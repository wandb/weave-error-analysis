"""
Backend Service for Error Analysis Workflow

This FastAPI service provides:
- Trace querying from W&B Weave
- Feedback and notes management
- LLM-powered failure mode categorization
"""

import os
from datetime import datetime, timedelta
from typing import Optional
from dotenv import load_dotenv

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import weave
from weave.trace.weave_client import WeaveClient
from weave.trace_server.trace_server_interface import CallsFilter

import litellm

load_dotenv()

app = FastAPI(
    title="Error Analysis Backend",
    description="Backend service for AI error analysis workflow",
    version="1.0.0"
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Weave client
WEAVE_PROJECT = os.getenv("WEAVE_PROJECT", "error-analysis-demo")
WANDB_ENTITY = os.getenv("WANDB_ENTITY", None)  # Your W&B username or team name


def get_weave_client() -> WeaveClient:
    """Get or create a Weave client."""
    # The project name format is entity/project
    if WANDB_ENTITY:
        project_id = f"{WANDB_ENTITY}/{WEAVE_PROJECT}"
    else:
        project_id = WEAVE_PROJECT
    
    client = weave.init(project_id)
    return client


# Pydantic models
class TraceListResponse(BaseModel):
    traces: list
    total_count: int
    page: int
    page_size: int


class TraceDetail(BaseModel):
    id: str
    op_name: str
    started_at: Optional[str]
    ended_at: Optional[str]
    inputs: Optional[dict]
    outputs: Optional[dict]
    status: Optional[str]
    exception: Optional[str]
    feedback: Optional[list]
    attributes: Optional[dict]


class AddNoteRequest(BaseModel):
    trace_id: str
    note: str
    failure_mode: Optional[str] = None


class CategorizeRequest(BaseModel):
    notes: list[str]


class CategorizeResponse(BaseModel):
    categories: list[dict]
    summary: str


class FeedbackRequest(BaseModel):
    trace_id: str
    feedback_type: str  # "thumbs_up", "thumbs_down", "note"
    value: Optional[str] = None


# API Endpoints
@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "healthy", "service": "error-analysis-backend"}


