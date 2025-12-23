"""
Simple HTTP Server for TaskFlow Support Agent

This is a simplified server that replaces the AG-UI protocol with a simple
request/response model. Agents only need to implement POST /query.

Endpoint Specification:
    POST /query
    Request:  {"query": "...", "batch_id": "..."}
    Response: {"response": "...", "error": null}

The agent is a black box: query in → response out. That's it.

Batch Attribution:
    When batch_id is provided, we wrap the agent execution in weave.attributes()
    so ALL traces from the agent (including internal LLM calls) inherit the batch_id.
    This enables filtering by batch in Weave UI.
"""

import os
import uuid
import warnings
import logging

import weave
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Suppress the ADK app name mismatch warning (it's just a warning, not a real issue)
warnings.filterwarnings("ignore", message="App name mismatch detected")

# Suppress OpenTelemetry context detachment errors that occur on generator cleanup
logging.getLogger("opentelemetry").setLevel(logging.ERROR)

AGENT_DIR = Path(__file__).parent

# Load .env from project root (one directory up from agent/)
load_dotenv(AGENT_DIR.parent / ".env")

# Import the agent
from customer_support import create_support_agent, flush_traces
from google.adk.runners import InMemoryRunner
from google.genai import types

# Initialize Weave for agent tracing
# This project is where the agent's traces will be logged
WEAVE_PROJECT = os.getenv("WEAVE_PROJECT", "error-analysis-demo")
weave.init(WEAVE_PROJECT)

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
    # For granular trace linking - allows linking each query to its specific trace
    batch_id: str | None = None
    query_id: str | None = None


class QueryResponse(BaseModel):
    """Response from the agent."""
    response: str
    error: str | None = None


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "agent": "TaskFlow Support"}


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "TaskFlow Support Agent",
        "version": "1.0.0",
        "endpoints": {
            "health": "GET /health",
            "query": "POST /query"
        }
    }


@weave.op(name="run_agent")
async def run_agent(query: str) -> str:
    """
    Run the agent with a query and return the response.
    
    Decorated with @weave.op so all internal agent traces (LLM calls, tool calls, etc.)
    appear as children of this trace. When called within weave.attributes(), all
    child traces inherit those attributes (like batch_id).
    
    Args:
        query: The user's query string
    
    Returns:
        The agent's response text
    """
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
            parts=[types.Part(text=query)]
        ),
    ):
        # Collect final response text
        if event.is_final_response() and event.content:
            for part in event.content.parts:
                if hasattr(part, 'text') and part.text:
                    response_text += part.text
    
    # Flush traces to ensure they're exported to Weave
    flush_traces(timeout_millis=2000)
    
    return response_text


@app.post("/query", response_model=QueryResponse)
async def query(request: QueryRequest):
    """
    Run a query against the agent.
    
    This is the main endpoint for interacting with the agent.
    Simple request/response model - query in, response out.
    
    If batch_id is provided, wraps the agent execution in weave.attributes()
    so ALL traces from the agent inherit the batch_id for filtering in Weave UI.
    
    Requires OPENAI_API_KEY environment variable to be set.
    """
    try:
        # Check for API key
        if not os.environ.get("OPENAI_API_KEY"):
            return QueryResponse(
                response="",
                error="OPENAI_API_KEY not set. Please add it to your .env file and restart."
            )
        
        # Run agent with trace linking attributes
        if request.batch_id:
            attrs = {"batch_id": request.batch_id}
            if request.query_id:
                attrs["query_id"] = request.query_id
            with weave.attributes(attrs):
                response_text = await run_agent(request.query)
        else:
            response_text = await run_agent(request.query)
        
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
