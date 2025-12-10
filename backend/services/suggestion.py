"""
AI Suggestion Service for trace quality analysis.

This service analyzes conversation traces and suggests quality issues to help
humans review faster. It uses:
1. Agent context (AGENT_INFO.md) - What the agent should do
2. Existing taxonomy - Established failure mode categories
3. Recent notes - Examples of human-written observations

See: fails.md for full design.
"""

import json
import asyncio
from typing import List, Optional, Dict, Any, Union
from dataclasses import dataclass
from datetime import datetime

import litellm

from database import get_db, get_db_readonly, generate_id, now_iso
from config import CATEGORIZATION_MODEL
from services.settings import get_setting


# =============================================================================
# Data Classes
# =============================================================================

@dataclass
class AnalysisContext:
    """All context needed for trace analysis."""
    agent_info: str                    # AGENT_INFO.md contents
    agent_name: str                    # Agent name for prompt
    failure_modes: List[Dict]          # Existing taxonomy with example notes
    recent_notes: List[Dict]           # Recent human-written notes for style


@dataclass
class Suggestion:
    """A suggestion for a trace quality issue."""
    id: str
    trace_id: str
    batch_id: Optional[str]
    session_id: Optional[str]
    
    has_issue: bool
    suggested_note: Optional[str]
    confidence: float
    thinking: Optional[str]
    
    failure_mode_id: Optional[str]
    failure_mode_name: Optional[str]
    suggested_category: Optional[str]
    
    status: str  # pending | accepted | edited | rejected | skipped
    created_at: str
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "trace_id": self.trace_id,
            "batch_id": self.batch_id,
            "session_id": self.session_id,
            "has_issue": self.has_issue,
            "suggested_note": self.suggested_note,
            "confidence": self.confidence,
            "thinking": self.thinking,
            "failure_mode_id": self.failure_mode_id,
            "failure_mode_name": self.failure_mode_name,
            "suggested_category": self.suggested_category,
            "status": self.status,
            "created_at": self.created_at,
        }


# =============================================================================
# Suggestion Service
# =============================================================================

class SuggestionService:
    """Analyzes traces using agent context, taxonomy, and notes to suggest quality observations."""
    
    def __init__(self, model: str = None):
        self.model = model or CATEGORIZATION_MODEL
    
    # -------------------------------------------------------------------------
    # Context Gathering
    # -------------------------------------------------------------------------
    
    def _get_agent_context(self, agent_id: str) -> tuple[str, str]:
        """Get agent info markdown and name."""
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT name, agent_info_raw FROM agents WHERE id = ?",
                (agent_id,)
            )
            row = cursor.fetchone()
            
            if not row:
                return "", "Unknown Agent"
            
            return row["agent_info_raw"] or "", row["name"] or "Unknown Agent"
    
    def _get_failure_modes_with_notes(self, limit_notes: int = 3) -> List[Dict]:
        """Get existing failure modes with example notes for each."""
        failure_modes = []
        
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            
            # Get all active failure modes
            cursor.execute("""
                SELECT id, name, description, severity 
                FROM failure_modes 
                WHERE status = 'active'
                ORDER BY times_seen DESC
            """)
            fm_rows = cursor.fetchall()
            
            for fm in fm_rows:
                # Get example notes for this failure mode
                cursor.execute("""
                    SELECT content 
                    FROM notes 
                    WHERE failure_mode_id = ?
                    ORDER BY created_at DESC
                    LIMIT ?
                """, (fm["id"], limit_notes))
                note_rows = cursor.fetchall()
                
                failure_modes.append({
                    "id": fm["id"],
                    "name": fm["name"],
                    "description": fm["description"],
                    "severity": fm["severity"],
                    "example_notes": [n["content"] for n in note_rows]
                })
        
        return failure_modes
    
    def _get_recent_notes(self, limit: int = 10) -> List[Dict]:
        """Get recent human-written notes for style reference."""
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT content, created_at, failure_mode_id
                FROM notes
                WHERE content IS NOT NULL AND content != ''
                ORDER BY created_at DESC
                LIMIT ?
            """, (limit,))
            rows = cursor.fetchall()
            
            return [
                {
                    "content": row["content"],
                    "created_at": row["created_at"],
                    "has_category": bool(row["failure_mode_id"])
                }
                for row in rows
            ]
    
    def _get_context(self, agent_id: str) -> AnalysisContext:
        """Gather all context for LLM analysis."""
        agent_info, agent_name = self._get_agent_context(agent_id)
        failure_modes = self._get_failure_modes_with_notes()
        recent_notes = self._get_recent_notes()
        
        return AnalysisContext(
            agent_info=agent_info,
            agent_name=agent_name,
            failure_modes=failure_modes,
            recent_notes=recent_notes
        )
    
    # -------------------------------------------------------------------------
    # Prompt Building
    # -------------------------------------------------------------------------
    
    def _build_analysis_prompt(
        self, 
        context: AnalysisContext, 
        trace_data: Dict
    ) -> List[Dict]:
        """Build the analysis prompt with all context."""
        
        # Format failure modes section
        failure_modes_text = ""
        if context.failure_modes:
            fm_parts = []
            for fm in context.failure_modes:
                fm_text = f"- **{fm['name']}**: {fm['description']}"
                if fm["example_notes"]:
                    fm_text += "\n  Example notes:"
                    for note in fm["example_notes"]:
                        # Truncate long notes
                        note_preview = note[:150] + "..." if len(note) > 150 else note
                        fm_text += f'\n    • "{note_preview}"'
                fm_parts.append(fm_text)
            failure_modes_text = "\n".join(fm_parts)
        else:
            failure_modes_text = "(No existing failure modes yet)"
        
        # Format recent notes section
        recent_notes_text = ""
        if context.recent_notes:
            notes_parts = []
            for note in context.recent_notes[:5]:  # Just show 5 for style reference
                note_preview = note["content"][:200] + "..." if len(note["content"]) > 200 else note["content"]
                notes_parts.append(f'• "{note_preview}"')
            recent_notes_text = "\n".join(notes_parts)
        else:
            recent_notes_text = "(No notes written yet - write in a clear, concise style)"
        
        # Format trace data
        trace_text = self._format_trace_for_prompt(trace_data)
        
        system_prompt = f"""You are analyzing traces from a {context.agent_name} to identify quality issues.

