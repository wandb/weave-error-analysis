"""
Auto Reviewer Service for automated trace review using the FAILS pipeline.

This service integrates the FAILS (Failure Analysis and Insight Learning System) pipeline
with the Error Analysis application to provide automated review of agent traces.

Key functionality:
1. Build context from AGENT_INFO for the review LLM
2. Convert batch execution traces to FAILS-compatible format
3. Run the FAILS categorization pipeline
4. Store and return review results

FAILS Integration Notes:
------------------------
The FAILS library (https://github.com/wandb/fails) provides a 3-step pipeline for
categorizing evaluation failures:

1. Draft Categorization (Open Coding): Each trace is analyzed individually to identify
   potential failure categories. This is inspired by qualitative research "open coding".

2. Clustering & Review: The draft categories from all traces are clustered into a
   canonical set of failure categories (max 7 categories).

3. Final Classification: Each trace is classified into exactly one of the canonical
   categories.

The pipeline expects trace data in this format:
{
    "id": str,           # Trace/query ID
    "inputs": dict,      # Input data (e.g., {"query": "...", "dimensions": {...}})
    "output": dict,      # Output data (e.g., {"response": "..."})
    "scores": dict       # Evaluation scores/metadata
}

See fails/CLAUDE.md for detailed documentation on the pipeline and API usage.
"""

import asyncio
import json
import os
from datetime import datetime
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field
from enum import Enum

from database import get_db, generate_id, now_iso

# Import FAILS pipeline components
# FAILS is installed via: pip install git+https://github.com/wandb/fails.git
FAILS_AVAILABLE = False

try:
    from fails.pipeline import run_pipeline
    from fails.prompts import (
        Category as FAILSCategory,
        FinalClassificationResult as FAILSClassificationResult,
        PipelineResult as FAILSPipelineResult,
    )
    FAILS_AVAILABLE = True
except ImportError as e:
    print(f"Warning: FAILS library not available. Install with: pip install git+https://github.com/wandb/fails.git")
    print(f"Import error: {e}")
    # Define stub types for when FAILS is not available
    FAILSCategory = None
    FAILSClassificationResult = None
    FAILSPipelineResult = None


class AutoReviewStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class ReviewedTrace(BaseModel):
    """A single trace with its automated review classification."""
    trace_id: str
    query_id: Optional[str] = None
    query_text: Optional[str] = None
    response_text: Optional[str] = None
    failure_category: str
    categorization_reason: str
    thinking: Optional[str] = None


class FailureCategory(BaseModel):
    """A failure category identified by the review."""
    name: str
    definition: str
    notes: Optional[str] = None
    count: int = 0
    trace_ids: List[str] = Field(default_factory=list)


class AutoReviewResult(BaseModel):
    """Result of an automated review session."""
    id: str
    batch_id: str
    agent_id: str
    status: AutoReviewStatus
    model_used: str
    failure_categories: List[FailureCategory]
    classifications: List[ReviewedTrace]
    report_markdown: Optional[str] = None
    total_traces: int = 0
    created_at: str
    completed_at: Optional[str] = None
    error_message: Optional[str] = None


class AutoReviewProgress(BaseModel):
    """Progress update during auto-review."""
    review_id: str
    status: str
    step: str  # 'draft_categorization', 'clustering', 'final_classification', 'complete'
    progress_percent: float
    message: str


