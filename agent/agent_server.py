"""
Simple HTTP Server for TaskFlow Support Agent

This is a simplified server that replaces the AG-UI protocol with a simple
request/response model. Agents only need to implement POST /query.

Endpoint Specification:
    POST /query
    Request:  {"query": "...", "thread_id": "optional"}
    Response: {"response": "...", "thread_id": "...", "error": null}
"""

import os
import uuid
import warnings
import logging
import httpx
from typing import Optional

from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Suppress the ADK app name mismatch warning (it's just a warning, not a real issue)
warnings.filterwarnings("ignore", message="App name mismatch detected")

# Suppress OpenTelemetry context detachment errors that occur on generator cleanup
logging.getLogger("opentelemetry").setLevel(logging.ERROR)

# Path to AGENT_INFO.md
AGENT_DIR = Path(__file__).parent
AGENT_INFO_PATH = AGENT_DIR / "AGENT_INFO.md"

load_dotenv()

# Import the agent
from customer_support import create_support_agent, flush_traces
from google.adk.runners import InMemoryRunner
from google.genai import types

app = FastAPI(
    title="TaskFlow Support Agent",
    description="Simple HTTP API server for the TaskFlow customer support agent",
    version="1.0.0"
)

# Enable CORS for our frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global state for sessions
sessions = {}

# Backend URL for fetching API key from settings
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")


async def ensure_api_key():
    """Fetch OpenAI API key from backend settings if not already set."""
    if os.environ.get("OPENAI_API_KEY"):
        return True
    
    try:
        async with httpx.AsyncClient() as client:
            # Fetch the API key from backend settings
            response = await client.get(f"{BACKEND_URL}/api/settings/llm-api-key", timeout=5.0)
            if response.status_code == 200:
                data = response.json()
                api_key = data.get("api_key")
                if api_key:
                    os.environ["OPENAI_API_KEY"] = api_key
                    return True
    except Exception as e:
        logging.warning(f"Failed to fetch API key from backend: {e}")
    
    return False


class QueryRequest(BaseModel):
    """Request to query the agent."""
    query: str
    thread_id: Optional[str] = None


class QueryResponse(BaseModel):
    """Response from the agent."""
    response: str
    thread_id: Optional[str] = None
    error: Optional[str] = None


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "agent": "TaskFlow Support"}


@app.get("/agent-info")
async def get_agent_info():
    """
    Get the AGENT_INFO.md content.
    This provides context about the agent for the Error Analysis application.
    """
    if not AGENT_INFO_PATH.exists():
        raise HTTPException(status_code=404, detail="AGENT_INFO.md not found")
    
    content = AGENT_INFO_PATH.read_text()
    return PlainTextResponse(content, media_type="text/markdown")


@app.get("/agent-info/json")
async def get_agent_info_json():
    """
    Get the AGENT_INFO as parsed JSON (basic parsing).
    Extracts key sections for programmatic access.
    """
    if not AGENT_INFO_PATH.exists():
        raise HTTPException(status_code=404, detail="AGENT_INFO.md not found")
    
    content = AGENT_INFO_PATH.read_text()
    
    # Basic parsing of AGENT_INFO.md
    info = {
        "name": "TaskFlow Support Agent",
        "version": "1.0.0",
        "type": "Customer Support",
        "framework": "Google ADK",
        "raw_content": content
    }
    
    # Extract sections
    sections = {}
    current_section = None
    current_content = []
    
    for line in content.split('\n'):
        if line.startswith('## '):
            if current_section:
                sections[current_section] = '\n'.join(current_content).strip()
            current_section = line[3:].strip()
            current_content = []
        elif current_section:
            current_content.append(line)
    
    if current_section:
        sections[current_section] = '\n'.join(current_content).strip()
    
    info["sections"] = sections
    
    # Extract testing dimensions if present
    if "Testing Dimensions" in sections:
        dims_text = sections["Testing Dimensions"]
        dimensions = []
        current_dim = None
        
        for line in dims_text.split('\n'):
            if line.startswith('### '):
                if current_dim:
                    dimensions.append(current_dim)
                current_dim = {"name": line[4:].strip(), "values": []}
            elif line.startswith('- **') and current_dim:
                value = line.split('**')[1] if '**' in line else line[2:].strip()
                current_dim["values"].append(value)
        
        if current_dim:
            dimensions.append(current_dim)
        
        info["testing_dimensions"] = dimensions
    
    return info


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "TaskFlow Support Agent",
        "version": "1.0.0",
        "endpoints": {
            "health": "GET /health",
            "query": "POST /query",
            "agent_info": "GET /agent-info",
            "agent_info_json": "GET /agent-info/json"
        }
    }


@app.post("/query", response_model=QueryResponse)
async def query(request: QueryRequest):
    """
    Run a query against the agent.
    
    This is the main endpoint for interacting with the agent.
    Simple request/response model - no streaming, no SSE.
    """
    try:
        # Ensure API key is available (fetch from backend settings if needed)
        if not await ensure_api_key():
            return QueryResponse(
                response="",
                thread_id=None,
                error="OpenAI API key not configured. Please set it in Settings → LLM Configuration."
            )
        
        # Get or create thread ID
        thread_id = request.thread_id or f"thread_{uuid.uuid4().hex[:12]}"
        
        # Get or create session
        if thread_id not in sessions:
            agent = create_support_agent()
            runner = InMemoryRunner(agent=agent, app_name="taskflow_support")
            user_id = f"user_{uuid.uuid4().hex[:8]}"
            session_id = f"session_{uuid.uuid4().hex[:8]}"
            
            await runner.session_service.create_session(
                app_name="taskflow_support",
                user_id=user_id,
                session_id=session_id,
            )
            
            sessions[thread_id] = {
                "runner": runner,
                "user_id": user_id,
                "session_id": session_id
            }
        
        session = sessions[thread_id]
        runner = session["runner"]
        user_id = session["user_id"]
        session_id = session["session_id"]
        
        # Run the agent and collect the full response
        response_text = ""
        
        async for event in runner.run_async(
            user_id=user_id,
            session_id=session_id,
            new_message=types.Content(
                role="user",
                parts=[types.Part(text=request.query)]
            ),
        ):
            # Collect final response text
            if event.is_final_response() and event.content:
                for part in event.content.parts:
                    if hasattr(part, 'text') and part.text:
                        response_text += part.text
        
        # Flush traces to ensure they're exported to Weave
        flush_traces(timeout_millis=2000)
        
        return QueryResponse(
            response=response_text,
            thread_id=session_id,  # Return Weave session_id for filtering
            error=None
        )
        
    except Exception as e:
        return QueryResponse(
            response="",
            thread_id=None,
            error=str(e)
        )


if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("PORT", "9000"))
    print(f"🚀 Starting TaskFlow Support Agent on port {port}")
    print(f"   Health: http://localhost:{port}/health")
    print(f"   Query:  http://localhost:{port}/query (POST)")
    
    uvicorn.run(app, host="0.0.0.0", port=port)

