# Drop AG-UI Protocol: Simplification Plan

## Summary

The AG-UI protocol was originally adopted to enable real-time streaming of agent responses and tool call visualization. However, after reflection, we don't actually need this complexity because:

1. **We're not modifying UI based on agent actions** - We don't need to show tool calls in real-time
2. **Batch execution is the primary use case** - We're mostly running synthetic queries in batch, not interactive chat
3. **Simple request/response is sufficient** - All we need is: `def response(query: str) -> str:`

This document outlines the plan to remove AG-UI and replace it with a simple HTTP API.

---

## Current Architecture (AG-UI)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CURRENT: AG-UI PROTOCOL                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Frontend                     Backend                      Agent Server      │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐          │
│  │ AgentsTab.tsx   │    │ AGUIClient      │    │ agui_server.py  │          │
│  │                 │    │                 │    │                 │          │
│  │ • SSE listener  │◄───│ • SSE parser    │◄───│ • SSE emitter   │          │
│  │ • text_chunk    │    │ • Event types   │    │ • Event types   │          │
│  │ • tool_start    │    │ • Streaming     │    │ • Streaming     │          │
│  │ • tool_args     │    │                 │    │                 │          │
│  │ • tool_end      │    │ 489 lines       │    │ 407 lines       │          │
│  │ • error/done    │    │                 │    │                 │          │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘          │
│                                                                              │
│  Complexity:                                                                 │
│  • 10+ event types to handle                                                 │
│  • SSE streaming infrastructure                                              │
│  • Tool call visualization state management                                  │
│  • Multiple endpoint fallbacks (/v1/run, /api/run, /run)                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Target Architecture (Simple HTTP)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TARGET: SIMPLE HTTP API                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Frontend                     Backend                      Agent Server      │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐          │
│  │ AgentsTab.tsx   │    │ SimpleClient    │    │ agent_server.py │          │
│  │                 │    │                 │    │                 │          │
│  │ • fetch()       │───►│ • POST request  │───►│ POST /query     │          │
│  │ • await JSON    │◄───│ • JSON response │◄───│ response: str   │          │
│  │                 │    │                 │    │                 │          │
│  │                 │    │ ~100 lines      │    │ ~100 lines      │          │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘          │
│                                                                              │
│  Simplicity:                                                                 │
│  • Single endpoint: POST /query                                              │
│  • Simple JSON request/response                                              │
│  • No streaming, no SSE                                                      │
│  • No tool call state management                                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## User-Facing Agent Requirements

### Before (AG-UI)
Users had to expose an AG-UI compatible endpoint with SSE streaming:

```python
# Complex: SSE streaming with multiple event types
@app.post("/v1/run")
async def run(request: RunRequest):
    async def event_stream():
        yield f"data: {json.dumps({'type': 'RUN_STARTED'})}\n\n"
        # ... run agent ...
        for chunk in response:
            yield f"data: {json.dumps({'type': 'TEXT_MESSAGE_CHUNK', 'content': chunk})}\n\n"
        yield f"data: {json.dumps({'type': 'RUN_FINISHED'})}\n\n"
    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

### After (Simple HTTP)
Users only need to expose a simple endpoint:

```python
# Simple: Just return a string
@app.post("/query")
async def query(request: QueryRequest) -> QueryResponse:
    response = await agent.run(request.query)
    return QueryResponse(response=response)

# Or even simpler with function signature:
# def response(query: str) -> str:
#     return agent.run(query)
```

### Endpoint Specification

**Request:**
```http
POST /query
Content-Type: application/json

{
    "query": "What's the pricing for the Pro plan?",
    "thread_id": "optional-for-multi-turn"  // optional
}
```

**Response:**
```json
{
    "response": "The Pro plan costs $9/month or $89/year...",
    "thread_id": "session_abc123",  // optional
    "error": null  // or error message if failed
}
```

---

## Files to Modify

### Backend Changes

#### 1. `backend/services/agui_client.py` → `backend/services/agent_client.py`

**Current (489 lines):**
- SSE streaming
- 10+ event types (TEXT_MESSAGE_CHUNK, TOOL_CALL_START, etc.)
- Event parsing and normalization
- AsyncGenerator streaming

**Target (~80 lines):**
```python
"""Simple HTTP client for connecting to user's agent endpoints."""

