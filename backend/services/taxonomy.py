"""
Taxonomy service for managing failure modes and note categorization.

Handles:
- CRUD operations for failure modes
- Note-to-failure-mode assignment
- AI-powered categorization with semantic matching
- Saturation tracking
"""

from typing import Optional, List

from pydantic import BaseModel, Field

from database import get_db, generate_id, now_iso
from services.llm import LLMClient
from prompts import prompt_manager


# =============================================================================
# Pydantic Models for LLM Responses
# =============================================================================

class NewCategoryDetails(BaseModel):
    """Details for a new failure mode category."""
    name: str = Field(description="Short descriptive name")
    description: str = Field(description="Clear description of this failure pattern")
    severity: str = Field(description="Severity level: high, medium, or low")
    suggested_fix: Optional[str] = Field(default=None, description="Suggestion for addressing this issue")


class CategorySuggestion(BaseModel):
    """LLM response for category suggestion."""
    match_type: str = Field(description="'existing' if matches existing mode, 'new' if new category needed")
    existing_mode_id: Optional[str] = Field(default=None, description="ID of matching mode if match_type is existing")
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence score 0.0-1.0")
    reasoning: str = Field(description="Brief explanation of the decision")
    new_category: Optional[NewCategoryDetails] = Field(default=None, description="New category details if match_type is new")


class TaxonomyImprovementSuggestion(BaseModel):
    """A single taxonomy improvement suggestion."""
    type: str = Field(description="Type of improvement: merge, split, or rename")
    mode_ids: List[str] = Field(default_factory=list, description="IDs of affected failure modes")
    reason: str = Field(description="Why this change is recommended")
    suggested_name: Optional[str] = Field(default=None, description="New name if applicable")


class TaxonomyImprovementsResponse(BaseModel):
    """LLM response for taxonomy improvements."""
    suggestions: List[TaxonomyImprovementSuggestion] = Field(default_factory=list)
    overall_assessment: str = Field(description="Brief summary of taxonomy health")


# ============================================================================
# Data Classes
# ============================================================================

class FailureMode:
    """A failure mode category in the taxonomy."""
    
    # Valid status values
    VALID_STATUSES = ["active", "investigating", "resolved", "wont_fix"]
    
    def __init__(
        self,
        id: str,
        name: str,
        description: str,
        severity: str = "medium",
        suggested_fix: Optional[str] = None,
        created_at: Optional[str] = None,
        last_seen_at: Optional[str] = None,
        times_seen: int = 1,
        note_ids: Optional[list] = None,
        status: str = "active",
        status_changed_at: Optional[str] = None
    ):
        self.id = id
        self.name = name
        self.description = description
        self.severity = severity
        self.suggested_fix = suggested_fix
        self.created_at = created_at or now_iso()
        self.last_seen_at = last_seen_at or self.created_at
        self.times_seen = times_seen
        self.note_ids = note_ids or []
        self.status = status if status in self.VALID_STATUSES else "active"
        self.status_changed_at = status_changed_at
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "severity": self.severity,
            "suggested_fix": self.suggested_fix,
            "created_at": self.created_at,
            "last_seen_at": self.last_seen_at,
            "times_seen": self.times_seen,
            "note_ids": self.note_ids,
            "status": self.status,
            "status_changed_at": self.status_changed_at
        }


class TaxonomyNote:
    """A note that can be assigned to a failure mode."""
    
    def __init__(
        self,
        id: str,
        content: str,
        trace_id: Optional[str] = None,
        weave_ref: Optional[str] = None,
        weave_url: Optional[str] = None,
        weave_feedback_id: Optional[str] = None,
        failure_mode_id: Optional[str] = None,
        assignment_method: Optional[str] = None,
        created_at: Optional[str] = None,
        assigned_at: Optional[str] = None,
        session_id: Optional[str] = None,
        source_type: Optional[str] = None
    ):
        self.id = id
        self.content = content
        self.trace_id = trace_id
        self.weave_ref = weave_ref
        self.weave_url = weave_url
        self.weave_feedback_id = weave_feedback_id
        self.failure_mode_id = failure_mode_id
        self.assignment_method = assignment_method
        self.created_at = created_at or now_iso()
        self.assigned_at = assigned_at
        self.session_id = session_id
        self.source_type = source_type or 'weave_feedback'
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "content": self.content,
            "trace_id": self.trace_id,
            "weave_ref": self.weave_ref,
            "weave_url": self.weave_url,
            "weave_feedback_id": self.weave_feedback_id,
            "failure_mode_id": self.failure_mode_id,
            "assignment_method": self.assignment_method,
            "created_at": self.created_at,
            "assigned_at": self.assigned_at,
            "session_id": self.session_id,
            "source_type": self.source_type
        }


# ============================================================================
# Taxonomy Service
# ============================================================================

