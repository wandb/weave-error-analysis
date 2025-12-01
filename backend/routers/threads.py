"""
Thread-related API endpoints.
"""

from fastapi import APIRouter, HTTPException, Query

from services.weave_client import weave_client
from services.conversation import process_thread_calls

router = APIRouter(prefix="/api", tags=["threads"])


@router.get("/threads")
async def get_threads(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0)
):
    """Get list of threads from Weave."""
    try:
        threads = await weave_client.query_threads(limit=limit, offset=offset)
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

    Optimized to:
    1. Skip per-call feedback fetching (was causing N+1 problem)
    2. Limit number of calls processed
    3. Use original processing which handles ADK format
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

        # Return summarized calls (not full raw data to keep response manageable)
        call_summaries = [
            {
                "id": call.get("id"),
                "op_name": call.get("op_name"),
                "started_at": call.get("started_at"),
                "ended_at": call.get("ended_at"),
            }
            for call in calls
        ]

        return {
            "thread_id": thread_id,
            "calls": call_summaries,
            "conversation": conversation,
            "feedback": {},  # Removed N+1 feedback fetching - can be added back via separate endpoint
            "total_calls": len(calls)
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching thread detail: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

