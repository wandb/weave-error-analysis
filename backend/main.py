"""
Backend Service for Error Analysis Workflow

Uses Weave Trace API (https://trace.wandb.ai) to query traces and feedback.
"""

import os
import base64
import httpx
from datetime import datetime
from typing import Optional
from dotenv import load_dotenv

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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

# Configuration
WANDB_API_KEY = os.getenv("WANDB_API_KEY")
WANDB_ENTITY = os.getenv("WANDB_ENTITY")
WEAVE_PROJECT = os.getenv("WEAVE_PROJECT", "error-analysis-demo")
PROJECT_ID = f"{WANDB_ENTITY}/{WEAVE_PROJECT}" if WANDB_ENTITY else WEAVE_PROJECT

# Weave Trace API
WEAVE_API_BASE = "https://trace.wandb.ai"


def get_auth_header() -> dict:
    """Get HTTP Basic auth header for Weave API."""
    if not WANDB_API_KEY:
        return {}
    auth = base64.b64encode(f"api:{WANDB_API_KEY}".encode()).decode()
    return {
        "Authorization": f"Basic {auth}",
        "Content-Type": "application/json"
    }


# Pydantic models
class CategorizeRequest(BaseModel):
    notes: list[str]


class FeedbackRequest(BaseModel):
    trace_id: str
    feedback_type: str
    value: Optional[str] = None


# API Endpoints
@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "error-analysis-backend",
        "project": PROJECT_ID
    }


@app.get("/api/traces")
async def get_traces(
    start_time: Optional[str] = Query(None, description="ISO format start time"),
    end_time: Optional[str] = Query(None, description="ISO format end time"),
    op_name: Optional[str] = Query(None, description="Filter by operation name"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0)
):
    """Get list of traces from Weave using /calls/stream_query."""
    try:
        # Build filter
        filter_obj = {}
        if op_name:
            filter_obj["op_names"] = [op_name]
        
        # NOTE: Weave API does not support time filtering directly in query
        # Time filtering should be done client-side or via different endpoint
        # For now, we fetch all traces and the frontend can filter if needed
        
        request_body = {
            "project_id": PROJECT_ID,
            "limit": limit,
            "offset": offset,
            "sort_by": [{"field": "started_at", "direction": "desc"}]
        }
        
        if filter_obj:
            request_body["filter"] = filter_obj
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{WEAVE_API_BASE}/calls/stream_query",
                headers=get_auth_header(),
                json=request_body,
                timeout=30.0
            )
            
            if response.status_code != 200:
                print(f"Weave API error: {response.status_code} - {response.text}")
                return {
                    "traces": [],
                    "total_count": 0,
                    "error": f"API error: {response.status_code}"
                }
            
            # Parse JSONL response
            traces = []
            for line in response.text.strip().split("\n"):
                if line:
                    import json
                    call = json.loads(line)
                    traces.append({
                        "id": call.get("id"),
                        "op_name": call.get("op_name", "unknown"),
                        "started_at": call.get("started_at"),
                        "ended_at": call.get("ended_at"),
                        "status": "error" if call.get("exception") else "success",
                        "inputs_preview": _truncate_dict(call.get("inputs", {})),
                        "has_exception": call.get("exception") is not None,
                        "trace_id": call.get("trace_id"),
                        "parent_id": call.get("parent_id")
                    })
            
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


@app.get("/api/traces/{trace_id}")
async def get_trace_detail(trace_id: str):
    """Get detailed information about a specific trace using /call/read."""
    try:
        request_body = {
            "project_id": PROJECT_ID,
            "id": trace_id
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{WEAVE_API_BASE}/call/read",
                headers=get_auth_header(),
                json=request_body,
                timeout=30.0
            )
            
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail=f"API error: {response.text}")
            
            import json
            data = response.json()
            call = data.get("call")
            
            if not call:
                raise HTTPException(status_code=404, detail="Trace not found")
            
            # Get child calls
            children = await _get_child_calls(trace_id)
            
            # Get feedback for this call
            feedback = await _get_feedback_for_call(trace_id)
            
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


async def _get_child_calls(parent_id: str) -> list:
    """Get child calls for a trace."""
    try:
        request_body = {
            "project_id": PROJECT_ID,
            "filter": {"parent_ids": [parent_id]},
            "limit": 50
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{WEAVE_API_BASE}/calls/stream_query",
                headers=get_auth_header(),
                json=request_body,
                timeout=30.0
            )
            
            if response.status_code != 200:
                return []
            
            children = []
            import json
            for line in response.text.strip().split("\n"):
                if line:
                    call = json.loads(line)
                    children.append({
                        "id": call.get("id"),
                        "op_name": call.get("op_name"),
                        "started_at": call.get("started_at"),
                        "ended_at": call.get("ended_at"),
                        "inputs_preview": _truncate_dict(call.get("inputs", {})),
                        "output_preview": _truncate_value(call.get("output"))
                    })
            
            return children
    except Exception:
        return []


