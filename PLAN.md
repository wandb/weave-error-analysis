# Error Analysis Application Enhancement Plan

## Executive Summary

This document outlines the plan to enhance the Error Analysis application by:
1. Connecting user agents via the AG-UI protocol
2. Introducing an AGENT_INFO.md documentation protocol
3. Enabling synthetic data generation with dimensions
4. Automating trace review with LLM assistance
5. Creating an iterative improvement loop

---

## Part 1: Analysis

### 1.1 Current Workflow Analysis

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CURRENT WORKFLOW                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  [User's Agent] ──────→ [Weave Traces] ──────→ [Our App/Weave UI]           │
│       │                      │                       │                       │
│       │                      │                       ▼                       │
│  Instrumented            Logged              Manual Review                   │
│  with Weave              traces              (notes, feedback)               │
│                                                      │                       │
│                                                      ▼                       │
│                                              Categorization                  │
│                                              (Failure Modes)                 │
│                                                      │                       │
│                                                      ▼                       │
│                                              Manual Action                   │
│                                              (Fix the agent)                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Current Pain Points:**
1. **Manual Query Generation**: Users run agents with ad-hoc queries or alpha tester data
2. **No Agent Context**: Application has no understanding of what the agent is designed to do
3. **Manual Review Only**: All trace review is done manually
4. **No Iteration Tracking**: Can't measure improvement across agent versions
5. **Disconnected Workflow**: Agent → Traces → Review → Fix is fragmented

### 1.2 AG-UI Protocol Analysis

The AG-UI (Agent-UI) protocol is designed to connect AI agents to user interfaces with:

**Core Concepts:**
- **Event-Driven Streaming**: Real-time communication between agent and UI
- **Key Events**: `RUN_STARTED`, `TEXT_MESSAGE_CHUNK`, `TOOL_CALL_CHUNK`, `RUN_FINISHED`, `RUN_ERROR`
- **Human-in-the-Loop**: Agents can request human input, pause for confirmation
- **Tool System**: Tools bridge AI reasoning with real-world actions
- **Shared State**: Real-time visibility of agent's thought process

**Why AG-UI for This Use Case:**
1. **User-Facing Application**: Our error analysis app is a user-facing tool
2. **Interactive Agent Sessions**: Need to run agents with synthetic queries in real-time
3. **Tool Observability**: Can see tool calls as they happen
4. **Streaming Responses**: Better UX for long-running agent tasks
5. **Extensibility**: Can add custom tools for our specific needs

**AG-UI Integration Points:**

```typescript
// Frontend: React hooks for agent communication
const { agent, sendMessage, state } = useAgentConnection({
  agentUrl: "http://localhost:8000/api/agent",
  onEvent: (event) => {
    // Handle TEXT_MESSAGE_CHUNK, TOOL_CALL_CHUNK, etc.
  }
});

// Backend: Python AG-UI server
@ag_ui.route("/run")
async def run_agent(request: AgentRequest):
    async for event in agent.stream(request.message):
        yield event
```

### 1.3 FAILS Project Analysis

The `fails` project provides a robust pipeline for categorizing evaluation failures:

**Pipeline Steps:**
```
Step 1: Draft Categorization (Open Coding)
    ↓
Step 2: Clustering & Review
    ↓
Step 3: Final Classification
    ↓
Step 4: Report Generation
```

**Key Components We Can Reuse:**
1. **Prompts** (`fails/prompts.py`): Well-crafted prompts for categorization
2. **LLM Orchestration**: Concurrent LLM calls with semaphores
3. **Pydantic Models**: Structured outputs for categories and classifications
4. **Weave Integration**: Already integrated with Weave for logging

**Integration Approach:**
- Import `fails` as a library rather than running CLI
- Adapt `run_pipeline()` to work with our trace data
- Use the same categorization logic but with AGENT_INFO context

### 1.4 Existing Agent Analysis (customer_support.py)

The demo agent already has patterns we can learn from:

```python
# TASKFLOW_INFO serves as the "product knowledge"
TASKFLOW_INFO = """
# TaskFlow - Product Information
## Pricing Tiers
### Free Plan - $0/month
...
"""

# SYSTEM_PROMPT defines agent behavior
SYSTEM_PROMPT = """You are a helpful customer support agent...
Your role is to:
1. Answer questions about TaskFlow's features
2. Help users with account and billing issues
...
"""
```

This is essentially what AGENT_INFO.md would formalize!

---

## Part 2: Proposed Enhanced Workflow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ENHANCED WORKFLOW                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌─────────────┐    ┌────────────────┐                  │
│  │ AGENT_INFO.md│───→│ Our App LLM │───→│ Synthetic Data │                  │
│  │  (Context)   │    │  (Context)  │    │   Generator    │                  │
│  └──────────────┘    └─────────────┘    └───────┬────────┘                  │
│         │                                        │                           │
│         │                                        ▼                           │
│         │           ┌───────────────────────────────────────┐               │
│         │           │     User's Agent (via AG-UI)          │               │
│         └──────────→│  • Connected to our application       │               │
│                     │  • Runs with synthetic queries        │               │
│                     │  • Streams responses in real-time     │               │
│                     └───────────────────┬───────────────────┘               │
│                                         │                                    │
│                                         ▼                                    │
│                     ┌───────────────────────────────────────┐               │
│                     │         Weave Traces (Batch)          │               │
│                     │  • Tagged with batch_id               │               │
│                     │  • Linked to synthetic queries        │               │
│                     └───────────────────┬───────────────────┘               │
│                                         │                                    │
│                     ┌───────────────────┼───────────────────┐               │
│                     │                   ▼                   │               │
│                     │  ┌─────────────────────────────────┐  │               │
│                     │  │      Automated Review           │  │               │
│                     │  │  • LLM-powered trace analysis   │  │               │
│                     │  │  • FAILS integration            │  │               │
│                     │  │  • Uses AGENT_INFO context      │  │               │
│                     │  └─────────────────────────────────┘  │               │
│                     │                   │                   │               │
│                     │  ┌─────────────────────────────────┐  │               │
│                     │  │      Human Review               │  │               │
│                     │  │  • Validate automated review    │  │               │
│                     │  │  • Add notes, feedback          │  │               │
│                     │  │  • Mark as reviewed             │  │               │
│                     │  └─────────────────────────────────┘  │               │
│                     └───────────────────┬───────────────────┘               │
│                                         │                                    │
│                                         ▼                                    │
│                     ┌───────────────────────────────────────┐               │
│                     │        Failure Modes (Taxonomy)       │               │
│                     │  • Saturation tracking                │               │
│                     │  • Actionable insights                │               │
│                     └───────────────────┬───────────────────┘               │
│                                         │                                    │
│                                         ▼                                    │
│                     ┌───────────────────────────────────────┐               │
│                     │         Improvement Loop              │               │
│                     │  • User fixes agent                   │               │
│                     │  • Generate new batch                 │               │
│                     │  • Track regression/improvement       │               │
│                     └───────────────────────────────────────┘               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 3: AGENT_INFO.md Protocol Design

### 3.1 Schema Definition

```markdown
# AGENT_INFO.md

## Agent Metadata
- **Name**: TaskFlow Support Agent
- **Version**: 1.0.0
- **Type**: Customer Support
- **Framework**: Google ADK

## Purpose & Scope
Provide customer support for TaskFlow, a productivity and task management application.

### Target Audience
- Free tier users exploring features
- Pro users needing billing help
- Business admins managing teams

### Capabilities
1. Answer pricing and feature questions
2. Check subscription status
3. Process refund requests
4. Troubleshoot common issues

### Limitations
- Cannot access real payment systems (demo mode)
- Cannot modify user accounts directly
- Cannot make promises about unreleased features

## System Prompts

### Primary System Prompt
```
You are a helpful customer support agent for TaskFlow...
[Full system prompt here]
```

### Tool Descriptions
| Tool Name | Purpose | Inputs | Outputs |
|-----------|---------|--------|---------|
| get_product_info | Get pricing/features | None | Product info string |
| check_subscription_status | Check user plan | user_email | Subscription details |
| process_refund_request | Submit refund | user_email, reason | Request status |

## Domain Knowledge

### Product Information
[Include TASKFLOW_INFO or similar structured knowledge]

### Policies
- 30-day money-back guarantee
- 14-day free trial
- [Other policies]

## Testing Dimensions

### User Personas
- first_time_user: New to TaskFlow, exploring
- power_user: Uses daily, knows features well
- frustrated_customer: Having issues, needs help

### Scenarios
- billing_inquiry: Questions about charges
- feature_request: Asking for capabilities
- bug_report: Something isn't working
- upgrade_downgrade: Changing plans

### Query Complexity
- simple: One-step question
- multi_step: Requires multiple tool calls
- edge_case: Unusual or tricky situations

## Success Criteria
- Accurate information (no hallucinations)
- Appropriate tool usage
- Professional tone
- Escalation when needed
```

### 3.2 AGENT_INFO Parser

```python
# backend/services/agent_info.py

from pydantic import BaseModel
from typing import List, Optional, Dict
import yaml
import re

class TestingDimension(BaseModel):
    name: str
    values: List[str]
    descriptions: Optional[Dict[str, str]] = None

class Tool(BaseModel):
    name: str
    purpose: str
    inputs: str
    outputs: str

class AgentInfo(BaseModel):
    name: str
    version: str
    agent_type: str
    framework: str
    purpose: str
    target_audience: List[str]
    capabilities: List[str]
    limitations: List[str]
    system_prompt: str
    tools: List[Tool]
    domain_knowledge: str
    testing_dimensions: List[TestingDimension]
    success_criteria: List[str]

def parse_agent_info(markdown_content: str) -> AgentInfo:
    """Parse AGENT_INFO.md into structured data."""
    # Implementation to parse markdown sections
    pass

def generate_agent_info_template(agent_code: str) -> str:
    """Use LLM to generate AGENT_INFO.md from agent code."""
    # LLM-powered template generation
    pass
```

---

## Part 4: Phase Design

### Phase 1: AGENT_INFO Protocol & Agent Registry
**Goal**: Enable users to register their externally-hosted agents with our application.

**Key Principle**: We do NOT modify the user's agent. The user:
1. Creates their agent (e.g., with Google ADK)
2. Exposes it as an AG-UI compatible endpoint (using `ag-ui-adk` middleware)
3. Writes an AGENT_INFO.md documenting their agent
4. Registers both the endpoint URL and AGENT_INFO.md with our application

**User's Setup (Outside Our App):**
```bash
# User installs ag-ui-adk middleware
pip install ag-ui-adk google-adk

# User creates their agent (customer_support.py)
# User runs their agent as an AG-UI server
python -m ag_ui_adk.server --agent my_agent:agent --port 8000
# OR using ADK's built-in server with AG-UI adapter
adk web --agent my_agent:agent --port 8000
```

**What Our App Receives:**
- **AGENT_INFO.md content** (pasted or uploaded by user)
- **Agent endpoint URL** (e.g., `http://localhost:8000` or deployed URL)

**Backend Changes:**
1. `POST /api/agents` - Register agent with AGENT_INFO content + endpoint URL
2. `GET /api/agents` - List registered agents
3. `GET /api/agents/{id}` - Get agent details (parsed AGENT_INFO)
4. `PUT /api/agents/{id}` - Update AGENT_INFO or endpoint
5. `DELETE /api/agents/{id}` - Remove agent registration
6. `POST /api/agents/{id}/test-connection` - Verify endpoint is reachable

**Database Schema:**
```sql
CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT,
    agent_type TEXT,
    endpoint_url TEXT NOT NULL,        -- User-provided AG-UI endpoint
    agent_info_content TEXT NOT NULL,  -- Raw AGENT_INFO.md content
    parsed_info JSON,                  -- Parsed structured data
    connection_status TEXT DEFAULT 'unknown', -- 'connected', 'disconnected', 'error'
    last_connection_test TEXT,
    created_at TEXT,
    updated_at TEXT
);
```

**Frontend Changes:**
1. "Agents" tab in navigation
2. Agent registration form:
   - Endpoint URL input
   - AGENT_INFO.md textarea (with markdown preview)
   - "Test Connection" button
3. Agent list with connection status indicators
4. Agent detail view showing parsed AGENT_INFO

**Deliverables:**
- [x] AGENT_INFO.md schema definition and Pydantic parser (`backend/services/agent_info.py`)
- [x] Agent registration API endpoints (`backend/routers/agents.py`)
- [x] Connection testing endpoint (`POST /api/agents/{id}/test-connection`)
- [x] Frontend agent registration UI (Agents tab in `frontend/src/app/page.tsx`)
- [x] Template loading for AGENT_INFO (`GET /api/agents/template`)

**Implementation Notes:**
- Created `AgentInfo` Pydantic model with full schema
- Added `agents`, `agent_dimensions`, `agent_versions`, `synthetic_batches`, `synthetic_queries` tables
- Frontend shows agent list, registration form, detail view with capabilities/tools/dimensions
- Connection testing pings the AG-UI health endpoint

---

### Phase 2: AG-UI Integration
**Goal**: Connect to user's externally-hosted agents using AG-UI protocol.

**Understanding AG-UI Protocol:**
AG-UI is an event-based streaming protocol. Key events:
- `RUN_STARTED` - Agent run begins
- `TEXT_MESSAGE_CHUNK` - Streaming text response
- `TEXT_MESSAGE_END` - Text message complete
- `TOOL_CALL_START` - Agent is calling a tool
- `TOOL_CALL_ARGS` - Tool call arguments (streamed)
- `TOOL_CALL_END` - Tool call complete
- `RUN_FINISHED` - Agent run complete
- `RUN_ERROR` - Error occurred

**How User Exposes Their ADK Agent:**
```python
# User's agent server (run by user, NOT us)
# Option 1: Using ag-ui-adk middleware
from ag_ui_adk import create_app
from my_agent import create_support_agent

agent = create_support_agent()
app = create_app(agent=agent)

# Run with: uvicorn my_server:app --port 8000

# Option 2: Using CopilotKit starter
# User clones https://github.com/CopilotKit/with-adk
# Runs: pnpm dev (starts agent on localhost:8000)
```

**Our Backend Changes (Client-Side):**
1. AG-UI client service to connect to user's endpoint
2. `POST /api/agents/{id}/run` - Send query, stream response
3. SSE/WebSocket endpoint for frontend streaming

**AG-UI Client Implementation:**
```python
# backend/services/agui_client.py
import httpx
from typing import AsyncGenerator
import json

class AGUIClient:
    """Client to connect to user's AG-UI compatible agent endpoint."""
    
    def __init__(self, endpoint_url: str):
        self.endpoint_url = endpoint_url.rstrip('/')
    
    async def health_check(self) -> bool:
        """Check if agent endpoint is reachable."""
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(f"{self.endpoint_url}/health", timeout=5.0)
                return resp.status_code == 200
            except:
                return False
    
    async def run(self, message: str, thread_id: str = None) -> AsyncGenerator[dict, None]:
        """
        Send a message to the agent and stream AG-UI events.
        
        AG-UI uses Server-Sent Events (SSE) for streaming.
        """
        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST",
                f"{self.endpoint_url}/v1/run",
                json={
                    "message": message,
                    "thread_id": thread_id,
                },
                headers={"Accept": "text/event-stream"},
                timeout=60.0
            ) as response:
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = json.loads(line[6:])
                        yield self._parse_event(data)
    
    def _parse_event(self, data: dict) -> dict:
        """Parse AG-UI event into our internal format."""
        event_type = data.get("type")
        
        if event_type == "TEXT_MESSAGE_CHUNK":
            return {"type": "text_chunk", "content": data.get("content", "")}
        elif event_type == "TEXT_MESSAGE_END":
            return {"type": "text_end", "message_id": data.get("message_id")}
        elif event_type == "TOOL_CALL_START":
            return {"type": "tool_start", "tool_name": data.get("tool_name"), "call_id": data.get("call_id")}
        elif event_type == "TOOL_CALL_ARGS":
            return {"type": "tool_args", "args": data.get("args"), "call_id": data.get("call_id")}
        elif event_type == "TOOL_CALL_END":
            return {"type": "tool_end", "result": data.get("result"), "call_id": data.get("call_id")}
        elif event_type == "RUN_FINISHED":
            return {"type": "complete", "trace_id": data.get("trace_id")}
        elif event_type == "RUN_ERROR":
            return {"type": "error", "message": data.get("message")}
        else:
            return {"type": "unknown", "raw": data}
```

**Backend API Endpoints:**
```python
# backend/routers/agents.py

@router.post("/agents/{agent_id}/run")
async def run_agent(agent_id: str, request: RunRequest):
    """Run a query against the agent, streaming response via SSE."""
    agent = await get_agent(agent_id)
    client = AGUIClient(agent.endpoint_url)
    
    async def event_generator():
        async for event in client.run(request.message, request.thread_id):
            yield f"data: {json.dumps(event)}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream"
    )
```

**Frontend Changes:**
1. Agent "Playground" view to test queries
2. Real-time streaming response display
3. Tool call visualization (collapsible cards)
4. Connection status indicators

**Deliverables:**
- [x] AG-UI client library (`AGUIClient`) - `backend/services/agui_client.py`
- [x] SSE streaming endpoint for agent runs - `POST /api/agents/{id}/run`
- [x] Frontend agent playground UI - Embedded in agent detail view
- [x] Real-time response display with tool calls - Streaming updates with tool call visualization
- [x] Error handling for disconnected agents - Graceful error states and messages

**Implementation Notes:**
- Created `AGUIClient` class with health check, streaming run, sync run, and `get_agent_info()` methods
- Backend streams AG-UI events via SSE to frontend
- Frontend displays real-time text chunks, tool calls with args/results, and error states
- Playground UI includes input field, send button, tool call cards, response display, and event log
- Created `agent/AGENT_INFO.md` documenting the TaskFlow Support Agent with testing dimensions
- Agent server (`agent/agui_server.py`) exposes `/agent-info` and `/agent-info/json` endpoints
- Backend can fetch AGENT_INFO from remote agents via `GET /api/agents/{id}/agent-info`

---

### Phase 3: Synthetic Data Generation
**Goal**: Generate realistic test queries based on AGENT_INFO dimensions.

**Backend Changes:**
1. `POST /api/synthetic/dimensions` - Define/update dimensions
2. `POST /api/synthetic/tuples` - Generate dimension tuples
3. `POST /api/synthetic/queries` - Generate queries from tuples
4. `POST /api/synthetic/batch` - Create a batch of synthetic queries

**Generation Pipeline:**
```python
# backend/services/synthetic.py

class SyntheticGenerator:
    def __init__(self, agent_info: AgentInfo):
        self.agent_info = agent_info
        self.dimensions = agent_info.testing_dimensions
    
    async def generate_tuples(self, n: int = 20) -> List[Dict]:
        """Generate dimension tuples."""
        # Cross-product or LLM-guided generation
        pass
    
    async def tuple_to_query(self, tuple: Dict) -> str:
        """Convert a dimension tuple to natural language query."""
        prompt = f"""
        Given an agent for: {self.agent_info.purpose}
        
        Generate a realistic user query matching these characteristics:
        - Persona: {tuple['persona']}
        - Scenario: {tuple['scenario']}
        - Complexity: {tuple['complexity']}
        
        The query should sound natural, not formulaic.
        """
        return await llm_generate(prompt)
    
    async def generate_batch(self, n: int = 20) -> List[SyntheticQuery]:
        """Generate a full batch of synthetic queries."""
        tuples = await self.generate_tuples(n)
        queries = []
        for t in tuples:
            query = await self.tuple_to_query(t)
            queries.append(SyntheticQuery(
                id=generate_id(),
                tuple=t,
                query=query,
                batch_id=current_batch_id
            ))
        return queries
```

**Frontend Changes:**
1. Dimension editor UI
2. Tuple preview/editing
3. Query generation controls
4. Batch management UI

**Deliverables:**
- [x] Dimension management endpoints (`backend/routers/synthetic.py`)
- [x] Tuple generation (cross-product + LLM-guided)
- [x] Query generation with two-step process (LLM with template fallback)
- [x] Batch creation and tracking
- [x] Frontend synthetic data UI

**Implementation Notes:**
- Created `SyntheticGenerator` class in `backend/services/synthetic.py`
- Supports both cross-product and LLM-guided tuple generation
- Query generation uses LLM with template-based fallback when LLM unavailable
- Endpoints: `GET/POST /api/agents/{id}/dimensions`, `POST /api/agents/{id}/dimensions/import-from-agent`
- Batch endpoints: `POST /api/synthetic/batches`, `GET /api/synthetic/batches`, `GET/DELETE /api/synthetic/batches/{id}`
- Query endpoints: `POST /api/synthetic/tuples`, `POST /api/synthetic/queries`, `POST /api/synthetic/query-single`
- Frontend integrated into Agent detail view with:
  - Dimension import from AGENT_INFO
  - Batch generation controls (count, strategy)
  - Batch list with status indicators
  - Query detail view with dimension tags

---

### Phase 4: Batch Execution & Trace Collection
**Goal**: Run synthetic queries through connected agents and collect traces.

**Backend Changes:**
1. `POST /api/batches/{id}/run` - Execute a batch of queries
2. `GET /api/batches/{id}/status` - Get execution status
3. `GET /api/batches/{id}/traces` - Get traces for a batch

**Execution Flow:**
```python
# backend/services/batch_executor.py

class BatchExecutor:
    async def execute_batch(self, batch_id: str, agent_id: str):
        batch = await get_batch(batch_id)
        agent = await get_agent(agent_id)
        connection = await agui_adapter.connect(agent.endpoint)
        
        for query in batch.queries:
            # Run agent with query
            result = await agui_adapter.run(connection, query.query)
            
            # The agent is already instrumented with Weave
            # Traces are automatically collected
            
            # Link trace to batch
            await link_trace_to_batch(
                trace_id=result.trace_id,
                batch_id=batch_id,
                query_id=query.id
            )
```

**Database Schema:**
```sql
CREATE TABLE batches (
    id TEXT PRIMARY KEY,
    name TEXT,
    agent_id TEXT,
    status TEXT,  -- 'pending', 'running', 'completed', 'failed'
    created_at TEXT,
    completed_at TEXT,
    query_count INTEGER,
    success_count INTEGER,
    failure_count INTEGER
);

CREATE TABLE batch_queries (
    id TEXT PRIMARY KEY,
    batch_id TEXT,
    tuple JSON,
    query TEXT,
    status TEXT,
    trace_id TEXT,
    started_at TEXT,
    completed_at TEXT
);
```

**Frontend Changes:**
1. Batch execution controls
2. Progress tracking UI
3. Live execution status
4. Trace linking display

**Deliverables:**
- [x] Batch execution service (`backend/services/batch_executor.py`)
- [x] Trace-to-batch linking (trace_id stored in synthetic_queries)
- [x] Execution progress API (`POST /api/synthetic/batches/{id}/execute`, `GET /api/synthetic/batches/{id}/status`)
- [x] Frontend execution UI (run button, progress bar, execution status per query)

**Implementation Notes:**
- Created `BatchExecutor` class that orchestrates running synthetic queries through agents via AG-UI
- Execution streams progress via SSE to frontend for real-time updates
- Each query's execution status, response, and trace_id are stored in the database
- Frontend shows "Run Batch" button for pending batches, progress bar during execution
- Query preview shows execution status badges (success/error), response text, and trace links
- Added reset functionality to re-run all or only failed queries

---

### Phase 4.1: UX Improvement & Consolidation
**Goal**: Improve user experience by separating concerns and reducing duplication.

**Current UX Problems:**
1. **Mixed Responsibilities**: Synthetic tab handles data generation, execution, AND reviewing
2. **Duplicate Views**: Query Preview with responses is similar to Sessions conversation view
3. **No Clear Progress**: Batch execution needs better progress indication
4. **Disconnected Workflow**: Hard to connect synthetic runs to note-taking in Sessions

**Proposed Tab Structure:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         IMPROVED TAB STRUCTURE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  [Sessions]     [Taxonomy]     [Agents]     [Synthetic]     [Runs]          │
│      │              │             │              │             │             │
│      │              │             │              │             │             │
│      ▼              ▼             ▼              ▼             ▼             │
│  Review &       Failure       Agent         Data          Batch             │
│  Notes          Modes         Registry      Generation    Execution         │
│                                                                              │
│  • All traces   • Categories  • Connections • Dimensions  • Run batches     │
│  • Add notes    • Saturation  • Playground  • Generate    • Progress bar    │
│  • Feedback     • Export      • AGENT_INFO  • Edit/Delete • Results         │
│  • Mark review  • Copy        • Test        • Batches     • Re-run failed   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key UX Changes:**

1. **Synthetic Tab** - Pure Data Generation:
   ```
   ┌─────────────────────────────────────────────────────────────────────────┐
   │                    SYNTHETIC TAB (Data Building Only)                   │
   ├─────────────────────────────────────────────────────────────────────────┤
   │                                                                          │
   │  ┌─────────────────┐  ┌────────────────────┐  ┌──────────────────────┐  │
   │  │  Select Agent   │  │ Generate Batch     │  │   Query Preview      │  │
   │  │                 │  │                    │  │                      │  │
   │  │  • Agent list   │  │  • Dimensions      │  │  • View queries      │  │
   │  │  • Connection   │  │  • Count/Strategy  │  │  • Edit queries      │  │
   │  │    status       │  │  • Generate button │  │  • Delete queries    │  │
   │  │                 │  │                    │  │  • Select all        │  │
   │  │                 │  │  Generated Batches │  │                      │  │
   │  │                 │  │  • List (no run)   │  │  NO execution        │  │
   │  │                 │  │  • Quick actions   │  │  NO responses        │  │
   │  └─────────────────┘  └────────────────────┘  └──────────────────────┘  │
   │                                                                          │
   └─────────────────────────────────────────────────────────────────────────┘
   ```

2. **NEW Runs Tab** - Batch Execution:
   ```
   ┌─────────────────────────────────────────────────────────────────────────┐
   │                    RUNS TAB (Execution & Monitoring)                    │
   ├─────────────────────────────────────────────────────────────────────────┤
   │                                                                          │
   │  ┌─────────────────────────────────────────────────────────────────────┐│
   │  │                    Pending Runs                                      ││
   │  │  ┌─────────────────────────────────────────────────────────────┐    ││
   │  │  │ Batch 12/3/2025  │ 20 queries │ ready │ [▶ Run] [⟳ Re-gen] │    ││
   │  │  └─────────────────────────────────────────────────────────────┘    ││
   │  └─────────────────────────────────────────────────────────────────────┘│
   │                                                                          │
   │  ┌─────────────────────────────────────────────────────────────────────┐│
   │  │                    Active Execution                                  ││
   │  │  ┌─────────────────────────────────────────────────────────────┐    ││
   │  │  │ 🔄 Executing: Batch 12/2/2025                               │    ││
   │  │  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░ 45%  (9/20)                 │    ││
   │  │  │ ✓ 8 success  ✗ 1 failed  ⏱ ~2 min remaining                │    ││
   │  │  │                                                             │    ││
   │  │  │ Current: "I've been using your service..."                  │    ││
   │  │  └─────────────────────────────────────────────────────────────┘    ││
   │  └─────────────────────────────────────────────────────────────────────┘│
   │                                                                          │
   │  ┌─────────────────────────────────────────────────────────────────────┐│
   │  │                    Completed Runs                                    ││
   │  │  ┌─────────────────────────────────────────────────────────────┐    ││
   │  │  │ Batch 12/1/2025 │ 18/20 success │ completed │ [📝 Review]  │    ││
   │  │  │ Batch 11/30/25  │ 15/15 success │ completed │ [📝 Review]  │    ││
   │  │  └─────────────────────────────────────────────────────────────┘    ││
   │  └─────────────────────────────────────────────────────────────────────┘│
   │                                                                          │
   └─────────────────────────────────────────────────────────────────────────┘
   ```

3. **Enhanced Sessions Tab** - Unified Review:
   - After batch execution, traces appear in Sessions automatically (via Weave)
   - Sessions can filter by batch_id to show batch-specific traces
   - Note-taking and feedback work as before
   - Link to Taxonomy for categorization

**Implementation Changes:**

**Frontend:**
1. Create new "Runs" tab component
2. Move execution controls from Synthetic to Runs
3. Remove response display from Synthetic Query Preview
4. Add prominent progress bar to Runs tab
5. Add "View in Sessions" link from completed runs

**Backend:**
1. Add `GET /api/batches?status=pending|running|completed` for Runs tab
2. Add batch_id filter to Sessions/threads endpoint
3. Ensure trace_id linking enables Sessions → Batch correlation

**Data Flow:**
```
Synthetic (Create) → Runs (Execute) → Sessions (Review) → Taxonomy (Categorize)
        │                  │                  │                    │
        │                  │                  │                    │
        ▼                  ▼                  ▼                    ▼
   Batches DB         Progress SSE      Weave Traces        Failure Modes
```

**Deliverables:**
- [x] Create Runs tab with pending/active/completed sections
- [x] Add prominent progress bar with ETA during execution
- [x] Move execution controls from Synthetic to Runs
- [x] Remove response display from Synthetic Query Preview
- [x] Add "View in Sessions" navigation from completed runs
- [ ] Add batch filter to Sessions tab (deferred to Phase 5)

**Implementation Notes:**
- Created new "Runs" tab with coral theme color
- Runs tab shows: Select Agent, Pending Runs, Completed Runs, Run Results panels
- Active execution shows large progress bar with current query, success/failure counts
- Synthetic tab now shows "Go to Runs →" link for pending batches
- Query Preview in Synthetic shows only query text (no responses/execution status)
- Run Results panel shows query with response, error, and trace ID

---

### Phase 4.2: Streaming Progress & Async Optimization
**Goal**: Improve feedback during long-running operations with streaming progress and async-first execution.

**Current UX Problems:**
1. **No Generation Progress**: When generating synthetic queries, only a spinning emoji is shown
2. **Batch Loading**: Query preview area waits until all queries are generated before showing any
3. **No Execution Progress**: When running batches, progress isn't visible until completion
4. **Sync Blocking**: Operations that could be async are blocking the UI
5. **Disconnected Batch-Session Link**: "View in Sessions" doesn't filter to the batch

**Key Improvements:**

1. **Streaming Synthetic Data Generation:**
   ```
   ┌─────────────────────────────────────────────────────────────────────────┐
   │                    GENERATION PROGRESS                                   │
   ├─────────────────────────────────────────────────────────────────────────┤
   │                                                                          │
   │  Generating 20 queries...                                                │
   │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░ 45%  (9/20)                            │
   │                                                                          │
   │  ✓ Generated: "I've been using your service for a while..."             │
   │  ✓ Generated: "What's the pricing for enterprise?"                       │
   │  ⏳ Generating next query...                                              │
   │                                                                          │
   └─────────────────────────────────────────────────────────────────────────┘
   ```

2. **Real-time Query Preview Population:**
   - As each query is generated, immediately add it to the preview
   - User sees queries appearing one by one
   - Can start reviewing while generation continues

3. **Batch Execution Progress:**
   ```
   ┌─────────────────────────────────────────────────────────────────────────┐
   │                    EXECUTION PROGRESS                                    │
   ├─────────────────────────────────────────────────────────────────────────┤
   │                                                                          │
   │  🔄 Running batch against TaskFlow Support Agent                         │
   │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░ 45%  (9/20)                            │
   │                                                                          │
   │  ✓ 8 success  ✗ 1 failed  ⏱ ~2 min remaining                            │
   │                                                                          │
   │  Current: "I'm frustrated with your billing..."                          │
   │  Last Response: "I understand your frustration. Let me help..."         │
   │                                                                          │
   └─────────────────────────────────────────────────────────────────────────┘
   ```

4. **Batch-Filtered Sessions:**
   - "View in Sessions" passes batch_id as filter parameter
   - Sessions tab shows: "Filtered by: Batch 12/3/2025 [Clear Filter]"
   - Only traces linked to that batch are displayed

**Backend Changes:**

1. **Streaming Generation Endpoint:**
   ```python
   # POST /api/synthetic/batches/generate-stream
   # Returns SSE stream of generation progress
   
   async def generate_batch_stream(request: GenerateBatchRequest):
       async def event_generator():
           for i, query in enumerate(generate_queries(request)):
               yield f"data: {json.dumps({
                   'type': 'query_generated',
                   'query': query.dict(),
                   'progress': (i + 1) / request.count,
                   'completed': i + 1,
                   'total': request.count
               })}\n\n"
           yield f"data: {json.dumps({'type': 'complete', 'batch_id': batch_id})}\n\n"
       
       return StreamingResponse(event_generator(), media_type="text/event-stream")
   ```

2. **Streaming Execution Endpoint (already exists, enhance):**
   - Add current query text to progress events
   - Add last response snippet to progress events
   - Add ETA calculation based on average query time

3. **Batch Filter for Sessions:**
   ```python
   # GET /api/threads?batch_id=xxx
   # Filter threads by linked batch
   ```

**Frontend Changes:**

1. **SyntheticTab - Generation Progress:**
   - Add progress bar component
   - Stream queries into preview as they're generated
   - Show generation status with current query count

2. **RunsTab - Execution Progress:**
   - Enhanced progress bar with ETA
   - Show current query being processed
   - Show last response snippet
   - Real-time success/failure counts

3. **Sessions - Batch Filter:**
   - Accept `batch_id` URL parameter or state
   - Show filter indicator when batch filter active
   - "Clear Filter" button to remove

**Async-First Architecture:**
```python
# Agent execution with async preference
async def execute_query(agent_client, query):
    try:
        # Try async first
        result = await agent_client.run_async(query)
    except NotImplementedError:
        # Fallback to sync in thread pool
        result = await asyncio.to_thread(agent_client.run_sync, query)
    return result
```

**Optimizations:**
1. **Parallel Query Generation**: Generate multiple tuples concurrently
2. **Connection Pooling**: Reuse agent connections across queries
3. **Batch Database Writes**: Buffer and batch-insert queries
4. **Incremental UI Updates**: Use React's `useTransition` for non-blocking updates

**Deliverables:**
- [x] Streaming generation endpoint with SSE progress (`POST /api/synthetic/batches/generate-stream`)
- [x] Real-time query preview population during generation
- [x] Enhanced execution progress with ETA and current query
- [x] Batch filter for Sessions tab (`GET /api/threads?batch_id=xxx`)
- [ ] Async-first execution with sync fallback (deferred)
- [ ] Performance optimizations (parallel generation, connection pooling) (deferred)

**Implementation Notes:**
- Backend: Created `generate_batch_streaming()` async generator in `SyntheticGenerator`
- Backend: Added `/api/synthetic/batches/generate-stream` SSE endpoint
- Backend: Added `batch_id` filter parameter to `/api/threads` endpoint
- Frontend: `generateBatch()` now uses streaming, updates `selectedBatch.queries` in real-time
- Frontend: Progress bar shows during generation with completed/total count
- Frontend: "View in Sessions" button sets batch filter and switches to Sessions tab
- Frontend: Sessions tab shows batch filter indicator with "Clear Filter" button
- Frontend: Execution progress shows ETA based on average query time

---

### Phase 5: Automated Review Integration
**Goal**: Use LLM + FAILS pipeline to automatically review traces.

**Backend Changes:**
1. `POST /api/batches/{id}/auto-review` - Trigger automated review
2. `GET /api/batches/{id}/review-results` - Get automated review results
3. Integration with `fails` pipeline

**Integration with FAILS:**
```python
# backend/services/auto_reviewer.py

from fails.pipeline import run_pipeline
from fails.prompts import (
    FIRST_PASS_CATEGORIZATION_SYSTEM_PROMPT,
    CLUSTERING_PROMPT
)

class AutoReviewer:
    def __init__(self, agent_info: AgentInfo):
        self.agent_info = agent_info
        self.user_context = self._build_user_context()
    
    def _build_user_context(self) -> str:
        """Build context from AGENT_INFO for the review LLM."""
        return f"""
        Agent: {self.agent_info.name}
        Purpose: {self.agent_info.purpose}
        Capabilities: {', '.join(self.agent_info.capabilities)}
        Limitations: {', '.join(self.agent_info.limitations)}
        Success Criteria: {', '.join(self.agent_info.success_criteria)}
        """
    
    async def review_batch(self, batch_id: str) -> ReviewResult:
        # Get traces for batch
        traces = await get_batch_traces(batch_id)
        
        # Convert to FAILS-compatible format
        trace_data = [
            {
                "id": t.trace_id,
                "inputs": t.inputs,
                "output": t.output,
                "scores": {}  # Will be populated by automated scoring
            }
            for t in traces
        ]
        
        # Run FAILS pipeline with AGENT_INFO context
        result = await run_pipeline(
            trace_data=trace_data,
            user_context=self.user_context,
            model="gemini/gemini-2.5-pro",
            max_concurrent_llm_calls=10
        )
        
        return result
```

**Frontend Changes:**
1. "Auto Review" button on batch view
2. Automated review results display
3. Comparison with manual review
4. Confidence indicators

**Deliverables:**
- [x] FAILS library integration (`backend/services/auto_reviewer.py`)
- [x] AGENT_INFO context builder (`AutoReviewer._build_user_context()`)
- [x] Auto-review endpoints (`POST /api/synthetic/batches/{id}/auto-review`, `GET /api/synthetic/batches/{id}/reviews`)
- [x] Results display UI (Auto Review panel in RunsTab)

**Implementation Notes:**
- Created `AutoReviewer` class that integrates with the FAILS categorization pipeline
- The reviewer builds context from AGENT_INFO (purpose, capabilities, limitations, success criteria) to help the LLM understand agent behavior
- Converts batch execution traces to FAILS-compatible format with inputs, outputs, and scores
- Runs the full FAILS pipeline: draft categorization → clustering → final classification
- Stores results in `auto_reviews` table with failure categories and per-trace classifications
- Generates markdown report summarizing findings
- Frontend shows "Run Auto Review" button on completed batches
- Results display collapsible failure categories with trace counts and example traces
- Full markdown report can be viewed and copied to clipboard

---

### Phase 6: Iterative Improvement Loop
**Goal**: Track improvements across agent versions and batches.

**Backend Changes:**
1. `GET /api/agents/{id}/improvement` - Get improvement metrics
2. `POST /api/agents/{id}/version` - Record new agent version
3. `GET /api/batches/compare` - Compare batches

**Improvement Tracking:**
```python
# backend/services/improvement_tracker.py

class ImprovementTracker:
    def compare_batches(self, batch1_id: str, batch2_id: str) -> Comparison:
        """Compare failure modes between two batches."""
        b1_modes = get_failure_modes_for_batch(batch1_id)
        b2_modes = get_failure_modes_for_batch(batch2_id)
        
        return Comparison(
            resolved_modes=b1_modes - b2_modes,
            new_modes=b2_modes - b1_modes,
            persistent_modes=b1_modes & b2_modes,
            improvement_score=calculate_improvement(b1_modes, b2_modes)
        )
    
    def generate_targeted_queries(self, failure_modes: List[FailureMode]) -> List[str]:
        """Generate queries specifically targeting known failure modes."""
        # Use LLM to create queries that would trigger these failures
        pass
```

**Frontend Changes:**
1. Version history view
2. Batch comparison UI
3. Improvement graphs
4. Targeted query generation controls

**Deliverables:**
- [ ] Improvement metrics calculation
- [ ] Version tracking
- [ ] Batch comparison
- [ ] Targeted query generation
- [ ] Improvement visualization

---

## Part 5: Technical Architecture

### 5.1 System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SYSTEM ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    USER'S ENVIRONMENT (External)                      │   │
│  │  ┌────────────────┐    ┌─────────────────┐    ┌─────────────────┐    │   │
│  │  │  User's Agent  │───►│  ag-ui-adk      │───►│  AG-UI Endpoint │    │   │
│  │  │  (ADK-based)   │    │  middleware     │    │  localhost:8000 │    │   │
│  │  └────────────────┘    └─────────────────┘    └────────┬────────┘    │   │
│  │         │                                              │             │   │
│  │         │ instrumented with                            │             │   │
│  │         ▼                                              │             │   │
│  │  ┌────────────────┐                                    │             │   │
│  │  │   Weave OTEL   │────────────────────────────────────│─────────┐   │   │
│  │  │   Tracing      │                                    │         │   │   │
│  │  └────────────────┘                                    │         │   │   │
│  └────────────────────────────────────────────────────────│─────────│───┘   │
│                                                           │         │       │
│  ┌────────────────────────────────────────────────────────│─────────│───┐   │
│  │                    OUR APPLICATION                     │         │   │   │
│  │                                                        │         │   │   │
│  │  ┌──────────────┐    ┌──────────────┐                 │         │   │   │
│  │  │   Frontend   │◄──►│   Backend    │◄────────────────┘         │   │   │
│  │  │  (Next.js)   │    │  (FastAPI)   │    AG-UI SSE              │   │   │
│  │  └──────────────┘    └──────┬───────┘                           │   │   │
│  │         │                   │                                    │   │   │
│  │         │    ┌──────────────┼──────────────────────────┐        │   │   │
│  │         │    │              │                          │        │   │   │
│  │         │    ▼              ▼                          ▼        ▼   │   │
│  │         │  ┌─────┐    ┌──────────┐              ┌──────────────┐│   │   │
│  │         │  │SQLite│   │ AG-UI    │              │  Weave API   ││   │   │
│  │         │  │ DB   │   │ Client   │              │  (Traces)    │◄───┘   │
│  │         │  └─────┘    └──────────┘              └──────────────┘│       │
│  │         │       │           │                          │        │       │
│  │         │       │           │                          │        │       │
│  │         │       │           │       ┌──────────────────┘        │       │
│  │         │       │           │       │                           │       │
│  │         │       │           │       ▼                           │       │
│  │         │       │           │  ┌─────────────┐                  │       │
│  │         │       │           │  │   FAILS     │                  │       │
│  │         │       │           │  │  (Library)  │                  │       │
│  │         │       │           │  └─────────────┘                  │       │
│  │         │       │           │                                   │       │
│  │         │       ▼           ▼                                   │       │
│  │         │    ┌─────────────────────────────────────────┐        │       │
│  │         └───►│              LLM Services               │        │       │
│  │              │  • Synthetic Data Generation            │        │       │
│  │              │  • Auto Review (with AGENT_INFO)        │        │       │
│  │              │  • AGENT_INFO Parsing                   │        │       │
│  │              └─────────────────────────────────────────┘        │       │
│  │                                                                  │       │
│  │  User Provides:                                                  │       │
│  │  • AGENT_INFO.md content                                         │       │
│  │  • Agent endpoint URL (AG-UI compatible)                         │       │
│  └──────────────────────────────────────────────────────────────────┘       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Points:**
1. **User's agent is external** - We never touch their code
2. **User exposes AG-UI endpoint** - Using `ag-ui-adk` middleware or similar
3. **User provides AGENT_INFO.md** - Pasted into our registration form
4. **Traces flow through Weave** - User's agent already logs to Weave
5. **We connect via AG-UI protocol** - SSE streaming for real-time responses

### 5.2 Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA FLOW                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  USER PROVIDES:                                                              │
│  ┌────────────────────┐    ┌────────────────────┐                           │
│  │  AGENT_INFO.md     │    │  Agent Endpoint    │                           │
│  │  (pasted content)  │    │  (AG-UI URL)       │                           │
│  └─────────┬──────────┘    └─────────┬──────────┘                           │
│            │                         │                                       │
│            └────────────┬────────────┘                                       │
│                         │                                                    │
│                         ▼                                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    AGENT REGISTRATION                                 │   │
│  │  • Parse AGENT_INFO.md                                                │   │
│  │  • Store endpoint URL                                                 │   │
│  │  • Test connection                                                    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                         │                                                    │
│            ┌────────────┴────────────┐                                       │
│            │                         │                                       │
│            ▼                         ▼                                       │
│  ┌───────────────────┐     ┌───────────────────┐                            │
│  │ Synthetic Data    │     │ AG-UI Client      │                            │
│  │ Generator         │     │ (Connect to       │                            │
│  │ (uses AGENT_INFO  │     │  user's agent)    │                            │
│  │  dimensions)      │     │                   │                            │
│  └─────────┬─────────┘     └─────────┬─────────┘                            │
│            │                         │                                       │
│            │     ┌───────────────────┘                                       │
│            │     │                                                           │
│            ▼     ▼                                                           │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    BATCH EXECUTION                                    │   │
│  │  FOR each synthetic query:                                            │   │
│  │    1. Send query to user's agent (via AG-UI)                         │   │
│  │    2. Stream response back                                            │   │
│  │    3. Agent logs trace to Weave (via OTEL)                           │   │
│  │    4. Link trace_id to batch                                          │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                         │                                                    │
│                         ▼                                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    WEAVE TRACES                                       │   │
│  │  • Automatically logged by user's agent                               │   │
│  │  • Tagged with batch_id by our app                                    │   │
│  │  • Contains inputs, outputs, tool calls                               │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                         │                                                    │
│            ┌────────────┴────────────┐                                       │
│            │                         │                                       │
│            ▼                         ▼                                       │
│  ┌───────────────────┐     ┌───────────────────┐                            │
│  │ MANUAL REVIEW     │     │ AUTO REVIEW       │◄── AGENT_INFO context      │
│  │ • Browse sessions │     │ • FAILS pipeline  │                            │
│  │ • Add notes       │     │ • LLM analysis    │                            │
│  │ • Mark reviewed   │     │ • Auto-categorize │                            │
│  └─────────┬─────────┘     └─────────┬─────────┘                            │
│            │                         │                                       │
│            └────────────┬────────────┘                                       │
│                         │                                                    │
│                         ▼                                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    FAILURE TAXONOMY                                   │   │
│  │  • Failure modes with saturation tracking                             │   │
│  │  • Linked to specific traces and batches                              │   │
│  │  • Actionable insights                                                │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                         │                                                    │
│                         ▼                                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    IMPROVEMENT LOOP                                   │   │
│  │  1. User sees failure modes → fixes agent                             │   │
│  │  2. User updates AGENT_INFO version                                   │   │
│  │  3. Generate new batch targeting known failures                       │   │
│  │  4. Compare failure modes across versions                             │   │
│  │  5. Track improvement/regression                                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Database Schema (Extended)

```sql
-- Existing tables...

-- New tables for enhanced workflow

CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT DEFAULT '1.0.0',
    agent_type TEXT,
    framework TEXT,
    agent_info_raw TEXT,      -- Raw AGENT_INFO.md content
    agent_info_parsed JSON,   -- Parsed structured data
    system_prompt TEXT,
    domain_knowledge TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE agent_connections (
    id TEXT PRIMARY KEY,
    agent_id TEXT REFERENCES agents(id),
    connection_type TEXT DEFAULT 'ag-ui',
    endpoint_url TEXT NOT NULL,
    status TEXT DEFAULT 'disconnected',
    last_ping_at TEXT,
    error_message TEXT,
    created_at TEXT
);

CREATE TABLE testing_dimensions (
    id TEXT PRIMARY KEY,
    agent_id TEXT REFERENCES agents(id),
    name TEXT NOT NULL,
    values JSON,              -- Array of possible values
    descriptions JSON,        -- Optional descriptions per value
    created_at TEXT
);

CREATE TABLE synthetic_batches (
    id TEXT PRIMARY KEY,
    agent_id TEXT REFERENCES agents(id),
    name TEXT,
    status TEXT DEFAULT 'pending',
    generation_strategy TEXT, -- 'cross_product', 'llm_guided'
    query_count INTEGER,
    created_at TEXT,
    started_at TEXT,
    completed_at TEXT
);

CREATE TABLE synthetic_queries (
    id TEXT PRIMARY KEY,
    batch_id TEXT REFERENCES synthetic_batches(id),
    dimension_tuple JSON,     -- e.g., {"persona": "frustrated", "scenario": "billing"}
    query_text TEXT,
    trace_id TEXT,            -- Linked trace after execution
    execution_status TEXT,    -- 'pending', 'running', 'success', 'error'
    started_at TEXT,
    completed_at TEXT
);

CREATE TABLE auto_reviews (
    id TEXT PRIMARY KEY,
    batch_id TEXT REFERENCES synthetic_batches(id),
    status TEXT DEFAULT 'pending',
    model_used TEXT,
    failure_categories JSON,  -- Result from FAILS pipeline
    classifications JSON,
    report_markdown TEXT,
    created_at TEXT,
    completed_at TEXT
);

CREATE TABLE agent_versions (
    id TEXT PRIMARY KEY,
    agent_id TEXT REFERENCES agents(id),
    version TEXT,
    changes_summary TEXT,
    agent_info_snapshot TEXT, -- Snapshot of AGENT_INFO at this version
    created_at TEXT
);

CREATE TABLE batch_comparisons (
    id TEXT PRIMARY KEY,
    batch1_id TEXT REFERENCES synthetic_batches(id),
    batch2_id TEXT REFERENCES synthetic_batches(id),
    resolved_modes JSON,
    new_modes JSON,
    persistent_modes JSON,
    improvement_score REAL,
    created_at TEXT
);
```

---

## Part 5.5: User Requirements (What Users Must Do)

Before registering with our application, users must:

### 1. Have Their Agent Ready
- Agent built with any framework (Google ADK, LangChain, etc.)
- Agent instrumented with Weave for tracing

### 2. Expose Agent as AG-UI Endpoint

**Option A: Using ag-ui-adk (for Google ADK agents)**
```bash
# Install
pip install ag-ui-adk google-adk

# Create server wrapper (my_server.py)
from ag_ui_adk import create_app
from my_agent import create_support_agent

agent = create_support_agent()
app = create_app(agent=agent)

# Run
uvicorn my_server:app --host 0.0.0.0 --port 8000
```

**Option B: Using CopilotKit starter**
```bash
# Clone and setup
git clone https://github.com/CopilotKit/with-adk
cd with-adk
pnpm install && pnpm install:agent

# Add your agent logic, then run
pnpm dev
```

**Option C: Implement AG-UI manually**
Users can implement the AG-UI protocol directly:
- `POST /v1/run` - Accept message, stream SSE events
- Events: `RUN_STARTED`, `TEXT_MESSAGE_CHUNK`, `TOOL_CALL_*`, `RUN_FINISHED`

### 3. Create AGENT_INFO.md

Users create a markdown file documenting their agent:
- Purpose and scope
- System prompts
- Available tools
- Testing dimensions
- Success criteria

(See Appendix A for full template)

### 4. Register with Our Application

1. Open our Error Analysis app
2. Go to "Agents" tab
3. Paste their AGENT_INFO.md content
4. Enter their agent endpoint URL
5. Click "Test Connection" to verify
6. Save registration

---

## Part 6: Implementation Timeline

### Phase 1: AGENT_INFO Protocol (1-2 weeks)
- Week 1: Schema design, parser, database setup
- Week 2: Frontend UI, LLM generator

### Phase 2: AG-UI Integration (2 weeks)
- Week 1: AG-UI adapter, WebSocket endpoints
- Week 2: Frontend connection UI, testing

### Phase 3: Synthetic Data Generation (2 weeks)
- Week 1: Dimension management, tuple generation
- Week 2: Query generation, batch creation UI

### Phase 4: Batch Execution (1 week)
- Execution service, trace linking, progress UI

### Phase 5: Automated Review (1-2 weeks)
- Week 1: FAILS integration, context builder
- Week 2: Results display, manual comparison

### Phase 6: Improvement Loop (1 week)
- Version tracking, comparison, targeted generation

**Total Estimated Time: 8-10 weeks**

---

## Part 7: Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| AG-UI compatibility issues | High | Start with HTTP fallback, add AG-UI incrementally |
| LLM costs for synthetic generation | Medium | Implement caching, rate limiting, budget controls |
| FAILS integration complexity | Medium | Import as library, minimal modifications |
| User agent instrumentation varies | High | Provide clear documentation, validation tools |
| Large batch execution time | Medium | Background jobs, progress streaming, partial results |

---

## Part 8: Success Metrics

1. **Adoption**: # of agents registered with AGENT_INFO
2. **Coverage**: % of failure modes discovered via synthetic data
3. **Efficiency**: Time saved vs manual testing
4. **Accuracy**: Auto-review agreement with manual review
5. **Improvement**: Failure mode resolution rate across versions

---

## Appendix A: Example AGENT_INFO.md for Demo Agent

```markdown
# AGENT_INFO.md

## Agent Metadata
- **Name**: TaskFlow Support Agent
- **Version**: 1.0.0
- **Type**: Customer Support
- **Framework**: Google ADK

## Purpose & Scope
Provide customer support for TaskFlow, a productivity and task management application.

### Target Audience
- Free tier users exploring features
- Pro users needing billing help  
- Business admins managing teams

### Capabilities
1. Answer pricing and feature questions (get_product_info)
2. Check subscription status (check_subscription_status)
3. Process refund requests (process_refund_request)
4. Provide current date for context (get_current_date)

### Limitations
- Cannot access real payment systems (demo mode)
- Cannot modify user accounts directly
- Cannot make promises about unreleased features
- No access to historical support tickets

## System Prompts

### Primary System Prompt
You are a helpful customer support agent for TaskFlow, a productivity and task management application.

Your role is to:
1. Answer questions about TaskFlow's features, pricing, and policies
2. Help users with account and billing issues
3. Troubleshoot common problems
4. Escalate complex issues appropriately

IMPORTANT GUIDELINES:
- Always use the get_product_info tool to get accurate pricing and policy information
- Never make up prices, features, or policies - always check the product info
- If you're unsure about something, say so and offer to connect them with a human agent
- Be friendly but professional
- For account-specific questions, use check_subscription_status with their email

### Tool Descriptions
| Tool Name | Purpose | Inputs | Outputs |
|-----------|---------|--------|---------|
| get_product_info | Get TaskFlow pricing and policies | None | Product info string |
| check_subscription_status | Check user's current plan | user_email: str | Subscription details dict |
| process_refund_request | Submit refund request | user_email: str, reason: str | Request status dict |
| get_current_date | Get today's date | None | Date string (YYYY-MM-DD) |

## Domain Knowledge

### Pricing Tiers
- **Free**: $0/month - 3 projects, 100 tasks, basic features
- **Pro**: $9/month or $89/year - Unlimited projects, calendar integration
- **Business**: $19/user/month (min 5 users) - Team collaboration, SSO, API

### Key Policies
- 30-day money-back guarantee for first-time subscribers
- 14-day free trial of Pro (no credit card required)
- Annual plans: Prorated refund within 60 days
- Monthly plans: No refunds, cancel anytime

### Support Hours
- Free: Community forum only
- Pro: Email support, 24-48 hour response
- Business: Priority email + chat, 4-hour SLA

## Testing Dimensions

### personas
- first_time_user: New to TaskFlow, exploring options, lots of questions
- power_user: Uses TaskFlow daily, familiar with features, specific requests
- frustrated_customer: Having issues, potentially upset, needs empathy
- enterprise_prospect: Evaluating for team, detailed questions about Business tier

### scenarios  
- pricing_inquiry: Questions about plans, costs, billing cycles
- feature_question: What can/can't TaskFlow do
- refund_request: Wants money back
- upgrade_inquiry: Considering moving to higher tier
- downgrade_request: Wants to reduce their plan
- technical_issue: Something's not working
- account_recovery: Can't access account

### complexity
- simple: Single question, one tool call
- multi_step: Requires gathering info then taking action
- edge_case: Unusual situation, policy gray area
- adversarial: Trying to get something they shouldn't

## Success Criteria
1. All pricing/feature info comes from get_product_info tool (no hallucination)
2. Subscription status checked before making account-specific claims
3. Refund eligibility verified before processing
4. Professional tone maintained even with frustrated customers
5. Appropriate escalation when unable to help
6. No promises about features not in TASKFLOW_INFO
```

---

## Appendix B: Synthetic Query Examples

Given dimensions:
- personas: [first_time_user, frustrated_customer, power_user]
- scenarios: [pricing_inquiry, refund_request, feature_question]
- complexity: [simple, multi_step, edge_case]

### Generated Tuples:
1. (first_time_user, pricing_inquiry, simple)
2. (frustrated_customer, refund_request, multi_step)
3. (power_user, feature_question, edge_case)

### Converted to Queries:
1. "Hi! I'm new here. How much does TaskFlow cost?"
2. "I've been trying to get my money back for THREE DAYS. I signed up for the annual plan last month but I haven't even used it. My email is john@example.com. Can you just refund me already?"
3. "I use the Pro plan and I'm wondering - if I create a recurring task on the 31st of a month, what happens in February? Also, does calendar sync support lunar calendars?"
```