@app.get("/api/traces")
async def get_traces(
    start_time: Optional[str] = Query(None, description="ISO format start time"),
    end_time: Optional[str] = Query(None, description="ISO format end time"),
    op_name: Optional[str] = Query(None, description="Filter by operation name"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100)
):
    """
    Get list of traces from Weave with optional filtering.
    """
    try:
        client = get_weave_client()
        
        # Build filter
        filter_dict = {}
        
        if op_name:
            filter_dict["op_names"] = [op_name]
        
        # Get calls (traces) from Weave
        calls = client.get_calls(
            filter=CallsFilter(**filter_dict) if filter_dict else None,
            limit=page_size,
            offset=(page - 1) * page_size
        )
        
        traces = []
        for call in calls:
            # Parse timestamps
            started_at = None
            ended_at = None
            
            if hasattr(call, 'started_at') and call.started_at:
                started_at = call.started_at.isoformat() if hasattr(call.started_at, 'isoformat') else str(call.started_at)
            
            if hasattr(call, 'ended_at') and call.ended_at:
                ended_at = call.ended_at.isoformat() if hasattr(call.ended_at, 'isoformat') else str(call.ended_at)
            
            # Apply time filter if specified
            if start_time and started_at:
                if started_at < start_time:
                    continue
            if end_time and started_at:
                if started_at > end_time:
                    continue
            
            trace_data = {
                "id": call.id,
                "op_name": call.op_name if hasattr(call, 'op_name') else "unknown",
                "started_at": started_at,
                "ended_at": ended_at,
                "status": getattr(call, 'status', 'unknown'),
                "inputs_preview": _truncate_dict(call.inputs if hasattr(call, 'inputs') else {}),
                "has_exception": hasattr(call, 'exception') and call.exception is not None
            }
            traces.append(trace_data)
        
        return {
            "traces": traces,
            "total_count": len(traces),
            "page": page,
            "page_size": page_size
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching traces: {str(e)}")


@app.get("/api/traces/{trace_id}")
async def get_trace_detail(trace_id: str):
    """
    Get detailed information about a specific trace.
    """
    try:
        client = get_weave_client()
        
        # Get the specific call
        call = client.get_call(trace_id)
        
        if not call:
            raise HTTPException(status_code=404, detail="Trace not found")
        
        # Get feedback for this trace
        feedback = []
        try:
            if hasattr(call, 'feedback'):
                for fb in call.feedback:
                    feedback.append({
                        "type": getattr(fb, 'feedback_type', 'unknown'),
                        "value": getattr(fb, 'payload', None),
                        "created_at": getattr(fb, 'created_at', None)
                    })
        except Exception:
            pass  # Feedback might not be available
        
        # Parse timestamps
        started_at = None
        ended_at = None
        
        if hasattr(call, 'started_at') and call.started_at:
            started_at = call.started_at.isoformat() if hasattr(call.started_at, 'isoformat') else str(call.started_at)
        
        if hasattr(call, 'ended_at') and call.ended_at:
            ended_at = call.ended_at.isoformat() if hasattr(call.ended_at, 'isoformat') else str(call.ended_at)
        
        return {
            "id": call.id,
            "op_name": call.op_name if hasattr(call, 'op_name') else "unknown",
            "started_at": started_at,
            "ended_at": ended_at,
            "inputs": call.inputs if hasattr(call, 'inputs') else {},
            "output": call.output if hasattr(call, 'output') else None,
            "status": getattr(call, 'status', 'unknown'),
            "exception": str(call.exception) if hasattr(call, 'exception') and call.exception else None,
            "feedback": feedback,
            "attributes": call.attributes if hasattr(call, 'attributes') else {},
            "children": _get_child_calls(client, trace_id)
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching trace: {str(e)}")


def _get_child_calls(client, parent_id: str) -> list:
    """Get child calls for a trace."""
    try:
        calls = client.get_calls(
            filter=CallsFilter(parent_ids=[parent_id]),
            limit=100
        )
        
        children = []
        for call in calls:
            started_at = None
            ended_at = None
            
            if hasattr(call, 'started_at') and call.started_at:
                started_at = call.started_at.isoformat() if hasattr(call.started_at, 'isoformat') else str(call.started_at)
            
            if hasattr(call, 'ended_at') and call.ended_at:
                ended_at = call.ended_at.isoformat() if hasattr(call.ended_at, 'isoformat') else str(call.ended_at)
            
            children.append({
                "id": call.id,
                "op_name": call.op_name if hasattr(call, 'op_name') else "unknown",
                "started_at": started_at,
                "ended_at": ended_at,
                "inputs_preview": _truncate_dict(call.inputs if hasattr(call, 'inputs') else {}),
                "output_preview": _truncate_value(call.output if hasattr(call, 'output') else None)
            })
        
        return children
    except Exception:
        return []


def _truncate_dict(d: dict, max_length: int = 100) -> dict:
    """Truncate dictionary values for preview."""
    if not d:
        return {}
    result = {}
    for k, v in d.items():
        result[k] = _truncate_value(v, max_length)
    return result


def _truncate_value(v, max_length: int = 100):
    """Truncate a value for preview."""
    if v is None:
        return None
    if isinstance(v, str):
        return v[:max_length] + "..." if len(v) > max_length else v
    if isinstance(v, dict):
        return _truncate_dict(v, max_length)
    if isinstance(v, list):
        return [_truncate_value(item, max_length) for item in v[:5]]
    return v


@app.post("/api/traces/{trace_id}/feedback")
async def add_feedback(trace_id: str, request: FeedbackRequest):
    """
    Add feedback to a trace (thumbs up/down or note).
    """
    try:
        client = get_weave_client()
        call = client.get_call(trace_id)
        
        if not call:
            raise HTTPException(status_code=404, detail="Trace not found")
        
        # Add feedback based on type
        if request.feedback_type == "thumbs_up":
            call.feedback.add_reaction("👍")
        elif request.feedback_type == "thumbs_down":
            call.feedback.add_reaction("👎")
        elif request.feedback_type == "note":
            call.feedback.add_note(request.value or "")
        else:
            raise HTTPException(status_code=400, detail="Invalid feedback type")
        
        return {"status": "success", "message": "Feedback added"}
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error adding feedback: {str(e)}")


@app.post("/api/categorize")
async def categorize_notes(request: CategorizeRequest):
    """
    Use LLM to categorize notes into failure modes.
    This implements the "Axial Coding" step from the error analysis workflow.
    """
    if not request.notes:
        return {"categories": [], "summary": "No notes to categorize"}
    
    try:
        # Build prompt for categorization
        notes_text = "\n".join([f"- {note}" for note in request.notes])
        
        prompt = f"""You are an expert at analyzing AI system failures. Given the following notes/observations about AI system behavior, identify and categorize the common failure modes.

NOTES:
{notes_text}

Your task:
1. Identify distinct failure mode categories (cluster similar issues together)
2. Give each category a clear, descriptive name
3. Provide a brief description of each category
4. List which notes belong to each category

Respond in this JSON format:
{{
    "categories": [
        {{
            "name": "Category Name",
            "description": "Brief description of this failure mode",
            "note_indices": [0, 2, 5],
            "severity": "high|medium|low",
            "suggested_fix": "Brief suggestion for addressing this issue"
        }}
    ],
    "summary": "Overall summary of the main issues found"
}}

Be specific and actionable. Focus on patterns that appear multiple times."""

        response = litellm.completion(
            model=os.getenv("CATEGORIZATION_MODEL", "gpt-4o"),
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"}
        )
        
        import json
        result = json.loads(response.choices[0].message.content)
        
        return result
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error categorizing notes: {str(e)}")


@app.get("/api/feedback-summary")
async def get_feedback_summary(
    start_time: Optional[str] = Query(None),
    end_time: Optional[str] = Query(None)
):
    """
    Get a summary of all feedback across traces.
    """
    try:
        client = get_weave_client()
        
        # Get all calls with feedback
        calls = client.get_calls(limit=500)
        
        notes = []
        thumbs_up = 0
        thumbs_down = 0
        
        for call in calls:
            # Apply time filter
            if hasattr(call, 'started_at') and call.started_at:
                started_at = call.started_at.isoformat() if hasattr(call.started_at, 'isoformat') else str(call.started_at)
                if start_time and started_at < start_time:
                    continue
                if end_time and started_at > end_time:
                    continue
            
            try:
                if hasattr(call, 'feedback'):
                    for fb in call.feedback:
                        fb_type = getattr(fb, 'feedback_type', '')
                        if 'reaction' in fb_type.lower():
                            payload = getattr(fb, 'payload', {})
                            if payload.get('emoji') == '👍':
                                thumbs_up += 1
                            elif payload.get('emoji') == '👎':
                                thumbs_down += 1
                        elif 'note' in fb_type.lower():
                            payload = getattr(fb, 'payload', {})
                            if payload.get('note'):
                                notes.append({
                                    "trace_id": call.id,
                                    "note": payload.get('note'),
                                    "op_name": call.op_name if hasattr(call, 'op_name') else "unknown"
                                })
            except Exception:
                pass
        
        return {
            "thumbs_up": thumbs_up,
            "thumbs_down": thumbs_down,
            "notes": notes,
            "total_notes": len(notes)
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching feedback summary: {str(e)}")


@app.get("/api/op-names")
async def get_op_names():
    """
    Get list of unique operation names for filtering.
    """
    try:
        client = get_weave_client()
        calls = client.get_calls(limit=500)
        
        op_names = set()
        for call in calls:
            if hasattr(call, 'op_name') and call.op_name:
                op_names.add(call.op_name)
        
        return {"op_names": sorted(list(op_names))}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching op names: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