class AutoReviewer:
    """
    Automated reviewer using the FAILS pipeline.
    
    The reviewer:
    1. Loads agent context from AGENT_INFO
    2. Fetches traces from a completed batch
    3. Runs the FAILS categorization pipeline
    4. Stores and returns categorization results
    """
    
    def __init__(
        self,
        agent_id: str,
        batch_id: str,
        model: str = "openai/gpt-4.1",
        max_concurrent_llm_calls: int = 10,
        n_samples: Optional[int] = None,
        debug: bool = False,
        filter_failures_only: bool = False
    ):
        self.agent_id = agent_id
        self.batch_id = batch_id
        self.model = model
        self.max_concurrent_llm_calls = max_concurrent_llm_calls
        self.n_samples = n_samples
        self.debug = debug
        self.filter_failures_only = filter_failures_only
        self._review_id: Optional[str] = None
    
    def _get_agent_info(self) -> Dict[str, Any]:
        """Get agent info from database."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT name, version, agent_type, framework, 
                       agent_info_raw, agent_info_parsed
                FROM agents WHERE id = ?
            """, (self.agent_id,))
            row = cursor.fetchone()
            if row:
                return dict(row)
            return {}
    
    def _build_user_context(self) -> str:
        """
        Build context from AGENT_INFO for the review LLM.
        
        This context helps the LLM understand what the agent is supposed to do,
        which improves categorization accuracy.
        """
        agent = self._get_agent_info()
        if not agent:
            return "No agent context available."
        
        parsed = json.loads(agent.get("agent_info_parsed", "{}")) if agent.get("agent_info_parsed") else {}
        
        context_parts = [
            f"# Agent Context",
            f"",
            f"**Agent Name**: {agent.get('name', 'Unknown')}",
            f"**Version**: {agent.get('version', '1.0.0')}",
            f"**Type**: {agent.get('agent_type', 'General')}",
            f"**Framework**: {agent.get('framework', 'Unknown')}",
        ]
        
        # Add purpose
        if parsed.get("purpose"):
            context_parts.extend([
                "",
                "## Purpose",
                parsed["purpose"],
            ])
        
        # Add capabilities
        if parsed.get("capabilities"):
            context_parts.extend([
                "",
                "## Capabilities",
            ])
            for cap in parsed["capabilities"]:
                context_parts.append(f"- {cap}")
        
        # Add limitations
        if parsed.get("limitations"):
            context_parts.extend([
                "",
                "## Limitations",
            ])
            for lim in parsed["limitations"]:
                context_parts.append(f"- {lim}")
        
        # Add success criteria
        if parsed.get("success_criteria"):
            context_parts.extend([
                "",
                "## Success Criteria",
            ])
            for i, criteria in enumerate(parsed["success_criteria"], 1):
                context_parts.append(f"{i}. {criteria}")
        
        # Add tool information
        if parsed.get("tools"):
            context_parts.extend([
                "",
                "## Available Tools",
            ])
            for tool in parsed["tools"]:
                context_parts.append(f"- **{tool.get('name', 'Unknown')}**: {tool.get('purpose', 'No description')}")
        
        return "\n".join(context_parts)
    
    def _get_batch_traces(self) -> List[Dict[str, Any]]:
        """
        Get all traces from the batch that have been executed.
        
        Returns traces in a format suitable for the FAILS pipeline.
        Supports filtering to only error/failed traces if filter_failures_only is True.
        """
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Build query based on filter_failures_only setting
            if self.filter_failures_only:
                # Only get error traces
                cursor.execute("""
                    SELECT id, query_text, response_text, trace_id, 
                           dimension_tuple, execution_status, error_message
                    FROM synthetic_queries
                    WHERE batch_id = ? AND execution_status = 'error'
                    ORDER BY id
                """, (self.batch_id,))
            else:
                # Get all executed traces (both success and error)
                cursor.execute("""
                    SELECT id, query_text, response_text, trace_id, 
                           dimension_tuple, execution_status, error_message
                    FROM synthetic_queries
                    WHERE batch_id = ? AND execution_status IN ('success', 'error')
                    ORDER BY id
                """, (self.batch_id,))
            
            traces = []
            for row in cursor.fetchall():
                row_dict = dict(row)
                
                # Parse dimension tuple
                dimension_tuple = {}
                if row_dict.get("dimension_tuple"):
                    try:
                        dimension_tuple = json.loads(row_dict["dimension_tuple"])
                    except:
                        pass
                
                # Format for FAILS pipeline
                traces.append({
                    "id": row_dict["trace_id"] or row_dict["id"],
                    "query_id": row_dict["id"],
                    "inputs": {
                        "query": row_dict["query_text"],
                        "dimensions": dimension_tuple
                    },
                    "output": {
                        "response": row_dict["response_text"],
                        "error": row_dict["error_message"]
                    },
                    "scores": {
                        # Include execution status as a score for FAILS to understand
                        "auto_review": True,
                        "execution_status": row_dict["execution_status"],
                        "has_error": row_dict["execution_status"] == "error"
                    }
                })
            
            return traces
    
    def _create_review_record(self) -> str:
        """Create a review record in the database."""
        review_id = generate_id()
        self._review_id = review_id
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO auto_reviews (
                    id, batch_id, agent_id, status, model_used, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
            """, (
                review_id,
                self.batch_id,
                self.agent_id,
                AutoReviewStatus.PENDING.value,
                self.model,
                now_iso()
            ))
        
        return review_id
    
    def _update_review_status(
        self,
        status: AutoReviewStatus,
        failure_categories: Optional[List[FailureCategory]] = None,
        classifications: Optional[List[ReviewedTrace]] = None,
        report_markdown: Optional[str] = None,
        error_message: Optional[str] = None
    ):
        """Update the review record in the database."""
        if not self._review_id:
            return
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            updates = ["status = ?"]
            params = [status.value]
            
            if status in (AutoReviewStatus.COMPLETED, AutoReviewStatus.FAILED):
                updates.append("completed_at = ?")
                params.append(now_iso())
            
            if failure_categories is not None:
                updates.append("failure_categories = ?")
                params.append(json.dumps([fc.model_dump() for fc in failure_categories]))
            
            if classifications is not None:
                updates.append("classifications = ?")
                params.append(json.dumps([c.model_dump() for c in classifications]))
            
            if report_markdown is not None:
                updates.append("report_markdown = ?")
                params.append(report_markdown)
            
            if error_message is not None:
                updates.append("error_message = ?")
                params.append(error_message)
            
            params.append(self._review_id)
            
            cursor.execute(f"""
                UPDATE auto_reviews
                SET {', '.join(updates)}
                WHERE id = ?
            """, params)
    
    async def run_review(self) -> AutoReviewResult:
        """
        Run the automated review pipeline.
        
        Returns:
            AutoReviewResult with failure categories and classifications
        """
        import random
        
        if not FAILS_AVAILABLE:
            raise RuntimeError(
                "FAILS library is not available. Please ensure the 'fails' package is installed."
            )
        
        # Create review record
        review_id = self._create_review_record()
        
        try:
            # Update status to running
            self._update_review_status(AutoReviewStatus.RUNNING)
            
            # Get batch traces
            traces = self._get_batch_traces()
            
            if not traces:
                filter_msg = " (with filter_failures_only=True)" if self.filter_failures_only else ""
                self._update_review_status(
                    AutoReviewStatus.FAILED,
                    error_message=f"No traces found in batch{filter_msg}"
                )
                return AutoReviewResult(
                    id=review_id,
                    batch_id=self.batch_id,
                    agent_id=self.agent_id,
                    status=AutoReviewStatus.FAILED,
                    model_used=self.model,
                    failure_categories=[],
                    classifications=[],
                    total_traces=0,
                    created_at=now_iso(),
                    error_message=f"No traces found in batch{filter_msg}"
                )
            
            # Apply n_samples if specified (random sample)
            if self.n_samples and self.n_samples < len(traces):
                traces = random.sample(traces, self.n_samples)
            
            # Build user context from AGENT_INFO
            user_context = self._build_user_context()
            
            # Run FAILS pipeline
            from rich.console import Console
            console = Console(quiet=not self.debug)  # Show output in debug mode
            
            pipeline_result = await run_pipeline(
                trace_data=traces,
                user_context=user_context,
                model=self.model,
                max_concurrent_llm_calls=self.max_concurrent_llm_calls,
                debug=self.debug,
                console=console
            )
            
            # Convert results to our format
            failure_categories = self._convert_categories(
                pipeline_result.failure_categories,
                pipeline_result.classifications
            )
            classifications = self._convert_classifications(
                pipeline_result.classifications,
                traces
            )
            
            # Generate report
            report = self._generate_report(failure_categories, classifications)
            
            # Update database
            self._update_review_status(
                AutoReviewStatus.COMPLETED,
                failure_categories=failure_categories,
                classifications=classifications,
                report_markdown=report
            )
            
            return AutoReviewResult(
                id=review_id,
                batch_id=self.batch_id,
                agent_id=self.agent_id,
                status=AutoReviewStatus.COMPLETED,
                model_used=self.model,
                failure_categories=failure_categories,
                classifications=classifications,
                report_markdown=report,
                total_traces=len(traces),
                created_at=now_iso(),
                completed_at=now_iso()
            )
            
        except Exception as e:
            error_msg = str(e)
            self._update_review_status(
                AutoReviewStatus.FAILED,
                error_message=error_msg
            )
            return AutoReviewResult(
                id=review_id,
                batch_id=self.batch_id,
                agent_id=self.agent_id,
                status=AutoReviewStatus.FAILED,
                model_used=self.model,
                failure_categories=[],
                classifications=[],
                total_traces=0,
                created_at=now_iso(),
                error_message=error_msg
            )
    
    def _convert_categories(
        self,
        categories: List[Any],
        classifications: List[Any]
    ) -> List[FailureCategory]:
        """Convert FAILS categories to our format with counts."""
        # Count occurrences of each category
        category_counts: Dict[str, List[str]] = {}
        for classification in classifications:
            cat_name = classification.failure_category
            if cat_name not in category_counts:
                category_counts[cat_name] = []
            category_counts[cat_name].append(classification.trace_id)
        
        result = []
        for category in categories:
            result.append(FailureCategory(
                name=category.failure_category_name,
                definition=category.failure_category_definition,
                notes=category.failure_category_notes,
                count=len(category_counts.get(category.failure_category_name, [])),
                trace_ids=category_counts.get(category.failure_category_name, [])
            ))
        
        return result
    
    def _convert_classifications(
        self,
        classifications: List[Any],
        original_traces: List[Dict[str, Any]]
    ) -> List[ReviewedTrace]:
        """Convert FAILS classifications to our format."""
        # Build lookup for original traces
        trace_lookup = {t["id"]: t for t in original_traces}
        
        result = []
        for classification in classifications:
            original = trace_lookup.get(classification.trace_id, {})
            
            result.append(ReviewedTrace(
                trace_id=classification.trace_id,
                query_id=original.get("query_id"),
                query_text=original.get("inputs", {}).get("query"),
                response_text=original.get("output", {}).get("response"),
                failure_category=classification.failure_category,
                categorization_reason=classification.categorization_reason,
                thinking=classification.thinking
            ))
        
        return result
    
    def _generate_report(
        self,
        categories: List[FailureCategory],
        classifications: List[ReviewedTrace]
    ) -> str:
        """Generate a markdown report of the review results."""
        lines = [
            "# Automated Review Report",
            "",
            f"**Batch ID**: {self.batch_id}",
            f"**Total Traces Reviewed**: {len(classifications)}",
            f"**Failure Categories Found**: {len([c for c in categories if c.count > 0])}",
            f"**Model Used**: {self.model}",
            "",
            "---",
            "",
            "## Failure Categories Summary",
            "",
        ]
        
        # Sort categories by count
        sorted_categories = sorted(categories, key=lambda c: c.count, reverse=True)
        
        for category in sorted_categories:
            if category.count > 0:
                pct = (category.count / len(classifications) * 100) if classifications else 0
                lines.extend([
                    f"### {category.name}",
                    f"",
                    f"**Count**: {category.count} ({pct:.1f}%)",
                    f"",
                    f"**Definition**: {category.definition}",
                    f"",
                ])
                if category.notes:
                    lines.append(f"**Notes**: {category.notes}")
                    lines.append("")
                lines.append("")
        
        lines.extend([
            "---",
            "",
            "## Individual Classifications",
            "",
        ])
        
        for i, classification in enumerate(classifications, 1):
            lines.extend([
                f"### {i}. {classification.failure_category}",
                "",
                f"**Query**: {classification.query_text[:200] if classification.query_text else 'N/A'}{'...' if classification.query_text and len(classification.query_text) > 200 else ''}",
                "",
                f"**Reason**: {classification.categorization_reason}",
                "",
            ])
        
        return "\n".join(lines)


# =============================================================================
# Database Functions
# =============================================================================

def get_auto_review(review_id: str) -> Optional[Dict[str, Any]]:
    """Get an auto-review by ID."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM auto_reviews WHERE id = ?", (review_id,))
        row = cursor.fetchone()
        if row:
            result = dict(row)
            # Parse JSON fields
            if result.get("failure_categories"):
                result["failure_categories"] = json.loads(result["failure_categories"])
            if result.get("classifications"):
                result["classifications"] = json.loads(result["classifications"])
            return result
        return None


