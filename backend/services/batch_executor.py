"""
Batch Executor Service for running synthetic queries through connected agents.

This service orchestrates:
1. Fetching synthetic queries from a batch
2. Running each query through the agent
3. Tracking execution status and results
4. Linking generated traces back to the batch
5. **Auto-syncing sessions after batch completion** (Phase 2)

The auto-sync integration ensures that after a batch completes, all sessions
are immediately available in the local database for fast filtering.
"""

import asyncio
import json
from datetime import datetime
from typing import Optional, Dict, Any, AsyncGenerator, List
from pydantic import BaseModel
from enum import Enum

from config import get_agent_query_timeout
from database import get_db, now_iso
from services.agent_client import AgentClient
from logger import get_logger, log_event, generate_correlation_id

logger = get_logger("batch")


class ExecutionStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"
    CANCELLED = "cancelled"


class QueryExecutionResult(BaseModel):
    """Result of executing a single query."""
    query_id: str
    status: ExecutionStatus
    response_text: Optional[str] = None
    tool_calls: List[Dict[str, Any]] = []
    trace_id: Optional[str] = None
    thread_id: Optional[str] = None
    error_message: Optional[str] = None
    started_at: str
    completed_at: Optional[str] = None
    duration_ms: Optional[int] = None


class BatchExecutionProgress(BaseModel):
    """Progress update for batch execution."""
    batch_id: str
    status: str  # 'running', 'completed', 'failed', 'cancelled'
    total_queries: int
    completed_queries: int
    success_count: int
    failure_count: int
    current_query_id: Optional[str] = None
    current_query_text: Optional[str] = None
    progress_percent: float = 0.0
    estimated_remaining_seconds: Optional[int] = None


