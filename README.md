# Weave Error Analysis

Bottom-up failure mode discovery for AI agents. Connect your agent, generate synthetic tests, review traces, and build a taxonomy of failure patterns powered by W&B Weave.

## Quick Start

```bash
git clone git@github.com:wandb/weave-error-analysis.git
cd weave-error-analysis
uv run ea
```

Opens http://localhost:3000 with:
- **Backend** on port 8000
- **Frontend** on port 3000
- **Example Agent** pre-registered (start it from the Agents tab)

### Getting Started

1. **Configure Settings** — Go to Settings tab, add your OpenAI API key
2. **Start the Example Agent** — Go to Agents tab, click "Start Example Agent"
3. **Generate Queries** — Go to Synthetic tab, create test queries from dimensions
4. **Execute Batch** — Run queries against the agent to generate sessions
5. **Review & Categorize** — Browse sessions, add notes, build your failure taxonomy

### Bring Your Own Agent

When you're ready to analyze your own agent:

1. Implement a simple HTTP endpoint (`POST /query`) that accepts `{query, thread_id}` and returns `{response, thread_id, error}`
2. Register it in the Agents tab with AGENT_INFO.md describing its capabilities
3. Optionally specify the Weave project where your agent logs traces
4. Generate synthetic queries based on your agent's testing dimensions

### CLI Options

| Command | Description |
|---------|-------------|
| `uv run ea` | Start backend + frontend |
| `uv run ea --port 3001` | Custom frontend port |
| `uv run ea --backend-port 8001` | Custom backend port |
| `uv run ea --no-browser` | Don't auto-open browser |

**Note:** The Example Agent is started from the Agents tab, not the CLI. This lets you configure your API key first.

### Testing a Fresh Install

```bash
rm -f backend/taxonomy.db   # Remove existing database
uv run ea --no-browser      # Start fresh
```

Then: Settings → Add API key → Agents → Start Example Agent → Generate queries

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

### Environment Variable Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `WANDB_API_KEY` | W&B API key for Weave access | (required) |
| `WANDB_ENTITY` | W&B entity (username or team) | (required) |
| `WEAVE_PROJECT` | Weave project name for your agent's traces | (required) |
| `OPENAI_API_KEY` | OpenAI API key for LLM operations | (required) |
| `TOOL_PROJECT_NAME` | Weave project for tool's internal traces | `error-analysis-tool` |
| `WEAVE_API_BASE` | Weave API base URL (for enterprise) | `https://trace.wandb.ai` |
| `CORS_ORIGINS` | Comma-separated list of allowed origins | localhost:3000,8000 |
| `CORS_ALLOW_ALL` | Set to `true` to allow all origins | `false` |
| `SYNC_QUERY_LIMIT` | Max calls to fetch per sync | `500` |
| `AGENT_QUERY_TIMEOUT` | Timeout (seconds) for agent queries | `120` |
| `WEAVE_API_TIMEOUT` | Timeout (seconds) for Weave API calls | `60` |
| `HEALTH_CHECK_TIMEOUT` | Timeout (seconds) for health checks | `10` |

**CORS Configuration:**

By default, CORS is configured for local development (localhost:3000, localhost:8000). For production deployments:

```bash
# Allow specific origins (recommended)
CORS_ORIGINS=https://your-app.example.com,https://your-domain.com

# Or allow all origins (use with caution)
CORS_ALLOW_ALL=true
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
