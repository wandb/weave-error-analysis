"""
Annotation service for tracking reviewed threads and annotation progress.

Handles:
- Marking threads as reviewed
- Tracking review progress
- Managing review target settings
"""

from typing import Optional
from database import get_db, now_iso


class AnnotationService:
    """Service for managing annotation progress."""
    
    def get_reviewed_threads(self) -> set[str]:
        """Get set of all reviewed thread IDs."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT thread_id FROM reviewed_threads")
            return {row["thread_id"] for row in cursor.fetchall()}
    
    def is_thread_reviewed(self, thread_id: str) -> bool:
        """Check if a specific thread has been reviewed."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT 1 FROM reviewed_threads WHERE thread_id = ?",
                (thread_id,)
            )
            return cursor.fetchone() is not None
    
    def mark_thread_reviewed(self, thread_id: str, notes: Optional[str] = None) -> bool:
        """Mark a thread as reviewed."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO reviewed_threads (thread_id, reviewed_at, reviewer_notes)
                VALUES (?, ?, ?)
            """, (thread_id, now_iso(), notes))
            return True
    
    def unmark_thread_reviewed(self, thread_id: str) -> bool:
        """Remove a thread from the reviewed list."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM reviewed_threads WHERE thread_id = ?",
                (thread_id,)
            )
            return cursor.rowcount > 0
    
    def get_review_target(self) -> int:
        """Get the target number of threads to review."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT value FROM annotation_settings WHERE key = 'review_target'"
            )
            row = cursor.fetchone()
            return int(row["value"]) if row else 100
    
    def set_review_target(self, target: int) -> bool:
        """Set the target number of threads to review."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO annotation_settings (key, value)
                VALUES ('review_target', ?)
            """, (str(target),))
            return True
    
    def get_annotation_progress(self) -> dict:
        """Get annotation progress statistics."""
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Get reviewed count
            cursor.execute("SELECT COUNT(*) as count FROM reviewed_threads")
            reviewed_count = cursor.fetchone()["count"]
            
            # Get target
            target = self.get_review_target()
            
            # Get recent reviews (last 24 hours)
            cursor.execute("""
                SELECT COUNT(*) as count FROM reviewed_threads 
                WHERE reviewed_at > datetime('now', '-1 day')
            """)
            recent_reviews = cursor.fetchone()["count"]
            
            # Calculate progress percentage
            progress_percent = min(100, round((reviewed_count / target) * 100)) if target > 0 else 0
            
            return {
                "reviewed_count": reviewed_count,
                "target": target,
                "progress_percent": progress_percent,
                "recent_reviews_24h": recent_reviews,
                "remaining": max(0, target - reviewed_count)
            }
    
    def get_threads_with_review_status(self, thread_ids: list[str]) -> dict[str, bool]:
        """Get review status for multiple threads at once."""
        if not thread_ids:
            return {}
        
        with get_db() as conn:
            cursor = conn.cursor()
            placeholders = ",".join("?" * len(thread_ids))
            cursor.execute(f"""
                SELECT thread_id FROM reviewed_threads 
                WHERE thread_id IN ({placeholders})
            """, thread_ids)
            
            reviewed = {row["thread_id"] for row in cursor.fetchall()}
            return {tid: tid in reviewed for tid in thread_ids}


# Singleton instance
annotation_service = AnnotationService()

