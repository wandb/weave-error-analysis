"""
Sessions API Router - Fast, local-first session management.

This router provides session endpoints that read from LOCAL SQLite database,
not directly from Weave API. This enables:
- Instant session list loading (< 100ms)
- Rich filtering without Weave API latency
- Offline capability for cached sessions
- Background sync keeps data fresh

Architecture:
- Router handles HTTP concerns (request parsing, response formatting)
- SessionRepository handles all database queries
- SessionSyncService handles background sync from Weave

Key endpoints:
- GET /api/sessions - List sessions with rich filtering (LOCAL DB)
- GET /api/sessions/{id} - Get session detail (local + Weave conversation)
- GET /api/sessions/sync-status - Current sync status
- POST /api/sessions/sync - Trigger background sync

See: sessions_improvements.md for full design.
"""

from typing import Optional, List

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.session_repository import (
    session_repository,
    SessionFilters,
    SortField,
    SortDirection,
)
from services.taxonomy import taxonomy_service
from services.session_sync import (
    session_sync_service,
    trigger_session_sync,
)
from services.weave_client import weave_client
from services.conversation import process_thread_calls
from models import (
    SessionSummary,
    SessionListResponse,
    SessionDetail,
    SessionNote,
    SyncStatusResponse,
    SyncTriggerResponse,
    BatchReviewProgress,
    CreateNoteRequest,
    MarkSessionReviewedRequest,
    ConversationMessage,
)
from logger import get_logger

logger = get_logger("sessions_api")

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


# =============================================================================
# Session Auto-Review Request/Response Models (Sprint 3)
# =============================================================================

class SessionAutoReviewRequest(BaseModel):
    """Request to run auto-review on sessions."""
    session_ids: List[str]  # Sessions to analyze
    model: Optional[str] = None  # Uses settings default if not provided
    max_concurrent_llm_calls: Optional[int] = None
    n_samples: Optional[int] = None  # Max traces to analyze (None = all)
    debug: bool = False
    filter_failures_only: bool = False


class SessionAutoReviewResponse(BaseModel):
    """Response containing session review results."""
    id: str
    batch_id: str  # Will be "sessions:N" for session reviews
    agent_id: str
    status: str
    model_used: str
    failure_categories: List[dict]
    classifications: List[dict]
    report_markdown: Optional[str] = None
    total_traces: int
    created_at: str
    completed_at: Optional[str] = None
    error_message: Optional[str] = None


# =============================================================================
# Session List Endpoint (LOCAL DB - Fast)
# =============================================================================

