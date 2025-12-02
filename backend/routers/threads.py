"""
Thread-related API endpoints with enhanced filtering, sorting, and annotation.

Now uses traces with summary.session_id to group sessions instead of the
threads endpoint which has limitations.
"""

import random
from typing import Optional, Literal
from collections import defaultdict

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
    Get list of sessions by querying traces and grouping by summary.session_id.
    
    This approach uses traces directly instead of the threads endpoint,
    allowing us to properly group calls by their actual session.
    """
    try:
        # Fetch ALL traces to group by session
        all_calls = await weave_client.query_calls(
            limit=500,
            offset=0,
            sort_field="started_at",
            sort_direction="desc"
        )
        
        # Build parent-child map to find root's thread_id from children
        # Some root calls don't have thread_id, but their children do
        call_by_id = {call.get("id"): call for call in all_calls}
        
        # First pass: identify root calls and their thread_id from children
        root_to_thread = {}  # trace_id -> thread_id (from children)
        for call in all_calls:
            thread_id = call.get("thread_id")
            trace_id = call.get("trace_id")
            if thread_id and trace_id:
                # If this call has both thread_id and trace_id, map them
                if trace_id not in root_to_thread:
                    root_to_thread[trace_id] = thread_id
        
        # Group calls by session_id (prefer thread_id)
        sessions = defaultdict(lambda: {
            "calls": [],
            "first_time": None,
            "last_time": None,
            "turn_count": 0
        })
        
        for call in all_calls:
            trace_id = call.get("trace_id")
            # Priority: thread_id > inherited from children > trace_id
            session_id = (
                call.get("thread_id") or 
                root_to_thread.get(trace_id) or  # Get from child's thread_id
                call.get("summary", {}).get("session_id") or 
                trace_id
            )
            
            if not session_id:
                continue
            
            # Skip if session_id is just a trace_id that we already mapped to a thread_id
            # This avoids duplication
            if session_id == trace_id and trace_id in root_to_thread:
                continue
            
            # Only count root calls (no parent) as turns
            is_root = call.get("parent_id") is None
            
            session = sessions[session_id]
            session["calls"].append(call)
            
            started_at = call.get("started_at")
            if started_at:
                if session["first_time"] is None or started_at < session["first_time"]:
                    session["first_time"] = started_at
                if session["last_time"] is None or started_at > session["last_time"]:
                    session["last_time"] = started_at
            
            if is_root:
                session["turn_count"] += 1
        
        # Convert to list format - only include sessions with session_xxx format (real sessions)
        threads = []
        for session_id, session_data in sessions.items():
            # Only include if it's a real session (not just a trace_id)
            # Real sessions typically start with "session_" or have multiple calls
            is_real_session = (
                session_id.startswith("session_") or 
                len(session_data["calls"]) > 1 or
                session_data["turn_count"] > 0
            )
            if not is_real_session:
                continue
                
            threads.append({
                "thread_id": session_id,
                "turn_count": session_data["turn_count"],
                "start_time": session_data["first_time"],
                "last_updated": session_data["last_time"],
                "call_count": len(session_data["calls"])
            })
        
        # Sort
        reverse = direction == "desc"
        if sort_by == "turn_count":
            threads.sort(key=lambda t: t["turn_count"], reverse=reverse)
        else:  # last_updated
            threads.sort(key=lambda t: t["last_updated"] or "", reverse=reverse)
        
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
        
        # Apply offset and limit
        threads = threads[offset:offset + limit]
        
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
    Get all calls in a session by filtering traces where summary.session_id matches.
    
    This fetches all traces and filters by session_id from summary field,
    giving us the actual calls that belong to this session.
    """
    try:
        # Fetch all calls
        all_calls = await weave_client.query_calls(
            limit=500,
            sort_field="started_at",
            sort_direction="asc"
        )
        
        # Build parent-child map to find root's thread_id from children
        root_to_thread = {}
        for call in all_calls:
            call_thread_id = call.get("thread_id")
            trace_id = call.get("trace_id")
            if call_thread_id and trace_id:
                if trace_id not in root_to_thread:
                    root_to_thread[trace_id] = call_thread_id
        
        # Filter calls that belong to this session
        # Include calls where thread_id matches OR trace_id maps to this thread_id
        session_calls = []
        for call in all_calls:
            trace_id = call.get("trace_id")
            call_session_id = (
                call.get("thread_id") or 
                root_to_thread.get(trace_id) or
                call.get("summary", {}).get("session_id") or 
                trace_id
            )
            if call_session_id == thread_id:
                session_calls.append(call)
        
        # Sort by started_at
        session_calls.sort(key=lambda c: c.get("started_at", ""))

        # Process calls into conversation format
        conversation = process_thread_calls(session_calls)

        # Calculate metrics from ROOT calls only (to avoid double-counting nested latency)
        total_latency_ms = 0
        has_error = False
        root_call_count = 0
        
        for call in session_calls:
            # Only count root calls for latency
            if call.get("parent_id") is None:
                root_call_count += 1
                started = call.get("started_at")
                ended = call.get("ended_at")
                if started and ended:
                    try:
                        from datetime import datetime
                        start_dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
                        end_dt = datetime.fromisoformat(ended.replace("Z", "+00:00"))
                        total_latency_ms += (end_dt - start_dt).total_seconds() * 1000
                    except:
                        pass
            if call.get("exception"):
                has_error = True

        # Return summarized calls (only root calls for cleaner view)
        call_summaries = [
            {
                "id": call.get("id"),
                "op_name": call.get("op_name"),
                "started_at": call.get("started_at"),
                "ended_at": call.get("ended_at"),
                "is_root": call.get("parent_id") is None,
                "session_id": call.get("summary", {}).get("session_id"),
            }
            for call in session_calls
            if call.get("parent_id") is None  # Only include root calls in summary
        ]

        # Get review status
        is_reviewed = annotation_service.is_thread_reviewed(thread_id)

        return {
            "thread_id": thread_id,
            "calls": call_summaries,
            "conversation": conversation,
            "feedback": {},
            "total_calls": len(call_summaries),  # Root calls only
            "all_calls_count": len(session_calls),  # Including nested
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
