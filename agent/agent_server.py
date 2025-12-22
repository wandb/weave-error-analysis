"""
Simple HTTP Server for TaskFlow Support Agent

This is a simplified server that replaces the AG-UI protocol with a simple
request/response model. Agents only need to implement POST /query.

Endpoint Specification:
    POST /query
    Request:  {"query": "..."}
    Response: {"response": "...", "error": null}

The agent is a black box: query in → response out. That's it.
The error analysis application handles all the complexity of trace linkage.
"""

import os
import uuid
import warnings
import logging

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

# Load .env from project root (one directory up from agent/)
load_dotenv(AGENT_DIR.parent / ".env")

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


class QueryRequest(BaseModel):
    """Request to query the agent."""
    query: str
    # Optional: batch_id is passed by the error analysis backend but can be ignored.
    # The backend handles batch attribution via weave.attributes() before calling us.
    batch_id: str | None = None


class QueryResponse(BaseModel):
    """Response from the agent."""
    response: str
    error: str | None = None


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
    Simple request/response model - query in, response out.
    
    The error analysis backend handles batch attribution via weave.attributes()
    before calling this endpoint, so we don't need to do anything special here.
    
    Requires OPENAI_API_KEY environment variable to be set.
    """
    try:
        # Check for API key
        if not os.environ.get("OPENAI_API_KEY"):
            return QueryResponse(
                response="",
                error="OPENAI_API_KEY not set. Please add it to your .env file and restart."
            )
        
        # Create a new session for each query (single-turn)
        agent = create_support_agent()
        runner = InMemoryRunner(agent=agent, app_name="taskflow_support")
        user_id = f"user_{uuid.uuid4().hex[:8]}"
        session_id = f"session_{uuid.uuid4().hex[:8]}"
        
        await runner.session_service.create_session(
            app_name="taskflow_support",
            user_id=user_id,
            session_id=session_id,
        )
        
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
            error=None
        )
        
    except Exception as e:
        return QueryResponse(
            response="",
            error=str(e)
        )


if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("PORT", "9000"))
    print(f"🚀 Starting TaskFlow Support Agent on port {port}")
    print(f"   Health: http://localhost:{port}/health")
    print(f"   Query:  http://localhost:{port}/query (POST)")
    
    uvicorn.run(app, host="0.0.0.0", port=port)
