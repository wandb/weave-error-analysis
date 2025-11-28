# Weave Error Analysis Workflow

A practical implementation of the bottom-up error analysis workflow for AI systems, as described by Hamel Husain and Shreya Shankar.

![Error Analysis Workflow](./assets/image.png)

## What This Does

This system implements the iterative error analysis process:

1. **Generate traces** - Run an AI agent (Travel Planner) that logs to W&B Weave
2. **Read & Open Code** - View traces in a custom UI, write notes about problems/surprises
3. **Axial Coding** - Use LLM to cluster similar notes into failure mode categories
4. **Re-Code Traces** - Label traces with discovered failure modes
5. **Iterate** - Refine categories as you see more data

## Architecture

```
┌──────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Travel Planner  │────▶│    W&B Weave    │◀────│  Backend API    │
│  Agent (ADK)     │     │  (Observability)│     │   (FastAPI)     │
└──────────────────┘     └─────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
                                                ┌─────────────────┐
                                                │    Frontend     │
                                                │   (Next.js)     │
                                                └─────────────────┘
```

## Components

### 1. Travel Planner Agent (`agent/`)
An ADK-based AI agent that helps users plan trips. Instrumented with W&B Weave for observability.

### 2. Backend Service (`backend/`)
FastAPI service that:
- Queries traces from Weave
- Manages feedback and notes
- Uses GPT-4 (via LiteLLM) to categorize notes into failure modes

### 3. Frontend (`frontend/`)
Next.js application for error analysis with:
- Trace list view with time filtering
- Trace detail view with full inputs/outputs
- Open coding interface (add notes)
- LLM-powered failure mode categorization

## Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+ with pnpm
- W&B account (for Weave)
- Google API key (for ADK agent)
- OpenAI API key (for categorization)

### 1. Set Up Environment Variables

Create a `.env` file in the root directory:

```bash
# W&B Weave
WANDB_API_KEY=your_wandb_api_key
WEAVE_PROJECT=error-analysis-demo
WANDB_ENTITY=your_wandb_username  # Optional

# Google AI (for ADK)
GOOGLE_API_KEY=your_google_api_key

# OpenAI (for categorization)
OPENAI_API_KEY=your_openai_api_key
CATEGORIZATION_MODEL=gpt-4o  # or gpt-4-turbo, gpt-3.5-turbo
```

### 2. Set Up the Agent

```bash
cd agent
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Set Up the Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 4. Set Up the Frontend

```bash
cd frontend
pnpm install
```

### 5. Generate Some Traces

```bash
cd agent
source .venv/bin/activate
python generate_traces.py
```

This will run various test scenarios through the travel planner agent.

### 6. Start the Backend

```bash
cd backend
source .venv/bin/activate
uvicorn main:app --reload --port 8000
```

### 7. Start the Frontend

```bash
cd frontend
pnpm dev
```

Visit http://localhost:3000 to start analyzing!

## Usage Workflow

### Step 1: Generate Traces
Run your agent (or use `generate_traces.py`) to create traces in Weave.

### Step 2: Open Code Traces
In the UI:
- Browse traces in the left panel
- Click a trace to see its full details
- Use thumbs up/down for quick feedback
- Write open-ended notes about any issues you observe

### Step 3: Categorize Failure Modes
Once you have several notes:
- Click "Categorize" in the right panel
- The LLM will cluster similar notes into failure mode categories
- Review the suggested categories and their severity

### Step 4: Iterate
- Continue reviewing traces
- Add more notes
- Re-categorize as patterns become clearer
- Refine your understanding of failure modes

## Customization

### Using a Different Agent
Replace `agent/travel_planner.py` with your own agent. Just ensure:
1. It's instrumented with `@weave.op()` decorators
2. It calls `weave.init(project_name)` at startup

### Changing the Categorization Model
Set `CATEGORIZATION_MODEL` in your `.env`:
- `gpt-4o` (recommended)
- `gpt-4-turbo`
- `claude-3-opus-20240229` (if using Anthropic)

### Custom Failure Mode Prompts
Edit the prompt in `backend/main.py` under the `categorize_notes` endpoint.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/traces` | GET | List traces with filtering |
| `/api/traces/{id}` | GET | Get trace details |
| `/api/traces/{id}/feedback` | POST | Add feedback to a trace |
| `/api/feedback-summary` | GET | Get feedback statistics |
| `/api/categorize` | POST | Categorize notes into failure modes |
| `/api/op-names` | GET | Get unique operation names |

## Key Insights from the Workflow

From Hamel Husain's error analysis approach:

1. **Skip generic metrics** - "Helpfulness" and "toxicity" often miss domain-specific issues
2. **Let metrics emerge** - Use bottom-up analysis to discover what actually matters
3. **100 traces rule** - Aim for ~100 high-quality, diverse traces before drawing conclusions
4. **Theoretical saturation** - Keep iterating until no new failure modes appear
5. **Simple tools win** - A custom data viewer beats complex dashboards

## License

MIT
