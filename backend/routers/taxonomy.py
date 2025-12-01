"""
Taxonomy API endpoints for failure mode management.

Provides:
- CRUD operations for failure modes
- Note sync and assignment
- AI-powered categorization
- Saturation tracking
"""

from typing import Optional, List

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.taxonomy import taxonomy_service
from services.weave_client import weave_client
from config import PROJECT_ID


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


@router.get("/saturation")
async def get_saturation_stats(window_size: int = Query(20, ge=5, le=100)):
    """
    Get saturation tracking statistics.
    
    Saturation indicates whether we're still discovering new failure patterns
    or if most notes fit existing categories.
    """
    try:
        return taxonomy_service.get_saturation_stats(window_size)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Failure Mode CRUD Endpoints
# ============================================================================

@router.get("/failure-modes")
async def get_failure_modes():
    """Get all failure modes."""
    try:
        modes = taxonomy_service.get_all_failure_modes()
        return {"failure_modes": [m.to_dict() for m in modes]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/failure-modes/{mode_id}")
async def get_failure_mode(mode_id: str):
    """Get a single failure mode by ID."""
    mode = taxonomy_service.get_failure_mode(mode_id)
    if not mode:
        raise HTTPException(status_code=404, detail="Failure mode not found")
    return mode.to_dict()


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
        suggested_fix=request.suggested_fix
    )
    if not mode:
        raise HTTPException(status_code=404, detail="Failure mode not found")
    return mode.to_dict()


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

@router.get("/notes")
async def get_notes(uncategorized_only: bool = Query(False)):
    """Get notes, optionally filtering to uncategorized only."""
    try:
        if uncategorized_only:
            notes = taxonomy_service.get_uncategorized_notes()
        else:
            notes = taxonomy_service.get_all_notes()
        return {"notes": [n.to_dict() for n in notes]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/notes/sync")
async def sync_notes_from_weave():
    """
    Sync notes from Weave feedback into the local taxonomy database.
    
    This pulls all notes from Weave and adds any new ones to our local DB.
    Existing notes (matched by content and trace) are skipped.
    """
    try:
        # Fetch notes from Weave
        feedback_list = await weave_client.query_feedback(limit=500)
        
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
                        "weave_url": f"https://wandb.ai/{PROJECT_ID}/weave/calls/{call_id}" if call_id else "",
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


@router.post("/notes/{note_id}/unassign")
async def unassign_note(note_id: str):
    """Remove a note from its failure mode (move to uncategorized)."""
    success = taxonomy_service.unassign_note(note_id)
    if not success:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"status": "unassigned", "note_id": note_id}


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
        result = await taxonomy_service.suggest_category_for_note(note_id)
        if "error" in result:
            raise HTTPException(status_code=500, detail=result["error"])
        return result
    except HTTPException:
        raise
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


@router.post("/suggest-improvements")
async def suggest_taxonomy_improvements():
    """
    Analyze the current taxonomy and suggest improvements.
    
    Looks for:
    - Categories that could be merged (too similar)
    - Categories that might need splitting (too broad)
    - Naming improvements
    """
    try:
        import json
        import litellm
        from config import CATEGORIZATION_MODEL
        
        modes = taxonomy_service.get_all_failure_modes()
        
        if len(modes) < 2:
            return {
                "suggestions": [],
                "message": "Need at least 2 failure modes to analyze taxonomy"
            }
        
        modes_text = "\n".join([
            f"- Name: {m.name}\n  Description: {m.description}\n  Notes: {m.times_seen}"
            for m in modes
        ])
        
        prompt = f"""Analyze this failure mode taxonomy for an AI system:

{modes_text}

Suggest improvements. Look for:
1. Categories that are too similar and should be merged
2. Categories that seem too broad and might need splitting
3. Naming that could be clearer or more specific

Respond in JSON format:
{{
    "suggestions": [
        {{
            "type": "merge" | "split" | "rename",
            "mode_ids": ["id1", "id2"],
            "reason": "Why this change is recommended",
            "suggested_name": "New name if applicable"
        }}
    ],
    "overall_assessment": "Brief summary of taxonomy health"
}}

If the taxonomy looks good, return empty suggestions array."""

        response = litellm.completion(
            model=CATEGORIZATION_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"}
        )
        
        return json.loads(response.choices[0].message.content)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

