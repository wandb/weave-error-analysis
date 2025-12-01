# Weave Error Analysis Workflow

Bottom-up error analysis for AI agents using W&B Weave.

![Error Analysis Workflow](./assets/image.png)

## Components

- **Agent** (`agent/`) - Customer Support Bot using Google ADK + OpenAI, instrumented with Weave OTEL
- **Backend** (`backend/`) - FastAPI service querying Weave traces and feedback
- **Frontend** (`frontend/`) - Next.js UI for trace analysis and failure mode discovery

## Setup

### Environment Variables

Create `.env` in the root:

```bash
WANDB_API_KEY=your_key
WANDB_ENTITY=your_username
WEAVE_PROJECT=error-analysis-demo
OPENAI_API_KEY=your_openai_key
```

### Install & Run

```bash
# Agent
cd agent && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python generate_traces.py

# Backend
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend
cd frontend && pnpm install && pnpm dev
```

Visit http://localhost:3000

## Workflow

1. **Generate traces** - Run agent scenarios that log to Weave
2. **Open code** - Browse traces, write notes about issues
3. **Categorize** - LLM clusters notes into failure modes
4. **Iterate** - Refine understanding as patterns emerge

## License

MIT