import httpx
from typing import Optional, Dict, Any
from pydantic import BaseModel

class QueryRequest(BaseModel):
    query: str
    thread_id: Optional[str] = None

class QueryResponse(BaseModel):
    response: str
    thread_id: Optional[str] = None
    error: Optional[str] = None

class AgentClient:
    """Simple HTTP client for agent communication."""
    
    def __init__(self, endpoint_url: str, timeout: float = 120.0):
        self.endpoint_url = endpoint_url.rstrip('/')
        self.timeout = timeout
    
    async def health_check(self) -> Dict[str, Any]:
        """Check if agent endpoint is reachable."""
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(f"{self.endpoint_url}/health", timeout=10.0)
                return {"healthy": resp.status_code == 200}
            except Exception as e:
                return {"healthy": False, "error": str(e)}
    
    async def query(
        self, 
        query: str, 
        thread_id: Optional[str] = None
    ) -> QueryResponse:
        """Send a query to the agent and get the response."""
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    f"{self.endpoint_url}/query",
                    json={"query": query, "thread_id": thread_id},
                    timeout=self.timeout
                )
                resp.raise_for_status()
                data = resp.json()
                return QueryResponse(
                    response=data.get("response", ""),
                    thread_id=data.get("thread_id"),
                    error=None
                )
            except Exception as e:
                return QueryResponse(response="", error=str(e))
    
    async def get_agent_info(self) -> Dict[str, Any]:
        """Fetch AGENT_INFO from the agent endpoint."""
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(f"{self.endpoint_url}/agent-info", timeout=10.0)
                if resp.status_code == 200:
                    return {"raw_content": resp.text}
            except:
                pass
            return {"error": "Agent does not expose AGENT_INFO"}
```

#### 2. `backend/routers/agents.py`

**Remove:**
- SSE streaming endpoints
- `run_agent()` streaming function
- Event generator code

**Keep/Modify:**
- `run_agent_sync()` → rename to `run_agent()`, simplify
- Health check endpoints
- CRUD operations (unchanged)

**Changes:**
```python
# BEFORE (streaming)
@router.post("/agents/{agent_id}/run")
async def run_agent(agent_id: str, request: RunAgentRequest):
    async def event_generator():
        async for event in client.run(...):
            yield f"data: {json.dumps(event)}\n\n"
    return StreamingResponse(event_generator(), media_type="text/event-stream")

# AFTER (simple)
@router.post("/agents/{agent_id}/run")
async def run_agent(agent_id: str, request: RunAgentRequest):
    client = AgentClient(endpoint_url)
    result = await client.query(request.message, request.thread_id)
    return {
        "success": result.error is None,
        "response": result.response,
        "thread_id": result.thread_id,
        "error": result.error
    }
```

#### 3. `backend/services/batch_executor.py`

**Simplify:**
- Remove AG-UI event parsing
- Use simple `client.query()` instead of `client.run_sync()`
- Keep progress streaming for batch execution (this is our own SSE, not AG-UI)

**Changes:**
```python
# BEFORE
result = await self.client.run_sync(query_text)

# AFTER  
from services.agent_client import AgentClient
result = await self.client.query(query_text)
```

### Agent Server Changes

#### 4. `agent/agui_server.py` → `agent/agent_server.py`

**Current (407 lines):**
- SSE streaming with multiple event types
- AG-UI protocol compliance
- Tool call event emission

**Target (~150 lines):**
```python
"""Simple HTTP server for TaskFlow Support Agent."""

import os
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv

from customer_support import create_support_agent
from google.adk.runners import InMemoryRunner
from google.genai import types

load_dotenv()

app = FastAPI(title="TaskFlow Support Agent")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Session storage
sessions = {}

class QueryRequest(BaseModel):
    query: str
    thread_id: Optional[str] = None