async def _get_feedback_for_call(call_id: str) -> list:
    """Get feedback for a specific call."""
    try:
        # Build weave ref for the call
        weave_ref = f"weave:///{PROJECT_ID}/call/{call_id}"
        
        request_body = {
            "project_id": PROJECT_ID,
            "query": {
                "$expr": {
                    "$eq": [
                        {"$getField": "weave_ref"},
                        {"$literal": weave_ref}
                    ]
                }
            }
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{WEAVE_API_BASE}/feedback/query",
                headers=get_auth_header(),
                json=request_body,
                timeout=30.0
            )
            
            if response.status_code != 200:
                return []
            
            data = response.json()
            feedback_list = []
            for fb in data.get("result", []):
                feedback_list.append({
                    "id": fb.get("id"),
                    "type": fb.get("feedback_type"),
                    "payload": fb.get("payload"),
                    "created_at": fb.get("created_at")
                })
            
            return feedback_list
    except Exception as e:
        print(f"Error fetching feedback: {e}")
        return []


def _truncate_dict(d: dict, max_length: int = 100) -> dict:
    """Truncate dictionary values for preview."""
    if not d:
        return {}
    result = {}
    for k, v in list(d.items())[:5]:  # Limit to 5 keys
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
        return [_truncate_value(item, max_length) for item in v[:3]]
    return v


@app.post("/api/traces/{trace_id}/feedback")
async def add_feedback(trace_id: str, request: FeedbackRequest):
    """Add feedback to a trace using /feedback/create."""
    try:
        weave_ref = f"weave:///{PROJECT_ID}/call/{trace_id}"
        
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
        
        request_body = {
            "project_id": PROJECT_ID,
            "weave_ref": weave_ref,
            "feedback_type": feedback_type,
            "payload": payload
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{WEAVE_API_BASE}/feedback/create",
                headers=get_auth_header(),
                json=request_body,
                timeout=30.0
            )
            
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail=f"API error: {response.text}")
            
            data = response.json()
            return {
                "status": "success",
                "feedback_id": data.get("id"),
                "message": "Feedback added"
            }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/categorize")
async def categorize_notes(request: CategorizeRequest):
    """Use LLM to categorize notes into failure modes."""
    if not request.notes:
        return {"categories": [], "summary": "No notes to categorize"}
    
    try:
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
            model=os.getenv("CATEGORIZATION_MODEL", "gpt-4o-mini"),
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
    """Get summary of all feedback using /feedback/query."""
    try:
        request_body = {
            "project_id": PROJECT_ID,
            "limit": 500
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{WEAVE_API_BASE}/feedback/query",
                headers=get_auth_header(),
                json=request_body,
                timeout=30.0
            )
            
            if response.status_code != 200:
                return {"thumbs_up": 0, "thumbs_down": 0, "notes": [], "total_notes": 0}
            
            data = response.json()
            
            thumbs_up = 0
            thumbs_down = 0
            notes = []
            
            for fb in data.get("result", []):
                fb_type = fb.get("feedback_type", "")
                payload = fb.get("payload", {})
                
                if "reaction" in fb_type:
                    emoji = payload.get("emoji", "")
                    if emoji == "👍":
                        thumbs_up += 1
                    elif emoji == "👎":
                        thumbs_down += 1
                elif "note" in fb_type:
                    note_text = payload.get("note", "")
                    if note_text:
                        notes.append({
                            "note": note_text,
                            "trace_id": fb.get("weave_ref", "").split("/")[-1] if fb.get("weave_ref") else "",
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
        return {"thumbs_up": 0, "thumbs_down": 0, "notes": [], "total_notes": 0, "error": str(e)}


@app.get("/api/op-names")
async def get_op_names():
    """Get list of unique operation names."""
    try:
        # Fetch traces and extract unique op names
        request_body = {
            "project_id": PROJECT_ID,
            "limit": 200
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{WEAVE_API_BASE}/calls/stream_query",
                headers=get_auth_header(),
                json=request_body,
                timeout=30.0
            )
            
            if response.status_code != 200:
                return {"op_names": []}
            
            op_names = set()
            import json
            for line in response.text.strip().split("\n"):
                if line:
                    call = json.loads(line)
                    op_name = call.get("op_name")
                    if op_name:
                        op_names.add(op_name)
            
            return {"op_names": sorted(list(op_names))}
    
    except Exception as e:
        return {"op_names": [], "error": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
