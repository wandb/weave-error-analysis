"""
Session Repository - Data access layer for local session cache.

This repository provides clean, efficient access to sessions stored in SQLite.
All methods query LOCAL DB only - no Weave API calls. This enables:

- Instant queries (< 50ms for most operations)
- Rich filtering without network latency
- Offline capability
- SQL-optimized queries using indexes

Key Features:
- Comprehensive filtering (batch, turns, tokens, cost, status, dates)
- Random sampling for review workflows
- Note search across sessions
- Pagination with total counts
- Sort by any indexed column

Usage:
    from services.session_repository import session_repository
    
    # List with filters
    result = session_repository.list_sessions(
        batch_id="batch-123",
        min_turns=3,
        is_reviewed=False,
        limit=50
    )
    
    # Random sample for review
    sessions = session_repository.random_sample(
        batch_id="batch-123",
        count=20,
        is_reviewed=False
    )
    
    # Search by note content
    sessions = session_repository.search_by_notes("user frustrated")

See: sessions_improvements.md Section 3.2 for full design.
"""

import random
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any, Tuple
from enum import Enum

from database import get_db, get_db_readonly, now_iso, generate_id
from logger import get_logger

logger = get_logger("session_repository")


# =============================================================================
# Filter & Sort Configuration
# =============================================================================

class SortField(str, Enum):
    """Valid sort fields for session queries."""
    STARTED_AT = "started_at"
    ENDED_AT = "ended_at"
    TURN_COUNT = "turn_count"
    TOTAL_TOKENS = "total_tokens"
    ESTIMATED_COST = "estimated_cost_usd"
    LATENCY = "total_latency_ms"
    REVIEWED_AT = "reviewed_at"


class SortDirection(str, Enum):
    ASC = "ASC"
    DESC = "DESC"


@dataclass
class SessionFilters:
    """
    Comprehensive session filtering options.
    
    All filters are optional - only non-None values are applied.
    This allows flexible composition of filter criteria.
    """
    # Batch Association
    batch_id: Optional[str] = None
    exclude_batches: bool = False  # Show only organic (non-batch) sessions
    
    # Turn Count Range
    min_turns: Optional[int] = None
    max_turns: Optional[int] = None
    
    # Review Status
    is_reviewed: Optional[bool] = None
    
    # Error Status
    has_error: Optional[bool] = None
    
    # Token Usage Range
    min_tokens: Optional[int] = None
    max_tokens: Optional[int] = None
    
    # Cost Range (USD)
    min_cost: Optional[float] = None
    max_cost: Optional[float] = None
    
    # Latency Range (ms)
    min_latency_ms: Optional[float] = None
    max_latency_ms: Optional[float] = None
    
    # Date Range (ISO timestamps)
    started_after: Optional[str] = None
    started_before: Optional[str] = None
    
    # Model Filter
    primary_model: Optional[str] = None
    
    # Note Search (searches session_notes.content)
    note_search: Optional[str] = None


@dataclass
class SessionListResult:
    """Result of a session list query."""
    sessions: List[Dict[str, Any]]
    total_count: int
    page: int
    page_size: int
    has_more: bool
    
    # Query metadata (useful for debugging)
    query_time_ms: Optional[float] = None
    filters_applied: int = 0


@dataclass  
class SessionStats:
    """Aggregate statistics for sessions matching a filter."""
    total_sessions: int = 0
    reviewed_sessions: int = 0
    unreviewed_sessions: int = 0
    error_sessions: int = 0
    total_tokens: int = 0
    total_cost_usd: float = 0.0
    avg_turns: float = 0.0
    avg_latency_ms: float = 0.0


# =============================================================================
# Session Repository
# =============================================================================

