"""
Sync feedback from Weave to local storage for taxonomy analysis.

This service pulls feedback annotations that users added in Weave's native UI
when reviewing traces. The feedback is then used for taxonomy building - 
categorizing failure modes and understanding agent behavior patterns.

Workflow:
1. User executes a synthetic batch
2. User clicks "Review in Weave" to see traces in Weave's UI
3. User adds feedback/annotations to traces (thumbs up/down, notes, etc.)
4. This service syncs that feedback back to our local database
5. Taxonomy tab uses the feedback to build failure categories

This eliminates the need to build a trace viewer in our app - we leverage
Weave's native UI for review and just sync the feedback data we need.
"""

import asyncio
from datetime import datetime
from typing import Any

from database import get_db, now_iso
from services.weave_client import weave_client
from logger import get_logger, log_event, generate_correlation_id

logger = get_logger("feedback_sync")


class FeedbackSyncService:
    """
    Sync feedback from Weave to local database.
    
    Pulls feedback annotations from Weave for traces in a batch,
    storing them locally for taxonomy analysis.
    """
    
    def __init__(self):
        self.correlation_id: str | None = None
    
    async def sync_feedback_for_batch(self, batch_id: str) -> dict:
        """
        Pull feedback from Weave for traces in a batch.
        
        Queries traces that have the batch_id attribute set, then fetches
        any feedback annotations users added while reviewing in Weave.
        
        Args:
            batch_id: The batch ID to sync feedback for
            
        Returns:
            Dict with sync results: synced_count, new_count, errors
        """
        self.correlation_id = generate_correlation_id()
        
        log_event(logger, "feedback_sync.batch_start",
            correlation_id=self.correlation_id,
            batch_id=batch_id
        )
        
        synced_count = 0
        new_count = 0
        errors = []
        
        try:
            # Get trace IDs for this batch from our database
            trace_ids = self._get_batch_trace_ids(batch_id)
            
            if not trace_ids:
                log_event(logger, "feedback_sync.no_traces",
                    correlation_id=self.correlation_id,
                    batch_id=batch_id
                )
                return {
                    "batch_id": batch_id,
                    "synced_count": 0,
                    "new_count": 0,
                    "errors": []
                }
            
            # Fetch feedback for each trace
            for trace_id in trace_ids:
                try:
                    feedback_list = await weave_client.get_feedback_for_call(trace_id)
                    
                    for feedback in feedback_list:
                        is_new = self._store_feedback(
                            trace_id=trace_id,
                            batch_id=batch_id,
                            feedback=feedback
                        )
                        synced_count += 1
                        if is_new:
                            new_count += 1
                            
                except Exception as e:
                    errors.append({
                        "trace_id": trace_id,
                        "error": str(e)
                    })
                    logger.warning(f"Failed to fetch feedback for trace {trace_id}: {e}")
            
            # Restore tool project context after Weave operations
            weave_client.restore_tool_context()
            
            log_event(logger, "feedback_sync.batch_complete",
                correlation_id=self.correlation_id,
                batch_id=batch_id,
                synced_count=synced_count,
                new_count=new_count,
                error_count=len(errors)
            )
            
            return {
                "batch_id": batch_id,
                "synced_count": synced_count,
                "new_count": new_count,
                "errors": errors
            }
            
        except Exception as e:
            logger.error(f"Feedback sync failed for batch {batch_id}: {e}")
            raise
    
    async def sync_all_feedback(self, limit: int = 500) -> dict:
        """
        Sync all recent feedback from Weave.
        
        Pulls feedback from the project (up to limit) and stores any
        that we don't already have locally.
        
        Args:
            limit: Maximum number of feedback items to fetch
            
        Returns:
            Dict with sync results
        """
        self.correlation_id = generate_correlation_id()
        
        log_event(logger, "feedback_sync.all_start",
            correlation_id=self.correlation_id,
            limit=limit
        )
        
        synced_count = 0
        new_count = 0
        
        try:
            feedback_list = await weave_client.query_feedback(limit=limit)
            
            for feedback in feedback_list:
                # Extract trace_id from weave_ref
                weave_ref = feedback.get("weave_ref", "")
                trace_id = self._extract_trace_id_from_ref(weave_ref)
                
                if trace_id:
                    # Look up batch_id for this trace
                    batch_id = self._get_batch_id_for_trace(trace_id)
                    
                    is_new = self._store_feedback(
                        trace_id=trace_id,
                        batch_id=batch_id,
                        feedback=feedback
                    )
                    synced_count += 1
                    if is_new:
                        new_count += 1
            
            # Restore tool project context
            weave_client.restore_tool_context()
            
            log_event(logger, "feedback_sync.all_complete",
                correlation_id=self.correlation_id,
                synced_count=synced_count,
                new_count=new_count
            )
            
            return {
                "synced_count": synced_count,
                "new_count": new_count
            }
            
        except Exception as e:
            logger.error(f"Full feedback sync failed: {e}")
            raise
    
    def _get_batch_trace_ids(self, batch_id: str) -> list[str]:
        """Get trace IDs for queries in a batch."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT trace_id FROM synthetic_queries
                WHERE batch_id = ? AND trace_id IS NOT NULL
            """, (batch_id,))
            return [row["trace_id"] for row in cursor.fetchall()]
    
    def _get_batch_id_for_trace(self, trace_id: str) -> str | None:
        """Look up the batch_id for a trace."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT batch_id FROM synthetic_queries
                WHERE trace_id = ?
            """, (trace_id,))
            row = cursor.fetchone()
            return row["batch_id"] if row else None
    
    def _extract_trace_id_from_ref(self, weave_ref: str) -> str | None:
        """Extract trace/call ID from a Weave reference string."""
        # Weave refs look like: weave:///entity/project/call/id
        if not weave_ref:
            return None
        parts = weave_ref.split("/")
        # The call ID is typically the last part
        if len(parts) >= 2 and parts[-2] == "call":
            return parts[-1]
        return None
    
    def _store_feedback(
        self,
        trace_id: str,
        batch_id: str | None,
        feedback: dict
    ) -> bool:
        """
        Store feedback in the local database.
        
        Returns True if this is a new feedback entry, False if updated.
        """
        feedback_id = feedback.get("id")
        if not feedback_id:
            return False
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Check if we already have this feedback
            cursor.execute("""
                SELECT id FROM weave_feedback WHERE id = ?
            """, (feedback_id,))
            existing = cursor.fetchone()
            
            import json
            
            if existing:
                # Update existing
                cursor.execute("""
                    UPDATE weave_feedback
                    SET payload = ?, synced_at = ?
                    WHERE id = ?
                """, (
                    json.dumps(feedback.get("payload", {})),
                    now_iso(),
                    feedback_id
                ))
                return False
            else:
                # Insert new
                cursor.execute("""
                    INSERT INTO weave_feedback (id, trace_id, batch_id, feedback_type, payload, created_at, synced_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    feedback_id,
                    trace_id,
                    batch_id,
                    feedback.get("type") or feedback.get("feedback_type"),
                    json.dumps(feedback.get("payload", {})),
                    feedback.get("created_at"),
                    now_iso()
                ))
                return True
    
    def get_feedback_for_taxonomy(self, batch_id: str | None = None) -> list[dict]:
        """
        Get feedback suitable for taxonomy analysis.
        
        Returns feedback with notes and reactions that can help identify
        failure modes and categorize agent behavior.
        
        Args:
            batch_id: Optional filter by batch
            
        Returns:
            List of feedback entries with relevant metadata
        """
        with get_db() as conn:
            cursor = conn.cursor()
            
            if batch_id:
                cursor.execute("""
                    SELECT wf.*, sq.query_text, sq.response_text
                    FROM weave_feedback wf
                    LEFT JOIN synthetic_queries sq ON wf.trace_id = sq.trace_id
                    WHERE wf.batch_id = ?
                    ORDER BY wf.created_at DESC
                """, (batch_id,))
            else:
                cursor.execute("""
                    SELECT wf.*, sq.query_text, sq.response_text
                    FROM weave_feedback wf
                    LEFT JOIN synthetic_queries sq ON wf.trace_id = sq.trace_id
                    ORDER BY wf.created_at DESC
                """)
            
            import json
            return [
                {
                    "id": row["id"],
                    "trace_id": row["trace_id"],
                    "batch_id": row["batch_id"],
                    "feedback_type": row["feedback_type"],
                    "payload": json.loads(row["payload"]) if row["payload"] else {},
                    "created_at": row["created_at"],
                    "query_text": row["query_text"],
                    "response_text": row["response_text"],
                }
                for row in cursor.fetchall()
            ]


# Singleton instance
feedback_sync_service = FeedbackSyncService()

