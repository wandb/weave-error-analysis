"""
Taxonomy API endpoints for failure mode management.

Provides:
- CRUD operations for failure modes
- Note sync and assignment
- AI-powered categorization
- Saturation tracking
"""

from typing import Optional, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.taxonomy import taxonomy_service
from services.weave_client import weave_client
from config import get_target_project_id, get_feedback_query_limit


router = APIRouter(prefix="/api/taxonomy", tags=["taxonomy"])


# ============================================================================
# Request/Response Models
# ============================================================================

class CreateFailureModeRequest(BaseModel):
    name: str
    description: str
    severity: str = "medium"
    suggested_fix: Optional[str] = None


class UpdateFailureModeRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[str] = None
    suggested_fix: Optional[str] = None
    status: Optional[str] = None


class UpdateFailureModeStatusRequest(BaseModel):
    status: str  # 'active', 'investigating', 'resolved', 'wont_fix'


class MergeFailureModesRequest(BaseModel):
    source_id: str
    target_id: str
    new_name: Optional[str] = None
    new_description: Optional[str] = None


class AssignNoteRequest(BaseModel):
    note_id: str
    failure_mode_id: str
    method: str = "manual"


class AutoCategorizeRequest(BaseModel):
    note_ids: Optional[List[str]] = None  # If None, categorize all uncategorized


# ============================================================================
# Taxonomy Overview Endpoints
# ============================================================================

@router.get("")
async def get_taxonomy():
    """
    Get the full taxonomy with failure modes, uncategorized notes, and saturation stats.
    """
    try:
        return taxonomy_service.get_taxonomy_summary()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/saturation-history")
async def get_saturation_history():
    """
    Get the full saturation discovery history for the chart visualization.
    
    Returns:
    - snapshots: List of (threads_reviewed, failure_modes_count) points for the curve
    - current_threads: Current number of reviewed threads
    - current_modes: Current number of failure modes
    - last_discovery_at_threads: Thread count when last new mode was discovered
    - threads_since_last_discovery: Threads reviewed since last new mode
    - saturation_status: "no_data", "discovering", "approaching_saturation", "saturated"
    - recommendation: Actionable guidance based on status
    - recommendation_type: "info", "action", or "success"
    """
    try:
        return taxonomy_service.get_saturation_history()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/saturation-by-batch")
async def get_saturation_by_batch():
    """
    Get saturation statistics grouped by batch for charts.
    
    Returns batch-level metrics for three visualizations:
    1. Review progress per batch (sessions reviewed vs total)
    2. Discovery by batch (new vs matched failure modes)
    3. Taxonomy growth (cumulative failure modes over batches)
    
    All data comes from real database records - no mock data.
    """
    try:
        return taxonomy_service.get_saturation_by_batch()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Failure Mode CRUD Endpoints
# ============================================================================

@router.post("/failure-modes")
async def create_failure_mode(request: CreateFailureModeRequest):
    """Create a new failure mode."""
    try:
        mode = taxonomy_service.create_failure_mode(
            name=request.name,
            description=request.description,
            severity=request.severity,
            suggested_fix=request.suggested_fix
        )
        return mode.to_dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/failure-modes/{mode_id}")
async def update_failure_mode(mode_id: str, request: UpdateFailureModeRequest):
    """Update a failure mode."""
    mode = taxonomy_service.update_failure_mode(
        mode_id=mode_id,
        name=request.name,
        description=request.description,
        severity=request.severity,
        suggested_fix=request.suggested_fix,
        status=request.status
    )
    if not mode:
        raise HTTPException(status_code=404, detail="Failure mode not found")
    return mode.to_dict()


@router.put("/failure-modes/{mode_id}/status")
async def update_failure_mode_status(mode_id: str, request: UpdateFailureModeStatusRequest):
    """
    Update only the status of a failure mode.
    
    Valid statuses:
    - active: Currently occurring, needs attention
    - investigating: Being worked on
    - resolved: Fixed in latest version
    - wont_fix: Accepted limitation
    """
    try:
        mode = taxonomy_service.update_failure_mode_status(mode_id, request.status)
        if not mode:
            raise HTTPException(status_code=404, detail="Failure mode not found")
        return mode.to_dict()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/failure-modes/{mode_id}")
async def delete_failure_mode(mode_id: str):
    """
    Delete a failure mode.
    Notes assigned to this mode will be unassigned (moved to uncategorized).
    """
    success = taxonomy_service.delete_failure_mode(mode_id)
    if not success:
        raise HTTPException(status_code=404, detail="Failure mode not found")
    return {"status": "deleted", "mode_id": mode_id}


