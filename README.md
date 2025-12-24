# Weave Error Analysis

**Bottom-up failure mode discovery for AI agents.**

This tool helps you systematically find, categorize, and track failure patterns in your AI agents development cycle. Generate synthetic test queries, execute them against your agent, review traces in Weave, and build a taxonomy of what's actually going wrong.

> [!IMPORTANT]  
> **Alpha Release** — This is an experimental tool, not an official Weights & Biases product. Expect rough edges and breaking changes. If something breaks, [open an issue](https://github.com/wandb/weave-error-analysis/issues).

---

## Quick Start

```bash
git clone https://github.com/wandb/weave-error-analysis.git
cd weave-error-analysis
uv run ea
```

That's it. Opens http://localhost:3000 with backend on :8000.

### First-Time Setup

1. **Add your OpenAI API key** — The setup wizard prompts you on first launch
2. **Start the Example Agent** — Click "Start Example Agent" in the Agents tab
3. **Generate test queries** — Go to Synthetic tab, pick dimensions, generate a batch
4. **Execute the batch** — Run queries against the agent
5. **Review in Weave** — Click "Review in Weave" to see traces with pre-applied filters
6. **Annotate in Weave** -- Leave note about how the agent is doing by analyzing the trace.
6. **Build your taxonomy** — Categorize failures in the Taxonomy tab.

### CLI Options

```bash
uv run ea                    # Start everything
uv run ea --port 3001        # Custom frontend port
uv run ea --backend-port 8001  # Custom backend port
uv run ea --no-browser       # Don't auto-open browser
```

---

## The Workflow

The tool follows a structured workflow to help you discover failure patterns:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  1. AGENTS  │ ──▶ │ 2. SYNTHETIC│ ──▶ │  3. REVIEW  │ ──▶ │ 4. TAXONOMY │
│  Connect &  │     │  Generate & │     │  Traces in  │     │ Categorize  │
│  Configure  │     │  Execute    │     │  Weave UI   │     │  Failures   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

### Step 1: Agents Tab — Connect Your Agent

Register your agent with a simple HTTP endpoint. The tool ships with an Example Agent (a customer support bot) so you can try things out immediately.

**To bring your own agent**, implement this endpoint:

```
POST /query
Request:  {"query": "user message", "batch_id": "optional", "query_id": "optional"}
Response: {"response": "agent reply", "error": null}

GET /health
Response: {"status": "healthy"}
```

Add context about what your agent does (capabilities, limitations, target users) to help generate better synthetic queries.

### Step 2: Synthetic Tab — Generate & Execute Test Queries

Define **testing dimensions** that describe your agent's domain:

| Dimension | Example Values |
|-----------|----------------|
| Personas | `first_time_user`, `power_user`, `frustrated_customer` |
| Scenarios | `pricing_inquiry`, `refund_request`, `feature_question` |
| Complexity | `simple`, `multi_step`, `edge_case` |

The tool generates test queries by sampling combinations of these dimensions and using an LLM to craft realistic user messages. Execute batches against your agent with real-time progress tracking.

### Step 3: Review in Weave

Click "Review in Weave" to open Weave's trace viewer with filters pre-applied to your batch. Add feedback, annotate issues, mark traces as reviewed—all in Weave's native UI.

### Step 4: Taxonomy Tab — Build Your Failure Taxonomy

Create failure mode categories like:
- "Hallucinated pricing information"
- "Ignored tool results"
- "Failed to escalate complex issue"

Track **saturation**—how many traces exhibit each failure pattern. AI suggestions help surface patterns you might have missed. Merge similar categories, split overly broad ones, mark issues as resolved.

---

## Connecting Your Own Agent

Your agent needs a simple HTTP endpoint. Here's a complete FastAPI example with Weave tracing:

```python
import weave
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()
weave.init("your-weave-project")  # Where your agent's traces go

class QueryRequest(BaseModel):
    query: str
    batch_id: str | None = None   # For batch attribution
    query_id: str | None = None   # For query-level tracking

class QueryResponse(BaseModel):
    response: str
    error: str | None = None

@app.get("/health")
async def health():
    return {"status": "healthy"}

@weave.op(name="run_agent")
async def run_agent(query: str) -> str:
    # Your agent logic here - LLM calls, tool use, etc.
    return await your_agent_logic(query)

@app.post("/query", response_model=QueryResponse)
async def query(request: QueryRequest):
    try:
        # Wrap in weave.attributes so traces inherit batch_id
        if request.batch_id:
            attrs = {"batch_id": request.batch_id}
            if request.query_id:
                attrs["query_id"] = request.query_id
            with weave.attributes(attrs):
                result = await run_agent(request.query)
        else:
            result = await run_agent(request.query)
        
        return QueryResponse(response=result)
    except Exception as e:
        return QueryResponse(response="", error=str(e))
```

The `batch_id` and `query_id` fields enable filtering traces by batch in Weave UI. The `@weave.op` decorator ensures all nested operations (LLM calls, tool invocations) appear as child traces.

**Register your agent:**
1. Go to the **Agents** tab
2. Click **Add Agent**
3. Enter endpoint URL (e.g., `http://localhost:9000`)
4. Add context describing your agent's purpose (optional but recommended)
5. Click **Test Connection** to verify

---

## Features

### Agent Management
- **Agent Registry** — Register agents with HTTP endpoints and connection status monitoring
- **Agent Context** — Describe your agent's purpose to improve synthetic query generation
- **Example Agent** — Pre-configured TaskFlow support bot for learning the workflow

### Synthetic Data Generation
- **Dimension-Based Sampling** — Define personas, scenarios, complexity levels
- **LLM Query Generation** — Converts dimension tuples into realistic user messages
- **Batch Management** — Create, edit, delete batches of test queries
- **Streaming Progress** — Real-time feedback during generation and execution

### Trace Review (via Weave)
- **Deep Links** — Pre-filtered URLs to your batch's traces in Weave
- **Batch Attribution** — All traces tagged with `batch_id` for easy filtering
- **Native Feedback** — Use Weave's built-in annotation and feedback tools
- **No Local Sync** — Traces stay in Weave, we generate links to them

### Failure Taxonomy
- **Failure Modes** — Named categories with severity, status, and suggested fixes
- **Note Collection** — Gather observations from trace review
- **AI Suggestions** — LLM-powered category recommendations
- **Saturation Tracking** — Know when you've found most patterns in a batch
- **Taxonomy Operations** — Merge, split, edit, and track status over time

### Configuration & Prompts
- **Settings UI** — Configure API keys and Weave credentials through the UI
- **Prompt Management** — Edit analysis prompts, versions stored in Weave

---

## Issues & Contributing

**Found a bug?** [Open an issue](https://github.com/wandb/weave-error-analysis/issues) with:
- What you were trying to do
- What happened instead
- Any error messages from the console

**Want to contribute?** See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup.

---

<details>
<summary><h2>Architecture & Mental Model</h2></summary>

### Two Projects, One Tool

The tool works with two Weave projects:

| Project | Purpose | Who Creates Traces |
|---------|---------|-------------------|
| **Target Project** | Your agent's traces | Your agent |
| **Tool Project** | Internal tool traces, prompt versions | This tool |

This separation keeps your agent's trace data clean while letting the tool version its own prompts and analyses.

### System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           YOUR ENVIRONMENT                                   │
│  ┌────────────────┐                                                         │
│  │  Your Agent    │◀──── Instrumented with Weave (logs to Target Project)   │
│  │  (HTTP Server) │                                                         │
│  └───────┬────────┘                                                         │
└──────────┼──────────────────────────────────────────────────────────────────┘
           │ POST /query
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ERROR ANALYSIS TOOL                                   │
│                                                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                 │
│  │   Frontend   │◀───▶│   Backend    │◀───▶│   SQLite     │                 │
│  │  (Next.js)   │     │  (FastAPI)   │     │   (Local)    │                 │
│  └──────────────┘     └──────┬───────┘     └──────────────┘                 │
│                              │                                               │
│                              ▼                                               │
│                    ┌──────────────────┐                                      │
│                    │    Weave API     │──── Fetches traces, generates URLs   │
│                    │  (Target Project)│                                      │
│                    └──────────────────┘                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. GENERATE          2. EXECUTE           3. REVIEW            4. CATEGORIZE
   Synthetic            Batch               in Weave             Failures
   Queries              
                    
┌──────────┐       ┌──────────┐        ┌──────────┐        ┌──────────┐
│ Dimension│──────▶│ Run each │───────▶│ "Review  │───────▶│ Build    │
│ Tuples   │       │ query vs │        │ in Weave"│        │ Taxonomy │
│ → LLM    │       │ Agent    │        │ button   │        │          │
└──────────┘       └────┬─────┘        └────┬─────┘        └──────────┘
                        │                   │
                        ▼                   ▼
                   Agent logs          Pre-filtered
                   trace to            Weave URL
                   Weave with          with batch_id
                   batch_id
```

### Key Design Decisions

**Why not build our own trace viewer?**  
Weave's trace UI is excellent. Instead of reimplementing it, we generate deep links with pre-applied filters. You review traces in Weave, add feedback there, and we sync it back for taxonomy building.

**Why dimension-based synthetic data?**  
Testing dimensions (personas × scenarios × complexity) give systematic coverage. Random prompts miss edge cases; curated test sets are expensive to build. Dimensions let you explore the space efficiently.

**Why local SQLite?**  
The tool runs locally, your data stays local. No cloud storage, no data leaving your machine (except API calls to LLMs and Weave). The database is just `backend/taxonomy.db`.

### File Structure

```
weave-error-analysis/
├── pyproject.toml       # Python package (uv)
├── error_analysis_cli/  # CLI entry point
│   └── main.py          # `uv run ea` command
├── backend/             # FastAPI backend
│   ├── main.py          # App entry, lifespan
│   ├── config.py        # Configuration loading
│   ├── database.py      # SQLite operations
│   ├── routers/         # API endpoints
│   ├── services/        # Business logic
│   └── prompts/         # LLM prompt definitions
├── frontend/            # Next.js frontend
│   └── src/app/         
│       ├── components/  # React components
│       ├── context/     # App state
│       └── lib/         # API clients, hooks
└── agent/               # Example agent
    ├── agent_server.py  # HTTP wrapper
    └── customer_support.py  # ADK agent
```

</details>

---

## Tech Stack

**Backend:** Python 3.11+, FastAPI, SQLite, Weave SDK, LiteLLM  
**Frontend:** Next.js 14, React 18, Tailwind CSS  
**Example Agent:** Google ADK  
**Package Manager:** [uv](https://docs.astral.sh/uv/)

---

## License

MIT — See [LICENSE](LICENSE)

---

> **Disclaimer:** This is not an official Weights & Biases product. It's an experimental tool built on top of Weave. Use at your own risk, and please report issues so we can make it better.
