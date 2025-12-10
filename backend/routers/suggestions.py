"""
AI Suggestions API Router.

Provides endpoints for:
- Analyzing batches/sessions with AI to generate suggestions
- Retrieving suggestions for review
- Accepting/skipping/rejecting suggestions
- Bulk operations on suggestions

See: fails.md for full design.
"""

from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.suggestion import suggestion_service, Suggestion
from database import get_db_readonly

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])


# =============================================================================
# Request/Response Models
# =============================================================================

class AnalyzeBatchRequest(BaseModel):
    """Request to analyze a batch."""
    max_concurrent: int = 10
    model: Optional[str] = None  # Uses default if not provided


class AnalyzeSessionRequest(BaseModel):
    """Request to analyze a session."""
    model: Optional[str] = None


class SuggestionResponse(BaseModel):
    """Response for a single suggestion."""
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
    
    status: str
    created_at: str


class AnalysisResponse(BaseModel):
    """Response for batch/session analysis."""
    batch_id: Optional[str]
    session_id: Optional[str]
    total_traces: int
    issues_found: int
    suggestions: List[SuggestionResponse]


class AcceptSuggestionRequest(BaseModel):
    """Request to accept a suggestion."""
    edited_text: Optional[str] = None
    failure_mode_id: Optional[str] = None


class BulkAcceptRequest(BaseModel):
    """Request to accept multiple suggestions."""
    suggestion_ids: List[str]


class NoteResponse(BaseModel):
    """Response for a created note."""
    note_id: str
    content: str
    failure_mode_id: Optional[str]
    session_id: Optional[str]
    created_at: str


class BulkAcceptResponse(BaseModel):
    """Response for bulk accept operation."""
    accepted: int
    failed: int
    notes_created: List[NoteResponse]


class SuggestionStatsResponse(BaseModel):
    """Statistics about suggestions."""
    total: int
    issues_found: int
    pending: int
    accepted: int
    edited: int
    rejected: int
    skipped: int
    error: int


# =============================================================================
# Helper Functions
# =============================================================================

def suggestion_to_response(s: Suggestion) -> SuggestionResponse:
    """Convert a Suggestion to a response model."""
    return SuggestionResponse(
        id=s.id,
        trace_id=s.trace_id,
        batch_id=s.batch_id,
        session_id=s.session_id,
        has_issue=s.has_issue,
        suggested_note=s.suggested_note,
        confidence=s.confidence,
        thinking=s.thinking,
        failure_mode_id=s.failure_mode_id,
        failure_mode_name=s.failure_mode_name,
        suggested_category=s.suggested_category,
        status=s.status,
        created_at=s.created_at
    )


# =============================================================================
# Analyze Endpoints
# =============================================================================