@router.post("/failure-modes/merge")
async def merge_failure_modes(request: MergeFailureModesRequest):
    """
    Merge two failure modes.
    Source mode is deleted, its notes move to target mode.
    """
    mode = taxonomy_service.merge_failure_modes(
        source_id=request.source_id,
        target_id=request.target_id,
        new_name=request.new_name,
        new_description=request.new_description
    )
    if not mode:
        raise HTTPException(status_code=404, detail="One or both failure modes not found")
    return mode.to_dict()


# ============================================================================
# Note Management Endpoints
# ============================================================================

@router.post("/notes/sync")
async def sync_notes_from_weave():
    """
    Sync notes from Weave feedback into the local taxonomy database.
    
    This pulls all notes from Weave and adds any new ones to our local DB.
    Existing notes (matched by content and trace) are skipped.
    """
    try:
        # Fetch notes from Weave
        feedback_list = await weave_client.query_feedback(limit=get_feedback_query_limit())
        
        # Filter to notes only
        weave_notes = []
        for fb in feedback_list:
            fb_type = fb.get("feedback_type", "")
            if "note" in fb_type:
                payload = fb.get("payload", {})
                note_text = payload.get("note", "")
                if note_text:
                    weave_ref = fb.get("weave_ref", "")
                    call_id = weave_ref.split("/")[-1] if weave_ref else ""
                    weave_notes.append({
                        "weave_feedback_id": fb.get("id", ""),
                        "note": note_text,
                        "call_id": call_id,
                        "weave_ref": weave_ref,
                        "weave_url": f"https://wandb.ai/{get_target_project_id()}/weave/calls/{call_id}" if call_id else "",
                        "created_at": fb.get("created_at")
                    })
        
        # Sync to local DB
        result = taxonomy_service.sync_notes_from_weave(weave_notes)
        
        return {
            "status": "synced",
            "weave_notes_found": len(weave_notes),
            "new_notes_added": result["new"],
            "existing_notes_skipped": result["existing"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/notes/assign")
async def assign_note(request: AssignNoteRequest):
    """Assign a note to a failure mode."""
    success = taxonomy_service.assign_note_to_failure_mode(
        note_id=request.note_id,
        failure_mode_id=request.failure_mode_id,
        method=request.method
    )
    if not success:
        raise HTTPException(status_code=404, detail="Note or failure mode not found")
    return {"status": "assigned", "note_id": request.note_id, "failure_mode_id": request.failure_mode_id}


# ============================================================================
# AI Categorization Endpoints
# ============================================================================

@router.post("/notes/{note_id}/suggest")
async def suggest_category_for_note(note_id: str):
    """
    Use AI to suggest which failure mode a note belongs to.
    
    Returns either a match to an existing mode (with confidence score)
    or suggests creating a new failure mode.
    """
    try:
        return await taxonomy_service.suggest_category_for_note(note_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/auto-categorize")
async def auto_categorize(request: AutoCategorizeRequest):
    """
    Automatically categorize notes using AI.
    
    For each note:
    - Checks if it matches an existing failure mode (semantic matching)
    - If no match, creates a new failure mode
    
    Returns saturation metrics showing new vs matched categories.
    """
    try:
        result = await taxonomy_service.auto_categorize_notes(request.note_ids)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Batch Categorization Endpoints (Phase 2)
# ============================================================================

class BatchSuggestRequest(BaseModel):
    note_ids: Optional[List[str]] = None  # If None, suggest for all uncategorized


class BatchApplyAssignment(BaseModel):
    note_id: str
    action: str  # "existing" | "new" | "skip"
    failure_mode_id: Optional[str] = None  # Required if action is "existing"
    new_category: Optional[dict] = None  # Required if action is "new"


class BatchApplyRequest(BaseModel):
    assignments: List[BatchApplyAssignment]


@router.post("/batch-suggest")
async def batch_suggest_categories(request: BatchSuggestRequest):
    """
    Get AI suggestions for multiple notes WITHOUT applying them.
    
    This is the first step of the batch categorization workflow:
    1. Call this endpoint to get suggestions for all uncategorized notes
    2. User reviews suggestions in the UI
    3. User confirms/modifies/skips each suggestion
    4. Call /batch-apply to apply confirmed suggestions
    
    Returns a list of suggestions with confidence scores for human review.
    """
    try:
        result = await taxonomy_service.batch_suggest_categories(request.note_ids)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch-apply")
async def batch_apply_categories(request: BatchApplyRequest):
    """
    Apply multiple category assignments at once.
    
    This is the second step of the batch categorization workflow.
    Call this after user has reviewed suggestions from /batch-suggest.
    
    Each assignment should specify:
    - note_id: The note to categorize
    - action: "existing" (assign to existing mode), "new" (create new mode), or "skip"
    - failure_mode_id: Required if action is "existing"
    - new_category: Required if action is "new" (with name, description, severity, suggested_fix)
    """
    try:
        # Convert to list of dicts
        assignments = [a.model_dump() for a in request.assignments]
        result = taxonomy_service.batch_apply_categories(assignments)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



