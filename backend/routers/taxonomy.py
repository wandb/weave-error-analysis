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


@router.get("/notes/{note_id}/session")
async def get_note_session(note_id: str):
    """
    Get the session info associated with a note.
    
    Returns session details if the note came from a session note,
    or null if it's a Weave feedback note.
    """
    try:
        session_info = taxonomy_service.get_note_session(note_id)
        return {"session": session_info}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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


class AddFromReviewRequest(BaseModel):
    """Request to add discovered categories from AI review to taxonomy."""
    review_id: str
    categories: List[str]  # Category names to add
    merge_mappings: Optional[dict] = None  # Map category_name -> existing_mode_id for merges


class AddFromReviewResult(BaseModel):
    """Result of adding categories from review."""
    created: List[dict]  # New failure modes created
    merged: List[dict]   # Categories merged into existing modes
    skipped: List[str]   # Categories not processed
    similarity_suggestions: List[dict]  # Suggested merges based on name similarity


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


# ============================================================================
# Add Categories from AI Review (Sprint 4)
# ============================================================================

@router.post("/add-from-review", response_model=AddFromReviewResult)
async def add_categories_from_review(request: AddFromReviewRequest):
    """
    Add discovered failure categories from an AI review to the taxonomy.
    
    This endpoint:
    1. Fetches the review and its failure categories
    2. Checks for similarity with existing failure modes
    3. Creates new failure modes for selected categories
    4. Optionally merges categories into existing modes
    5. Tracks which traces belong to which failure modes
    
    Args:
        request: AddFromReviewRequest with review_id, category names, and optional merge mappings
        
    Returns:
        AddFromReviewResult with created modes, merges, and similarity suggestions
    """
    import json
    from difflib import SequenceMatcher
    from services.auto_reviewer import get_auto_review
    
    try:
        # Get the review
        review = get_auto_review(request.review_id)
        if not review:
            raise HTTPException(status_code=404, detail="Review not found")
        
        # Get failure categories from review
        failure_categories = review.get("failure_categories", [])
        if not failure_categories:
            raise HTTPException(status_code=400, detail="Review has no failure categories")
        
        # Build a map of category name -> category data
        category_map = {cat["name"]: cat for cat in failure_categories}
        
        # Get existing failure modes for similarity check
        existing_modes = taxonomy_service.get_all_failure_modes()
        existing_names = {m.name.lower(): m for m in existing_modes}
        
        # Initialize merge mappings
        merge_mappings = request.merge_mappings or {}
        
        created = []
        merged = []
        skipped = []
        similarity_suggestions = []
        
        for category_name in request.categories:
            if category_name not in category_map:
                skipped.append(category_name)
                continue
            
            category = category_map[category_name]
            
            # Check if this category should be merged into an existing mode
            if category_name in merge_mappings:
                target_mode_id = merge_mappings[category_name]
                target_mode = taxonomy_service.get_failure_mode(target_mode_id)
                if target_mode:
                    # Update the existing mode's description if needed
                    # and increment its count
                    merged.append({
                        "category_name": category_name,
                        "merged_into": target_mode.to_dict(),
                        "trace_count": category.get("count", 0)
                    })
                    continue
            
            # Check for similar existing modes
            similar_modes = []
            for existing_mode in existing_modes:
                # Use sequence matching for similarity
                similarity = SequenceMatcher(
                    None, 
                    category_name.lower().replace("_", " "), 
                    existing_mode.name.lower().replace("_", " ")
                ).ratio()
                
                if similarity > 0.6:  # Threshold for suggesting merge
                    similar_modes.append({
                        "mode_id": existing_mode.id,
                        "mode_name": existing_mode.name,
                        "similarity": round(similarity, 2)
                    })
            
            if similar_modes:
                similarity_suggestions.append({
                    "category_name": category_name,
                    "similar_modes": sorted(similar_modes, key=lambda x: -x["similarity"])
                })
            
            # Create new failure mode
            # Convert category name from snake_case to Title Case for display
            display_name = category_name.replace("_", " ").title()
            
            new_mode = taxonomy_service.create_failure_mode(
                name=display_name,
                description=category.get("definition", "Discovered by AI Review"),
                severity="medium",  # Default severity
                suggested_fix=category.get("notes")
            )
            
            # Store the association between this failure mode and its review
            _store_review_category_association(
                review_id=request.review_id,
                failure_mode_id=new_mode.id,
                category_name=category_name,
                trace_ids=category.get("trace_ids", [])
            )
            
            created.append({
                **new_mode.to_dict(),
                "original_category_name": category_name,
                "trace_count": category.get("count", 0),
                "trace_ids": category.get("trace_ids", [])
            })
        
        return AddFromReviewResult(
            created=created,
            merged=merged,
            skipped=skipped,
            similarity_suggestions=similarity_suggestions
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _store_review_category_association(
    review_id: str,
    failure_mode_id: str,
    category_name: str,
    trace_ids: List[str]
):
    """
    Store the association between a review's category and a failure mode.
    
    This enables tracking which traces belong to which failure modes,
    and linking back from failure modes to the review that discovered them.
    """
    from database import get_db, now_iso
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Check if review_category_associations table exists, create if not
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS review_category_associations (
                id TEXT PRIMARY KEY,
                review_id TEXT NOT NULL,
                failure_mode_id TEXT NOT NULL,
                category_name TEXT NOT NULL,
                trace_ids TEXT,  -- JSON array of trace IDs
                created_at TEXT NOT NULL,
                FOREIGN KEY (failure_mode_id) REFERENCES failure_modes(id)
            )
        """)
        
        # Insert association
        import json
        from database import generate_id
        
        cursor.execute("""
            INSERT INTO review_category_associations 
            (id, review_id, failure_mode_id, category_name, trace_ids, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            generate_id(),
            review_id,
            failure_mode_id,
            category_name,
            json.dumps(trace_ids),
            now_iso()
        ))


@router.get("/failure-modes/{mode_id}/traces")
async def get_failure_mode_traces(mode_id: str):
    """
    Get traces associated with a failure mode.
    
    Returns traces that were classified into this failure mode by AI review.
    """
    import json
    from database import get_db
    
    try:
        mode = taxonomy_service.get_failure_mode(mode_id)
        if not mode:
            raise HTTPException(status_code=404, detail="Failure mode not found")
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Check if table exists
            cursor.execute("""
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name='review_category_associations'
            """)
            if not cursor.fetchone():
                return {
                    "failure_mode_id": mode_id,
                    "failure_mode_name": mode.name,
                    "traces": [],
                    "total_count": 0
                }
            
            # Get all trace associations for this failure mode
            cursor.execute("""
                SELECT review_id, category_name, trace_ids, created_at
                FROM review_category_associations
                WHERE failure_mode_id = ?
                ORDER BY created_at DESC
            """, (mode_id,))
            
            rows = cursor.fetchall()
            
            all_traces = []
            for row in rows:
                trace_ids = json.loads(row["trace_ids"]) if row["trace_ids"] else []
                for trace_id in trace_ids:
                    all_traces.append({
                        "trace_id": trace_id,
                        "review_id": row["review_id"],
                        "category_name": row["category_name"],
                        "discovered_at": row["created_at"]
                    })
            
            return {
                "failure_mode_id": mode_id,
                "failure_mode_name": mode.name,
                "traces": all_traces,
                "total_count": len(all_traces)
            }
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

