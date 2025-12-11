"""
Feedback-related API endpoints.
"""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from config import get_target_project_id
from models import FeedbackRequest
from services.weave_client import weave_client

router = APIRouter(prefix="/api", tags=["feedback"])


@router.post("/traces/{trace_id}/feedback")
async def add_feedback(trace_id: str, request: FeedbackRequest):
    """Add feedback to a trace."""
    try:
        # Build payload based on feedback type
        if request.feedback_type == "thumbs_up":
            payload = {"emoji": "👍"}
            feedback_type = "wandb.reaction.1"
        elif request.feedback_type == "thumbs_down":
            payload = {"emoji": "👎"}
            feedback_type = "wandb.reaction.1"
        elif request.feedback_type == "note":
            payload = {"note": request.value or ""}
            feedback_type = "wandb.note.1"
        else:
            payload = {"value": request.value}
            feedback_type = request.feedback_type

        result = await weave_client.create_feedback(
            call_id=trace_id,
            feedback_type=feedback_type,
            payload=payload
        )

        return {
            "status": "success",
            "feedback_id": result.get("id"),
            "message": "Feedback added"
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/feedback-summary")
async def get_feedback_summary(
    start_time: Optional[str] = Query(None),
    end_time: Optional[str] = Query(None)
):
    """Get summary of all feedback."""
    try:
        feedback_list = await weave_client.query_feedback(limit=500)

        thumbs_up = 0
        thumbs_down = 0
        notes = []

        for fb in feedback_list:
            fb_type = fb.get("feedback_type", "")
            payload = fb.get("payload", {})
            weave_ref = fb.get("weave_ref", "")

            if "reaction" in fb_type:
                emoji = payload.get("emoji", "")
                if emoji == "👍":
                    thumbs_up += 1
                elif emoji == "👎":
                    thumbs_down += 1
            elif "note" in fb_type:
                note_text = payload.get("note", "")
                if note_text:
                    # Extract call_id from weave_ref
                    call_id = weave_ref.split("/")[-1] if weave_ref else ""
                    notes.append({
                        "note": note_text,
                        "call_id": call_id,
                        "weave_ref": weave_ref,
                        "weave_url": f"https://wandb.ai/{get_target_project_id()}/weave/calls/{call_id}" if call_id else "",
                        "created_at": fb.get("created_at")
                    })

        return {
            "thumbs_up": thumbs_up,
            "thumbs_down": thumbs_down,
            "notes": notes,
            "total_notes": len(notes)
        }

    except Exception as e:
        print(f"Error fetching feedback summary: {e}")
        return {
            "thumbs_up": 0,
            "thumbs_down": 0,
            "notes": [],
            "total_notes": 0,
            "error": str(e)
        }