class TaxonomyService:
    """Service for managing the failure mode taxonomy."""
    
    def __init__(self):
        # Default LLM client (fallback, but prefer prompt-specific clients)
        self._default_llm = LLMClient()
    
    # ------------------------------------------------------------------------
    # Failure Mode CRUD
    # ------------------------------------------------------------------------
    
    def get_all_failure_modes(self, agent_id: Optional[str] = None) -> list[FailureMode]:
        """Get all failure modes with their associated notes, optionally filtered by agent."""
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Get failure modes, optionally filtered by agent_id
            if agent_id:
                cursor.execute("""
                    SELECT * FROM failure_modes 
                    WHERE agent_id = ? OR agent_id IS NULL
                    ORDER BY times_seen DESC, last_seen_at DESC
                """, (agent_id,))
            else:
                cursor.execute("""
                    SELECT * FROM failure_modes 
                    ORDER BY times_seen DESC, last_seen_at DESC
                """)
            rows = cursor.fetchall()
            
            failure_modes = []
            for row in rows:
                # Get notes for this failure mode
                cursor.execute(
                    "SELECT id FROM notes WHERE failure_mode_id = ?",
                    (row["id"],)
                )
                note_ids = [n["id"] for n in cursor.fetchall()]
                
                failure_modes.append(FailureMode(
                    id=row["id"],
                    name=row["name"],
                    description=row["description"],
                    severity=row["severity"],
                    suggested_fix=row["suggested_fix"],
                    created_at=row["created_at"],
                    last_seen_at=row["last_seen_at"],
                    times_seen=row["times_seen"],
                    note_ids=note_ids,
                    status=row["status"] if "status" in row.keys() else "active",
                    status_changed_at=row["status_changed_at"] if "status_changed_at" in row.keys() else None
                ))
            
            return failure_modes
    
    def get_failure_mode(self, mode_id: str) -> Optional[FailureMode]:
        """Get a single failure mode by ID."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM failure_modes WHERE id = ?", (mode_id,))
            row = cursor.fetchone()
            
            if not row:
                return None
            
            cursor.execute(
                "SELECT id FROM notes WHERE failure_mode_id = ?",
                (mode_id,)
            )
            note_ids = [n["id"] for n in cursor.fetchall()]
            
            return FailureMode(
                id=row["id"],
                name=row["name"],
                description=row["description"],
                severity=row["severity"],
                suggested_fix=row["suggested_fix"],
                created_at=row["created_at"],
                last_seen_at=row["last_seen_at"],
                times_seen=row["times_seen"],
                note_ids=note_ids,
                status=row["status"] if "status" in row.keys() else "active",
                status_changed_at=row["status_changed_at"] if "status_changed_at" in row.keys() else None
            )
    
    def create_failure_mode(
        self,
        name: str,
        description: str,
        severity: str = "medium",
        suggested_fix: Optional[str] = None,
        agent_id: Optional[str] = None
    ) -> FailureMode:
        """Create a new failure mode, optionally associated with an agent."""
        mode_id = generate_id()
        now = now_iso()
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO failure_modes 
                (id, name, description, severity, suggested_fix, created_at, last_seen_at, times_seen, agent_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
            """, (mode_id, name, description, severity, suggested_fix, now, now, agent_id))
        
        return FailureMode(
            id=mode_id,
            name=name,
            description=description,
            severity=severity,
            suggested_fix=suggested_fix,
            created_at=now,
            last_seen_at=now,
            times_seen=1
        )
    
    def update_failure_mode(
        self,
        mode_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        severity: Optional[str] = None,
        suggested_fix: Optional[str] = None,
        status: Optional[str] = None
    ) -> Optional[FailureMode]:
        """Update a failure mode."""
        mode = self.get_failure_mode(mode_id)
        if not mode:
            return None
        
        # Check if status is changing
        status_changed = status is not None and status != mode.status
        status_changed_at = now_iso() if status_changed else mode.status_changed_at
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE failure_modes 
                SET name = ?, description = ?, severity = ?, suggested_fix = ?,
                    status = ?, status_changed_at = ?
                WHERE id = ?
            """, (
                name or mode.name,
                description or mode.description,
                severity or mode.severity,
                suggested_fix if suggested_fix is not None else mode.suggested_fix,
                status if status in FailureMode.VALID_STATUSES else mode.status,
                status_changed_at,
                mode_id
            ))
        
        return self.get_failure_mode(mode_id)
    
    def update_failure_mode_status(
        self,
        mode_id: str,
        status: str
    ) -> Optional[FailureMode]:
        """Update only the status of a failure mode."""
        if status not in FailureMode.VALID_STATUSES:
            raise ValueError(f"Invalid status: {status}. Must be one of {FailureMode.VALID_STATUSES}")
        
        mode = self.get_failure_mode(mode_id)
        if not mode:
            return None
        
        now = now_iso()
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE failure_modes 
                SET status = ?, status_changed_at = ?
                WHERE id = ?
            """, (status, now, mode_id))
        
        return self.get_failure_mode(mode_id)
    
    def delete_failure_mode(self, mode_id: str) -> bool:
        """Delete a failure mode. Notes are unassigned, not deleted."""
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Unassign notes from this mode
            cursor.execute("""
                UPDATE notes 
                SET failure_mode_id = NULL, assigned_at = NULL, assignment_method = NULL
                WHERE failure_mode_id = ?
            """, (mode_id,))
            
            # Delete the failure mode
            cursor.execute("DELETE FROM failure_modes WHERE id = ?", (mode_id,))
            
            return cursor.rowcount > 0
    
    def merge_failure_modes(
        self,
        source_id: str,
        target_id: str,
        new_name: Optional[str] = None,
        new_description: Optional[str] = None
    ) -> Optional[FailureMode]:
        """Merge source failure mode into target. Source is deleted."""
        source = self.get_failure_mode(source_id)
        target = self.get_failure_mode(target_id)
        
        if not source or not target:
            return None
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Move notes from source to target
            cursor.execute("""
                UPDATE notes SET failure_mode_id = ? WHERE failure_mode_id = ?
            """, (target_id, source_id))
            
            # Update target stats
            cursor.execute("""
                UPDATE failure_modes 
                SET times_seen = times_seen + ?,
                    last_seen_at = ?,
                    name = ?,
                    description = ?
                WHERE id = ?
            """, (
                source.times_seen,
                now_iso(),
                new_name or target.name,
                new_description or target.description,
                target_id
            ))
            
            # Delete source
            cursor.execute("DELETE FROM failure_modes WHERE id = ?", (source_id,))
        
        return self.get_failure_mode(target_id)
    
    # ------------------------------------------------------------------------
    # Note Management
    # ------------------------------------------------------------------------
    
    def get_all_notes(self, agent_id: Optional[str] = None) -> list[TaxonomyNote]:
        """Get all notes, optionally filtered by agent."""
        with get_db() as conn:
            cursor = conn.cursor()
            
            if agent_id:
                cursor.execute("""
                    SELECT * FROM notes 
                    WHERE agent_id = ? OR agent_id IS NULL
                    ORDER BY created_at DESC
                """, (agent_id,))
            else:
                cursor.execute("SELECT * FROM notes ORDER BY created_at DESC")
            rows = cursor.fetchall()
            
            return [TaxonomyNote(
                id=row["id"],
                content=row["content"],
                trace_id=row["trace_id"],
                weave_ref=row["weave_ref"],
                weave_url=row["weave_url"],
                weave_feedback_id=row["weave_feedback_id"],
                failure_mode_id=row["failure_mode_id"],
                assignment_method=row["assignment_method"],
                created_at=row["created_at"],
                assigned_at=row["assigned_at"],
                session_id=row["session_id"] if "session_id" in row.keys() else None,
                source_type=row["source_type"] if "source_type" in row.keys() else "weave_feedback"
            ) for row in rows]
    
    def get_uncategorized_notes(self, agent_id: Optional[str] = None) -> list[TaxonomyNote]:
        """Get notes that haven't been assigned to a failure mode, optionally filtered by agent."""
        with get_db() as conn:
            cursor = conn.cursor()
            
            if agent_id:
                cursor.execute("""
                    SELECT * FROM notes 
                    WHERE failure_mode_id IS NULL AND (agent_id = ? OR agent_id IS NULL)
                    ORDER BY created_at DESC
                """, (agent_id,))
            else:
                cursor.execute("""
                    SELECT * FROM notes 
                    WHERE failure_mode_id IS NULL 
                    ORDER BY created_at DESC
                """)
            rows = cursor.fetchall()
            
            return [TaxonomyNote(
                id=row["id"],
                content=row["content"],
                trace_id=row["trace_id"],
                weave_ref=row["weave_ref"],
                weave_url=row["weave_url"],
                weave_feedback_id=row["weave_feedback_id"],
                failure_mode_id=None,
                assignment_method=None,
                created_at=row["created_at"],
                assigned_at=None,
                session_id=row["session_id"] if "session_id" in row.keys() else None,
                source_type=row["source_type"] if "source_type" in row.keys() else "weave_feedback"
            ) for row in rows]
    
    def sync_notes_from_weave(self, weave_notes: list[dict], agent_id: Optional[str] = None) -> dict:
        """
        Sync notes from Weave feedback into our local database.
        Optionally associates notes with a specific agent.
        Returns stats about new vs existing notes.
        """
        new_count = 0
        existing_count = 0
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            for note in weave_notes:
                # Check if we already have this note (by weave_feedback_id or content+trace)
                cursor.execute("""
                    SELECT id FROM notes 
                    WHERE weave_feedback_id = ? OR (content = ? AND trace_id = ?)
                """, (
                    note.get("weave_feedback_id", ""),
                    note.get("note", note.get("content", "")),
                    note.get("call_id", note.get("trace_id", ""))
                ))
                
                existing = cursor.fetchone()
                
                if existing:
                    existing_count += 1
                else:
                    # Insert new note
                    note_id = generate_id()
                    cursor.execute("""
                        INSERT INTO notes 
                        (id, weave_feedback_id, content, trace_id, weave_ref, weave_url, created_at, agent_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        note_id,
                        note.get("weave_feedback_id", ""),
                        note.get("note", note.get("content", "")),
                        note.get("call_id", note.get("trace_id", "")),
                        note.get("weave_ref", ""),
                        note.get("weave_url", ""),
                        note.get("created_at", now_iso()),
                        agent_id
                    ))
                    new_count += 1
        
        return {"new": new_count, "existing": existing_count}
    
    def assign_note_to_failure_mode(
        self,
        note_id: str,
        failure_mode_id: str,
        method: str = "manual"
    ) -> bool:
        """Assign a note to a failure mode."""
        with get_db() as conn:
            cursor = conn.cursor()
            now = now_iso()
            
            # Update the note
            cursor.execute("""
                UPDATE notes 
                SET failure_mode_id = ?, assignment_method = ?, assigned_at = ?
                WHERE id = ?
            """, (failure_mode_id, method, now, note_id))
            
            if cursor.rowcount == 0:
                return False
            
            # Update failure mode stats
            cursor.execute("""
                UPDATE failure_modes 
                SET times_seen = times_seen + 1, last_seen_at = ?
                WHERE id = ?
            """, (now, failure_mode_id))
            
            return True
    
    def unassign_note(self, note_id: str) -> bool:
        """Remove a note from its failure mode."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE notes 
                SET failure_mode_id = NULL, assignment_method = NULL, assigned_at = NULL
                WHERE id = ?
            """, (note_id,))
            return cursor.rowcount > 0
    
    # ------------------------------------------------------------------------
    # AI Categorization
    # ------------------------------------------------------------------------
    
    async def suggest_category_for_note(self, note_id: str, agent_id: Optional[str] = None) -> dict:
        """
        Use AI to suggest which failure mode a note belongs to.
        Returns either a match to existing mode or suggests a new one.
        Optionally filter failure modes by agent.
        """
        # Get the note and optionally the agent context
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM notes WHERE id = ?", (note_id,))
            note_row = cursor.fetchone()
            
            # Get agent context if agent_id is provided
            agent_name = ""
            agent_context = ""
            if agent_id:
                cursor.execute("SELECT name, agent_context FROM agents WHERE id = ?", (agent_id,))
                agent_row = cursor.fetchone()
                if agent_row:
                    agent_name = agent_row["name"] or ""
                    agent_context = agent_row["agent_context"] or ""
        
        if not note_row:
            raise ValueError("Note not found")
        
        note_content = note_row["content"]
        
        # Get existing failure modes (optionally filtered by agent)
        failure_modes = self.get_all_failure_modes(agent_id=agent_id)
        
        if not failure_modes:
            # No existing modes, suggest a new one
            return await self._suggest_new_category(note_content, note_id, agent_name, agent_context)
        
        # Build prompt for semantic matching
        modes_text = "\n".join([
            f"- ID: {m.id}\n  Name: {m.name}\n  Description: {m.description}"
            for m in failure_modes
        ])
        
        # Get the managed prompt
        prompt_config = prompt_manager.get_prompt("category_suggestion")
        
        # Create LLM client with prompt-specific configuration
        llm = LLMClient.for_prompt(prompt_config)
        
        # Format user prompt with agent context if enabled
        user_prompt = prompt_config.format_with_agent_context(
            agent_name=agent_name,
            agent_context=agent_context,
            note_content=note_content,
            modes_text=modes_text
        )
        
        # Use LLM client for structured output
        result = await llm.analyze(
            system_prompt=prompt_config.system_prompt,
            user_prompt=user_prompt,
            response_model=CategorySuggestion
        )
        
        # Convert to dict and add note_id
        result_dict = result.model_dump()
        result_dict["note_id"] = note_id
        return result_dict

    async def _suggest_new_category(
        self, 
        note_content: str, 
        note_id: Optional[str] = None,
        agent_name: str = "",
        agent_context: str = ""
    ) -> dict:
        """Suggest a new failure mode category for a note."""
        # Get the managed prompt
        prompt_config = prompt_manager.get_prompt("category_creation")
        
        # Create LLM client with prompt-specific configuration
        llm = LLMClient.for_prompt(prompt_config)
        
        # Format user prompt with agent context if enabled
        user_prompt = prompt_config.format_with_agent_context(
            agent_name=agent_name,
            agent_context=agent_context,
            note_content=note_content
        )
        
        # Use LLM client for structured output
        result = await llm.analyze(
            system_prompt=prompt_config.system_prompt,
            user_prompt=user_prompt,
            response_model=CategorySuggestion
        )
        
        # Convert to dict and add note_id if provided
        result_dict = result.model_dump()
        if note_id:
            result_dict["note_id"] = note_id
        return result_dict
    
    async def auto_categorize_notes(self, note_ids: Optional[list[str]] = None, agent_id: Optional[str] = None) -> dict:
        """
        Automatically categorize multiple notes.
        Tracks saturation by counting new vs matched categories.
        Optionally filter by agent.
        """
        if note_ids:
            # Get specific notes
            with get_db() as conn:
                cursor = conn.cursor()
                placeholders = ",".join("?" * len(note_ids))
                cursor.execute(f"""
                    SELECT * FROM notes WHERE id IN ({placeholders})
                """, note_ids)
                notes = cursor.fetchall()
        else:
            # Get all uncategorized notes (optionally filtered by agent)
            notes = self.get_uncategorized_notes(agent_id=agent_id)
        
        results = {
            "processed": 0,
            "new_modes_created": 0,
            "existing_modes_matched": 0,
            "errors": 0,
            "details": []
        }
        
        for note in notes:
            # Handle both TaxonomyNote objects and sqlite3.Row/dict objects
            if hasattr(note, 'id'):
                note_id = note.id
                note_content = note.content
            else:
                note_id = note["id"]
                note_content = note["content"]
            
            suggestion = await self.suggest_category_for_note(note_id)
            
            if "error" in suggestion:
                results["errors"] += 1
                results["details"].append({"note_id": note_id, "error": suggestion["error"]})
                continue
            
            results["processed"] += 1
            
            if suggestion["match_type"] == "existing" and suggestion.get("existing_mode_id"):
                # Assign to existing mode
                self.assign_note_to_failure_mode(
                    note_id,
                    suggestion["existing_mode_id"],
                    method="ai_auto"
                )
                results["existing_modes_matched"] += 1
                results["details"].append({
                    "note_id": note_id,
                    "action": "matched_existing",
                    "mode_id": suggestion["existing_mode_id"],
                    "confidence": suggestion.get("confidence", 0)
                })
            
            elif suggestion["match_type"] == "new" and suggestion.get("new_category"):
                # Create new failure mode and assign
                new_cat = suggestion["new_category"]
                new_mode = self.create_failure_mode(
                    name=new_cat["name"],
                    description=new_cat["description"],
                    severity=new_cat.get("severity", "medium"),
                    suggested_fix=new_cat.get("suggested_fix")
                )
                self.assign_note_to_failure_mode(note_id, new_mode.id, method="ai_auto")
                results["new_modes_created"] += 1
                results["details"].append({
                    "note_id": note_id,
                    "action": "created_new",
                    "mode_id": new_mode.id,
                    "mode_name": new_mode.name
                })
        
        # Log saturation event
        self._log_saturation_event(
            notes_processed=results["processed"],
            new_modes=results["new_modes_created"],
            matched_modes=results["existing_modes_matched"]
        )
        
        return results
    
    # ------------------------------------------------------------------------
    # Saturation Tracking
    # ------------------------------------------------------------------------
    
    def _log_saturation_event(
        self,
        notes_processed: int,
        new_modes: int,
        matched_modes: int
    ):
        """Log a categorization event for saturation tracking."""
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Get current total modes
            cursor.execute("SELECT COUNT(*) as count FROM failure_modes")
            total_modes = cursor.fetchone()["count"]
            
            cursor.execute("""
                INSERT INTO saturation_log 
                (timestamp, notes_processed, new_modes_created, existing_modes_matched, total_modes_after)
                VALUES (?, ?, ?, ?, ?)
            """, (now_iso(), notes_processed, new_modes, matched_modes, total_modes))
            
            # Also record a saturation snapshot for the discovery curve
            # Pass the connection to avoid nested transaction
            self._record_saturation_snapshot(conn)
    
    def _record_saturation_snapshot(self, conn=None):
        """
        Record a snapshot for the saturation discovery curve.
        Called after categorization or review events.
        
        Note: Uses total notes reviewed (categorized) as the x-axis metric,
        since we no longer track sessions locally.
        
        Args:
            conn: Optional existing connection to reuse (avoids nested transactions)
        """
        def do_record(connection):
            cursor = connection.cursor()
            
            # Get current counts - use total notes as the review metric
            cursor.execute("SELECT COUNT(*) as count FROM notes")
            total_notes = cursor.fetchone()["count"]
            
            cursor.execute("SELECT COUNT(*) as count FROM failure_modes")
            failure_modes_count = cursor.fetchone()["count"]
            
            cursor.execute("SELECT COUNT(*) as count FROM notes WHERE failure_mode_id IS NOT NULL")
            categorized_notes = cursor.fetchone()["count"]
            
            # Calculate saturation score
            saturation_score = 0.0
            if total_notes > 0:
                saturation_score = categorized_notes / total_notes
            
            # Insert snapshot (use total_notes as the x-axis metric)
            snapshot_id = generate_id()
            cursor.execute("""
                INSERT INTO saturation_snapshots 
                (id, snapshot_date, threads_reviewed, failure_modes_count, categorized_notes, saturation_score)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    failure_modes_count = excluded.failure_modes_count,
                    categorized_notes = excluded.categorized_notes,
                    saturation_score = excluded.saturation_score
            """, (snapshot_id, now_iso(), total_notes, failure_modes_count, 
                  categorized_notes, saturation_score))
        
        if conn is not None:
            # Use provided connection
            do_record(conn)
        else:
            # Get a new connection
            with get_db() as new_conn:
                do_record(new_conn)
    
    def get_saturation_stats(self, window_size: int = 20) -> dict:
        """
        Calculate saturation metrics.
        
        Saturation is reached when new notes stop creating new failure modes.
        """
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Get recent saturation events
            cursor.execute("""
                SELECT * FROM saturation_log 
                ORDER BY timestamp DESC 
                LIMIT ?
            """, (window_size,))
            events = cursor.fetchall()
            
            if not events:
                return {
                    "status": "no_data",
                    "message": "No categorization has been performed yet",
                    "saturation_score": 0.0,
                    "total_notes_processed": 0,
                    "total_modes": 0
                }
            
            # Calculate metrics
            total_notes = sum(e["notes_processed"] for e in events)
            total_new_modes = sum(e["new_modes_created"] for e in events)
            total_matched = sum(e["existing_modes_matched"] for e in events)
            
            # Get total failure modes
            cursor.execute("SELECT COUNT(*) as count FROM failure_modes")
            total_modes = cursor.fetchone()["count"]
            
            # Get total notes
            cursor.execute("SELECT COUNT(*) as count FROM notes")
            total_notes_all = cursor.fetchone()["count"]
            
            # Saturation score: 1.0 means all notes matched existing modes
            if total_notes > 0:
                saturation_score = total_matched / total_notes
            else:
                saturation_score = 0.0
            
            # Recent trend: look at last 5 events
            recent_events = events[:5]
            recent_new = sum(e["new_modes_created"] for e in recent_events)
            
            if recent_new == 0 and len(recent_events) >= 3:
                status = "saturated"
                message = "No new failure modes discovered in recent categorizations"
            elif saturation_score >= 0.8:
                status = "approaching_saturation"
                message = "Most notes fit existing categories"
            else:
                status = "discovering"
                message = "Still discovering new failure patterns"
            
            return {
                "status": status,
                "message": message,
                "saturation_score": round(saturation_score, 3),
                "window_size": len(events),
                "window_notes_processed": total_notes,
                "window_new_modes": total_new_modes,
                "window_matched": total_matched,
                "total_failure_modes": total_modes,
                "total_notes": total_notes_all,
                "recent_events": [
                    {
                        "timestamp": e["timestamp"],
                        "notes": e["notes_processed"],
                        "new_modes": e["new_modes_created"],
                        "matched": e["existing_modes_matched"]
                    }
                    for e in events[:10]
                ]
            }
    
    def get_saturation_history(self, agent_id: Optional[str] = None) -> dict:
        """
        Get the full saturation history for the discovery curve chart.
        
        Returns snapshots showing failure mode discovery over time,
        plus recommendations based on current saturation status.
        
        Note: Uses total notes as the x-axis metric (threads_reviewed field),
        since we now use Weave-native trace review.
        """
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Get all snapshots ordered by notes count (stored as threads_reviewed)
            cursor.execute("""
                SELECT * FROM saturation_snapshots 
                ORDER BY threads_reviewed ASC
            """)
            snapshot_rows = cursor.fetchall()
            
            # Get current counts - optionally filtered by agent
            if agent_id:
                cursor.execute("SELECT COUNT(*) as count FROM notes WHERE agent_id = ? OR agent_id IS NULL", (agent_id,))
            else:
                cursor.execute("SELECT COUNT(*) as count FROM notes")
            total_notes = cursor.fetchone()["count"]
            
            if agent_id:
                cursor.execute("SELECT COUNT(*) as count FROM failure_modes WHERE agent_id = ? OR agent_id IS NULL", (agent_id,))
            else:
                cursor.execute("SELECT COUNT(*) as count FROM failure_modes")
            current_modes = cursor.fetchone()["count"]
            
            if agent_id:
                cursor.execute("SELECT COUNT(*) as count FROM notes WHERE failure_mode_id IS NOT NULL AND (agent_id = ? OR agent_id IS NULL)", (agent_id,))
            else:
                cursor.execute("SELECT COUNT(*) as count FROM notes WHERE failure_mode_id IS NOT NULL")
            current_notes = cursor.fetchone()["count"]
            
            # Build snapshots list
            snapshots = []
            for row in snapshot_rows:
                snapshots.append({
                    "threads_reviewed": row["threads_reviewed"],  # Actually total notes count
                    "failure_modes_count": row["failure_modes_count"],
                    "categorized_notes": row["categorized_notes"],
                    "saturation_score": row["saturation_score"],
                    "snapshot_date": row["snapshot_date"]
                })
            
            # Find when the last new failure mode was discovered
            # by looking at where failure_modes_count increased
            last_discovery_at = 0
            prev_count = 0
            for snap in snapshots:
                if snap["failure_modes_count"] > prev_count:
                    last_discovery_at = snap["threads_reviewed"]
                    prev_count = snap["failure_modes_count"]
            
            notes_since_last_discovery = total_notes - last_discovery_at
            
            # Calculate recent discoveries (in last ~20 notes)
            recent_threshold = max(0, total_notes - 20)
            recent_discoveries = 0
            modes_at_threshold = 0
            for snap in snapshots:
                if snap["threads_reviewed"] <= recent_threshold:
                    modes_at_threshold = snap["failure_modes_count"]
            recent_discoveries = current_modes - modes_at_threshold
            
            # Calculate saturation score
            saturation_score = 0.0
            if total_notes > 0:
                saturation_score = current_notes / total_notes
            
            # Determine status and recommendation
            if total_notes == 0:
                status = "no_data"
                recommendation = "Start by syncing notes from Weave to begin building your failure taxonomy."
                recommendation_type = "info"
            elif current_modes == 0:
                status = "discovering"
                recommendation = "No failure modes yet. Categorize notes to identify failure patterns."
                recommendation_type = "action"
            elif notes_since_last_discovery >= 20:
                status = "saturated"
                recommendation = f"Taxonomy appears stable. No new failure modes discovered in the last {notes_since_last_discovery} notes. You can focus on addressing existing issues."
                recommendation_type = "success"
            elif notes_since_last_discovery >= 10:
                status = "approaching_saturation"
                recommendation = f"Approaching saturation. Only {recent_discoveries} new modes in recent notes. Continue reviewing to confirm stability."
                recommendation_type = "info"
            else:
                status = "discovering"
                recommendation = f"Still discovering new failure patterns. Recent activity: {recent_discoveries} new modes. Continue reviewing to build comprehensive taxonomy."
                recommendation_type = "action"
            
            # If we don't have snapshots but do have data, create initial point
            if len(snapshots) == 0 and (total_notes > 0 or current_modes > 0):
                snapshots.append({
                    "threads_reviewed": total_notes,
                    "failure_modes_count": current_modes,
                    "categorized_notes": current_notes,
                    "saturation_score": saturation_score,
                    "snapshot_date": now_iso()
                })
            
            return {
                "snapshots": snapshots,
                "current_threads": total_notes,  # Renamed but kept for API compatibility
                "current_modes": current_modes,
                "current_notes": current_notes,
                "last_discovery_at_threads": last_discovery_at,
                "threads_since_last_discovery": notes_since_last_discovery,
                "saturation_score": round(saturation_score, 3),
                "saturation_status": status,
                "recommendation": recommendation,
                "recommendation_type": recommendation_type,
                "recent_discoveries": recent_discoveries
            }
    
    # ------------------------------------------------------------------------
    # Batch Categorization (Phase 2)
    # ------------------------------------------------------------------------
    
    async def batch_suggest_categories(self, note_ids: Optional[list[str]] = None, agent_id: Optional[str] = None) -> dict:
        """
        Get AI suggestions for multiple notes WITHOUT applying them.
        
        Returns a list of suggestions that the user can review before applying.
        This is for the "batch categorization review" workflow.
        Optionally filter by agent.
        """
        if note_ids:
            # Get specific notes
            with get_db() as conn:
                cursor = conn.cursor()
                placeholders = ",".join("?" * len(note_ids))
                cursor.execute(f"""
                    SELECT * FROM notes WHERE id IN ({placeholders})
                """, note_ids)
                rows = cursor.fetchall()
                notes = [TaxonomyNote(
                    id=row["id"],
                    content=row["content"],
                    trace_id=row["trace_id"],
                    weave_ref=row["weave_ref"],
                    weave_url=row["weave_url"],
                    weave_feedback_id=row["weave_feedback_id"],
                    failure_mode_id=row["failure_mode_id"],
                    assignment_method=row["assignment_method"],
                    created_at=row["created_at"],
                    assigned_at=row["assigned_at"],
                    session_id=row["session_id"] if "session_id" in row.keys() else None,
                    source_type=row["source_type"] if "source_type" in row.keys() else "weave_feedback"
                ) for row in rows]
        else:
            # Get all uncategorized notes (optionally filtered by agent)
            notes = self.get_uncategorized_notes(agent_id=agent_id)
        
        suggestions = []
        errors = []
        
        for note in notes:
            try:
                suggestion = await self.suggest_category_for_note(note.id, agent_id=agent_id)
                suggestions.append({
                    "note_id": note.id,
                    "note_content": note.content[:200] + "..." if len(note.content) > 200 else note.content,
                    "session_id": note.session_id,
                    "source_type": note.source_type,
                    "suggestion": suggestion
                })
            except Exception as e:
                errors.append({
                    "note_id": note.id,
                    "error": str(e)
                })
        
        return {
            "total_notes": len(notes),
            "suggestions": suggestions,
            "errors": errors
        }
    
    def batch_apply_categories(self, assignments: list[dict], agent_id: Optional[str] = None) -> dict:
        """
        Apply multiple category assignments at once.
        
        Each assignment should have:
        - note_id: str
        - action: "existing" | "new" | "skip"
        - failure_mode_id: str (if action is "existing")
        - new_category: dict with name, description, severity, suggested_fix (if action is "new")
        
        Optionally associates new failure modes with an agent.
        Returns stats about what was applied.
        """
        results = {
            "applied": 0,
            "new_modes_created": 0,
            "existing_modes_matched": 0,
            "skipped": 0,
            "errors": []
        }
        
        for assignment in assignments:
            note_id = assignment.get("note_id")
            action = assignment.get("action")
            
            if not note_id:
                results["errors"].append({"error": "Missing note_id"})
                continue
            
            if action == "skip":
                results["skipped"] += 1
                continue
            
            try:
                if action == "existing":
                    failure_mode_id = assignment.get("failure_mode_id")
                    if not failure_mode_id:
                        results["errors"].append({"note_id": note_id, "error": "Missing failure_mode_id"})
                        continue
                    
                    success = self.assign_note_to_failure_mode(
                        note_id=note_id,
                        failure_mode_id=failure_mode_id,
                        method="ai_batch"
                    )
                    if success:
                        results["applied"] += 1
                        results["existing_modes_matched"] += 1
                    else:
                        results["errors"].append({"note_id": note_id, "error": "Failed to assign"})
                
                elif action == "new":
                    new_category = assignment.get("new_category")
                    if not new_category or not new_category.get("name"):
                        results["errors"].append({"note_id": note_id, "error": "Missing new_category"})
                        continue
                    
                    # Create the new failure mode (associate with agent if provided)
                    new_mode = self.create_failure_mode(
                        name=new_category["name"],
                        description=new_category.get("description", ""),
                        severity=new_category.get("severity", "medium"),
                        suggested_fix=new_category.get("suggested_fix"),
                        agent_id=agent_id
                    )
                    
                    # Assign the note to it
                    success = self.assign_note_to_failure_mode(
                        note_id=note_id,
                        failure_mode_id=new_mode.id,
                        method="ai_batch"
                    )
                    if success:
                        results["applied"] += 1
                        results["new_modes_created"] += 1
                    else:
                        results["errors"].append({"note_id": note_id, "error": "Failed to assign to new mode"})
                
                else:
                    results["errors"].append({"note_id": note_id, "error": f"Unknown action: {action}"})
            
            except Exception as e:
                results["errors"].append({"note_id": note_id, "error": str(e)})
        
        # Log saturation event
        if results["applied"] > 0:
            self._log_saturation_event(
                notes_processed=results["applied"],
                new_modes=results["new_modes_created"],
                matched_modes=results["existing_modes_matched"]
            )
        
        return results
    
    # ------------------------------------------------------------------------
    # Taxonomy Improvement Suggestions
    # ------------------------------------------------------------------------
    
    async def suggest_taxonomy_improvements(self, agent_id: str | None = None) -> dict:
        """
        Analyze the current taxonomy and suggest improvements.
        
        Looks for:
        - Categories that could be merged (too similar)
        - Categories that might need splitting (too broad)
        - Naming improvements
        
        Args:
            agent_id: Optional agent ID to filter modes and get agent context
        
        Returns:
            Dict with suggestions list and overall assessment
        """
        modes = self.get_all_failure_modes(agent_id=agent_id)
        
        if len(modes) < 2:
            return {
                "suggestions": [],
                "overall_assessment": "Need at least 2 failure modes to analyze taxonomy"
            }
        
        # Get agent context if agent_id is provided
        agent_name = ""
        agent_context = ""
        if agent_id:
            with get_db_readonly() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT name, agent_context FROM agents WHERE id = ?", (agent_id,))
                agent_row = cursor.fetchone()
                if agent_row:
                    agent_name = agent_row["name"] or ""
                    agent_context = agent_row["agent_context"] or ""
        
        modes_text = "\n".join([
            f"- ID: {m.id}\n  Name: {m.name}\n  Description: {m.description}\n  Notes count: {m.times_seen}"
            for m in modes
        ])
        
        # Get the managed prompt
        prompt_config = prompt_manager.get_prompt("taxonomy_improvement")
        
        # Create LLM client with prompt-specific configuration
        llm = LLMClient.for_prompt(prompt_config)
        
        # Format user prompt with agent context
        user_prompt = prompt_config.format_with_agent_context(
            agent_name=agent_name,
            agent_context=agent_context,
            modes_text=modes_text
        )
        
        # Use LLM client for structured output
        result = await llm.analyze(
            system_prompt=prompt_config.system_prompt,
            user_prompt=user_prompt,
            response_model=TaxonomyImprovementsResponse
        )
        
        return result.model_dump()
    
    def get_taxonomy_summary(self, agent_id: Optional[str] = None) -> dict:
        """Get a full summary of the taxonomy, optionally filtered by agent."""
        failure_modes = self.get_all_failure_modes(agent_id=agent_id)
        uncategorized = self.get_uncategorized_notes(agent_id=agent_id)
        all_notes = self.get_all_notes(agent_id=agent_id)
        saturation = self.get_saturation_stats()
        
        return {
            "failure_modes": [m.to_dict() for m in failure_modes],
            "uncategorized_notes": [n.to_dict() for n in uncategorized],
            "notes": [n.to_dict() for n in all_notes],
            "saturation": saturation,
            "stats": {
                "total_failure_modes": len(failure_modes),
                "total_uncategorized": len(uncategorized),
                "total_categorized": sum(len(m.note_ids) for m in failure_modes)
            }
        }
    
    # ------------------------------------------------------------------------
    # Batch-Based Saturation Tracking
    # ------------------------------------------------------------------------
    
    def get_saturation_by_batch(self, agent_id: Optional[str] = None) -> dict:
        """
        Compute saturation stats grouped by batch.
        
        Returns batch-level metrics showing:
        1. Query count per batch
        2. New vs matched modes per batch (based on failure mode creation times)
        3. Cumulative mode count over batches
        
        Optionally filtered by agent.
        """
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Get all batches ordered by creation, optionally filtered by agent
            if agent_id:
                cursor.execute("""
                    SELECT id, name, created_at 
                    FROM synthetic_batches 
                    WHERE agent_id = ?
                    ORDER BY created_at ASC
                """, (agent_id,))
            else:
                cursor.execute("""
                    SELECT id, name, created_at 
                    FROM synthetic_batches 
                    ORDER BY created_at ASC
                """)
            batches = cursor.fetchall()
            
            if not batches:
                return {
                    "batches": [],
                    "summary": {
                        "total_batches": 0,
                        "total_queries": 0,
                        "total_modes": 0,
                        "saturation_status": "discovering"
                    }
                }
            
            result = []
            cumulative_modes = 0
            mode_ids_before_batch = set()
            
            for batch_order, batch in enumerate(batches):
                batch_id = batch["id"]
                batch_name = batch["name"] or f"Batch {batch_order + 1}"
                batch_created_at = batch["created_at"]
                
                # Get query count for this batch
                cursor.execute("""
                    SELECT COUNT(*) as count
                    FROM synthetic_queries 
                    WHERE batch_id = ?
                """, (batch_id,))
                query_count = cursor.fetchone()["count"] or 0
                
                # Get failure modes created around this batch's time
                # We consider modes created between this batch and the next batch
                next_batch_idx = batch_order + 1
                if next_batch_idx < len(batches):
                    next_batch_created = batches[next_batch_idx]["created_at"]
                    cursor.execute("""
                        SELECT id FROM failure_modes
                        WHERE created_at >= ? AND created_at < ?
                    """, (batch_created_at, next_batch_created))
                else:
                    cursor.execute("""
                        SELECT id FROM failure_modes
                        WHERE created_at >= ?
                    """, (batch_created_at,))
                
                new_mode_rows = cursor.fetchall()
                new_mode_ids = set(row["id"] for row in new_mode_rows)
                
                # Count modes
                new_modes = len(new_mode_ids - mode_ids_before_batch)
                matched_modes = len(new_mode_ids & mode_ids_before_batch)
                
                # Update cumulative tracking
                mode_ids_before_batch.update(new_mode_ids)
                cumulative_modes = len(mode_ids_before_batch)
                
                result.append({
                    "batch_id": batch_id,
                    "batch_name": batch_name,
                    "batch_order": batch_order,
                    "query_count": query_count,
                    "new_modes_discovered": new_modes,
                    "existing_modes_matched": matched_modes,
                    "cumulative_modes": cumulative_modes
                })
            
            # Compute summary
            total_queries = sum(b["query_count"] for b in result)
            
            # Saturation status based on recent batches
            recent_batches = result[-3:] if len(result) >= 3 else result
            recent_new = sum(b["new_modes_discovered"] for b in recent_batches)
            
            if recent_new == 0 and len(result) >= 3:
                status = "saturated"
            elif recent_new <= 1:
                status = "stabilizing"
            else:
                status = "discovering"
            
            return {
                "batches": result,
                "summary": {
                    "total_batches": len(result),
                    "total_queries": total_queries,
                    "total_modes": cumulative_modes,
                    "saturation_status": status
                }
            }
    
    # ------------------------------------------------------------------------
    # Persisted Taxonomy Suggestions
    # ------------------------------------------------------------------------
    
    def get_persisted_suggestions(self, agent_id: Optional[str] = None) -> dict:
        """
        Get active (non-dismissed, non-applied) suggestions from the database.
        
        Returns:
            Dict with suggestions list and overall assessment
        """
        import json
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            if agent_id:
                cursor.execute("""
                    SELECT id, suggestion_type, mode_ids, reason, suggested_name, created_at
                    FROM taxonomy_suggestions
                    WHERE agent_id = ? AND status = 'active'
                    ORDER BY created_at DESC
                """, (agent_id,))
            else:
                cursor.execute("""
                    SELECT id, suggestion_type, mode_ids, reason, suggested_name, created_at
                    FROM taxonomy_suggestions
                    WHERE (agent_id IS NULL OR agent_id = '') AND status = 'active'
                    ORDER BY created_at DESC
                """)
            
            rows = cursor.fetchall()
            
            suggestions = []
            for row in rows:
                mode_ids = json.loads(row["mode_ids"]) if row["mode_ids"] else []
                suggestions.append({
                    "id": row["id"],
                    "type": row["suggestion_type"],
                    "mode_ids": mode_ids,
                    "reason": row["reason"],
                    "suggested_name": row["suggested_name"]
                })
            
            # Get overall assessment if available (stored with first suggestion)
            cursor.execute("""
                SELECT value FROM annotation_settings 
                WHERE key = ?
            """, (f"taxonomy_assessment_{agent_id or 'global'}",))
            assessment_row = cursor.fetchone()
            overall_assessment = assessment_row["value"] if assessment_row else ""
            
            return {
                "suggestions": suggestions,
                "overall_assessment": overall_assessment
            }
    
    def save_suggestions(
        self,
        suggestions: List[dict],
        overall_assessment: str,
        agent_id: Optional[str] = None
    ) -> dict:
        """
        Save taxonomy improvement suggestions to the database.
        
        This marks any existing active suggestions as replaced and adds new ones.
        
        Args:
            suggestions: List of suggestion dicts with type, mode_ids, reason, suggested_name
            overall_assessment: Summary of taxonomy health
            agent_id: Optional agent ID to scope suggestions
            
        Returns:
            Dict with saved suggestion count
        """
        import json
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Mark existing active suggestions as replaced (so we don't delete history)
            now = now_iso()
            if agent_id:
                cursor.execute("""
                    UPDATE taxonomy_suggestions
                    SET status = 'replaced', dismissed_at = ?
                    WHERE agent_id = ? AND status = 'active'
                """, (now, agent_id))
            else:
                cursor.execute("""
                    UPDATE taxonomy_suggestions
                    SET status = 'replaced', dismissed_at = ?
                    WHERE (agent_id IS NULL OR agent_id = '') AND status = 'active'
                """, (now,))
            
            # Insert new suggestions
            for suggestion in suggestions:
                suggestion_id = generate_id()
                mode_ids_json = json.dumps(suggestion.get("mode_ids", []))
                
                cursor.execute("""
                    INSERT INTO taxonomy_suggestions
                    (id, agent_id, suggestion_type, mode_ids, reason, suggested_name, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
                """, (
                    suggestion_id,
                    agent_id,
                    suggestion.get("type", ""),
                    mode_ids_json,
                    suggestion.get("reason", ""),
                    suggestion.get("suggested_name"),
                    now
                ))
            
            # Save overall assessment
            cursor.execute("""
                INSERT OR REPLACE INTO annotation_settings (key, value)
                VALUES (?, ?)
            """, (f"taxonomy_assessment_{agent_id or 'global'}", overall_assessment))
            
            conn.commit()
            
            return {"saved": len(suggestions)}
    
    def dismiss_suggestion(self, suggestion_id: str) -> None:
        """Mark a suggestion as dismissed."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE taxonomy_suggestions
                SET status = 'dismissed', dismissed_at = ?
                WHERE id = ?
            """, (now_iso(), suggestion_id))
            conn.commit()
    
    def mark_suggestion_applied(self, suggestion_id: str) -> None:
        """Mark a suggestion as applied."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE taxonomy_suggestions
                SET status = 'applied', applied_at = ?
                WHERE id = ?
            """, (now_iso(), suggestion_id))
            conn.commit()


# Singleton instance
taxonomy_service = TaxonomyService()

