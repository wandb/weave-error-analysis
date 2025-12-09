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

See: sessions_improvements.md Section 3.1 for full design.
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
# Model Pricing (for cost estimation)
# =============================================================================

# Approximate pricing per 1M tokens (USD) - update as needed
MODEL_PRICING: Dict[str, Tuple[float, float]] = {
    # (input_price_per_1M, output_price_per_1M)
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4-turbo": (10.00, 30.00),
    "gpt-4": (30.00, 60.00),
    "gpt-3.5-turbo": (0.50, 1.50),
    "claude-3-5-sonnet": (3.00, 15.00),
    "claude-3-opus": (15.00, 75.00),
    "claude-3-haiku": (0.25, 1.25),
    # Default for unknown models
    "default": (1.00, 3.00),
}


def estimate_cost(
    input_tokens: int, 
    output_tokens: int, 
    model: Optional[str] = None
) -> float:
    """
    Estimate cost in USD based on token counts and model.
    
    Uses approximate pricing; actual costs may vary.
    """
    if model:
        # Normalize model name (remove version suffixes, etc.)
        model_key = model.lower()
        for key in MODEL_PRICING:
            if key in model_key:
                input_price, output_price = MODEL_PRICING[key]
                break
        else:
            input_price, output_price = MODEL_PRICING["default"]
    else:
        input_price, output_price = MODEL_PRICING["default"]
    
    # Calculate cost (prices are per 1M tokens)
    cost = (input_tokens * input_price / 1_000_000) + (output_tokens * output_price / 1_000_000)
    return round(cost, 6)


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
        
        # Upsert sessions to local DB
        for session_id, calls in sessions_data.items():
            try:
                # Extract metrics
                metrics = self._extract_session_metrics(calls)
                
                # Find batch linkage
                batch_id, query_id = self._match_to_batch(session_id, calls, batch_linkage)
                
                # Check if already reviewed (migration from reviewed_threads)
                is_reviewed = session_id in reviewed_threads
                reviewed_at = reviewed_threads.get(session_id)
                
                # Upsert to database
                is_new = self._upsert_session(
                    session_id=session_id,
                    metrics=metrics,
                    batch_id=batch_id,
                    query_id=query_id,
                    is_reviewed=is_reviewed,
                    reviewed_at=reviewed_at
                )
                
                if is_new:
                    result.sessions_added += 1
                else:
                    result.sessions_updated += 1
                    
            except Exception as e:
                logger.error(f"Failed to sync session {session_id}: {e}")
                result.sessions_failed += 1
        
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
        
        # Upsert batch sessions
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
                
                is_new = self._upsert_session(
                    session_id=session_id,
                    metrics=metrics,
                    batch_id=batch_id,
                    query_id=query_id,
                    is_reviewed=is_reviewed,
                    reviewed_at=reviewed_at
                )
                
                if is_new:
                    result.sessions_added += 1
                else:
                    result.sessions_updated += 1
                    
            except Exception as e:
                logger.error(f"Failed to sync batch session {session_id}: {e}")
                result.sessions_failed += 1
        
        return result
    
    # =========================================================================
    # Helper Methods - Call Grouping
    # =========================================================================
    
    def _group_calls_by_session(self, calls: List[dict]) -> Dict[str, List[dict]]:
        """
        Group calls by session_id.
        
        Uses the same logic as threads.py to determine session_id:
        - thread_id (preferred)
        - summary.session_id
        - trace_id (fallback)
        
        Only returns "real" sessions (multiple calls or starts with session_).
        """
        # Build root-to-thread map (some root calls don't have thread_id but children do)
        root_to_thread: Dict[str, str] = {}
        for call in calls:
            thread_id = call.get("thread_id")
            trace_id = call.get("trace_id")
            if thread_id and trace_id:
                if trace_id not in root_to_thread:
                    root_to_thread[trace_id] = thread_id
        
        # Group calls by session
        sessions: Dict[str, List[dict]] = defaultdict(list)
        
        for call in calls:
            trace_id = call.get("trace_id")
            
            # Determine session_id with priority
            session_id = (
                call.get("thread_id") or
                root_to_thread.get(trace_id) or
                call.get("summary", {}).get("session_id") or
                trace_id
            )
            
            if not session_id:
                continue
            
            # Skip if session_id is a trace_id that maps to a thread_id
            if session_id == trace_id and trace_id in root_to_thread:
                continue
            
            sessions[session_id].append(call)
        
        # Filter to "real" sessions only
        real_sessions = {}
        for session_id, session_calls in sessions.items():
            is_real = (
                session_id.startswith("session_") or
                len(session_calls) > 1 or
                any(c.get("parent_id") is None for c in session_calls)
            )
            if is_real:
                real_sessions[session_id] = session_calls
        
        return real_sessions
    
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
                started = call.get("started_at")
                ended = call.get("ended_at")
                if started and ended:
                    try:
                        start_dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
                        end_dt = datetime.fromisoformat(ended.replace("Z", "+00:00"))
                        metrics.total_latency_ms += (end_dt - start_dt).total_seconds() * 1000
                    except Exception:
                        pass
            
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
            summary = call.get("summary", {})
            usage = summary.get("usage", {})
            
            # Handle different usage formats
            if isinstance(usage, dict):
                # Nested by model: {"gpt-4o": {"input_tokens": 100, ...}}
                for model_name, model_usage in usage.items():
                    if isinstance(model_usage, dict):
                        input_tokens = model_usage.get("input_tokens", 0) or model_usage.get("prompt_tokens", 0) or 0
                        output_tokens = model_usage.get("output_tokens", 0) or model_usage.get("completion_tokens", 0) or 0
                        
                        metrics.total_input_tokens += input_tokens
                        metrics.total_output_tokens += output_tokens
                        
                        # Track model usage
                        if input_tokens or output_tokens:
                            model_counts[model_name] += input_tokens + output_tokens
            
            # Extract model from op_name or attributes
            op_name = call.get("op_name", "")
            if "gpt" in op_name.lower() or "claude" in op_name.lower():
                model_counts[op_name] += 1
            
            # Check for model in attributes
            attributes = call.get("attributes", {})
            model = attributes.get("model")
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
        
        # Calculate totals
        metrics.total_tokens = metrics.total_input_tokens + metrics.total_output_tokens
        
        # Determine primary model
        if model_counts:
            metrics.primary_model = max(model_counts, key=model_counts.get)
        
        # Calculate cost estimate
        if metrics.total_input_tokens or metrics.total_output_tokens:
            metrics.estimated_cost_usd = estimate_cost(
                metrics.total_input_tokens,
                metrics.total_output_tokens,
                metrics.primary_model
            )
        
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
        
        # Generate weave URL
        # Format: weave:///{entity}/{project}/session/{session_id}
        # We'll construct a generic URL - actual format may vary
        from config import PROJECT_ID
        weave_url = f"https://wandb.ai/{PROJECT_ID}/weave/calls?filter=%7B%22traceId%22%3A%22{metrics.root_trace_id or session_id}%22%7D"
        
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
                        weave_url = ?,
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
                    weave_url,
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
                        id, weave_session_id, root_trace_id, weave_url,
                        batch_id, query_id,
                        turn_count, call_count, total_latency_ms,
                        total_input_tokens, total_output_tokens, total_tokens,
                        estimated_cost_usd, primary_model,
                        has_error, error_summary,
                        started_at, ended_at,
                        last_synced_at, sync_status,
                        is_reviewed, reviewed_at,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    session_id,
                    session_id,  # weave_session_id
                    metrics.root_trace_id,
                    weave_url,
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

