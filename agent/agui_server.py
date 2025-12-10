"""
AG-UI Compatible Server for TaskFlow Support Agent

This wraps the ADK agent in a FastAPI server that speaks the AG-UI protocol,
allowing our Error Analysis application to connect and test the agent.

AG-UI Protocol Events:
- RUN_STARTED: Agent run begins
- TEXT_MESSAGE_START: Start of a text message
- TEXT_MESSAGE_CHUNK: Streaming text content
- TEXT_MESSAGE_END: End of a text message
- TOOL_CALL_START: Tool invocation begins
- TOOL_CALL_ARGS: Tool arguments
- TOOL_CALL_END: Tool result
- RUN_FINISHED: Agent run complete
- RUN_ERROR: Error occurred
"""

import os
import json
import uuid
import asyncio
import warnings
import logging
from typing import Optional, AsyncGenerator

from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, PlainTextResponse
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
from customer_support import create_support_agent
from google.adk.runners import InMemoryRunner
from google.genai import types

app = FastAPI(
    title="TaskFlow Support Agent (AG-UI)",
    description="AG-UI compatible API server for the TaskFlow customer support agent",
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


class RunRequest(BaseModel):
    """Request to run the agent."""
    message: str
    thread_id: Optional[str] = None
    context: Optional[dict] = None


def create_event(event_type: str, **kwargs) -> str:
    """Create an AG-UI SSE event."""
    event = {"type": event_type, **kwargs}
    return f"data: {json.dumps(event)}\n\n"


async def run_agent_stream(message: str, thread_id: Optional[str] = None) -> AsyncGenerator[str, None]:
    """
    Run the agent and stream AG-UI events.
    
    Handles OpenTelemetry context cleanup gracefully to avoid "Failed to detach context" errors
    that occur when async generators are not fully consumed.
    """
    # Generate IDs
    run_id = f"run_{uuid.uuid4().hex[:12]}"
    message_id = f"msg_{uuid.uuid4().hex[:12]}"
    
    if not thread_id:
        thread_id = f"thread_{uuid.uuid4().hex[:12]}"
    
    # Emit RUN_STARTED
    yield create_event("RUN_STARTED", runId=run_id, threadId=thread_id)
    
    agent_gen = None  # Track the generator so we can close it properly
    
    try:
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
        
        # Emit TEXT_MESSAGE_START
        yield create_event("TEXT_MESSAGE_START", messageId=message_id, role="assistant")
        
        # Run the agent
        tool_calls = []
        response_text = ""
        
        # Create the generator
        agent_gen = runner.run_async(
            user_id=user_id,
            session_id=session_id,
            new_message=types.Content(
                role="user",
                parts=[types.Part(text=message)]
            ),
        )
        
        async for event in agent_gen:
            # Check for tool calls
            if hasattr(event, 'actions') and event.actions:
                for action in event.actions:
                    if hasattr(action, 'tool_call'):
                        tc = action.tool_call
                        tool_call_id = f"tc_{uuid.uuid4().hex[:8]}"
                        tool_name = tc.name if hasattr(tc, 'name') else str(tc)
                        tool_args = tc.args if hasattr(tc, 'args') else {}
                        
                        # Emit TOOL_CALL_START
                        yield create_event(
                            "TOOL_CALL_START",
                            toolCallId=tool_call_id,
                            toolName=tool_name
                        )
                        
                        # Emit TOOL_CALL_ARGS
                        yield create_event(
                            "TOOL_CALL_ARGS",
                            toolCallId=tool_call_id,
                            args=json.dumps(tool_args) if isinstance(tool_args, dict) else str(tool_args)
                        )
                        
                        tool_calls.append({
                            "id": tool_call_id,
                            "name": tool_name,
                            "args": tool_args
                        })
            
            # Check for tool results
            if hasattr(event, 'tool_response'):
                result = event.tool_response
                # Find the matching tool call
                if tool_calls:
                    last_tool = tool_calls[-1]
                    yield create_event(
                        "TOOL_CALL_END",
                        toolCallId=last_tool["id"],
                        result=str(result) if result else "OK"
                    )
            
            # Check for final response
            if event.is_final_response() and event.content:
                for part in event.content.parts:
                    if hasattr(part, 'text') and part.text:
                        text_chunk = part.text
                        response_text += text_chunk
                        
                        # Emit TEXT_MESSAGE_CHUNK (stream in smaller pieces for better UX)
                        chunk_size = 50
                        for i in range(0, len(text_chunk), chunk_size):
                            chunk = text_chunk[i:i+chunk_size]
                            yield create_event(
                                "TEXT_MESSAGE_CHUNK",
                                messageId=message_id,
                                content=chunk
                            )
                            await asyncio.sleep(0.02)  # Small delay for streaming effect
        
        # Generator completed naturally - mark as None so cleanup doesn't try to close it
        agent_gen = None
        
        # Emit TEXT_MESSAGE_END
        yield create_event("TEXT_MESSAGE_END", messageId=message_id)
        
        # Flush traces to ensure they're exported to Weave before responding
        # This is critical for batch execution where session sync happens immediately after
        from customer_support import flush_traces
        flush_traces(timeout_millis=2000)
        
        # Emit RUN_FINISHED
        # Return session_id as threadId since that's what Weave uses for grouping
        yield create_event(
            "RUN_FINISHED",
            runId=run_id,
            threadId=session_id,  # Use Weave session_id for filtering
            traceId=run_id
        )
        
    except GeneratorExit:
        # Client disconnected - this is expected, suppress the error
        pass
        
    except Exception as e:
        # Emit RUN_ERROR
        yield create_event(
            "RUN_ERROR",
            runId=run_id,
            message=str(e)
        )
    
    finally:
        # Properly close the agent generator to avoid OTEL context issues
        if agent_gen is not None:
            try:
                await agent_gen.aclose()
            except Exception:
                # Suppress any errors during cleanup
                pass


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "agent": "TaskFlow Support", "protocol": "AG-UI"}


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
                # Extract dimension value
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
        "protocol": "AG-UI",
        "endpoints": {
            "health": "/health",
            "agent_info": "/agent-info (GET)",
            "agent_info_json": "/agent-info/json (GET)",
            "run": "/v1/run (POST)",
            "api_run": "/api/run (POST)",
            "run_alt": "/run (POST)"
        }
    }


@app.post("/v1/run")
async def run_v1(request: RunRequest):
    """
    Run the agent with AG-UI protocol (v1 endpoint).
    Returns SSE stream of AG-UI events.
    """
    return StreamingResponse(
        run_agent_stream(request.message, request.thread_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@app.post("/api/run")
async def run_api(request: RunRequest):
    """
    Run the agent with AG-UI protocol (api endpoint).
    Returns SSE stream of AG-UI events.
    """
    return StreamingResponse(
        run_agent_stream(request.message, request.thread_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@app.post("/run")
async def run_simple(request: RunRequest):
    """
    Run the agent with AG-UI protocol (simple endpoint).
    Returns SSE stream of AG-UI events.
    """
    return StreamingResponse(
        run_agent_stream(request.message, request.thread_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("PORT", "9000"))
    print(f"🚀 Starting TaskFlow Support Agent (AG-UI) on port {port}")
    print(f"   Health: http://localhost:{port}/health")
    print(f"   Run:    http://localhost:{port}/v1/run (POST)")
    
    uvicorn.run(app, host="0.0.0.0", port=port)

