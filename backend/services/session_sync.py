"""
Session Sync Service - Background synchronization of Weave sessions to local SQLite.

This service is the foundation for fast, offline-capable session browsing.
It runs in the background (never blocking UI) and syncs sessions from Weave
to the local database.

Key Principles:
- Sessions tab reads from LOCAL DB only - instant response
- Sync happens in background (asyncio.create_task)
- Auto-triggers after batch execution completes
- Supports incremental sync (only new sessions since last sync)

Sync Triggers:
1. After batch execution completes (auto)
2. On app startup (incremental)
3. Manual trigger via API
"""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Set, Tuple
from collections import defaultdict
from enum import Enum

from database import get_db, now_iso, generate_id
from services.weave_client import weave_client
from logger import get_logger, log_event, generate_correlation_id

logger = get_logger("session_sync")


# =============================================================================
# Cost Extraction from Weave
# =============================================================================

def extract_cost_from_call(call: dict) -> float:
    """
    Extract cost from Weave's native cost tracking.
    
    Weave tracks costs in summary.weave.costs with the structure:
    {
        "model_name": {
            "prompt_tokens": int,
            "completion_tokens": int,
            "requests": int,
            "total_tokens": int,
            "cost": float  # <-- The actual cost
        }
    }
    
    We sum all model costs. If Weave doesn't have cost data, return 0.
    No client-side estimation - the source of truth is Weave.
    """
    summary = call.get("summary", {})
    weave_data = summary.get("weave", {})
    costs = weave_data.get("costs", {})
    
    if costs and isinstance(costs, dict):
        return sum(
            model_cost.get("cost", 0) 
            for model_cost in costs.values() 
            if isinstance(model_cost, dict)
        )
    
    return 0.0


def get_call_duration_ms(call: dict) -> float:
    """
    Get call duration in milliseconds from timestamps.
    
    Returns 0.0 if timestamps are missing or invalid.
    """
    started = call.get("started_at")
    ended = call.get("ended_at")
    
    if not (started and ended):
        return 0.0
    
    try:
        start_dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(ended.replace("Z", "+00:00"))
        return (end_dt - start_dt).total_seconds() * 1000
    except Exception:
        return 0.0


# =============================================================================
# Data Classes for Sync Results
# =============================================================================

class SyncStatus(str, Enum):
    IDLE = "idle"
    SYNCING = "syncing"
    ERROR = "error"


class SyncType(str, Enum):
    FULL = "full"
    INCREMENTAL = "incremental"
    BATCH = "batch"


@dataclass
class SessionMetrics:
    """Extracted metrics from a session's calls."""
    turn_count: int = 0
    call_count: int = 0
    total_latency_ms: float = 0.0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0
    primary_model: Optional[str] = None
    has_error: bool = False
    error_summary: Optional[str] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    root_trace_id: Optional[str] = None


@dataclass
class SyncResult:
    """Result of a sync operation."""
    success: bool = True
    sync_type: SyncType = SyncType.INCREMENTAL
    sessions_added: int = 0
    sessions_updated: int = 0
    sessions_failed: int = 0
    duration_ms: int = 0
    error_message: Optional[str] = None
    batch_id: Optional[str] = None


@dataclass
class SyncStatusInfo:
    """Current sync status for API responses."""
    status: SyncStatus = SyncStatus.IDLE
    last_sync_completed_at: Optional[str] = None
    last_sync_type: Optional[str] = None
    sessions_added: int = 0
    sessions_updated: int = 0
    is_syncing: bool = False
    current_sync_progress: float = 0.0
    error_message: Optional[str] = None


# =============================================================================
# Session Sync Service
# =============================================================================