class SessionRepository:
    """
    Repository for session data access.
    
    All methods query LOCAL SQLite only - no Weave API calls.
    This provides instant responses for the Sessions tab.
    """
    
    # =========================================================================
    # Session List Queries
    # =========================================================================
    
    def list_sessions(
        self,
        filters: Optional[SessionFilters] = None,
        sort_by: SortField = SortField.STARTED_AT,
        sort_direction: SortDirection = SortDirection.DESC,
        limit: int = 50,
        offset: int = 0,
    ) -> SessionListResult:
        """
        List sessions with comprehensive filtering and pagination.
        
        Args:
            filters: Optional filter criteria
            sort_by: Field to sort by
            sort_direction: ASC or DESC
            limit: Max sessions to return (1-200)
            offset: Pagination offset
            
        Returns:
            SessionListResult with sessions, total count, and pagination info
        """
        import time
        start_time = time.time()
        
        filters = filters or SessionFilters()
        
        # Build WHERE clause
        conditions, params = self._build_where_clause(filters)
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            
            # Get total count first
            count_query = f"""
                SELECT COUNT(*) as count 
                FROM sessions s
                WHERE {where_clause}
            """
            cursor.execute(count_query, params)
            total_count = cursor.fetchone()["count"]
            
            # Main query with batch name join
            query = f"""
                SELECT 
                    s.*,
                    b.name as batch_name
                FROM sessions s
                LEFT JOIN synthetic_batches b ON s.batch_id = b.id
                WHERE {where_clause}
                ORDER BY s.{sort_by.value} {sort_direction.value}
                LIMIT ? OFFSET ?
            """
            cursor.execute(query, params + [limit, offset])
            
            sessions = [dict(row) for row in cursor.fetchall()]
        
        # Calculate pagination
        page = (offset // limit) + 1 if limit > 0 else 1
        has_more = (offset + limit) < total_count
        
        query_time_ms = (time.time() - start_time) * 1000
        
        return SessionListResult(
            sessions=sessions,
            total_count=total_count,
            page=page,
            page_size=limit,
            has_more=has_more,
            query_time_ms=round(query_time_ms, 2),
            filters_applied=len(conditions)
        )
    
    def get_session_by_id(self, session_id: str) -> Optional[Dict[str, Any]]:
        """
        Get a single session by ID with all metadata.
        
        Returns:
            Session dict with batch_name and query_text, or None if not found
        """
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT 
                    s.*,
                    b.name as batch_name,
                    q.query_text
                FROM sessions s
                LEFT JOIN synthetic_batches b ON s.batch_id = b.id
                LEFT JOIN synthetic_queries q ON s.query_id = q.id
                WHERE s.id = ?
            """, (session_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
    
    def get_session_count(self, filters: Optional[SessionFilters] = None) -> int:
        """Get count of sessions matching filters."""
        filters = filters or SessionFilters()
        conditions, params = self._build_where_clause(filters)
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            cursor.execute(f"""
                SELECT COUNT(*) as count 
                FROM sessions s
                WHERE {where_clause}
            """, params)
            return cursor.fetchone()["count"]
    
    def get_session_stats(self, filters: Optional[SessionFilters] = None) -> SessionStats:
        """
        Get aggregate statistics for sessions matching filters.
        
        Useful for dashboards and progress tracking.
        """
        filters = filters or SessionFilters()
        conditions, params = self._build_where_clause(filters)
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            cursor.execute(f"""
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN is_reviewed THEN 1 ELSE 0 END) as reviewed,
                    SUM(CASE WHEN has_error THEN 1 ELSE 0 END) as errors,
                    COALESCE(SUM(total_tokens), 0) as total_tokens,
                    COALESCE(SUM(estimated_cost_usd), 0) as total_cost,
                    COALESCE(AVG(turn_count), 0) as avg_turns,
                    COALESCE(AVG(total_latency_ms), 0) as avg_latency
                FROM sessions s
                WHERE {where_clause}
            """, params)
            row = cursor.fetchone()
            
            return SessionStats(
                total_sessions=row["total"] or 0,
                reviewed_sessions=row["reviewed"] or 0,
                unreviewed_sessions=(row["total"] or 0) - (row["reviewed"] or 0),
                error_sessions=row["errors"] or 0,
                total_tokens=row["total_tokens"] or 0,
                total_cost_usd=round(row["total_cost"] or 0, 4),
                avg_turns=round(row["avg_turns"] or 0, 1),
                avg_latency_ms=round(row["avg_latency"] or 0, 1)
            )
    
    # =========================================================================
    # Random Sampling
    # =========================================================================
    
    def random_sample(
        self,
        count: int,
        filters: Optional[SessionFilters] = None,
        sort_by: SortField = SortField.STARTED_AT,
        sort_direction: SortDirection = SortDirection.DESC,
    ) -> List[Dict[str, Any]]:
        """
        Get a random sample of sessions matching filters.
        
        Useful for review workflows where you want to sample from a batch.
        
        Args:
            count: Number of sessions to sample (1-100)
            filters: Optional filter criteria
            sort_by: How to sort the final result
            sort_direction: Sort direction for final result
            
        Returns:
            List of session dicts
        """
        count = min(max(1, count), 100)  # Clamp to 1-100
        filters = filters or SessionFilters()
        
        conditions, params = self._build_where_clause(filters)
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            
            # Get all matching IDs first
            cursor.execute(f"""
                SELECT id FROM sessions s WHERE {where_clause}
            """, params)
            all_ids = [row["id"] for row in cursor.fetchall()]
            
            if not all_ids:
                return []
            
            # Sample IDs
            if len(all_ids) > count:
                sampled_ids = random.sample(all_ids, count)
            else:
                sampled_ids = all_ids
            
            # Fetch full session data for sampled IDs
            placeholders = ",".join("?" * len(sampled_ids))
            cursor.execute(f"""
                SELECT 
                    s.*,
                    b.name as batch_name
                FROM sessions s
                LEFT JOIN synthetic_batches b ON s.batch_id = b.id
                WHERE s.id IN ({placeholders})
                ORDER BY s.{sort_by.value} {sort_direction.value}
            """, sampled_ids)
            
            return [dict(row) for row in cursor.fetchall()]
    
    # =========================================================================
    # Note Search
    # =========================================================================
    
    def search_by_notes(
        self,
        search_term: str,
        filters: Optional[SessionFilters] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        Search sessions by note content.
        
        Finds sessions that have notes containing the search term.
        
        Args:
            search_term: Text to search for in notes
            filters: Additional filters to apply
            limit: Max results
            
        Returns:
            List of sessions with matching notes
        """
        filters = filters or SessionFilters()
        conditions, params = self._build_where_clause(filters)
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        
        # Add note search condition
        search_pattern = f"%{search_term}%"
        
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            cursor.execute(f"""
                SELECT DISTINCT
                    s.*,
                    b.name as batch_name,
                    (SELECT GROUP_CONCAT(content, ' | ')
                     FROM session_notes n 
                     WHERE n.session_id = s.id 
                     AND n.content LIKE ?) as matching_notes
                FROM sessions s
                LEFT JOIN synthetic_batches b ON s.batch_id = b.id
                INNER JOIN session_notes sn ON s.id = sn.session_id
                WHERE {where_clause}
                AND sn.content LIKE ?
                ORDER BY s.started_at DESC
                LIMIT ?
            """, params + [search_pattern, search_pattern, limit])
            
            return [dict(row) for row in cursor.fetchall()]
    
    # =========================================================================
    # Review Operations
    # =========================================================================
    
    def mark_reviewed(
        self,
        session_id: str,
        reviewer_notes: Optional[str] = None
    ) -> bool:
        """
        Mark a session as reviewed.
        
        Also updates reviewed_threads table for backwards compatibility.
        
        Returns:
            True if session was found and updated
        """
        now = now_iso()
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Update sessions table
            cursor.execute("""
                UPDATE sessions 
                SET is_reviewed = TRUE, reviewed_at = ?, updated_at = ?
                WHERE id = ?
            """, (now, now, session_id))
            
            if cursor.rowcount == 0:
                return False
            
            # Backwards compatibility: also update reviewed_threads
            cursor.execute("""
                INSERT OR REPLACE INTO reviewed_threads (thread_id, reviewed_at, reviewer_notes)
                VALUES (?, ?, ?)
            """, (session_id, now, reviewer_notes))
            
            return True
    
    def unmark_reviewed(self, session_id: str) -> bool:
        """
        Remove review status from a session.
        
        Returns:
            True if session was found and updated
        """
        now = now_iso()
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Update sessions table
            cursor.execute("""
                UPDATE sessions 
                SET is_reviewed = FALSE, reviewed_at = NULL, updated_at = ?
                WHERE id = ?
            """, (now, session_id))
            
            # Backwards compatibility
            cursor.execute(
                "DELETE FROM reviewed_threads WHERE thread_id = ?",
                (session_id,)
            )
            
            return cursor.rowcount > 0
    
    def get_next_unreviewed(
        self,
        filters: Optional[SessionFilters] = None,
        sort_by: SortField = SortField.STARTED_AT,
        sort_direction: SortDirection = SortDirection.DESC,
    ) -> Optional[Dict[str, Any]]:
        """
        Get the next unreviewed session matching filters.
        
        Useful for "Next" button in review workflow.
        """
        filters = filters or SessionFilters()
        filters.is_reviewed = False  # Force unreviewed
        
        conditions, params = self._build_where_clause(filters)
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            cursor.execute(f"""
                SELECT 
                    s.*,
                    b.name as batch_name
                FROM sessions s
                LEFT JOIN synthetic_batches b ON s.batch_id = b.id
                WHERE {where_clause}
                ORDER BY s.{sort_by.value} {sort_direction.value}
                LIMIT 1
            """, params)
            row = cursor.fetchone()
            return dict(row) if row else None
    
    # =========================================================================
    # Note Operations
    # =========================================================================
    
    def list_notes(self, session_id: str) -> List[Dict[str, Any]]:
        """Get all notes for a session."""
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM session_notes 
                WHERE session_id = ? 
                ORDER BY created_at
            """, (session_id,))
            return [dict(row) for row in cursor.fetchall()]
    
    def create_note(
        self,
        session_id: str,
        content: str,
        note_type: str = "observation",
        call_id: Optional[str] = None,
        created_by: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Create a note for a session.
        
        Returns:
            The created note dict, or None if session not found
        """
        now = now_iso()
        note_id = generate_id()
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Verify session exists
            cursor.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
            if not cursor.fetchone():
                return None
            
            cursor.execute("""
                INSERT INTO session_notes (
                    id, session_id, call_id, content, note_type,
                    synced_to_weave, created_at, updated_at, created_by
                ) VALUES (?, ?, ?, ?, ?, FALSE, ?, ?, ?)
            """, (
                note_id,
                session_id,
                call_id,
                content,
                note_type,
                now,
                now,
                created_by
            ))
            
            # Fetch and return the created note
            cursor.execute("SELECT * FROM session_notes WHERE id = ?", (note_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
    
    def delete_note(self, session_id: str, note_id: str) -> bool:
        """
        Delete a note.
        
        Returns:
            True if note was found and deleted
        """
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM session_notes WHERE id = ? AND session_id = ?",
                (note_id, session_id)
            )
            return cursor.rowcount > 0
    
    # =========================================================================
    # Batch Review Progress
    # =========================================================================
    
    def get_batch_review_progress(self, batch_id: str) -> Optional[Dict[str, Any]]:
        """
        Get review progress for a specific batch.
        
        Returns:
            Dict with progress metrics, or None if batch not found
        """
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            
            # Get batch info
            cursor.execute(
                "SELECT id, name FROM synthetic_batches WHERE id = ?",
                (batch_id,)
            )
            batch_row = cursor.fetchone()
            if not batch_row:
                return None
            
            # Get session counts
            cursor.execute("""
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN is_reviewed THEN 1 ELSE 0 END) as reviewed,
                    SUM(CASE WHEN has_error THEN 1 ELSE 0 END) as errors
                FROM sessions
                WHERE batch_id = ?
            """, (batch_id,))
            counts = cursor.fetchone()
            
            total = counts["total"] or 0
            reviewed = counts["reviewed"] or 0
            
            # Get recent activity
            cursor.execute("""
                SELECT 
                    COUNT(*) as recent_count,
                    MAX(reviewed_at) as last_review
                FROM sessions
                WHERE batch_id = ? 
                AND is_reviewed = TRUE
                AND reviewed_at > datetime('now', '-1 day')
            """, (batch_id,))
            recent = cursor.fetchone()
            
            return {
                "batch_id": batch_id,
                "batch_name": batch_row["name"],
                "total_sessions": total,
                "reviewed_sessions": reviewed,
                "unreviewed_sessions": total - reviewed,
                "error_sessions": counts["errors"] or 0,
                "progress_percent": round((reviewed / total * 100) if total > 0 else 0, 1),
                "recent_reviews_24h": recent["recent_count"] or 0,
                "last_review_at": recent["last_review"],
            }
    
    # =========================================================================
    # Distinct Values (for UI filter dropdowns)
    # =========================================================================
    
    def get_distinct_models(self) -> List[str]:
        """Get list of distinct primary models."""
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT DISTINCT primary_model 
                FROM sessions 
                WHERE primary_model IS NOT NULL
                ORDER BY primary_model
            """)
            return [row["primary_model"] for row in cursor.fetchall()]
    
    def get_batch_options(self) -> List[Dict[str, str]]:
        """Get list of batches for filter dropdown."""
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT DISTINCT 
                    s.batch_id,
                    b.name as batch_name
                FROM sessions s
                LEFT JOIN synthetic_batches b ON s.batch_id = b.id
                WHERE s.batch_id IS NOT NULL
                ORDER BY b.name
            """)
            return [
                {"id": row["batch_id"], "name": row["batch_name"]}
                for row in cursor.fetchall()
            ]
    
    # =========================================================================
    # Internal Helpers
    # =========================================================================
    
    def _build_where_clause(
        self, 
        filters: SessionFilters
    ) -> Tuple[List[str], List[Any]]:
        """
        Build SQL WHERE conditions from filters.
        
        Returns:
            Tuple of (conditions list, params list)
        """
        conditions = []
        params = []
        
        # Batch filter
        if filters.batch_id:
            conditions.append("s.batch_id = ?")
            params.append(filters.batch_id)
        elif filters.exclude_batches:
            conditions.append("s.batch_id IS NULL")
        
        # Turn count range
        if filters.min_turns is not None:
            conditions.append("s.turn_count >= ?")
            params.append(filters.min_turns)
        if filters.max_turns is not None:
            conditions.append("s.turn_count <= ?")
            params.append(filters.max_turns)
        
        # Review status
        if filters.is_reviewed is not None:
            conditions.append("s.is_reviewed = ?")
            params.append(filters.is_reviewed)
        
        # Error status
        if filters.has_error is not None:
            conditions.append("s.has_error = ?")
            params.append(filters.has_error)
        
        # Token range
        if filters.min_tokens is not None:
            conditions.append("s.total_tokens >= ?")
            params.append(filters.min_tokens)
        if filters.max_tokens is not None:
            conditions.append("s.total_tokens <= ?")
            params.append(filters.max_tokens)
        
        # Cost range
        if filters.min_cost is not None:
            conditions.append("s.estimated_cost_usd >= ?")
            params.append(filters.min_cost)
        if filters.max_cost is not None:
            conditions.append("s.estimated_cost_usd <= ?")
            params.append(filters.max_cost)
        
        # Latency range
        if filters.min_latency_ms is not None:
            conditions.append("s.total_latency_ms >= ?")
            params.append(filters.min_latency_ms)
        if filters.max_latency_ms is not None:
            conditions.append("s.total_latency_ms <= ?")
            params.append(filters.max_latency_ms)
        
        # Date range
        if filters.started_after:
            conditions.append("s.started_at >= ?")
            params.append(filters.started_after)
        if filters.started_before:
            conditions.append("s.started_at <= ?")
            params.append(filters.started_before)
        
        # Model filter
        if filters.primary_model:
            conditions.append("s.primary_model = ?")
            params.append(filters.primary_model)
        
        # Note search is handled separately in search_by_notes()
        # because it requires a JOIN
        
        return conditions, params


# =============================================================================
# Singleton Instance
# =============================================================================

session_repository = SessionRepository()