class BatchExecutor:
    """
    Executes batches of synthetic queries against connected agents.
    
    The executor:
    1. Loads queries from the batch
    2. Connects to the agent via AG-UI
    3. Runs each query and captures the response
    4. Updates the database with results
    5. Provides progress updates via async generator
    """
    
    def __init__(
        self,
        agent_endpoint: str,
        batch_id: str,
        max_concurrent: int = 1,  # Default to sequential for easier debugging
        timeout_per_query: Optional[float] = None,  # None = use config default
        batch_info: Optional[Dict[str, Any]] = None,  # Pre-fetched batch data to avoid redundant query
        correlation_id: Optional[str] = None  # For tracing related operations
    ):
        self.agent_endpoint = agent_endpoint
        self.batch_id = batch_id
        self.max_concurrent = max_concurrent
        # Use configured timeout if not explicitly provided
        self.timeout_per_query = timeout_per_query if timeout_per_query is not None else get_agent_query_timeout()
        self.client = AgentClient(agent_endpoint, timeout=self.timeout_per_query)
        self._cancelled = False
        self._start_times: Dict[str, datetime] = {}
        self._batch_info = batch_info  # Use pre-fetched data if available
        self.correlation_id = correlation_id or generate_correlation_id()
    
    def cancel(self):
        """Cancel the batch execution."""
        self._cancelled = True
    
    async def execute(self) -> AsyncGenerator[BatchExecutionProgress, None]:
        """
        Execute all queries in the batch and yield progress updates.
        
        Yields:
            BatchExecutionProgress objects with current execution status
        """
        # Use pre-fetched batch info or load from DB
        batch_info = self._batch_info if self._batch_info else self._get_batch_info()
        if not batch_info:
            yield BatchExecutionProgress(
                batch_id=self.batch_id,
                status="failed",
                total_queries=0,
                completed_queries=0,
                success_count=0,
                failure_count=0,
                progress_percent=0.0
            )
            return
        
        # Load queries
        queries = self._get_pending_queries()
        total_queries = len(queries)
        
        if total_queries == 0:
            yield BatchExecutionProgress(
                batch_id=self.batch_id,
                status="completed",
                total_queries=0,
                completed_queries=0,
                success_count=0,
                failure_count=0,
                progress_percent=100.0
            )
            return
        
        # Update batch status to running
        self._update_batch_status("running")
        
        completed = 0
        success_count = 0
        failure_count = 0
        execution_times: List[float] = []
        last_progress_log = 0  # Track last logged progress for batching
        
        # Log batch start
        log_event(logger, "batch.execution_started",
            correlation_id=self.correlation_id,
            batch_id=self.batch_id,
            endpoint=self.agent_endpoint,
            total_queries=total_queries,
            max_concurrent=self.max_concurrent,
            timeout_per_query=self.timeout_per_query
        )
        yield BatchExecutionProgress(
            batch_id=self.batch_id,
            status="running",
            total_queries=total_queries,
            completed_queries=0,
            success_count=0,
            failure_count=0,
            current_query_id=queries[0]["id"] if queries else None,
            current_query_text=queries[0]["query_text"][:100] if queries else None,
            progress_percent=0.0
        )
        
        # Execute queries with concurrency control
        if self.max_concurrent > 1:
            # Concurrent execution using semaphore
            semaphore = asyncio.Semaphore(self.max_concurrent)
            results_queue: asyncio.Queue[QueryExecutionResult] = asyncio.Queue()
            
            async def execute_with_semaphore(query: Dict[str, Any]):
                """Execute a query with semaphore-controlled concurrency."""
                if self._cancelled:
                    return
                async with semaphore:
                    if self._cancelled:
                        return
                    result = await self._execute_query(query["id"], query["query_text"])
                    await results_queue.put(result)
            
            # Start all query tasks
            tasks = [asyncio.create_task(execute_with_semaphore(q)) for q in queries]
            
            # Collect results as they complete
            while completed < total_queries and not self._cancelled:
                try:
                    result = await asyncio.wait_for(results_queue.get(), timeout=1.0)
                    
                    # Update counts
                    completed += 1
                    if result.status == ExecutionStatus.SUCCESS:
                        success_count += 1
                    else:
                        failure_count += 1
                    
                    # Track execution time
                    if result.duration_ms:
                        execution_times.append(result.duration_ms / 1000)
                    
                    # Calculate estimated remaining time
                    estimated_remaining = None
                    if execution_times and completed < total_queries:
                        avg_time = sum(execution_times) / len(execution_times)
                        remaining_queries = total_queries - completed
                        # Adjust for concurrency
                        estimated_remaining = int((avg_time * remaining_queries) / self.max_concurrent)
                    
                    # Log progress every 10% or every 10 queries (whichever is smaller)
                    progress_interval = max(1, min(10, total_queries // 10))
                    if completed - last_progress_log >= progress_interval:
                        log_event(logger, "batch.execution_progress",
                            correlation_id=self.correlation_id,
                            batch_id=self.batch_id,
                            completed=completed,
                            total=total_queries,
                            success=success_count,
                            failed=failure_count
                        )
                        last_progress_log = completed
                    
                    yield BatchExecutionProgress(
                        batch_id=self.batch_id,
                        status="running",
                        total_queries=total_queries,
                        completed_queries=completed,
                        success_count=success_count,
                        failure_count=failure_count,
                        progress_percent=(completed / total_queries) * 100,
                        estimated_remaining_seconds=estimated_remaining
                    )
                except asyncio.TimeoutError:
                    # No result yet, continue waiting
                    continue
            
            # Cancel any remaining tasks if cancelled
            if self._cancelled:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
        else:
            # Sequential execution (original behavior)
            for query in queries:
                if self._cancelled:
                    break
                
                query_id = query["id"]
                query_text = query["query_text"]
                
                # Update current query
                yield BatchExecutionProgress(
                    batch_id=self.batch_id,
                    status="running",
                    total_queries=total_queries,
                    completed_queries=completed,
                    success_count=success_count,
                    failure_count=failure_count,
                    current_query_id=query_id,
                    current_query_text=query_text[:100] if query_text else None,
                    progress_percent=(completed / total_queries) * 100
                )
                
                # Execute the query
                result = await self._execute_query(query_id, query_text)
                
                # Update counts
                completed += 1
                if result.status == ExecutionStatus.SUCCESS:
                    success_count += 1
                else:
                    failure_count += 1
                
                # Track execution time for estimation
                if result.duration_ms:
                    execution_times.append(result.duration_ms / 1000)
                
                # Calculate estimated remaining time
                estimated_remaining = None
                if execution_times and completed < total_queries:
                    avg_time = sum(execution_times) / len(execution_times)
                    remaining_queries = total_queries - completed
                    estimated_remaining = int(avg_time * remaining_queries)
                
                # Log progress every 10% or every 10 queries (whichever is smaller)
                progress_interval = max(1, min(10, total_queries // 10))
                if completed - last_progress_log >= progress_interval:
                    log_event(logger, "batch.execution_progress",
                        correlation_id=self.correlation_id,
                        batch_id=self.batch_id,
                        completed=completed,
                        total=total_queries,
                        success=success_count,
                        failed=failure_count
                    )
                    last_progress_log = completed
                
                # Yield progress
                yield BatchExecutionProgress(
                    batch_id=self.batch_id,
                    status="running",
                    total_queries=total_queries,
                    completed_queries=completed,
                    success_count=success_count,
                    failure_count=failure_count,
                    progress_percent=(completed / total_queries) * 100,
                    estimated_remaining_seconds=estimated_remaining
                )
        
        # Final status
        final_status = "cancelled" if self._cancelled else "completed"
        self._update_batch_status(final_status, success_count, failure_count)
        
        # Calculate total duration
        total_duration_ms = int(sum(execution_times) * 1000) if execution_times else 0
        
        # Log batch completion
        log_event(logger, "batch.execution_complete",
            correlation_id=self.correlation_id,
            batch_id=self.batch_id,
            status=final_status,
            total_queries=total_queries,
            success_count=success_count,
            failure_count=failure_count,
            duration_ms=total_duration_ms
        )
        
        # =================================================================
        # AUTO-SYNC: Trigger delayed background sync for this batch's sessions
        # =================================================================
        # This ensures sessions are immediately available in local DB
        # for fast filtering. We add a delay to give OTEL traces time to
        # be flushed to Weave (especially important with concurrent execution).
        if final_status == "completed" and success_count > 0:
            async def delayed_sync():
                """Sync with retry to handle OTEL trace propagation delays."""
                try:
                    # Wait for OTEL traces to propagate to Weave
                    # With concurrent execution, some traces may take longer to flush
                    await asyncio.sleep(3)  # Initial delay
                    
                    from services.session_sync import session_sync_service
                    from database import get_db
                    
                    # Get expected session count from batch
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute(
                            "SELECT COUNT(*) as cnt FROM synthetic_queries WHERE batch_id = ? AND thread_id IS NOT NULL",
                            (self.batch_id,)
                        )
                        expected_count = cursor.fetchone()["cnt"]
                    
                    # Try syncing up to 3 times with increasing delays
                    for attempt in range(3):
                        result = await session_sync_service.sync_batch_sessions(self.batch_id)
                        synced_count = result.sessions_added + result.sessions_updated
                        
                        log_event(logger, "batch.session_sync_attempt",
                            correlation_id=self.correlation_id,
                            batch_id=self.batch_id,
                            attempt=attempt + 1,
                            expected=expected_count,
                            synced=synced_count
                        )
                        
                        if synced_count >= expected_count:
                            break  # All sessions synced
                        
                        if attempt < 2:
                            await asyncio.sleep(2 * (attempt + 1))  # Progressive delay: 2s, 4s
                    
                except Exception as e:
                    logger.warning(f"Failed session sync for batch {self.batch_id}: {e}")
            
            # Start sync in background without blocking
            asyncio.create_task(delayed_sync())
        
        yield BatchExecutionProgress(
            batch_id=self.batch_id,
            status=final_status,
            total_queries=total_queries,
            completed_queries=completed,
            success_count=success_count,
            failure_count=failure_count,
            progress_percent=100.0
        )
    
    async def _execute_query(self, query_id: str, query_text: str) -> QueryExecutionResult:
        """Execute a single query and update the database."""
        started_at = now_iso()
        start_time = datetime.utcnow()
        
        # Mark as running
        self._update_query_status(query_id, ExecutionStatus.RUNNING, started_at=started_at)
        
        try:
            # Run the query through the agent using simple HTTP
            result = await self.client.query(query_text)
            
            completed_at = now_iso()
            duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
            
            if result.error:
                # Query failed
                self._update_query_status(
                    query_id,
                    ExecutionStatus.ERROR,
                    completed_at=completed_at,
                    error_message=result.error
                )
                return QueryExecutionResult(
                    query_id=query_id,
                    status=ExecutionStatus.ERROR,
                    error_message=result.error,
                    started_at=started_at,
                    completed_at=completed_at,
                    duration_ms=duration_ms
                )
            else:
                # Query succeeded
                self._update_query_status(
                    query_id,
                    ExecutionStatus.SUCCESS,
                    completed_at=completed_at,
                    response_text=result.response,
                    trace_id=None,  # Simple HTTP doesn't return trace_id
                    thread_id=result.thread_id
                )
                return QueryExecutionResult(
                    query_id=query_id,
                    status=ExecutionStatus.SUCCESS,
                    response_text=result.response,
                    tool_calls=[],  # Simple HTTP doesn't return tool calls
                    trace_id=None,
                    thread_id=result.thread_id,
                    started_at=started_at,
                    completed_at=completed_at,
                    duration_ms=duration_ms
                )
                
        except asyncio.TimeoutError:
            completed_at = now_iso()
            duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
            error_msg = f"Query timed out after {self.timeout_per_query}s"
            
            self._update_query_status(
                query_id,
                ExecutionStatus.ERROR,
                completed_at=completed_at,
                error_message=error_msg
            )
            return QueryExecutionResult(
                query_id=query_id,
                status=ExecutionStatus.ERROR,
                error_message=error_msg,
                started_at=started_at,
                completed_at=completed_at,
                duration_ms=duration_ms
            )
            
        except Exception as e:
            completed_at = now_iso()
            duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
            error_msg = str(e)
            
            self._update_query_status(
                query_id,
                ExecutionStatus.ERROR,
                completed_at=completed_at,
                error_message=error_msg
            )
            return QueryExecutionResult(
                query_id=query_id,
                status=ExecutionStatus.ERROR,
                error_message=error_msg,
                started_at=started_at,
                completed_at=completed_at,
                duration_ms=duration_ms
            )
    
    def _get_batch_info(self) -> Optional[Dict[str, Any]]:
        """Get batch information from the database."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT sb.*, a.endpoint_url
                FROM synthetic_batches sb
                JOIN agents a ON sb.agent_id = a.id
                WHERE sb.id = ?
            """, (self.batch_id,))
            row = cursor.fetchone()
            if row:
                return dict(row)
            return None
    
    def _get_pending_queries(self) -> List[Dict[str, Any]]:
        """Get all pending or not-yet-run queries from the batch."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, query_text, dimension_tuple, execution_status
                FROM synthetic_queries
                WHERE batch_id = ? AND execution_status IN ('pending', 'error')
                ORDER BY id
            """, (self.batch_id,))
            return [dict(row) for row in cursor.fetchall()]
    
    def _update_query_status(
        self,
        query_id: str,
        status: ExecutionStatus,
        started_at: Optional[str] = None,
        completed_at: Optional[str] = None,
        response_text: Optional[str] = None,
        trace_id: Optional[str] = None,
        thread_id: Optional[str] = None,
        error_message: Optional[str] = None
    ):
        """Update a query's execution status in the database."""
        with get_db() as conn:
            cursor = conn.cursor()
            
            updates = ["execution_status = ?"]
            params = [status.value]
            
            if started_at:
                updates.append("started_at = ?")
                params.append(started_at)
            
            if completed_at:
                updates.append("completed_at = ?")
                params.append(completed_at)
            
            if response_text is not None:
                updates.append("response_text = ?")
                params.append(response_text)
            
            if trace_id is not None:
                updates.append("trace_id = ?")
                params.append(trace_id)
            
            if thread_id is not None:
                updates.append("thread_id = ?")
                params.append(thread_id)
            
            if error_message is not None:
                updates.append("error_message = ?")
                params.append(error_message)
            
            params.append(query_id)
            
            cursor.execute(f"""
                UPDATE synthetic_queries
                SET {', '.join(updates)}
                WHERE id = ?
            """, params)
    
    def _update_batch_status(
        self,
        status: str,
        success_count: Optional[int] = None,
        failure_count: Optional[int] = None
    ):
        """Update the batch's execution status in the database."""
        with get_db() as conn:
            cursor = conn.cursor()
            
            updates = ["status = ?"]
            params = [status]
            
            if status == "running":
                updates.append("started_at = ?")
                params.append(now_iso())
            elif status in ("completed", "failed", "cancelled"):
                updates.append("completed_at = ?")
                params.append(now_iso())
            
            if success_count is not None:
                updates.append("success_count = ?")
                params.append(success_count)
            
            if failure_count is not None:
                updates.append("failure_count = ?")
                params.append(failure_count)
            
            params.append(self.batch_id)
            
            cursor.execute(f"""
                UPDATE synthetic_batches
                SET {', '.join(updates)}
                WHERE id = ?
            """, params)


async def execute_batch(
    agent_endpoint: str,
    batch_id: str,
    timeout_per_query: Optional[float] = None,  # None = use config default
    max_concurrent: int = 5,
    batch_info: Optional[Dict[str, Any]] = None
) -> AsyncGenerator[BatchExecutionProgress, None]:
    """
    Convenience function to execute a batch.
    
    Args:
        agent_endpoint: AG-UI endpoint URL of the agent
        batch_id: ID of the batch to execute
        timeout_per_query: Timeout in seconds for each query. If None, uses configured agent_query_timeout.
        max_concurrent: Maximum concurrent query executions (default 5)
        batch_info: Pre-fetched batch data to avoid redundant DB query
        
    Yields:
        BatchExecutionProgress updates
    """
    executor = BatchExecutor(
        agent_endpoint=agent_endpoint,
        batch_id=batch_id,
        max_concurrent=max_concurrent,
        timeout_per_query=timeout_per_query,
        batch_info=batch_info
    )
    async for progress in executor.execute():
        yield progress


def get_batch_execution_status(batch_id: str) -> Dict[str, Any]:
    """
    Get the current execution status of a batch.
    
    Returns:
        Dict with batch status, progress, and query details
    """
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Get batch info
        cursor.execute("""
            SELECT * FROM synthetic_batches WHERE id = ?
        """, (batch_id,))
        batch_row = cursor.fetchone()
        
        if not batch_row:
            raise ValueError("Batch not found")
        
        batch = dict(batch_row)
        
        # Get query stats
        cursor.execute("""
            SELECT 
                execution_status,
                COUNT(*) as count
            FROM synthetic_queries
            WHERE batch_id = ?
            GROUP BY execution_status
        """, (batch_id,))
        
        status_counts = {row["execution_status"]: row["count"] for row in cursor.fetchall()}
        
        # Get individual query results
        cursor.execute("""
            SELECT id, query_text, execution_status, response_text, 
                   trace_id, error_message, started_at, completed_at
            FROM synthetic_queries
            WHERE batch_id = ?
            ORDER BY id
        """, (batch_id,))
        
        queries = [dict(row) for row in cursor.fetchall()]
        
        # Calculate progress
        total = sum(status_counts.values())
        completed = status_counts.get("success", 0) + status_counts.get("error", 0)
        
        return {
            "batch_id": batch_id,
            "status": batch["status"],
            "total_queries": total,
            "completed_queries": completed,
            "pending": status_counts.get("pending", 0),
            "running": status_counts.get("running", 0),
            "success": status_counts.get("success", 0),
            "error": status_counts.get("error", 0),
            "progress_percent": (completed / total * 100) if total > 0 else 0,
            "started_at": batch.get("started_at"),
            "completed_at": batch.get("completed_at"),
            "queries": queries
        }


def get_batch_traces(batch_id: str) -> List[Dict[str, Any]]:
    """
    Get all traces linked to a batch.
    
    Returns:
        List of query results with their trace IDs
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, query_text, dimension_tuple, trace_id, 
                   response_text, execution_status, completed_at
            FROM synthetic_queries
            WHERE batch_id = ? AND trace_id IS NOT NULL
            ORDER BY completed_at
        """, (batch_id,))
        
        return [dict(row) for row in cursor.fetchall()]


def reset_batch_queries(batch_id: str, only_failed: bool = False):
    """
    Reset query execution status to allow re-running.
    
    Args:
        batch_id: Batch to reset
        only_failed: If True, only reset failed queries
    """
    with get_db() as conn:
        cursor = conn.cursor()
        
        if only_failed:
            cursor.execute("""
                UPDATE synthetic_queries
                SET execution_status = 'pending',
                    response_text = NULL,
                    trace_id = NULL,
                    thread_id = NULL,
                    error_message = NULL,
                    started_at = NULL,
                    completed_at = NULL
                WHERE batch_id = ? AND execution_status = 'error'
            """, (batch_id,))
        else:
            cursor.execute("""
                UPDATE synthetic_queries
                SET execution_status = 'pending',
                    response_text = NULL,
                    trace_id = NULL,
                    thread_id = NULL,
                    error_message = NULL,
                    started_at = NULL,
                    completed_at = NULL
                WHERE batch_id = ?
            """, (batch_id,))
        
        # Reset batch status
        cursor.execute("""
            UPDATE synthetic_batches
            SET status = 'pending',
                success_count = 0,
                failure_count = 0,
                started_at = NULL,
                completed_at = NULL
            WHERE id = ?
        """, (batch_id,))