# =============================================================================
# Session-to-FAILS Trace Conversion (Sprint 3)
# =============================================================================

def get_session_traces_for_fails(session_ids: List[str]) -> List[Dict[str, Any]]:
    """
    Convert session traces to FAILS-compatible format.
    
    Each session's conversation is converted into trace entries with:
    - inputs: The user message + context
    - output: The assistant response + tool calls  
    - scores: Any feedback or evaluation data we have
    
    Args:
        session_ids: List of session IDs to convert
        
    Returns:
        List of trace dicts in FAILS format
    """
    traces = []
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        for session_id in session_ids:
            # Get session metadata
            cursor.execute("""
                SELECT id, weave_session_id, batch_id, turn_count, 
                       has_error, error_summary, query_text, is_reviewed
                FROM sessions 
                WHERE id = ?
            """, (session_id,))
            session_row = cursor.fetchone()
            
            if not session_row:
                continue
            
            session = dict(session_row)
            
            # Get session notes (as evaluation/feedback data)
            cursor.execute("""
                SELECT id, content, note_type, call_id, created_at
                FROM session_notes
                WHERE session_id = ?
                ORDER BY created_at
            """, (session_id,))
            notes = [dict(r) for r in cursor.fetchall()]
            
            # Build feedback info from notes
            feedback_notes = [n["content"] for n in notes if n.get("note_type") in ("observation", "issue", "bug")]
            
            # Create a trace entry for the entire session
            # (FAILS analyzes at the trace level, and each session is a trace)
            trace = {
                "id": session_id,
                "session_id": session_id,
                "inputs": {
                    "query": session.get("query_text") or "(multi-turn session)",
                    "session_type": "batch" if session.get("batch_id") else "organic",
                    "turn_count": session.get("turn_count", 0),
                },
                "output": {
                    "has_error": session.get("has_error", False),
                    "error_summary": session.get("error_summary"),
                    "turn_count": session.get("turn_count", 0),
                },
                "scores": {
                    "is_reviewed": session.get("is_reviewed", False),
                    "has_error": session.get("has_error", False),
                    "has_feedback_notes": len(feedback_notes) > 0,
                    "feedback_notes": feedback_notes[:3] if feedback_notes else [],  # Limit to 3 notes
                }
            }
            
            traces.append(trace)
    
    return traces


