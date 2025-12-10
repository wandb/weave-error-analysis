"""
Taxonomy service for managing failure modes and note categorization.

Handles:
- CRUD operations for failure modes
- Note-to-failure-mode assignment
- AI-powered categorization with semantic matching
- Saturation tracking
"""

import json
from typing import Optional
from datetime import datetime

import litellm

from database import get_db, generate_id, now_iso
from config import CATEGORIZATION_MODEL


# ============================================================================
# Data Classes
# ============================================================================

class FailureMode:
    """A failure mode category in the taxonomy."""
    
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
        note_ids: Optional[list] = None
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
            "note_ids": self.note_ids
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
    
    # ------------------------------------------------------------------------
    # Failure Mode CRUD
    # ------------------------------------------------------------------------
    
    def get_all_failure_modes(self) -> list[FailureMode]:
        """Get all failure modes with their associated notes."""
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Get all failure modes
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
                    note_ids=note_ids
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
                note_ids=note_ids
            )
    
    def create_failure_mode(
        self,
        name: str,
        description: str,
        severity: str = "medium",
        suggested_fix: Optional[str] = None
    ) -> FailureMode:
        """Create a new failure mode."""
        mode_id = generate_id()
        now = now_iso()
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO failure_modes 
                (id, name, description, severity, suggested_fix, created_at, last_seen_at, times_seen)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            """, (mode_id, name, description, severity, suggested_fix, now, now))
        
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
        suggested_fix: Optional[str] = None
    ) -> Optional[FailureMode]:
        """Update a failure mode."""
        mode = self.get_failure_mode(mode_id)
        if not mode:
            return None
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE failure_modes 
                SET name = ?, description = ?, severity = ?, suggested_fix = ?
                WHERE id = ?
            """, (
                name or mode.name,
                description or mode.description,
                severity or mode.severity,
                suggested_fix if suggested_fix is not None else mode.suggested_fix,
                mode_id
            ))
        
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
    
    def get_all_notes(self) -> list[TaxonomyNote]:
        """Get all notes."""
        with get_db() as conn:
            cursor = conn.cursor()
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
    
    def get_uncategorized_notes(self) -> list[TaxonomyNote]:
        """Get notes that haven't been assigned to a failure mode."""
        with get_db() as conn:
            cursor = conn.cursor()
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
    
    def get_note_session(self, note_id: str) -> Optional[dict]:
        """
        Get the session info for a note if it came from a session.
        
        Returns:
            Session info dict with id, query, created_at, etc. or None if not a session note
        """
        with get_db() as conn:
            cursor = conn.cursor()
            
            # First get the note to check if it has a session_id
            cursor.execute("SELECT session_id, source_type FROM notes WHERE id = ?", (note_id,))
            note_row = cursor.fetchone()
            
            if not note_row:
                return None
            
            session_id = note_row["session_id"] if "session_id" in note_row.keys() else None
            
            if not session_id:
                return None
            
            # Fetch the session details
            cursor.execute("""
                SELECT id, query, first_message, is_error, is_reviewed, 
                       turn_count, created_at, batch_id
                FROM sessions 
                WHERE id = ?
            """, (session_id,))
            session_row = cursor.fetchone()
            
            if not session_row:
                return None
            
            return {
                "id": session_row["id"],
                "query": session_row["query"],
                "first_message": session_row["first_message"],
                "is_error": bool(session_row["is_error"]),
                "is_reviewed": bool(session_row["is_reviewed"]),
                "turn_count": session_row["turn_count"],
                "created_at": session_row["created_at"],
                "batch_id": session_row["batch_id"]
            }
    
    def sync_notes_from_weave(self, weave_notes: list[dict]) -> dict:
        """
        Sync notes from Weave feedback into our local database.
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
                        (id, weave_feedback_id, content, trace_id, weave_ref, weave_url, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (
                        note_id,
                        note.get("weave_feedback_id", ""),
                        note.get("note", note.get("content", "")),
                        note.get("call_id", note.get("trace_id", "")),
                        note.get("weave_ref", ""),
                        note.get("weave_url", ""),
                        note.get("created_at", now_iso())
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
    
    async def suggest_category_for_note(self, note_id: str) -> dict:
        """
        Use AI to suggest which failure mode a note belongs to.
        Returns either a match to existing mode or suggests a new one.
        """
        # Get the note
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM notes WHERE id = ?", (note_id,))
            note_row = cursor.fetchone()
        
        if not note_row:
            raise ValueError("Note not found")
        
        note_content = note_row["content"]
        
        # Get existing failure modes
        failure_modes = self.get_all_failure_modes()
        
        if not failure_modes:
            # No existing modes, suggest a new one
            return await self._suggest_new_category(note_content)
        
        # Build prompt for semantic matching
        modes_text = "\n".join([
            f"- ID: {m.id}\n  Name: {m.name}\n  Description: {m.description}"
            for m in failure_modes
        ])
        
        prompt = f"""You are analyzing failure modes in an AI system.