class SessionSyncService:
    """
    Syncs sessions from Weave to local SQLite database.
    
    The sync process:
    1. Fetch traces from Weave (with timestamp filter for incremental sync)
    2. Group traces by session_id (from summary or derived)
    3. Extract metrics (tokens, cost, latency, errors)
    4. Match to batch/query if trace_id exists in synthetic_queries
    5. Upsert to local sessions table
    
    Usage:
        # Non-blocking sync (recommended)
        asyncio.create_task(session_sync_service.sync_incremental())
        
        # Or await if you need to wait
        result = await session_sync_service.sync_sessions()
    """
    
    def __init__(self):
        self._lock = asyncio.Lock()  # Prevent concurrent syncs
        self._current_sync_task: Optional[asyncio.Task] = None
    
    # =========================================================================
    # Public Sync Methods
    # =========================================================================
    
    async def sync_sessions(
        self,
        full_sync: bool = False,
        batch_id: Optional[str] = None
    ) -> SyncResult:
        """
        Sync sessions from Weave to local database.
        
        Args:
            full_sync: If True, sync all sessions. If False, only sync since last sync.
            batch_id: If provided, only sync sessions linked to this batch.
            
        Returns:
            SyncResult with counts of synced/updated/failed sessions.
        """
        # Determine sync type
        if batch_id:
            sync_type = SyncType.BATCH
        elif full_sync:
            sync_type = SyncType.FULL
        else:
            sync_type = SyncType.INCREMENTAL
        
        correlation_id = generate_correlation_id()
        start_time = datetime.utcnow()
        
        log_event(logger, "session_sync.started",
            correlation_id=correlation_id,
            sync_type=sync_type.value,
            full_sync=full_sync,
            batch_id=batch_id
        )
        
        # Use lock to prevent concurrent syncs
        async with self._lock:
            try:
                # Update sync status to syncing
                self._update_sync_status(
                    status=SyncStatus.SYNCING,
                    sync_type=sync_type,
                    batch_id=batch_id
                )
                
                # Perform the sync
                if batch_id:
                    result = await self._sync_batch_sessions(batch_id, correlation_id)
                else:
                    result = await self._sync_all_sessions(full_sync, correlation_id)
                
                # Calculate duration
                result.duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
                result.sync_type = sync_type
                
                # Update sync status to complete
                self._update_sync_status(
                    status=SyncStatus.IDLE,
                    sync_type=sync_type,
                    completed=True,
                    result=result,
                    batch_id=batch_id
                )
                
                log_event(logger, "session_sync.completed",
                    correlation_id=correlation_id,
                    sync_type=sync_type.value,
                    sessions_added=result.sessions_added,
                    sessions_updated=result.sessions_updated,
                    sessions_failed=result.sessions_failed,
                    duration_ms=result.duration_ms
                )
                
                return result
                
            except Exception as e:
                error_msg = str(e)
                logger.error(f"Session sync failed: {error_msg}", exc_info=True)
                
                # Update sync status to error
                self._update_sync_status(
                    status=SyncStatus.ERROR,
                    error_message=error_msg
                )
                
                log_event(logger, "session_sync.failed",
                    correlation_id=correlation_id,
                    error=error_msg
                )
                
                return SyncResult(
                    success=False,
                    sync_type=sync_type,
                    error_message=error_msg,
                    duration_ms=int((datetime.utcnow() - start_time).total_seconds() * 1000)
                )
    
    async def sync_incremental(self) -> SyncResult:
        """
        Perform an incremental sync (only new sessions since last sync).
        
        This is the default sync method, called:
        - On app startup
        - Periodically in background
        """
        return await self.sync_sessions(full_sync=False)
    
    async def sync_full(self) -> SyncResult:
        """
        Perform a full sync of all sessions.
        
        Use sparingly - this fetches all sessions from Weave.
        """
        return await self.sync_sessions(full_sync=True)
    
    async def sync_batch_sessions(self, batch_id: str) -> SyncResult:
        """
        Sync only sessions from a specific batch.
        
        Called automatically after batch execution completes.
        Uses trace_ids from synthetic_queries to find matching sessions.
        """
        return await self.sync_sessions(batch_id=batch_id)
    
    def trigger_background_sync(
        self,
        full_sync: bool = False,
        batch_id: Optional[str] = None
    ) -> bool:
        """
        Trigger a non-blocking background sync.
        
        Returns True if sync was started, False if already syncing.
        
        Usage:
            # Fire and forget - doesn't block
            session_sync_service.trigger_background_sync()
        """
        if self._lock.locked():
            logger.info("Sync already in progress, skipping trigger")
            return False
        
        asyncio.create_task(self.sync_sessions(full_sync=full_sync, batch_id=batch_id))
        return True
    
    # =========================================================================
    # Status Methods
    # =========================================================================
    
    def get_sync_status(self) -> SyncStatusInfo:
        """
        Get current sync status for API/UI display.
        
        Returns:
            SyncStatusInfo with current state, last sync time, etc.
        """
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM sync_status WHERE id = 'sessions'")
            row = cursor.fetchone()
            
            if not row:
                return SyncStatusInfo()
            
            return SyncStatusInfo(
                status=SyncStatus(row["status"]) if row["status"] else SyncStatus.IDLE,
                last_sync_completed_at=row["last_sync_completed_at"],
                last_sync_type=row["last_sync_type"],
                sessions_added=row["sessions_added"] or 0,
                sessions_updated=row["sessions_updated"] or 0,
                is_syncing=row["status"] == "syncing",
                current_sync_progress=row["current_sync_progress"] or 0.0,
                error_message=row["error_message"]
            )
    
    # =========================================================================
    # Internal Sync Implementation
    # =========================================================================
    
    async def _sync_all_sessions(
        self,
        full_sync: bool,
        correlation_id: str
    ) -> SyncResult:
        """
        Sync all sessions (full or incremental).
        """
        result = SyncResult()
        
        # Get last sync timestamp for incremental sync
        last_timestamp = None
        if not full_sync:
            last_timestamp = self._get_last_sync_timestamp()
        
        # Fetch calls from Weave
        # For incremental, we'd ideally filter by timestamp but Weave API
        # doesn't support that well, so we fetch recent and dedupe
        try:
            all_calls = await weave_client.query_calls(
                limit=500,  # Match existing behavior
                sort_field="started_at",
                sort_direction="desc"
            )
        except Exception as e:
            logger.error(f"Failed to fetch calls from Weave: {e}")
            result.success = False
            result.error_message = f"Weave API error: {e}"
            return result
        
        if not all_calls:
            logger.info("No calls returned from Weave")
            return result
        
        # Group calls by session
        sessions_data = self._group_calls_by_session(all_calls)
        
        # Get batch linkage info
        batch_linkage = self._get_batch_linkage()
        
        # Get existing reviewed threads for migration
        reviewed_threads = self._get_reviewed_threads()
        
        # Prepare session data for batch upsert
        sessions_to_upsert = []
        for session_id, calls in sessions_data.items():
            try:
                # Extract metrics
                metrics = self._extract_session_metrics(calls)
                
                # Find batch linkage
                batch_id, query_id = self._match_to_batch(session_id, calls, batch_linkage)
                
                # Check if already reviewed (migration from reviewed_threads)
                is_reviewed = session_id in reviewed_threads
                reviewed_at = reviewed_threads.get(session_id)
                
                sessions_to_upsert.append({
                    "session_id": session_id,
                    "metrics": metrics,
                    "batch_id": batch_id,
                    "query_id": query_id,
                    "is_reviewed": is_reviewed,
                    "reviewed_at": reviewed_at,
                })
            except Exception as e:
                logger.error(f"Failed to prepare session {session_id}: {e}")
                result.sessions_failed += 1
        
        # Batch upsert all sessions in a single transaction
        added, updated, failed = self._batch_upsert_sessions(sessions_to_upsert)
        result.sessions_added = added
        result.sessions_updated = updated
        result.sessions_failed += failed
        
        return result
    
    async def _sync_batch_sessions(
        self,
        batch_id: str,
        correlation_id: str
    ) -> SyncResult:
        """
        Sync only sessions linked to a specific batch.
        
        Uses trace_ids/thread_ids from synthetic_queries to identify sessions.
        """
        result = SyncResult(batch_id=batch_id)
        
        # Get trace_ids and thread_ids for this batch
        batch_trace_ids = set()
        batch_thread_ids = set()
        query_map: Dict[str, str] = {}  # trace_id -> query_id
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, trace_id, thread_id 
                FROM synthetic_queries 
                WHERE batch_id = ?
            """, (batch_id,))
            for row in cursor.fetchall():
                if row["trace_id"]:
                    batch_trace_ids.add(row["trace_id"])
                    query_map[row["trace_id"]] = row["id"]
                if row["thread_id"]:
                    batch_thread_ids.add(row["thread_id"])
        
        if not batch_trace_ids and not batch_thread_ids:
            logger.info(f"No trace_ids/thread_ids found for batch {batch_id}")
            return result
        
        logger.info(f"Syncing batch {batch_id}: {len(batch_trace_ids)} trace_ids, {len(batch_thread_ids)} thread_ids")
        
        # Fetch calls from Weave
        try:
            all_calls = await weave_client.query_calls(
                limit=500,
                sort_field="started_at",
                sort_direction="desc"
            )
        except Exception as e:
            result.success = False
            result.error_message = f"Weave API error: {e}"
            return result
        
        # Group calls by session
        sessions_data = self._group_calls_by_session(all_calls)
        
        # Filter to only sessions in this batch
        batch_sessions = {}
        for session_id, calls in sessions_data.items():
            # Check if session matches batch
            call_trace_ids = {c.get("trace_id") for c in calls if c.get("trace_id")}
            
            if session_id in batch_thread_ids:
                batch_sessions[session_id] = calls
            elif call_trace_ids.intersection(batch_trace_ids):
                batch_sessions[session_id] = calls
        
        # Get existing reviewed threads for migration
        reviewed_threads = self._get_reviewed_threads()
        
        # Prepare session data for batch upsert
        sessions_to_upsert = []
        for session_id, calls in batch_sessions.items():
            try:
                metrics = self._extract_session_metrics(calls)
                
                # Find the query_id from trace_id
                query_id = None
                for call in calls:
                    trace_id = call.get("trace_id")
                    if trace_id in query_map:
                        query_id = query_map[trace_id]
                        break
                
                # Check if already reviewed
                is_reviewed = session_id in reviewed_threads
                reviewed_at = reviewed_threads.get(session_id)
                
                sessions_to_upsert.append({
                    "session_id": session_id,
                    "metrics": metrics,
                    "batch_id": batch_id,
                    "query_id": query_id,
                    "is_reviewed": is_reviewed,
                    "reviewed_at": reviewed_at,
                })
            except Exception as e:
                logger.error(f"Failed to prepare batch session {session_id}: {e}")
                result.sessions_failed += 1
        
        # Batch upsert all sessions in a single transaction
        added, updated, failed = self._batch_upsert_sessions(sessions_to_upsert)
        result.sessions_added = added
        result.sessions_updated = updated
        result.sessions_failed += failed
        
        return result
    
    # =========================================================================
    # Helper Methods - Call Grouping
    # =========================================================================
    
    def _group_calls_by_session(self, calls: List[dict]) -> Dict[str, List[dict]]:
        """
        Group calls by session_id.
        
        Session ID determination (simplified):
        - thread_id if present (agents should use weave.attributes(thread_id=...) for multi-turn)
        - trace_id as fallback (single-turn or un-attributed calls)
        
        Returns sessions with at least one root call (parent_id is None).
        """
        sessions: Dict[str, List[dict]] = defaultdict(list)
        
        for call in calls:
            session_id = self._get_session_id(call)
            if session_id:
                sessions[session_id].append(call)
        
        # Filter to sessions with at least one root call
        return {
            sid: session_calls 
            for sid, session_calls in sessions.items()
            if any(c.get("parent_id") is None for c in session_calls)
        }
    
    def _get_session_id(self, call: dict) -> Optional[str]:
        """
        Get session ID for a call.
        
        Uses thread_id if present, otherwise falls back to trace_id.
        Agents should use weave.attributes(thread_id=...) for multi-turn conversations.
        """
        return call.get("thread_id") or call.get("trace_id") or call.get("id")
    
    # =========================================================================
    # Helper Methods - Metrics Extraction
    # =========================================================================
    
    def _extract_session_metrics(self, calls: List[dict]) -> SessionMetrics:
        """
        Extract metrics from a session's calls.
        
        Extracts:
        - Turn count (root calls only)
        - Total latency
        - Token counts (from summary.usage)
        - Cost estimate
        - Primary model
        - Error status
        - Timestamps
        """
        metrics = SessionMetrics()
        metrics.call_count = len(calls)
        
        model_counts: Dict[str, int] = defaultdict(int)
        errors: List[str] = []
        
        for call in calls:
            is_root = call.get("parent_id") is None
            
            # Count turns (root calls only)
            if is_root:
                metrics.turn_count += 1
                
                # Track root trace_id
                if not metrics.root_trace_id:
                    metrics.root_trace_id = call.get("trace_id")
            
            # Calculate latency for root calls only
            if is_root:
                metrics.total_latency_ms += get_call_duration_ms(call)
            
            # Track timestamps
            started = call.get("started_at")
            ended = call.get("ended_at")
            if started:
                if metrics.started_at is None or started < metrics.started_at:
                    metrics.started_at = started
            if ended:
                if metrics.ended_at is None or ended > metrics.ended_at:
                    metrics.ended_at = ended
            
            # Extract token usage from summary
            # Weave normalizes to input_tokens/output_tokens - trust the format
            summary = call.get("summary", {})
            usage = summary.get("usage", {})
            
            if isinstance(usage, dict):
                # Nested by model: {"gpt-4o": {"input_tokens": 100, ...}}
                for model_name, model_usage in usage.items():
                    if isinstance(model_usage, dict):
                        input_tokens = model_usage.get("input_tokens", 0) or 0
                        output_tokens = model_usage.get("output_tokens", 0) or 0
                        
                        metrics.total_input_tokens += input_tokens
                        metrics.total_output_tokens += output_tokens
                        
                        # Track model usage by token count
                        if input_tokens or output_tokens:
                            model_counts[model_name] += input_tokens + output_tokens
            
            # Extract model from structured data only (no op_name string matching)
            # Priority: 1. attributes.model, 2. inputs.model, 3. usage keys (already handled above)
            attributes = call.get("attributes", {})
            model = attributes.get("model")
            if not model:
                # Fallback to inputs.model for LLM calls
                model = call.get("inputs", {}).get("model")
            if model:
                model_counts[model] += 1
            
            # Check for errors
            exception = call.get("exception")
            if exception:
                metrics.has_error = True
                if isinstance(exception, str):
                    errors.append(exception[:200])
                elif isinstance(exception, dict):
                    errors.append(str(exception.get("message", exception))[:200])
            
            # Extract cost from Weave's native cost tracking
            metrics.estimated_cost_usd += extract_cost_from_call(call)
        
        # Calculate totals
        metrics.total_tokens = metrics.total_input_tokens + metrics.total_output_tokens
        
        # Determine primary model
        if model_counts:
            metrics.primary_model = max(model_counts, key=model_counts.get)
        
        # Summarize errors
        if errors:
            metrics.error_summary = "; ".join(errors[:3])  # First 3 errors
            if len(errors) > 3:
                metrics.error_summary += f" (+{len(errors) - 3} more)"
        
        return metrics
    
    # =========================================================================
    # Helper Methods - Batch Linkage
    # =========================================================================
    
    def _get_batch_linkage(self) -> Dict[str, Tuple[str, str]]:
        """
        Get mapping of trace_id/thread_id -> (batch_id, query_id).
        """
        linkage = {}
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, batch_id, trace_id, thread_id 
                FROM synthetic_queries 
                WHERE trace_id IS NOT NULL OR thread_id IS NOT NULL
            """)
            for row in cursor.fetchall():
                if row["trace_id"]:
                    linkage[row["trace_id"]] = (row["batch_id"], row["id"])
                if row["thread_id"]:
                    linkage[row["thread_id"]] = (row["batch_id"], row["id"])
        return linkage
    
    def _match_to_batch(
        self,
        session_id: str,
        calls: List[dict],
        batch_linkage: Dict[str, Tuple[str, str]]
    ) -> Tuple[Optional[str], Optional[str]]:
        """
        Find batch_id and query_id if session matches a synthetic query.
        
        Returns:
            (batch_id, query_id) or (None, None) if no match
        """
        # Check session_id directly
        if session_id in batch_linkage:
            return batch_linkage[session_id]
        
        # Check trace_ids of calls
        for call in calls:
            trace_id = call.get("trace_id")
            if trace_id and trace_id in batch_linkage:
                return batch_linkage[trace_id]
        
        return None, None
    
    # =========================================================================
    # Helper Methods - Database Operations
    # =========================================================================
    
    def _get_reviewed_threads(self) -> Dict[str, Optional[str]]:
        """
        Get reviewed threads for migration.
        
        Returns:
            Dict of thread_id -> reviewed_at timestamp
        """
        reviewed = {}
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT thread_id, reviewed_at FROM reviewed_threads")
            for row in cursor.fetchall():
                reviewed[row["thread_id"]] = row["reviewed_at"]
        return reviewed
    
    def _get_last_sync_timestamp(self) -> Optional[str]:
        """Get timestamp of last successful sync."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT last_weave_timestamp FROM sync_status WHERE id = 'sessions'"
            )
            row = cursor.fetchone()
            return row["last_weave_timestamp"] if row else None
    
    def _upsert_session(
        self,
        session_id: str,
        metrics: SessionMetrics,
        batch_id: Optional[str],
        query_id: Optional[str],
        is_reviewed: bool = False,
        reviewed_at: Optional[str] = None
    ) -> bool:
        """
        Insert or update a session in the local database.
        
        Returns:
            True if new session was inserted, False if existing was updated.
        """
        now = now_iso()
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Check if exists
            cursor.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
            exists = cursor.fetchone() is not None
            
            if exists:
                # Update existing session
                cursor.execute("""
                    UPDATE sessions SET
                        weave_session_id = ?,
                        root_trace_id = ?,
                        batch_id = COALESCE(?, batch_id),
                        query_id = COALESCE(?, query_id),
                        turn_count = ?,
                        call_count = ?,
                        total_latency_ms = ?,
                        total_input_tokens = ?,
                        total_output_tokens = ?,
                        total_tokens = ?,
                        estimated_cost_usd = ?,
                        primary_model = ?,
                        has_error = ?,
                        error_summary = ?,
                        started_at = ?,
                        ended_at = ?,
                        last_synced_at = ?,
                        sync_status = 'synced',
                        is_reviewed = CASE WHEN is_reviewed THEN is_reviewed ELSE ? END,
                        reviewed_at = CASE WHEN reviewed_at IS NOT NULL THEN reviewed_at ELSE ? END,
                        updated_at = ?
                    WHERE id = ?
                """, (
                    session_id,  # weave_session_id
                    metrics.root_trace_id,
                    batch_id,
                    query_id,
                    metrics.turn_count,
                    metrics.call_count,
                    round(metrics.total_latency_ms, 2),
                    metrics.total_input_tokens,
                    metrics.total_output_tokens,
                    metrics.total_tokens,
                    metrics.estimated_cost_usd,
                    metrics.primary_model,
                    metrics.has_error,
                    metrics.error_summary,
                    metrics.started_at,
                    metrics.ended_at,
                    now,
                    is_reviewed,
                    reviewed_at,
                    now,
                    session_id
                ))
                return False
            else:
                # Insert new session
                cursor.execute("""
                    INSERT INTO sessions (
                        id, weave_session_id, root_trace_id,
                        batch_id, query_id,
                        turn_count, call_count, total_latency_ms,
                        total_input_tokens, total_output_tokens, total_tokens,
                        estimated_cost_usd, primary_model,
                        has_error, error_summary,
                        started_at, ended_at,
                        last_synced_at, sync_status,
                        is_reviewed, reviewed_at,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    session_id,
                    session_id,  # weave_session_id
                    metrics.root_trace_id,
                    batch_id,
                    query_id,
                    metrics.turn_count,
                    metrics.call_count,
                    round(metrics.total_latency_ms, 2),
                    metrics.total_input_tokens,
                    metrics.total_output_tokens,
                    metrics.total_tokens,
                    metrics.estimated_cost_usd,
                    metrics.primary_model,
                    metrics.has_error,
                    metrics.error_summary,
                    metrics.started_at,
                    metrics.ended_at,
                    now,
                    "synced",
                    is_reviewed,
                    reviewed_at,
                    now,
                    now
                ))
                return True
    
    def _batch_upsert_sessions(
        self,
        sessions: List[Dict[str, Any]]
    ) -> Tuple[int, int, int]:
        """
        Batch upsert multiple sessions in a single transaction.
        
        This is much more efficient than individual upserts because:
        1. Single transaction instead of one per session
        2. Uses executemany() for batch operations
        3. Minimizes database round-trips
        
        Args:
            sessions: List of dicts with session_id, metrics, batch_id, query_id,
                     is_reviewed, reviewed_at
        
        Returns:
            Tuple of (sessions_added, sessions_updated, sessions_failed)
        """
        if not sessions:
            return 0, 0, 0
        
        now = now_iso()
        session_ids = [s["session_id"] for s in sessions]
        
        # Get existing session IDs in one query
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Query existing IDs
            placeholders = ",".join("?" * len(session_ids))
            cursor.execute(
                f"SELECT id FROM sessions WHERE id IN ({placeholders})",
                session_ids
            )
            existing_ids = {row["id"] for row in cursor.fetchall()}
            
            # Separate into new and existing
            new_sessions = []
            update_sessions = []
            
            for s in sessions:
                if s["session_id"] in existing_ids:
                    update_sessions.append(s)
                else:
                    new_sessions.append(s)
            
            # Batch insert new sessions
            if new_sessions:
                insert_data = []
                for s in new_sessions:
                    m = s["metrics"]
                    insert_data.append((
                        s["session_id"],
                        s["session_id"],  # weave_session_id
                        m.root_trace_id,
                        s["batch_id"],
                        s["query_id"],
                        m.turn_count,
                        m.call_count,
                        round(m.total_latency_ms, 2),
                        m.total_input_tokens,
                        m.total_output_tokens,
                        m.total_tokens,
                        m.estimated_cost_usd,
                        m.primary_model,
                        m.has_error,
                        m.error_summary,
                        m.started_at,
                        m.ended_at,
                        now,
                        "synced",
                        s["is_reviewed"],
                        s["reviewed_at"],
                        now,
                        now
                    ))
                
                cursor.executemany("""
                    INSERT INTO sessions (
                        id, weave_session_id, root_trace_id,
                        batch_id, query_id,
                        turn_count, call_count, total_latency_ms,
                        total_input_tokens, total_output_tokens, total_tokens,
                        estimated_cost_usd, primary_model,
                        has_error, error_summary,
                        started_at, ended_at,
                        last_synced_at, sync_status,
                        is_reviewed, reviewed_at,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, insert_data)
            
            # Batch update existing sessions
            if update_sessions:
                update_data = []
                for s in update_sessions:
                    m = s["metrics"]
                    update_data.append((
                        s["session_id"],  # weave_session_id
                        m.root_trace_id,
                        s["batch_id"],
                        s["query_id"],
                        m.turn_count,
                        m.call_count,
                        round(m.total_latency_ms, 2),
                        m.total_input_tokens,
                        m.total_output_tokens,
                        m.total_tokens,
                        m.estimated_cost_usd,
                        m.primary_model,
                        m.has_error,
                        m.error_summary,
                        m.started_at,
                        m.ended_at,
                        now,
                        s["is_reviewed"],
                        s["reviewed_at"],
                        now,
                        s["session_id"]
                    ))
                
                cursor.executemany("""
                    UPDATE sessions SET
                        weave_session_id = ?,
                        root_trace_id = ?,
                        batch_id = COALESCE(?, batch_id),
                        query_id = COALESCE(?, query_id),
                        turn_count = ?,
                        call_count = ?,
                        total_latency_ms = ?,
                        total_input_tokens = ?,
                        total_output_tokens = ?,
                        total_tokens = ?,
                        estimated_cost_usd = ?,
                        primary_model = ?,
                        has_error = ?,
                        error_summary = ?,
                        started_at = ?,
                        ended_at = ?,
                        last_synced_at = ?,
                        sync_status = 'synced',
                        is_reviewed = CASE WHEN is_reviewed THEN is_reviewed ELSE ? END,
                        reviewed_at = CASE WHEN reviewed_at IS NOT NULL THEN reviewed_at ELSE ? END,
                        updated_at = ?
                    WHERE id = ?
                """, update_data)
            
            logger.debug(f"Batch upsert: {len(new_sessions)} inserted, {len(update_sessions)} updated")
            
            return len(new_sessions), len(update_sessions), 0
    
    def _update_sync_status(
        self,
        status: SyncStatus,
        sync_type: Optional[SyncType] = None,
        completed: bool = False,
        result: Optional[SyncResult] = None,
        error_message: Optional[str] = None,
        batch_id: Optional[str] = None
    ):
        """Update sync status in database."""
        now = now_iso()
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            if status == SyncStatus.SYNCING:
                cursor.execute("""
                    UPDATE sync_status SET
                        status = ?,
                        current_sync_started_at = ?,
                        current_sync_type = ?,
                        current_sync_progress = 0,
                        error_message = NULL
                    WHERE id = 'sessions'
                """, (status.value, now, sync_type.value if sync_type else None))
                
            elif completed and result:
                cursor.execute("""
                    UPDATE sync_status SET
                        status = ?,
                        last_sync_started_at = current_sync_started_at,
                        last_sync_completed_at = ?,
                        last_sync_type = ?,
                        last_sync_batch_id = ?,
                        sessions_added = ?,
                        sessions_updated = ?,
                        sessions_failed = ?,
                        current_sync_started_at = NULL,
                        current_sync_type = NULL,
                        current_sync_progress = 0,
                        last_weave_timestamp = ?,
                        error_message = NULL
                    WHERE id = 'sessions'
                """, (
                    status.value,
                    now,
                    sync_type.value if sync_type else None,
                    batch_id,
                    result.sessions_added,
                    result.sessions_updated,
                    result.sessions_failed,
                    now  # Use current time as last_weave_timestamp
                ))
                
            elif status == SyncStatus.ERROR:
                cursor.execute("""
                    UPDATE sync_status SET
                        status = ?,
                        error_message = ?,
                        current_sync_started_at = NULL,
                        current_sync_type = NULL,
                        current_sync_progress = 0
                    WHERE id = 'sessions'
                """, (status.value, error_message))
            
            else:
                cursor.execute("""
                    UPDATE sync_status SET status = ? WHERE id = 'sessions'
                """, (status.value,))


# =============================================================================
# Singleton Instance
# =============================================================================

session_sync_service = SessionSyncService()


# =============================================================================
# Convenience Functions for Integration
# =============================================================================

def trigger_session_sync(
    full_sync: bool = False,
    batch_id: Optional[str] = None
) -> bool:
    """
    Trigger a non-blocking background sync.
    
    Use this from batch_executor.py after batch completion:
    
        from services.session_sync import trigger_session_sync
        trigger_session_sync(batch_id=batch_id)
    
    Returns:
        True if sync was started, False if already syncing.
    """
    return session_sync_service.trigger_background_sync(
        full_sync=full_sync,
        batch_id=batch_id
    )


async def startup_sync():
    """
    Called on app startup to perform initial incremental sync.
    
    Add to main.py:
    
        @app.on_event("startup")
        async def on_startup():
            from services.session_sync import startup_sync
            asyncio.create_task(startup_sync())
    """
    logger.info("Starting initial session sync...")
    
    # Small delay to let the app fully start
    await asyncio.sleep(2)
    
    try:
        result = await session_sync_service.sync_incremental()
        logger.info(
            f"Startup sync complete: {result.sessions_added} added, "
            f"{result.sessions_updated} updated, {result.sessions_failed} failed"
        )
    except Exception as e:
        logger.error(f"Startup sync failed: {e}")