class SessionAutoReviewer(AutoReviewer):
    """
    Automated reviewer for session traces using the FAILS pipeline.
    
    This reviewer analyzes sessions directly rather than synthetic batch data,
    allowing discovery of failure patterns from real user interactions.
    """
    
    def __init__(
        self,
        agent_id: str,
        session_ids: List[str],
        model: str = "openai/gpt-4.1",
        max_concurrent_llm_calls: int = 10,
        n_samples: Optional[int] = None,
        debug: bool = False,
        filter_failures_only: bool = False
    ):
        # Initialize base but override batch_id with None
        super().__init__(
            agent_id=agent_id,
            batch_id="sessions",  # Placeholder
            model=model,
            max_concurrent_llm_calls=max_concurrent_llm_calls,
            n_samples=n_samples,
            debug=debug,
            filter_failures_only=filter_failures_only
        )
        self.session_ids = session_ids
    
    def _get_batch_traces(self) -> List[Dict[str, Any]]:
        """Override to get session traces instead of batch traces."""
        traces = get_session_traces_for_fails(self.session_ids)
        
        # Apply failure filter if enabled
        if self.filter_failures_only:
            traces = [t for t in traces if t.get("scores", {}).get("has_error", False)]
        
        return traces
    
    def _create_review_record(self) -> str:
        """Create a review record for session review."""
        review_id = generate_id()
        self._review_id = review_id
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO auto_reviews (
                    id, batch_id, agent_id, status, model_used, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
            """, (
                review_id,
                f"sessions:{len(self.session_ids)}",  # Mark as session review
                self.agent_id,
                AutoReviewStatus.PENDING.value,
                self.model,
                now_iso()
            ))
        
        return review_id


async def run_session_auto_review(
    agent_id: str,
    session_ids: List[str],
    model: str = "openai/gpt-4.1",
    max_concurrent_llm_calls: int = 10,
    n_samples: Optional[int] = None,
    debug: bool = False,
    filter_failures_only: bool = False
) -> AutoReviewResult:
    """
    Run automated review on session traces.
    
    Args:
        agent_id: ID of the agent
        session_ids: List of session IDs to review
        model: LLM model to use for review
        max_concurrent_llm_calls: Maximum concurrent LLM API calls
        n_samples: Maximum number of traces to analyze (None = all)
        debug: Enable debug mode (verbose output, cheaper model)
        filter_failures_only: Only analyze failed/error sessions
        
    Returns:
        AutoReviewResult with the review findings
    """
    reviewer = SessionAutoReviewer(
        agent_id=agent_id,
        session_ids=session_ids,
        model=model,
        max_concurrent_llm_calls=max_concurrent_llm_calls,
        n_samples=n_samples,
        debug=debug,
        filter_failures_only=filter_failures_only
    )
    return await reviewer.run_review()


def get_batch_reviews(batch_id: str) -> List[Dict[str, Any]]:
    """Get all auto-reviews for a batch."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM auto_reviews 
            WHERE batch_id = ? 
            ORDER BY created_at DESC
        """, (batch_id,))
        
        results = []
        for row in cursor.fetchall():
            result = dict(row)
            if result.get("failure_categories"):
                result["failure_categories"] = json.loads(result["failure_categories"])
            if result.get("classifications"):
                result["classifications"] = json.loads(result["classifications"])
            results.append(result)
        
        return results


def get_latest_batch_review(batch_id: str) -> Optional[Dict[str, Any]]:
    """Get the most recent auto-review for a batch."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM auto_reviews 
            WHERE batch_id = ? 
            ORDER BY created_at DESC
            LIMIT 1
        """, (batch_id,))
        row = cursor.fetchone()
        if row:
            result = dict(row)
            if result.get("failure_categories"):
                result["failure_categories"] = json.loads(result["failure_categories"])
            if result.get("classifications"):
                result["classifications"] = json.loads(result["classifications"])
            return result
        return None


def delete_auto_review(review_id: str) -> bool:
    """Delete an auto-review."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM auto_reviews WHERE id = ?", (review_id,))
        return cursor.rowcount > 0


async def run_auto_review(
    agent_id: str,
    batch_id: str,
    model: str = "openai/gpt-4.1",
    max_concurrent_llm_calls: int = 10,
    n_samples: Optional[int] = None,
    debug: bool = False,
    filter_failures_only: bool = False
) -> AutoReviewResult:
    """
    Convenience function to run an automated review.
    
    Args:
        agent_id: ID of the agent
        batch_id: ID of the batch to review
        model: LLM model to use for review
        max_concurrent_llm_calls: Maximum concurrent LLM API calls
        n_samples: Maximum number of traces to analyze (None = all)
        debug: Enable debug mode (verbose output, cheaper model)
        filter_failures_only: Only analyze failed/error traces
        
    Returns:
        AutoReviewResult with the review findings
    """
    reviewer = AutoReviewer(
        agent_id=agent_id,
        batch_id=batch_id,
        model=model,
        max_concurrent_llm_calls=max_concurrent_llm_calls,
        n_samples=n_samples,
        debug=debug,
        filter_failures_only=filter_failures_only
    )
    return await reviewer.run_review()