class QueryResponse(BaseModel):
    response: str
    thread_id: Optional[str] = None
    error: Optional[str] = None

@app.get("/health")
async def health():
    return {"status": "healthy", "agent": "TaskFlow Support"}

@app.get("/agent-info")
async def get_agent_info():
    path = Path(__file__).parent / "AGENT_INFO.md"
    if path.exists():
        return PlainTextResponse(path.read_text(), media_type="text/markdown")
    raise HTTPException(404, "AGENT_INFO.md not found")

@app.post("/query", response_model=QueryResponse)
async def query(request: QueryRequest):
    """Run a query against the agent."""
    try:
        # Get or create session
        thread_id = request.thread_id or f"thread_{uuid.uuid4().hex[:12]}"
        
        if thread_id not in sessions:
            agent = create_support_agent()
            runner = InMemoryRunner(agent=agent, app_name="taskflow_support")
            # ... setup session ...
            sessions[thread_id] = {"runner": runner, ...}
        
        session = sessions[thread_id]
        
        # Run agent
        response_text = ""
        async for event in session["runner"].run_async(...):
            if event.is_final_response() and event.content:
                for part in event.content.parts:
                    if hasattr(part, 'text'):
                        response_text += part.text
        
        return QueryResponse(response=response_text, thread_id=thread_id)
        
    except Exception as e:
        return QueryResponse(response="", error=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9000)
```

### Frontend Changes

#### 5. `frontend/src/app/components/tabs/AgentsTab.tsx`

**Remove:**
- SSE event listener code
- Tool call state management (`playgroundToolCalls`)
- Event log display
- Tool call visualization UI

**Simplify:**
```typescript
// BEFORE: SSE streaming with event handling
const runAgentQuery = async (message: string) => {
  const response = await fetch(`/api/agents/${id}/run`, {...});
  const reader = response.body?.getReader();
  while (true) {
    // Parse SSE events, handle text_chunk, tool_start, etc.
  }
};

