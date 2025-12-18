"""
Feedback-related API endpoints.
"""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from config import get_target_project_id, get_feedback_query_limit
from logger import get_logger
from services.weave_client import weave_client

logger = get_logger("feedback_api")

router = APIRouter(prefix="/api", tags=["feedback"])


@router.get("/feedback-summary")
async def get_feedback_summary(
    start_time: Optional[str] = Query(None),
    end_time: Optional[str] = Query(None)
):
    """Get summary of all feedback."""
    try:
        feedback_list = await weave_client.query_feedback(limit=get_feedback_query_limit())

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
        logger.error(f"Error fetching feedback summary: {e}", exc_info=True)
        return {
            "thumbs_up": 0,
            "thumbs_down": 0,
            "notes": [],
            "total_notes": 0,
            "error": str(e)
        }

