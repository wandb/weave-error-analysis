"""
Trace-related API endpoints.
"""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from services.weave_client import weave_client
from utils import truncate_dict

router = APIRouter(prefix="/api", tags=["traces"])


@router.get("/traces")
async def get_traces(
    start_time: Optional[str] = Query(None, description="ISO format start time"),
    end_time: Optional[str] = Query(None, description="ISO format end time"),
    op_name: Optional[str] = Query(None, description="Filter by operation name"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0)
):
    """Get list of traces from Weave."""
    try:
        op_names = [op_name] if op_name else None
        calls = await weave_client.query_calls(
            limit=limit,
            offset=offset,
            op_names=op_names
        )

        traces = [
            {
                "id": call.get("id"),
                "op_name": call.get("op_name", "unknown"),
                "started_at": call.get("started_at"),
                "ended_at": call.get("ended_at"),
                "status": "error" if call.get("exception") else "success",
                "inputs_preview": truncate_dict(call.get("inputs", {})),
                "has_exception": call.get("exception") is not None,
                "trace_id": call.get("trace_id"),
                "parent_id": call.get("parent_id")
            }
            for call in calls
        ]

        return {
            "traces": traces,
            "total_count": len(traces)
        }

    except Exception as e:
        print(f"Error fetching traces: {e}")
        import traceback
        traceback.print_exc()
        return {
            "traces": [],
            "total_count": 0,
            "error": str(e)
        }


@router.get("/traces/{trace_id}")
async def get_trace_detail(trace_id: str):
    """Get detailed information about a specific trace."""
    try:
        call = await weave_client.read_call(trace_id)

        if not call:
            raise HTTPException(status_code=404, detail="Trace not found")

        # Get child calls and feedback
        children = await weave_client.get_child_calls(trace_id)
        feedback = await weave_client.get_feedback_for_call(trace_id)

        return {
            "id": call.get("id"),
            "op_name": call.get("op_name"),
            "started_at": call.get("started_at"),
            "ended_at": call.get("ended_at"),
            "inputs": call.get("inputs", {}),
            "output": call.get("output"),
            "status": "error" if call.get("exception") else "success",
            "exception": call.get("exception"),
            "feedback": feedback,
            "attributes": call.get("attributes", {}),
            "children": children,
            "trace_id": call.get("trace_id"),
            "summary": call.get("summary", {})
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching trace detail: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/op-names")
async def get_op_names():
    """Get list of unique operation names."""
    try:
        calls = await weave_client.query_calls(limit=200)

        op_names = set()
        for call in calls:
            op_name = call.get("op_name")
            if op_name:
                op_names.add(op_name)

        return {"op_names": sorted(list(op_names))}

    except Exception as e:
        return {"op_names": [], "error": str(e)}