// AFTER: Simple fetch
const runAgentQuery = async (message: string) => {
  const response = await fetch(`/api/agents/${id}/run`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
  const data = await response.json();
  setPlaygroundResponse(data.response);
  if (data.error) setPlaygroundError(data.error);
};
```

**UI Simplification:**
- Remove tool call cards
- Remove event log section
- Keep simple input → response display

#### 6. `frontend/src/app/lib/api.ts`

**Remove:**
- `streamSSE()` helper function
- SSE-related types

---

## Documentation Updates

### PLAN.md Updates

Update Phase 2 section to reflect simplified architecture:

```markdown
### Phase 2: Agent Integration (Simplified)
**Goal**: Connect to user's externally-hosted agents using simple HTTP.

**User's Agent Requirements:**
- Expose `POST /query` endpoint
- Accept: `{"query": "...", "thread_id": "optional"}`
- Return: `{"response": "...", "thread_id": "...", "error": null}`
- Optionally expose `GET /health` and `GET /agent-info`

**Backend Changes:**
1. Simple HTTP client (`backend/services/agent_client.py`)
2. `POST /api/agents/{id}/run` - Non-streaming query endpoint
3. Health check endpoint (unchanged)
```

### AGENT_INFO.md Template Update

Add simpler endpoint documentation:

```markdown
## Required Endpoints

### POST /query
Main endpoint for running queries.

**Request:**
```json
{"query": "user question", "thread_id": "optional"}
```

**Response:**
```json
{"response": "agent answer", "thread_id": "session_id", "error": null}
```

### GET /health (Optional)
Health check endpoint.

### GET /agent-info (Optional)
Returns AGENT_INFO.md content.
```

---

## Migration Steps

### Step 1: Create Simple Agent Client
1. Create `backend/services/agent_client.py` with simple HTTP client
2. Keep `agui_client.py` temporarily for reference

### Step 2: Update Backend Routers
1. Modify `routers/agents.py` to use new client
2. Remove streaming endpoints, keep simple POST
3. Update `batch_executor.py` to use new client

### Step 3: Update Agent Server
1. Rename `agui_server.py` → `agent_server.py`
2. Replace SSE endpoints with simple `/query`
3. Keep `/health` and `/agent-info`

### Step 4: Simplify Frontend
1. Remove SSE handling from `AgentsTab.tsx`
2. Simplify playground to input/output only
3. Remove tool call visualization
4. Remove `streamSSE()` from `api.ts`

### Step 5: Cleanup
1. Delete `agui_client.py`
2. Update imports throughout codebase
3. Update PLAN.md documentation

---

## Code Reduction Summary

| Component | Before (lines) | After (lines) | Reduction |
|-----------|---------------|---------------|-----------|
| `agui_client.py` → `agent_client.py` | 489 | ~80 | -83% |
| `agui_server.py` → `agent_server.py` | 407 | ~150 | -63% |
| `routers/agents.py` (run endpoints) | ~120 | ~30 | -75% |
| `AgentsTab.tsx` (playground) | ~200 | ~50 | -75% |
| **Total** | ~1200 | ~300 | **-75%** |

---

## Benefits

1. **Simpler user onboarding** - Users only need to implement one endpoint
2. **Less code to maintain** - ~75% reduction in protocol handling code
3. **Easier debugging** - Standard HTTP request/response, no SSE parsing
4. **Better compatibility** - Works with any HTTP framework
5. **No streaming overhead** - Faster for short responses

---

## What We Keep

1. **SSE for batch execution progress** - This is our internal streaming, not AG-UI
2. **SSE for synthetic data generation** - Same as above
3. **Health checks** - Simple GET endpoint
4. **AGENT_INFO endpoint** - For fetching agent metadata

---

## Streaming Clarification

### Two Types of Streaming (Important!)

There's a crucial distinction between:

1. **Agent → Us Streaming** (AG-UI) - **REMOVING**
   - The agent streams SSE events to our backend
   - Events: TEXT_MESSAGE_CHUNK, TOOL_CALL_START, etc.
   - Requires agent to implement SSE streaming
   - **We don't need this!**

2. **Our Backend → Frontend Streaming** (Internal) - **KEEPING**
   - Our backend streams progress to our frontend
   - Events: `{completed: 5, total: 20, status: "running"}`
   - Independent of what the agent does
   - **This is our own implementation, unaffected by this change**

### Can We Stream Without AG-UI?

**Yes!** AG-UI is just one streaming protocol. We can:
- Define our own simpler streaming format (if needed)
- Or simply not require agents to stream at all

### Is Streaming Dependent on Agent Framework?

**No!** Because we're not requiring agents to stream to us:

```
BEFORE (AG-UI):
Agent (must stream) ──SSE──► Backend (parse) ──SSE──► Frontend

AFTER (Simple):
Agent (just respond) ──JSON──► Backend (forward) ──SSE──► Frontend
                       │                           │
                       └── No streaming needed ────┘
                                                   └── Our streaming stays
```

### How Dependent Is Our App on Streaming?

**Very little from agents, a lot internally:**

| Feature | Agent Streaming Needed? | Our Streaming Needed? |
|---------|------------------------|----------------------|
| Batch execution progress | ❌ No | ✅ Yes |
| Synthetic data generation | ❌ No | ✅ Yes |
| Playground (manual testing) | ❌ No (just wait for response) | ❌ No |
| Session sync | ❌ No | ❌ No |

**Conclusion:** We only need agents to provide a simple request/response endpoint. 
All our internal streaming (progress bars, etc.) continues to work independently.

---

## Timeline

| Task | Effort | Priority |
|------|--------|----------|
| Create `agent_client.py` | 1 hour | P0 |
| Update `batch_executor.py` | 30 min | P0 |
| Simplify `routers/agents.py` | 1 hour | P0 |
| Simplify `agent_server.py` | 1 hour | P0 |
| Simplify `AgentsTab.tsx` | 2 hours | P1 |
| Update documentation | 1 hour | P2 |
| Cleanup old files | 30 min | P2 |

**Total: ~7 hours**