@router.get("", response_model=SessionListResponse)
async def list_sessions(
    # Pagination
    limit: int = Query(50, ge=1, le=200, description="Number of sessions to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    
    # Sorting
    sort_by: str = Query("started_at", description="Sort field: started_at, turn_count, total_tokens, estimated_cost_usd, total_latency_ms"),
    direction: str = Query("desc", description="Sort direction: asc or desc"),
    
    # Batch Filter
    batch_id: Optional[str] = Query(None, description="Filter by batch ID"),
    exclude_batches: bool = Query(False, description="Only show organic (non-batch) sessions"),
    
    # Turn Count
    min_turns: Optional[int] = Query(None, ge=1, description="Minimum turn count"),
    max_turns: Optional[int] = Query(None, ge=1, description="Maximum turn count"),
    
    # Review Status
    is_reviewed: Optional[bool] = Query(None, description="Filter by review status"),
    
    # Error Status
    has_error: Optional[bool] = Query(None, description="Filter by error status"),
    
    # Token/Cost
    min_tokens: Optional[int] = Query(None, ge=0, description="Minimum total tokens"),
    max_tokens: Optional[int] = Query(None, ge=0, description="Maximum total tokens"),
    min_cost: Optional[float] = Query(None, ge=0, description="Minimum cost in USD"),
    max_cost: Optional[float] = Query(None, ge=0, description="Maximum cost in USD"),
    
    # Latency
    min_latency: Optional[float] = Query(None, ge=0, description="Minimum latency in ms"),
    max_latency: Optional[float] = Query(None, ge=0, description="Maximum latency in ms"),
    
    # Date Range
    started_after: Optional[str] = Query(None, description="Sessions started after (ISO timestamp)"),
    started_before: Optional[str] = Query(None, description="Sessions started before (ISO timestamp)"),
    
    # Model Filter
    primary_model: Optional[str] = Query(None, description="Filter by primary model"),
    
    # Sampling
    random_sample: Optional[int] = Query(None, ge=1, le=100, description="Return random N sessions"),
    
    # Note Search
    note_search: Optional[str] = Query(None, description="Search sessions by note content"),
):
    """
    List sessions from LOCAL database with rich filtering.
    
    This endpoint reads from the local SQLite cache, NOT from Weave API.
    Response is instant (< 100ms) regardless of network conditions.
    
    Use POST /api/sessions/sync to refresh data from Weave.
    """
    try:
        # Build filters
        filters = SessionFilters(
            batch_id=batch_id,
            exclude_batches=exclude_batches,
            min_turns=min_turns,
            max_turns=max_turns,
            is_reviewed=is_reviewed,
            has_error=has_error,
            min_tokens=min_tokens,
            max_tokens=max_tokens,
            min_cost=min_cost,
            max_cost=max_cost,
            min_latency_ms=min_latency,
            max_latency_ms=max_latency,
            started_after=started_after,
            started_before=started_before,
            primary_model=primary_model,
        )
        
        # Parse sort options
        try:
            sort_field = SortField(sort_by)
        except ValueError:
            sort_field = SortField.STARTED_AT
        
        sort_dir = SortDirection.DESC if direction.lower() == "desc" else SortDirection.ASC
        
        # Handle note search specially (requires different query)
        if note_search:
            sessions_data = session_repository.search_by_notes(
                search_term=note_search,
                filters=filters,
                limit=limit
            )
            total_count = len(sessions_data)
            sessions = [_session_to_summary(s) for s in sessions_data]
            return SessionListResponse(
                sessions=sessions,
                total_count=total_count,
                page=1,
                page_size=limit,
                has_more=False
            )
        
        # Handle random sampling
        if random_sample:
            sessions_data = session_repository.random_sample(
                count=random_sample,
                filters=filters,
                sort_by=sort_field,
                sort_direction=sort_dir
            )
            sessions = [_session_to_summary(s) for s in sessions_data]
            return SessionListResponse(
                sessions=sessions,
                total_count=len(sessions),
                page=1,
                page_size=random_sample,
                has_more=False
            )
        
        # Normal list with pagination
        result = session_repository.list_sessions(
            filters=filters,
            sort_by=sort_field,
            sort_direction=sort_dir,
            limit=limit,
            offset=offset
        )
        
        sessions = [_session_to_summary(s) for s in result.sessions]
        
        return SessionListResponse(
            sessions=sessions,
            total_count=result.total_count,
            page=result.page,
            page_size=result.page_size,
            has_more=result.has_more
        )
        
    except Exception as e:
        logger.error(f"Error listing sessions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


def _session_to_summary(row: dict) -> SessionSummary:
    """Convert a session dict to SessionSummary model."""
    return SessionSummary(
        id=row["id"],
        weave_session_id=row.get("weave_session_id"),
        weave_url=row.get("weave_url"),
        batch_id=row.get("batch_id"),
        batch_name=row.get("batch_name"),
        turn_count=row.get("turn_count") or 0,
        call_count=row.get("call_count") or 0,
        total_latency_ms=row.get("total_latency_ms") or 0.0,
        total_tokens=row.get("total_tokens") or 0,
        estimated_cost_usd=row.get("estimated_cost_usd") or 0.0,
        primary_model=row.get("primary_model"),
        has_error=bool(row.get("has_error")),
        is_reviewed=bool(row.get("is_reviewed")),
        started_at=row.get("started_at"),
        ended_at=row.get("ended_at"),
    )


# =============================================================================
# Session Detail Endpoint (Local metadata + Weave conversation)
# =============================================================================

@router.get("/{session_id}", response_model=SessionDetail)
async def get_session_detail(session_id: str):
    """
    Get detailed information about a session.
    
    Returns:
    - Session metadata from LOCAL DB (fast)
    - Conversation from Weave API (may have latency)
    - Local notes attached to session
    """
    try:
        # Get session from repository
        session = session_repository.get_session_by_id(session_id)
        if not session:
            raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
        
        # Get notes
        notes_data = session_repository.list_notes(session_id)
        notes = [
            SessionNote(
                id=n["id"],
                session_id=n["session_id"],
                call_id=n.get("call_id"),
                content=n["content"],
                note_type=n.get("note_type", "observation"),
                weave_feedback_id=n.get("weave_feedback_id"),
                synced_to_weave=bool(n.get("synced_to_weave")),
                created_at=n["created_at"],
                updated_at=n["updated_at"],
                created_by=n.get("created_by"),
            )
            for n in notes_data
        ]
        
        # Fetch conversation from Weave (this may have latency)
        conversation = await _fetch_conversation(session_id)
        
        return SessionDetail(
            id=session["id"],
            weave_session_id=session.get("weave_session_id"),
            weave_url=session.get("weave_url"),
            batch_id=session.get("batch_id"),
            batch_name=session.get("batch_name"),
            query_text=session.get("query_text"),
            turn_count=session.get("turn_count") or 0,
            call_count=session.get("call_count") or 0,
            total_latency_ms=session.get("total_latency_ms") or 0.0,
            total_input_tokens=session.get("total_input_tokens") or 0,
            total_output_tokens=session.get("total_output_tokens") or 0,
            total_tokens=session.get("total_tokens") or 0,
            estimated_cost_usd=session.get("estimated_cost_usd") or 0.0,
            primary_model=session.get("primary_model"),
            has_error=bool(session.get("has_error")),
            error_summary=session.get("error_summary"),
            is_reviewed=bool(session.get("is_reviewed")),
            reviewed_at=session.get("reviewed_at"),
            started_at=session.get("started_at"),
            ended_at=session.get("ended_at"),
            conversation=conversation,
            notes=notes,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting session detail: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


async def _fetch_conversation(session_id: str) -> List[ConversationMessage]:
    """
    Fetch conversation from Weave API for a session.
    
    Uses the same logic as threads.py to find and process calls.
    """
    try:
        # Fetch all calls
        all_calls = await weave_client.query_calls(
            limit=500,
            sort_field="started_at",
            sort_direction="asc"
        )
        
        # Build root-to-thread map
        root_to_thread = {}
        for call in all_calls:
            call_thread_id = call.get("thread_id")
            trace_id = call.get("trace_id")
            if call_thread_id and trace_id:
                if trace_id not in root_to_thread:
                    root_to_thread[trace_id] = call_thread_id
        
        # Filter calls that belong to this session
        session_calls = []
        for call in all_calls:
            trace_id = call.get("trace_id")
            call_session_id = (
                call.get("thread_id") or
                root_to_thread.get(trace_id) or
                call.get("summary", {}).get("session_id") or
                trace_id
            )
            if call_session_id == session_id:
                session_calls.append(call)
        
        # Sort by started_at
        session_calls.sort(key=lambda c: c.get("started_at", ""))
        
        # Process into conversation format
        raw_conversation = process_thread_calls(session_calls)
        
        # Convert to ConversationMessage models
        conversation = []
        for msg in raw_conversation:
            conversation.append(ConversationMessage(
                type=msg.get("type", "unknown"),
                content=msg.get("content"),
                call_id=msg.get("call_id"),
                timestamp=msg.get("timestamp"),
                tool_name=msg.get("tool_name"),
                tool_input=msg.get("tool_input"),
                tool_output=msg.get("tool_output"),
                tool_result=msg.get("tool_result"),
            ))
        
        return conversation
        
    except Exception as e:
        logger.error(f"Error fetching conversation for {session_id}: {e}")
        # Return empty conversation on error - don't fail the whole request
        return []


# =============================================================================
# Session Stats Endpoint (NEW)
# =============================================================================

@router.get("/stats/summary")
async def get_session_stats(
    batch_id: Optional[str] = Query(None, description="Filter by batch ID"),
    is_reviewed: Optional[bool] = Query(None, description="Filter by review status"),
):
    """
    Get aggregate statistics for sessions matching filters.
    
    Useful for dashboards and progress tracking.
    """
    try:
        filters = SessionFilters(batch_id=batch_id, is_reviewed=is_reviewed)
        stats = session_repository.get_session_stats(filters)
        
        return {
            "total_sessions": stats.total_sessions,
            "reviewed_sessions": stats.reviewed_sessions,
            "unreviewed_sessions": stats.unreviewed_sessions,
            "error_sessions": stats.error_sessions,
            "total_tokens": stats.total_tokens,
            "total_cost_usd": stats.total_cost_usd,
            "avg_turns": stats.avg_turns,
            "avg_latency_ms": stats.avg_latency_ms,
        }
    except Exception as e:
        logger.error(f"Error getting session stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Filter Options Endpoints (NEW)
# =============================================================================

@router.get("/options/models")
async def get_model_options():
    """Get list of distinct models for filter dropdown."""
    try:
        models = session_repository.get_distinct_models()
        return {"models": models}
    except Exception as e:
        logger.error(f"Error getting model options: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/options/batches")
async def get_batch_options():
    """Get list of batches for filter dropdown."""
    try:
        batches = session_repository.get_batch_options()
        return {"batches": batches}
    except Exception as e:
        logger.error(f"Error getting batch options: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/options/filter-ranges")
async def get_filter_ranges():
    """
    Get min/max ranges for all filterable numeric metrics.
    
    Returns the actual data bounds for:
    - Turn count (min/max)
    - Total tokens (min/max)
    - Estimated cost USD (min/max)
    - Total latency ms (min/max)
    
    Used to populate range slider bounds in the filter UI.
    """
    try:
        ranges = session_repository.get_filter_ranges()
        return {
            "turns": {"min": ranges.min_turns, "max": ranges.max_turns},
            "tokens": {"min": ranges.min_tokens, "max": ranges.max_tokens},
            "cost": {"min": ranges.min_cost, "max": ranges.max_cost},
            "latency": {"min": ranges.min_latency, "max": ranges.max_latency},
            "total_sessions": ranges.total_sessions,
        }
    except Exception as e:
        logger.error(f"Error getting filter ranges: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Sync Status & Trigger Endpoints
# =============================================================================

@router.get("/sync-status", response_model=SyncStatusResponse)
async def get_sync_status():
    """
    Get current sync status for UI display.
    
    Returns:
    - Current status (idle, syncing, error)
    - Last sync time
    - Counts from last sync
    - Any error message
    
    Call this on page load and periodically to update sync indicator.
    """
    try:
        status = session_sync_service.get_sync_status()
        return SyncStatusResponse(
            status=status.status.value,
            last_sync_completed_at=status.last_sync_completed_at,
            last_sync_type=status.last_sync_type,
            sessions_added=status.sessions_added,
            sessions_updated=status.sessions_updated,
            is_syncing=status.is_syncing,
            current_sync_progress=status.current_sync_progress,
            error_message=status.error_message,
        )
    except Exception as e:
        logger.error(f"Error getting sync status: {e}")
        return SyncStatusResponse(
            status="error",
            error_message=str(e)
        )


@router.post("/sync", response_model=SyncTriggerResponse)
async def trigger_sync(
    full_sync: bool = Query(False, description="If true, sync all sessions. Default: incremental"),
    batch_id: Optional[str] = Query(None, description="If provided, only sync this batch's sessions"),
):
    """
    Trigger a background sync from Weave.
    
    This returns IMMEDIATELY - the sync runs in the background.
    Poll /sync-status to track progress.
    
    Sync types:
    - Incremental (default): Only new sessions since last sync
    - Full: All sessions from Weave
    - Batch: Only sessions linked to a specific batch
    """
    try:
        started = trigger_session_sync(full_sync=full_sync, batch_id=batch_id)
        
        if started:
            sync_type = "batch" if batch_id else ("full" if full_sync else "incremental")
            return SyncTriggerResponse(
                status="started",
                message=f"{sync_type.capitalize()} sync started in background"
            )
        else:
            return SyncTriggerResponse(
                status="already_syncing",
                message="A sync is already in progress"
            )
    except Exception as e:
        logger.error(f"Error triggering sync: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Session Review Endpoints
# =============================================================================

@router.post("/{session_id}/mark-reviewed")
async def mark_session_reviewed(
    session_id: str,
    request: MarkSessionReviewedRequest = None
):
    """Mark a session as reviewed."""
    try:
        notes = request.notes if request else None
        success = session_repository.mark_reviewed(session_id, notes)
        
        if not success:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Record a saturation snapshot for the discovery curve
        try:
            taxonomy_service._record_saturation_snapshot()
        except Exception:
            pass  # Don't fail the review if snapshot fails
        
        return {
            "status": "success",
            "session_id": session_id,
            "is_reviewed": True
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{session_id}/mark-reviewed")
async def unmark_session_reviewed(session_id: str):
    """Remove a session from the reviewed list."""
    try:
        session_repository.unmark_reviewed(session_id)
        return {
            "status": "success",
            "session_id": session_id,
            "is_reviewed": False
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{session_id}/next-unreviewed")
async def get_next_unreviewed_session(
    session_id: str,
    batch_id: Optional[str] = Query(None, description="Stay within batch"),
):
    """
    Get the next unreviewed session after the current one.
    
    Useful for "Next" button in review workflow.
    """
    try:
        filters = SessionFilters(batch_id=batch_id)
        next_session = session_repository.get_next_unreviewed(filters)
        
        if not next_session:
            return {"next_session": None, "message": "No more unreviewed sessions"}
        
        return {
            "next_session": _session_to_summary(next_session),
            "message": "Found next unreviewed session"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Session Notes Endpoints
# =============================================================================

@router.get("/{session_id}/notes", response_model=List[SessionNote])
async def list_session_notes(session_id: str):
    """Get all notes for a session."""
    try:
        notes_data = session_repository.list_notes(session_id)
        return [
            SessionNote(
                id=n["id"],
                session_id=n["session_id"],
                call_id=n.get("call_id"),
                content=n["content"],
                note_type=n.get("note_type", "observation"),
                weave_feedback_id=n.get("weave_feedback_id"),
                synced_to_weave=bool(n.get("synced_to_weave")),
                created_at=n["created_at"],
                updated_at=n["updated_at"],
                created_by=n.get("created_by"),
            )
            for n in notes_data
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{session_id}/notes", response_model=SessionNote)
async def create_session_note(session_id: str, request: CreateNoteRequest):
    """
    Create a note for a session.
    
    The note is stored locally immediately for fast response.
    Syncing to Weave happens asynchronously in the background.
    """
    try:
        note = session_repository.create_note(
            session_id=session_id,
            content=request.content,
            note_type=request.note_type,
            call_id=request.call_id
        )
        
        if not note:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # TODO: Trigger async Weave sync in background
        # asyncio.create_task(sync_note_to_weave(note["id"]))
        
        return SessionNote(
            id=note["id"],
            session_id=note["session_id"],
            call_id=note.get("call_id"),
            content=note["content"],
            note_type=note.get("note_type", "observation"),
            weave_feedback_id=note.get("weave_feedback_id"),
            synced_to_weave=bool(note.get("synced_to_weave")),
            created_at=note["created_at"],
            updated_at=note["updated_at"],
            created_by=note.get("created_by"),
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{session_id}/notes/{note_id}")
async def delete_session_note(session_id: str, note_id: str):
    """Delete a session note."""
    try:
        success = session_repository.delete_note(session_id, note_id)
        
        if not success:
            raise HTTPException(status_code=404, detail="Note not found")
        
        return {"status": "success", "note_id": note_id}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Batch Review Progress Endpoint
# =============================================================================

@router.get("/batches/{batch_id}/review-progress", response_model=BatchReviewProgress)
async def get_batch_review_progress(batch_id: str):
    """
    Get review progress for a specific batch.
    
    Returns batch-scoped metrics instead of global review progress.
    """
    try:
        progress = session_repository.get_batch_review_progress(batch_id)
        
        if not progress:
            raise HTTPException(status_code=404, detail="Batch not found")
        
        return BatchReviewProgress(
            batch_id=progress["batch_id"],
            batch_name=progress["batch_name"],
            total_sessions=progress["total_sessions"],
            reviewed_sessions=progress["reviewed_sessions"],
            unreviewed_sessions=progress["unreviewed_sessions"],
            progress_percent=progress["progress_percent"],
            recent_reviews_24h=progress["recent_reviews_24h"],
            last_review_at=progress.get("last_review_at"),
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Session Auto-Review Endpoint (Sprint 3)
# =============================================================================

@router.post("/auto-review", response_model=SessionAutoReviewResponse)
async def run_session_auto_review_endpoint(request: SessionAutoReviewRequest):
    """
    Run automated AI review on session traces.
    
    This endpoint uses the FAILS pipeline to analyze session data and 
    discover failure patterns. Unlike batch auto-review which analyzes
    synthetic query traces, this analyzes real session conversations.
    
    Args:
        request: SessionAutoReviewRequest with session_ids and options
        
    Returns:
        SessionAutoReviewResponse with discovered failure categories
    """
    from services.settings import get_setting
    from services.auto_reviewer import run_session_auto_review, FAILS_AVAILABLE
    
    if not FAILS_AVAILABLE:
        raise HTTPException(
            status_code=503, 
            detail="FAILS library not available. Install with: pip install git+https://github.com/wandb/fails.git"
        )
    
    if not request.session_ids:
        raise HTTPException(status_code=400, detail="No session IDs provided")
    
    # Get model and concurrency from settings if not provided
    default_model = "openai/gpt-4.1-mini" if request.debug else get_setting("auto_review_model", "openai/gpt-4.1")
    model = request.model or default_model
    concurrency_str = get_setting("auto_review_concurrency", "10")
    max_concurrent = request.max_concurrent_llm_calls or int(concurrency_str)
    
    # Get agent_id from first session (sessions should belong to one agent)
    agent_id = None
    with session_repository.get_db() as conn:
        cursor = conn.cursor()
        # Get agent from batch if session is linked to a batch
        cursor.execute("""
            SELECT sb.agent_id 
            FROM sessions s
            JOIN synthetic_batches sb ON s.batch_id = sb.id
            WHERE s.id = ?
            LIMIT 1
        """, (request.session_ids[0],))
        row = cursor.fetchone()
        if row:
            agent_id = row["agent_id"]
        else:
            # Default to first agent if no batch link
            cursor.execute("SELECT id FROM agents LIMIT 1")
            row = cursor.fetchone()
            if row:
                agent_id = row["id"]
    
    if not agent_id:
        raise HTTPException(status_code=400, detail="Could not determine agent for sessions")
    
    try:
        result = await run_session_auto_review(
            agent_id=agent_id,
            session_ids=request.session_ids,
            model=model,
            max_concurrent_llm_calls=max_concurrent,
            n_samples=request.n_samples,
            debug=request.debug,
            filter_failures_only=request.filter_failures_only
        )
        
        return SessionAutoReviewResponse(
            id=result.id,
            batch_id=result.batch_id,
            agent_id=result.agent_id,
            status=result.status.value,
            model_used=result.model_used,
            failure_categories=[fc.model_dump() for fc in result.failure_categories],
            classifications=[c.model_dump() for c in result.classifications],
            report_markdown=result.report_markdown,
            total_traces=result.total_traces,
            created_at=result.created_at,
            completed_at=result.completed_at,
            error_message=result.error_message
        )
        
    except Exception as e:
        logger.error(f"Session auto-review failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Auto-review failed: {str(e)}")