=== AGENT CONTEXT ===
{context.agent_info if context.agent_info else "(No agent documentation available)"}

=== EXISTING FAILURE MODES ===
These are the established failure categories. Use these when applicable:

{failure_modes_text}

=== RECENT NOTES (for style reference) ===
{recent_notes_text}"""

        user_prompt = f"""=== TRACE TO ANALYZE ===
{trace_text}

=== TASK ===
Analyze this trace for quality issues. Consider:
1. Did the agent use appropriate tools?
2. Is the information accurate per the agent's knowledge base?
3. Was the tone appropriate?
4. Were any limitations violated?
5. Did the agent follow documented policies?

If there's an issue:
- Use an existing failure mode category if one fits
- Write a note in similar style to the examples
- If no existing category fits, suggest a new one

If the response looks good, respond with no issue.

=== OUTPUT FORMAT ===
Respond in JSON:
{{
  "has_issue": true/false,
  "suggested_note": "Description of issue..." or null,
  "failure_mode_id": "existing_mode_id" or null,
  "suggested_category": "New Category Name" or null,
  "confidence": 0.0-1.0,
  "thinking": "Brief reasoning for this judgment"
}}"""

        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
    
    def _format_trace_for_prompt(self, trace_data: Dict) -> str:
        """Format trace data for the prompt."""
        parts = []
        
        # Basic info
        if trace_data.get("query"):
            parts.append(f"User Query: {trace_data['query']}")
        
        if trace_data.get("response"):
            parts.append(f"Agent Response: {trace_data['response']}")
        
        # Conversation if available
        if trace_data.get("conversation"):
            parts.append("\n--- Conversation ---")
            for msg in trace_data["conversation"]:
                msg_type = msg.get("type", "unknown")
                content = msg.get("content", "")
                
                if msg_type == "user":
                    parts.append(f"User: {content}")
                elif msg_type == "assistant":
                    parts.append(f"Agent: {content}")
                elif msg_type == "tool_call":
                    tool_name = msg.get("tool_name", "unknown")
                    tool_input = msg.get("tool_input", {})
                    parts.append(f"[Tool Call: {tool_name}({json.dumps(tool_input)[:200]})]")
                elif msg_type == "tool_result":
                    tool_name = msg.get("tool_name", "unknown")
                    tool_result = msg.get("tool_result", "")
                    result_preview = str(tool_result)[:200] + "..." if len(str(tool_result)) > 200 else str(tool_result)
                    parts.append(f"[Tool Result ({tool_name}): {result_preview}]")
        
        # Tools used
        if trace_data.get("tools_used"):
            parts.append(f"\nTools used: {', '.join(trace_data['tools_used'])}")
        elif "conversation" not in trace_data:
            parts.append("\nTools used: (none)")
        
        # Error info
        if trace_data.get("has_error"):
            parts.append(f"\n⚠️ Error: {trace_data.get('error_summary', 'Unknown error')}")
        
        return "\n".join(parts)
    
    # -------------------------------------------------------------------------
    # Trace Analysis
    # -------------------------------------------------------------------------
    
    async def analyze_trace(
        self, 
        trace_data: Dict,
        context: AnalysisContext,
        batch_id: Optional[str] = None,
        session_id: Optional[str] = None
    ) -> Suggestion:
        """Analyze a single trace and return a suggestion."""
        
        trace_id = trace_data.get("trace_id") or trace_data.get("id") or generate_id()
        
        try:
            messages = self._build_analysis_prompt(context, trace_data)
            
            response = await asyncio.to_thread(
                litellm.completion,
                model=self.model,
                messages=messages,
                response_format={"type": "json_object"},
                temperature=0.3
            )
            
            result = json.loads(response.choices[0].message.content)
            
            # Look up failure mode name if we have an ID
            failure_mode_name = None
            if result.get("failure_mode_id"):
                with get_db_readonly() as conn:
                    cursor = conn.cursor()
                    cursor.execute(
                        "SELECT name FROM failure_modes WHERE id = ?",
                        (result["failure_mode_id"],)
                    )
                    row = cursor.fetchone()
                    if row:
                        failure_mode_name = row["name"]
            
            suggestion = Suggestion(
                id=generate_id(),
                trace_id=trace_id,
                batch_id=batch_id,
                session_id=session_id,
                has_issue=result.get("has_issue", False),
                suggested_note=result.get("suggested_note"),
                confidence=result.get("confidence", 0.5),
                thinking=result.get("thinking"),
                failure_mode_id=result.get("failure_mode_id"),
                failure_mode_name=failure_mode_name,
                suggested_category=result.get("suggested_category"),
                status="pending",
                created_at=now_iso()
            )
            
            # Save to database
            self._save_suggestion(suggestion)
            
            return suggestion
            
        except Exception as e:
            # Return a failed suggestion
            return Suggestion(
                id=generate_id(),
                trace_id=trace_id,
                batch_id=batch_id,
                session_id=session_id,
                has_issue=False,
                suggested_note=None,
                confidence=0.0,
                thinking=f"Analysis failed: {str(e)}",
                failure_mode_id=None,
                failure_mode_name=None,
                suggested_category=None,
                status="error",
                created_at=now_iso()
            )
    
    async def analyze_batch(
        self, 
        agent_id: str,
        batch_id: str,
        max_concurrent: int = 10
    ) -> List[Suggestion]:
        """Analyze all traces in a batch."""
        
        # Load context once
        context = self._get_context(agent_id)
        
        # Get traces for the batch
        traces = self._get_batch_traces(batch_id)
        
        if not traces:
            return []
        
        # Analyze traces with concurrency limit
        semaphore = asyncio.Semaphore(max_concurrent)
        
        async def analyze_with_limit(trace):
            async with semaphore:
                return await self.analyze_trace(
                    trace_data=trace,
                    context=context,
                    batch_id=batch_id,
                    session_id=trace.get("session_id")
                )
        
        suggestions = await asyncio.gather(*[
            analyze_with_limit(t) for t in traces
        ])
        
        return list(suggestions)
    
    async def analyze_session(
        self, 
        agent_id: str,
        session_id: str
    ) -> Suggestion:
        """Analyze a single session and return a suggestion."""
        
        context = self._get_context(agent_id)
        trace_data = self._get_session_trace(session_id)
        
        if not trace_data:
            return Suggestion(
                id=generate_id(),
                trace_id=session_id,
                batch_id=None,
                session_id=session_id,
                has_issue=False,
                suggested_note=None,
                confidence=0.0,
                thinking="Session not found or has no conversation data",
                failure_mode_id=None,
                failure_mode_name=None,
                suggested_category=None,
                status="error",
                created_at=now_iso()
            )
        
        return await self.analyze_trace(
            trace_data=trace_data,
            context=context,
            batch_id=trace_data.get("batch_id"),
            session_id=session_id
        )
    
    # -------------------------------------------------------------------------
    # Trace Data Retrieval
    # -------------------------------------------------------------------------
    
    def _get_batch_traces(self, batch_id: str) -> List[Dict]:
        """Get trace data for all queries in a batch."""
        traces = []
        
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            
            # Get queries with their session data
            cursor.execute("""
                SELECT 
                    sq.id, sq.query_text, sq.response_text, sq.trace_id,
                    sq.execution_status, sq.error_message,
                    s.id as session_id, s.has_error, s.error_summary
                FROM synthetic_queries sq
                LEFT JOIN sessions s ON s.query_id = sq.id
                WHERE sq.batch_id = ? AND sq.execution_status = 'success'
            """, (batch_id,))
            
            for row in cursor.fetchall():
                traces.append({
                    "id": row["id"],
                    "trace_id": row["trace_id"],
                    "session_id": row["session_id"],
                    "query": row["query_text"],
                    "response": row["response_text"],
                    "has_error": bool(row["has_error"]) if row["has_error"] is not None else False,
                    "error_summary": row["error_summary"],
                })
        
        return traces
    
    def _get_session_trace(self, session_id: str) -> Optional[Dict]:
        """Get trace data for a session."""
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT 
                    s.id, s.batch_id, s.has_error, s.error_summary,
                    sq.query_text, sq.response_text
                FROM sessions s
                LEFT JOIN synthetic_queries sq ON sq.id = s.query_id
                WHERE s.id = ?
            """, (session_id,))
            
            row = cursor.fetchone()
            if not row:
                return None
            
            return {
                "id": row["id"],
                "trace_id": row["id"],
                "session_id": row["id"],
                "batch_id": row["batch_id"],
                "query": row["query_text"],
                "response": row["response_text"],
                "has_error": bool(row["has_error"]),
                "error_summary": row["error_summary"],
            }
    
    # -------------------------------------------------------------------------
    # Database Operations
    # -------------------------------------------------------------------------
    
    def _save_suggestion(self, suggestion: Suggestion):
        """Save a suggestion to the database."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO trace_suggestions 
                (id, trace_id, batch_id, session_id, has_issue, suggested_note, 
                 confidence, thinking, failure_mode_id, suggested_category, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                suggestion.id,
                suggestion.trace_id,
                suggestion.batch_id,
                suggestion.session_id,
                suggestion.has_issue,
                suggestion.suggested_note,
                suggestion.confidence,
                suggestion.thinking,
                suggestion.failure_mode_id,
                suggestion.suggested_category,
                suggestion.status,
                suggestion.created_at
            ))
    
    def get_suggestions_for_session(self, session_id: str) -> List[Suggestion]:
        """Get all suggestions for a session."""
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT ts.*, fm.name as failure_mode_name
                FROM trace_suggestions ts
                LEFT JOIN failure_modes fm ON ts.failure_mode_id = fm.id
                WHERE ts.session_id = ?
                ORDER BY ts.created_at DESC
            """, (session_id,))
            
            return [self._row_to_suggestion(row) for row in cursor.fetchall()]
    
    def get_suggestions_for_batch(self, batch_id: str) -> List[Suggestion]:
        """Get all suggestions for a batch."""
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT ts.*, fm.name as failure_mode_name
                FROM trace_suggestions ts
                LEFT JOIN failure_modes fm ON ts.failure_mode_id = fm.id
                WHERE ts.batch_id = ?
                ORDER BY ts.confidence DESC, ts.created_at DESC
            """, (batch_id,))
            
            return [self._row_to_suggestion(row) for row in cursor.fetchall()]
    
    def get_pending_suggestions(
        self, 
        batch_id: Optional[str] = None,
        min_confidence: Optional[float] = None
    ) -> List[Suggestion]:
        """Get pending suggestions, optionally filtered."""
        # Use setting if not explicitly provided
        if min_confidence is None:
            threshold_str = get_setting("suggestion_confidence_threshold", "0.6")
            min_confidence = float(threshold_str)
        
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            
            query = """
                SELECT ts.*, fm.name as failure_mode_name
                FROM trace_suggestions ts
                LEFT JOIN failure_modes fm ON ts.failure_mode_id = fm.id
                WHERE ts.status = 'pending' AND ts.has_issue = 1 AND ts.confidence >= ?
            """
            params: List[Any] = [min_confidence]
            
            if batch_id:
                query += " AND ts.batch_id = ?"
                params.append(batch_id)
            
            query += " ORDER BY ts.confidence DESC, ts.created_at DESC"
            
            cursor.execute(query, params)
            return [self._row_to_suggestion(row) for row in cursor.fetchall()]
    
    def _row_to_suggestion(self, row) -> Suggestion:
        """Convert a database row to a Suggestion object."""
        return Suggestion(
            id=row["id"],
            trace_id=row["trace_id"],
            batch_id=row["batch_id"],
            session_id=row["session_id"],
            has_issue=bool(row["has_issue"]),
            suggested_note=row["suggested_note"],
            confidence=row["confidence"] or 0.0,
            thinking=row["thinking"],
            failure_mode_id=row["failure_mode_id"],
            failure_mode_name=row["failure_mode_name"] if "failure_mode_name" in row.keys() else None,
            suggested_category=row["suggested_category"],
            status=row["status"],
            created_at=row["created_at"]
        )
    
    # -------------------------------------------------------------------------
    # User Actions
    # -------------------------------------------------------------------------
    
    def accept_suggestion(
        self, 
        suggestion_id: str, 
        edited_text: Optional[str] = None,
        failure_mode_id: Optional[str] = None
    ) -> Optional[Dict]:
        """
        Accept a suggestion, creating a note.
        
        Returns the created note dict.
        """
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Get the suggestion
            cursor.execute("SELECT * FROM trace_suggestions WHERE id = ?", (suggestion_id,))
            row = cursor.fetchone()
            
            if not row:
                return None
            
            note_text = edited_text or row["suggested_note"]
            if not note_text:
                return None
            
            # Determine final failure mode ID
            final_fm_id = failure_mode_id or row["failure_mode_id"]
            
            # If we have a suggested_category but no failure_mode_id, create a new one
            if not final_fm_id and row["suggested_category"]:
                fm_id = generate_id()
                now = now_iso()
                cursor.execute("""
                    INSERT INTO failure_modes 
                    (id, name, description, severity, created_at, last_seen_at, times_seen, status)
                    VALUES (?, ?, ?, ?, ?, ?, 1, 'active')
                """, (
                    fm_id,
                    row["suggested_category"],
                    f"Auto-created from AI suggestion",
                    "medium",
                    now,
                    now
                ))
                final_fm_id = fm_id
            
            # Create the note
            note_id = generate_id()
            now = now_iso()
            
            cursor.execute("""
                INSERT INTO notes 
                (id, content, trace_id, failure_mode_id, assignment_method, 
                 created_at, assigned_at, session_id, source_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                note_id,
                note_text,
                row["trace_id"],
                final_fm_id,
                "ai_suggestion",
                now,
                now if final_fm_id else None,
                row["session_id"],
                "ai_suggestion"
            ))
            
            # Update failure mode stats if assigned
            if final_fm_id:
                cursor.execute("""
                    UPDATE failure_modes 
                    SET times_seen = times_seen + 1, last_seen_at = ?
                    WHERE id = ?
                """, (now, final_fm_id))
            
            # Update suggestion status
            status = "edited" if edited_text else "accepted"
            cursor.execute("""
                UPDATE trace_suggestions 
                SET status = ?, user_note_id = ?, reviewed_at = ?
                WHERE id = ?
            """, (status, note_id, now, suggestion_id))
            
            return {
                "note_id": note_id,
                "content": note_text,
                "failure_mode_id": final_fm_id,
                "session_id": row["session_id"],
                "created_at": now
            }
    
    def skip_suggestion(self, suggestion_id: str) -> bool:
        """Mark a suggestion as skipped."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE trace_suggestions 
                SET status = 'skipped', reviewed_at = ?
                WHERE id = ?
            """, (now_iso(), suggestion_id))
            
            return cursor.rowcount > 0
    
    def reject_suggestion(self, suggestion_id: str) -> bool:
        """Mark a suggestion as rejected (incorrect)."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE trace_suggestions 
                SET status = 'rejected', reviewed_at = ?
                WHERE id = ?
            """, (now_iso(), suggestion_id))
            
            return cursor.rowcount > 0
    
    def bulk_accept_suggestions(
        self, 
        suggestion_ids: List[str]
    ) -> Dict:
        """Accept multiple suggestions at once."""
        results = {
            "accepted": 0,
            "failed": 0,
            "notes_created": []
        }
        
        for suggestion_id in suggestion_ids:
            try:
                note = self.accept_suggestion(suggestion_id)
                if note:
                    results["accepted"] += 1
                    results["notes_created"].append(note)
                else:
                    results["failed"] += 1
            except Exception:
                results["failed"] += 1
        
        return results
    
    def bulk_reject_suggestions(self, suggestion_ids: List[str]) -> Dict:
        """Reject multiple suggestions at once."""
        results = {
            "rejected": 0,
            "failed": 0
        }
        
        for suggestion_id in suggestion_ids:
            try:
                if self.reject_suggestion(suggestion_id):
                    results["rejected"] += 1
                else:
                    results["failed"] += 1
            except Exception:
                results["failed"] += 1
        
        return results
    
    def bulk_skip_suggestions(self, suggestion_ids: List[str]) -> Dict:
        """Skip multiple suggestions at once."""
        results = {
            "skipped": 0,
            "failed": 0
        }
        
        for suggestion_id in suggestion_ids:
            try:
                if self.skip_suggestion(suggestion_id):
                    results["skipped"] += 1
                else:
                    results["failed"] += 1
            except Exception:
                results["failed"] += 1
        
        return results
    
    # -------------------------------------------------------------------------
    # Statistics
    # -------------------------------------------------------------------------
    
    def get_suggestion_stats(self, batch_id: Optional[str] = None) -> Dict:
        """Get statistics about suggestions including accept rate."""
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            
            base_query = "SELECT status, COUNT(*) as count FROM trace_suggestions"
            params = []
            
            if batch_id:
                base_query += " WHERE batch_id = ?"
                params.append(batch_id)
            
            base_query += " GROUP BY status"
            
            cursor.execute(base_query, params)
            rows = cursor.fetchall()
            
            stats = {row["status"]: row["count"] for row in rows}
            
            # Get issues found
            issue_query = "SELECT COUNT(*) as count FROM trace_suggestions WHERE has_issue = 1"
            if batch_id:
                issue_query += " AND batch_id = ?"
                cursor.execute(issue_query, [batch_id])
            else:
                cursor.execute(issue_query)
            
            stats["issues_found"] = cursor.fetchone()["count"]
            stats["total"] = sum(stats.get(s, 0) for s in ["pending", "accepted", "edited", "rejected", "skipped", "error"])
            
            # Calculate accept rate (accepted + edited) / (reviewed total)
            reviewed = stats.get("accepted", 0) + stats.get("edited", 0) + stats.get("rejected", 0) + stats.get("skipped", 0)
            accepted_total = stats.get("accepted", 0) + stats.get("edited", 0)
            stats["accept_rate"] = round(accepted_total / reviewed, 3) if reviewed > 0 else 0.0
            stats["reviewed_total"] = reviewed
            
            return stats
    
    def get_suggestion_history(
        self, 
        batch_id: Optional[str] = None,
        status_filter: Optional[List[str]] = None,
        limit: int = 50,
        offset: int = 0
    ) -> Dict:
        """Get history of reviewed suggestions (accepted, edited, rejected, skipped)."""
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            
            # Default to all non-pending statuses
            if not status_filter:
                status_filter = ["accepted", "edited", "rejected", "skipped"]
            
            placeholders = ",".join(["?" for _ in status_filter])
            
            query = f"""
                SELECT ts.*, fm.name as failure_mode_name
                FROM trace_suggestions ts
                LEFT JOIN failure_modes fm ON ts.failure_mode_id = fm.id
                WHERE ts.status IN ({placeholders})
            """
            params: List[Any] = list(status_filter)
            
            if batch_id:
                query += " AND ts.batch_id = ?"
                params.append(batch_id)
            
            # Get total count first
            count_query = query.replace("SELECT ts.*, fm.name as failure_mode_name", "SELECT COUNT(*) as count")
            cursor.execute(count_query, params)
            total_count = cursor.fetchone()["count"]
            
            # Get paginated results
            query += " ORDER BY ts.reviewed_at DESC LIMIT ? OFFSET ?"
            params.extend([limit, offset])
            
            cursor.execute(query, params)
            suggestions = [self._row_to_suggestion(row) for row in cursor.fetchall()]
            
            return {
                "suggestions": suggestions,
                "total_count": total_count,
                "limit": limit,
                "offset": offset,
                "has_more": (offset + len(suggestions)) < total_count
            }


# Singleton instance
suggestion_service = SuggestionService()