Given this observation/note about an AI failure:
"{note_content}"

And these existing failure mode categories:
{modes_text}

Does this note fit into one of the existing categories, or does it represent a NEW type of failure?

Respond in JSON format:
{{
    "match_type": "existing" | "new",
    "existing_mode_id": "id if match_type is existing, null otherwise",
    "confidence": 0.0-1.0,
    "reasoning": "Brief explanation",
    "new_category": {{
        "name": "Only if match_type is new",
        "description": "Only if match_type is new",
        "severity": "high|medium|low",
        "suggested_fix": "Optional suggestion"
    }}
}}

Be conservative about creating new categories. Only suggest a new category if the note describes a fundamentally different type of failure."""

        try:
            response = litellm.completion(
                model=CATEGORIZATION_MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            
            result = json.loads(response.choices[0].message.content)
            result["note_id"] = note_id
            return result
            
        except Exception as e:
            raise RuntimeError(f"Failed to suggest category for note {note_id}: {str(e)}")
    
    async def _suggest_new_category(self, note_content: str) -> dict:
        """Suggest a new failure mode category for a note."""
        prompt = f"""You are analyzing failure modes in an AI system.

Given this observation/note about an AI failure:
"{note_content}"

Create a failure mode category for this issue.

Respond in JSON format:
{{
    "match_type": "new",
    "existing_mode_id": null,
    "confidence": 1.0,
    "reasoning": "First failure mode being created",
    "new_category": {{
        "name": "Short descriptive name",
        "description": "Clear description of this failure pattern",
        "severity": "high|medium|low",
        "suggested_fix": "Brief suggestion for addressing this"
    }}
}}"""

        try:
            response = litellm.completion(
                model=CATEGORIZATION_MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            return json.loads(response.choices[0].message.content)
        except Exception as e:
            raise RuntimeError(f"Failed to suggest new category: {str(e)}")
    
    async def auto_categorize_notes(self, note_ids: Optional[list[str]] = None) -> dict:
        """
        Automatically categorize multiple notes.
        Tracks saturation by counting new vs matched categories.
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
            # Get all uncategorized notes
            notes = self.get_uncategorized_notes()
        
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
    
    # ------------------------------------------------------------------------
    # Batch Categorization (Phase 2)
    # ------------------------------------------------------------------------
    
    async def batch_suggest_categories(self, note_ids: Optional[list[str]] = None) -> dict:
        """
        Get AI suggestions for multiple notes WITHOUT applying them.
        
        Returns a list of suggestions that the user can review before applying.
        This is for the "batch categorization review" workflow.
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
            # Get all uncategorized notes
            notes = self.get_uncategorized_notes()
        
        suggestions = []
        errors = []
        
        for note in notes:
            try:
                suggestion = await self.suggest_category_for_note(note.id)
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
    
    def batch_apply_categories(self, assignments: list[dict]) -> dict:
        """
        Apply multiple category assignments at once.
        
        Each assignment should have:
        - note_id: str
        - action: "existing" | "new" | "skip"
        - failure_mode_id: str (if action is "existing")
        - new_category: dict with name, description, severity, suggested_fix (if action is "new")
        
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
                    
                    # Create the new failure mode
                    new_mode = self.create_failure_mode(
                        name=new_category["name"],
                        description=new_category.get("description", ""),
                        severity=new_category.get("severity", "medium"),
                        suggested_fix=new_category.get("suggested_fix")
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
    
    def get_taxonomy_summary(self) -> dict:
        """Get a full summary of the taxonomy."""
        failure_modes = self.get_all_failure_modes()
        uncategorized = self.get_uncategorized_notes()
        all_notes = self.get_all_notes()
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


# Singleton instance
taxonomy_service = TaxonomyService()

