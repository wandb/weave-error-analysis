# Weave Error Analysis

Bottom-up failure mode discovery for AI agents. Connect your agent, generate synthetic tests, review traces, and build a taxonomy of failure patterns powered by W&B Weave.

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

## Quick Start

```bash
# Setup
./run.sh setup

# Start backend (Terminal 1)
./run.sh backend

# Start frontend (Terminal 2)
./run.sh frontend

# Open http://localhost:3000
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
1. **Weave instrumentation** - Traces are created by your agent, not this tool
2. **HTTP endpoint** - Simple request/response interface

**Endpoint signature:**
```python
@app.post("/")
async def respond(query: str) -> str:
    """Process a query and return a response."""
    return agent.run(query)
```

**Google ADK** is currently the best-supported framework.

**AGENT_INFO.md** (optional but recommended) - placed alongside your agent:
```markdown
## Agent Metadata
- Name, Version, Type

## Purpose & Scope
What it does, capabilities, limitations

## Testing Dimensions
### personas
- first_time_user: Description
- power_user: Description

### scenarios  
- common_request: Description
- edge_case: Description

### complexity
- simple: One-step
- multi_step: Multiple tool calls
```

## Tech Stack

**Backend:** FastAPI, Weave SDK, LiteLLM, SQLite  
**Frontend:** Next.js 14, React 18, Tailwind CSS

## License

MIT
