"""
Thread-related API endpoints with enhanced filtering, sorting, and annotation.
"""

import random
from typing import Optional, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.weave_client import weave_client
from services.conversation import process_thread_calls
from services.annotation import annotation_service
from config import PROJECT_ID

router = APIRouter(prefix="/api", tags=["threads"])


# ============================================================================
# Request Models
# ============================================================================

class MarkReviewedRequest(BaseModel):
    notes: Optional[str] = None


class AddNoteRequest(BaseModel):
    note: str
    call_id: Optional[str] = None  # Optional: attach note to specific call


class SetReviewTargetRequest(BaseModel):
    target: int


# ============================================================================
# Thread List Endpoints
# ============================================================================

@router.get("/threads")
async def get_threads(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort_by: str = Query("last_updated", description="Sort field: last_updated, turn_count"),
    direction: str = Query("desc", description="Sort direction: asc, desc"),
    min_turns: Optional[int] = Query(None, ge=1, description="Minimum turn count filter"),
    max_turns: Optional[int] = Query(None, ge=1, description="Maximum turn count filter"),
    reviewed: Optional[bool] = Query(None, description="Filter by review status"),
    sample: Optional[str] = Query(None, description="Sampling strategy: random"),
    sample_size: int = Query(20, ge=1, le=100, description="Sample size for random sampling")
):
    """
    Get list of threads with enhanced filtering and sorting.
    
    Supports:
    - Sorting by last_updated, turn_count
    - Filtering by min/max turns
    - Filtering by review status
    - Random sampling
    """
    try:
        # Fetch threads from Weave
        # Note: We fetch more than needed to allow for client-side filtering
        fetch_limit = limit * 3 if min_turns or max_turns or reviewed is not None else limit
        
        threads = await weave_client.query_threads(
            limit=min(fetch_limit, 200),
            offset=offset,
            sort_by=sort_by if sort_by in ["last_updated", "turn_count"] else "last_updated",
            sort_direction=direction
        )
        
        # Get review status for all threads
        thread_ids = [t["thread_id"] for t in threads]
        review_status = annotation_service.get_threads_with_review_status(thread_ids)
        
        # Add review status to threads
        for thread in threads:
            thread["is_reviewed"] = review_status.get(thread["thread_id"], False)
        
        # Apply filters
        if min_turns is not None:
            threads = [t for t in threads if t["turn_count"] >= min_turns]
        
        if max_turns is not None:
            threads = [t for t in threads if t["turn_count"] <= max_turns]
        
        if reviewed is not None:
            threads = [t for t in threads if t["is_reviewed"] == reviewed]
        
        # Apply random sampling if requested
        if sample == "random" and len(threads) > sample_size:
            threads = random.sample(threads, sample_size)
        
        # Trim to requested limit
        threads = threads[:limit]
        
        return {
            "threads": threads,
            "total_count": len(threads)
        }

    except Exception as e:
        print(f"Error fetching threads: {e}")
        import traceback
        traceback.print_exc()
        return {
            "threads": [],
            "total_count": 0,
            "error": str(e)
        }


@router.get("/threads/{thread_id}")
async def get_thread_detail(thread_id: str):
    """
    Get all calls in a thread for conversation view.
    Includes review status and metrics.
    """
    try:
        # Query all calls with this thread_id
        calls = await weave_client.query_calls(
            limit=200,
            thread_ids=[thread_id],
            sort_field="started_at",
            sort_direction="asc"
        )

        # Process calls into conversation format
        conversation = process_thread_calls(calls)

        # Calculate metrics
        total_latency_ms = 0
        has_error = False
        for call in calls:
            started = call.get("started_at")
            ended = call.get("ended_at")
            if started and ended:
                # Parse ISO timestamps and calculate duration
                try:
                    from datetime import datetime
                    start_dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
                    end_dt = datetime.fromisoformat(ended.replace("Z", "+00:00"))
                    total_latency_ms += (end_dt - start_dt).total_seconds() * 1000
                except:
                    pass
            if call.get("exception"):
                has_error = True

        # Return summarized calls
        call_summaries = [
            {
                "id": call.get("id"),
                "op_name": call.get("op_name"),
                "started_at": call.get("started_at"),
                "ended_at": call.get("ended_at"),
            }
            for call in calls
        ]

        # Get review status
        is_reviewed = annotation_service.is_thread_reviewed(thread_id)

        return {
            "thread_id": thread_id,
            "calls": call_summaries,
            "conversation": conversation,
            "feedback": {},
            "total_calls": len(calls),
            "metrics": {
                "total_latency_ms": round(total_latency_ms, 2),
                "turn_count": len([m for m in conversation if m.get("type") == "user"]),
                "has_error": has_error
            },
            "is_reviewed": is_reviewed
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching thread detail: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Annotation Endpoints
# ============================================================================

@router.post("/threads/{thread_id}/mark-reviewed")
async def mark_thread_reviewed(thread_id: str, request: MarkReviewedRequest = None):
    """Mark a thread as reviewed."""
    try:
        notes = request.notes if request else None
        annotation_service.mark_thread_reviewed(thread_id, notes)
        return {
            "status": "success",
            "thread_id": thread_id,
            "is_reviewed": True
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/threads/{thread_id}/mark-reviewed")
async def unmark_thread_reviewed(thread_id: str):
    """Remove a thread from the reviewed list."""
    try:
        annotation_service.unmark_thread_reviewed(thread_id)
        return {
            "status": "success",
            "thread_id": thread_id,
            "is_reviewed": False
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/threads/{thread_id}/note")
async def add_note_to_thread(thread_id: str, request: AddNoteRequest):
    """
    Add a note to a thread via Weave feedback API.
    
    If call_id is provided, attaches the note to that specific call.
    Otherwise, attaches to the first call in the thread.
    """
    try:
        # If no specific call_id, get the first call in the thread
        call_id = request.call_id
        if not call_id:
            calls = await weave_client.query_calls(
                limit=1,
                thread_ids=[thread_id],
                sort_field="started_at",
                sort_direction="asc"
            )
            if calls:
                call_id = calls[0].get("id")
            else:
                raise HTTPException(status_code=404, detail="No calls found in thread")
        
        # Create note feedback via Weave
        result = await weave_client.create_feedback(
            call_id=call_id,
            feedback_type="wandb.note.1",
            payload={"note": request.note}
        )
        
        return {
            "status": "success",
            "thread_id": thread_id,
            "call_id": call_id,
            "note": request.note,
            "feedback_id": result.get("id")
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/annotation-progress")
async def get_annotation_progress():
    """Get annotation progress statistics."""
    try:
        progress = annotation_service.get_annotation_progress()
        
        # Also get saturation info from taxonomy if available
        try:
            from services.taxonomy import taxonomy_service
            saturation = taxonomy_service.get_saturation_stats()
            progress["saturation"] = saturation
        except:
            progress["saturation"] = None
        
        return progress
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/annotation-progress/target")
async def set_review_target(request: SetReviewTargetRequest):
    """Set the target number of threads to review."""
    try:
        annotation_service.set_review_target(request.target)
        return {
            "status": "success",
            "target": request.target
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