@router.post("/batches/{batch_id}/analyze", response_model=AnalysisResponse)
async def analyze_batch(batch_id: str, request: AnalyzeBatchRequest = None):
    """
    Analyze all traces in a batch and generate AI suggestions.
    
    This runs the suggestion service on each trace in the batch,
    using agent context, existing taxonomy, and recent notes to
    identify potential quality issues.
    
    Returns:
        AnalysisResponse with all generated suggestions
    """
    if request is None:
        request = AnalyzeBatchRequest()
    
    # Get agent_id from batch
    with get_db_readonly() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT agent_id FROM synthetic_batches WHERE id = ?", (batch_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Batch not found")
        
        agent_id = row["agent_id"]
    
    # Create service with optional model override
    service = suggestion_service
    if request.model:
        from services.suggestion import SuggestionService
        service = SuggestionService(model=request.model)
    
    try:
        suggestions = await service.analyze_batch(
            agent_id=agent_id,
            batch_id=batch_id,
            max_concurrent=request.max_concurrent
        )
        
        issues_found = sum(1 for s in suggestions if s.has_issue)
        
        return AnalysisResponse(
            batch_id=batch_id,
            session_id=None,
            total_traces=len(suggestions),
            issues_found=issues_found,
            suggestions=[suggestion_to_response(s) for s in suggestions]
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@router.post("/sessions/{session_id}/analyze", response_model=AnalysisResponse)
async def analyze_session(session_id: str, request: AnalyzeSessionRequest = None):
    """
    Analyze a single session and generate an AI suggestion.
    
    Returns:
        AnalysisResponse with the suggestion
    """
    if request is None:
        request = AnalyzeSessionRequest()
    
    # Get agent_id from session's batch or use first agent
    with get_db_readonly() as conn:
        cursor = conn.cursor()
        
        # Try to get agent from batch
        cursor.execute("""
            SELECT sb.agent_id 
            FROM sessions s
            LEFT JOIN synthetic_batches sb ON s.batch_id = sb.id
            WHERE s.id = ?
        """, (session_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Session not found")
        
        agent_id = row["agent_id"]
        
        # Fallback to first agent if no batch link
        if not agent_id:
            cursor.execute("SELECT id FROM agents LIMIT 1")
            agent_row = cursor.fetchone()
            if agent_row:
                agent_id = agent_row["id"]
    
    if not agent_id:
        raise HTTPException(status_code=400, detail="No agent found for analysis")
    
    # Create service with optional model override
    service = suggestion_service
    if request.model:
        from services.suggestion import SuggestionService
        service = SuggestionService(model=request.model)
    
    try:
        suggestion = await service.analyze_session(
            agent_id=agent_id,
            session_id=session_id
        )
        
        return AnalysisResponse(
            batch_id=suggestion.batch_id,
            session_id=session_id,
            total_traces=1,
            issues_found=1 if suggestion.has_issue else 0,
            suggestions=[suggestion_to_response(suggestion)]
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


# =============================================================================
# Retrieval Endpoints
# =============================================================================

@router.get("/sessions/{session_id}", response_model=List[SuggestionResponse])
async def get_session_suggestions(session_id: str):
    """Get all suggestions for a session."""
    suggestions = suggestion_service.get_suggestions_for_session(session_id)
    return [suggestion_to_response(s) for s in suggestions]


@router.get("/batches/{batch_id}", response_model=List[SuggestionResponse])
async def get_batch_suggestions(batch_id: str):
    """Get all suggestions for a batch."""
    suggestions = suggestion_service.get_suggestions_for_batch(batch_id)
    return [suggestion_to_response(s) for s in suggestions]


@router.get("/pending", response_model=List[SuggestionResponse])
async def get_pending_suggestions(
    batch_id: Optional[str] = Query(None, description="Filter by batch"),
    min_confidence: float = Query(0.6, ge=0.0, le=1.0, description="Minimum confidence threshold")
):
    """
    Get pending suggestions ready for review.
    
    Only returns suggestions that have issues and are above the confidence threshold.
    """
    suggestions = suggestion_service.get_pending_suggestions(
        batch_id=batch_id,
        min_confidence=min_confidence
    )
    return [suggestion_to_response(s) for s in suggestions]


@router.get("/stats", response_model=SuggestionStatsResponse)
async def get_suggestion_stats(
    batch_id: Optional[str] = Query(None, description="Filter by batch")
):
    """Get statistics about suggestions."""
    stats = suggestion_service.get_suggestion_stats(batch_id)
    
    return SuggestionStatsResponse(
        total=stats.get("total", 0),
        issues_found=stats.get("issues_found", 0),
        pending=stats.get("pending", 0),
        accepted=stats.get("accepted", 0),
        edited=stats.get("edited", 0),
        rejected=stats.get("rejected", 0),
        skipped=stats.get("skipped", 0),
        error=stats.get("error", 0)
    )


# =============================================================================
# Action Endpoints
# =============================================================================

@router.post("/{suggestion_id}/accept", response_model=NoteResponse)
async def accept_suggestion(
    suggestion_id: str, 
    request: AcceptSuggestionRequest = None
):
    """
    Accept a suggestion, creating a note.
    
    Optionally edit the text or assign a different failure mode.
    """
    if request is None:
        request = AcceptSuggestionRequest()
    
    try:
        note = suggestion_service.accept_suggestion(
            suggestion_id=suggestion_id,
            edited_text=request.edited_text,
            failure_mode_id=request.failure_mode_id
        )
        
        if not note:
            raise HTTPException(status_code=404, detail="Suggestion not found or has no note text")
        
        return NoteResponse(
            note_id=note["note_id"],
            content=note["content"],
            failure_mode_id=note["failure_mode_id"],
            session_id=note["session_id"],
            created_at=note["created_at"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to accept suggestion: {str(e)}")


@router.post("/{suggestion_id}/skip")
async def skip_suggestion(suggestion_id: str):
    """Mark a suggestion as skipped (not relevant but not incorrect)."""
    success = suggestion_service.skip_suggestion(suggestion_id)
    
    if not success:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    
    return {"status": "skipped", "suggestion_id": suggestion_id}


@router.post("/{suggestion_id}/reject")
async def reject_suggestion(suggestion_id: str):
    """Mark a suggestion as rejected (AI was wrong)."""
    success = suggestion_service.reject_suggestion(suggestion_id)
    
    if not success:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    
    return {"status": "rejected", "suggestion_id": suggestion_id}


# =============================================================================
# Bulk Action Endpoints
# =============================================================================

@router.post("/bulk-accept", response_model=BulkAcceptResponse)
async def bulk_accept_suggestions(request: BulkAcceptRequest):
    """Accept multiple suggestions at once."""
    if not request.suggestion_ids:
        raise HTTPException(status_code=400, detail="No suggestion IDs provided")
    
    results = suggestion_service.bulk_accept_suggestions(request.suggestion_ids)
    
    return BulkAcceptResponse(
        accepted=results["accepted"],
        failed=results["failed"],
        notes_created=[
            NoteResponse(
                note_id=n["note_id"],
                content=n["content"],
                failure_mode_id=n["failure_mode_id"],
                session_id=n["session_id"],
                created_at=n["created_at"]
            )
            for n in results["notes_created"]
        ]
    )

