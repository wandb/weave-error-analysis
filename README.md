# Weave Error Analysis

Bottom-up failure mode discovery for AI agents. Connect your agent, generate synthetic tests, review traces, and build a taxonomy of failure patterns powered by W&B Weave.

## Quick Start

```bash
git clone git@github.com:wandb/weave-error-analysis.git
cd weave-error-analysis
uv run ea
```

Opens http://localhost:3000 with example data loaded.

Go to **Settings** tab to configure:
- **LLM API Key** (OpenAI, Anthropic, etc.) - required for AI features
- **Weave credentials** (W&B API key, entity, project) - to connect your agent's traces

Settings are saved locally and persist across restarts.

### CLI Options

| Command | Description |
|---------|-------------|
| `uv run ea` | Start everything (default ports 3000/8000) |
| `uv run ea --port 3001` | Custom frontend port |
| `uv run ea --backend-port 8001` | Custom backend port |
| `uv run ea --no-browser` | Don't auto-open browser |

## Features

| Feature | Description |
|---------|-------------|
| **Agent Registry** | Register agents with a simple HTTP endpoint. Auto-extracts testing dimensions from AGENT_INFO.md |
| **Synthetic Generation** | LLM-guided test query generation across configurable dimensions (personas, scenarios, complexity) |
| **Batch Execution** | Execute queries against your agent with real-time streaming progress |
| **Session Review** | Browse Weave traces locally (SQLite cache), add notes, mark reviewed. Rich filtering by batch, model, latency, tokens |
| **AI Suggestions** | Analyze sessions to surface potential issues. Accept, edit, or reject suggestions with human-in-the-loop |
| **Failure Taxonomy** | Build categories from notes. AI-assisted clustering with saturation tracking to know when you've found most patterns |
| **Prompt Management** | Versioned prompts stored in Weave. Edit analysis prompts through the UI with full history |

## Mental Model

```
                    ┌─────────────────┐
                    │   Your Agent    │
                    │ (Weave-traced)  │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │           Error Analysis Tool           │
        │                                         │
        │  ┌──────────┐   ┌──────────┐           │
        │  │ Synthetic │──▶│  Execute  │          │
        │  │  Queries  │   │  Batch    │          │
        │  └──────────┘   └─────┬─────┘          │
        │                       │                 │
        │                       ▼                 │
        │              ┌──────────────┐          │
        │              │ Weave Traces │◀──────────┼────┐
        │              └───────┬──────┘          │    │
        │                      │                 │    │
        │         ┌────────────┼────────────┐   │    │
        │         ▼            ▼            ▼   │    │
        │   ┌─────────┐  ┌─────────┐  ┌──────┐ │    │ Your agent
        │   │ Manual  │  │   AI    │  │ Notes│ │    │ traces to
        │   │ Review  │  │Suggest  │  │      │ │    │ Weave
        │   └────┬────┘  └────┬────┘  └───┬──┘ │    │
        │        │            │           │    │    │
        │        └────────────┼───────────┘    │    │
        │                     ▼                │    │
        │            ┌───────────────┐         │    │
        │            │   Taxonomy    │         │    │
        │            │ (Failure Modes)│        │    │
        │            └───────────────┘         │    │
        └──────────────────────────────────────┘    │
                                                    │
                                         Weave (W&B)
```

**Two projects, one tool:**
- **Target project**: Your agent's Weave project (traces live here, created by your agent)
- **Tool project**: Error analysis internal traces and prompt versions

## Workflow

```
1. CONNECT        2. GENERATE         3. EXECUTE          4. REVIEW           5. CATEGORIZE
   Agent             Queries             Batch              Traces              Failures
┌──────────┐     ┌──────────┐       ┌──────────┐       ┌──────────┐       ┌──────────┐
│ Register │────▶│ Synthetic│──────▶│ Run vs   │──────▶│ Browse   │──────▶│ Build    │
│ endpoint │     │ test data│       │ Agent    │       │ Add notes│       │ Taxonomy │
└──────────┘     └──────────┘       └──────────┘       │ AI suggest│      │ Track sat│
                       │                               └──────────┘       └──────────┘
                       │                                     │                   │
                       └─────────────────────────────────────┴───────────────────┘
                                            Iterate
```

## Configuration

**Via Settings UI (recommended):**
1. Open Settings tab
2. Enter Weave credentials (W&B API key, entity, project pointing to your **agent's** project)
3. Enter LLM credentials (OpenAI/Anthropic/Google) -- OpenAI is tested.
4. Save

**Via environment variables:**
```bash
# .env in root
WANDB_API_KEY=your_key
WANDB_ENTITY=your_entity
WEAVE_PROJECT=your_agent_project  # Where your agent logs traces
OPENAI_API_KEY=your_key
```

## Connecting Your Agent

Your agent needs:
1. **Weave instrumentation** - Your agent logs traces to Weave; this tool reads them
2. **HTTP endpoint** - JSON request/response interface

**API contract:**
```
POST /query

Request:  {"query": "user message", "thread_id": "optional"}
Response: {"response": "agent reply", "thread_id": "...", "error": null}
```

**Example (FastAPI + Google ADK):**
```python
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class QueryRequest(BaseModel):
    query: str
    thread_id: str | None = None

class QueryResponse(BaseModel):
    response: str
    thread_id: str | None = None
    error: str | None = None

@app.post("/query", response_model=QueryResponse)
async def query(request: QueryRequest):
    result = await run_agent(request.query)  # Your agent logic
    return QueryResponse(response=result, thread_id=request.thread_id)
```

See `agent/agent_server.py` for a complete Google ADK example.

**AGENT_INFO.md** (optional) - helps generate better synthetic queries:
```markdown
## Purpose & Scope
What it does, capabilities, limitations

## Testing Dimensions
### personas
- first_time_user, power_user, frustrated_customer

### scenarios  
- pricing_inquiry, refund_request, feature_question

### complexity
- simple, multi_step, edge_case
```

## Tech Stack

**Backend:** FastAPI, Weave SDK, LiteLLM, SQLite  
**Frontend:** Next.js 14, React 18, Tailwind CSS

## License

MIT
