# Contributing to Weave Error Analysis

## Prerequisites

- Python 3.12+
- Node.js 18+ (for frontend)
- [uv](https://docs.astral.sh/uv/) - Fast Python package manager
- pnpm (recommended) or npm

## Quick Start

```bash
git clone <repo>
cd weave-error-analysis

# 1. Install dependencies
uv sync

# 2. Configure environment
cp .env.example .env
# Edit .env - at minimum set OPENAI_API_KEY

# 3. Run everything
uv run ea
```

Opens http://localhost:3000 with backend on :8000.

## Development Workflows

### Running Components Separately

For debugging or faster iteration, run each component in separate terminals:

**Terminal 1 - Backend (with auto-reload):**
```bash
cd backend
uv run uvicorn main:app --reload --port 8000
```

**Terminal 2 - Frontend (with HMR):**
```bash
cd frontend
pnpm dev
```

**Terminal 3 - Example Agent (optional):**
```bash
uv run uvicorn agent.agent_server:app --reload --port 9000
```

Or start the Example Agent from the UI (Agents tab → Start Example Agent).

### Environment Variables

All configuration lives in the root `.env` file. See `.env.example` for all options.

**Priority order:**
1. Settings UI (stored in database) 
2. Environment variables (`.env`)
3. Default values

This means you can:
- Set API keys in `.env` for development
- Override specific settings via the UI
- Use defaults for everything else

### Common Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | API key for AI features |
| `WANDB_API_KEY` | For Weave | W&B API key |
| `WANDB_ENTITY` | For Weave | W&B username or team |
| `WEAVE_PROJECT` | For Weave | Agent's trace project |

### Adding New Configuration

1. Add to `DEFAULT_SETTINGS` in `backend/services/settings.py`
2. Add getter function in `backend/config.py`
3. Document in `.env.example`
4. If user-facing, add to Settings UI groups in `get_settings_grouped()`

## Project Structure

```
weave-error-analysis/
├── pyproject.toml       # Python package definition (uv)
├── .env.example         # Environment template
├── .env                 # Your local config (gitignored)
│
├── error_analysis_cli/  # CLI entry point (uv run ea)
│   └── main.py          # Typer app
│
├── backend/             # FastAPI backend
│   ├── main.py          # App entry point
│   ├── config.py        # Configuration loading
│   ├── database.py      # SQLite database
│   ├── routers/         # API routes
│   ├── services/        # Business logic
│   └── prompts/         # Prompt definitions
│
├── frontend/            # Next.js frontend
│   ├── package.json     # Node deps
│   └── src/app/         # React components
│
└── agent/               # Example agent (Google ADK)
    ├── agent_server.py  # HTTP wrapper
    └── customer_support.py
```

## Testing

### Running Tests

```bash
# Install test dependencies
uv pip install pytest pytest-asyncio

# Run all tests
uv run pytest tests/ -v

# Run specific test file
uv run pytest tests/backend/services/test_llm.py -v

# Run specific test class
uv run pytest tests/backend/services/test_llm.py::TestTemperatureHandling -v

# Run with coverage (if installed)
uv run pytest tests/ --cov=backend --cov-report=term-missing
```

### Test Structure

```
tests/
├── backend/
│   └── services/
│       └── test_llm.py    # LLM client tests
```

### Writing Tests

- Use pytest fixtures to reduce boilerplate
- Mock external services (litellm, settings DB) to avoid real API calls
- Use `@pytest.mark.asyncio` for async tests
- Group related tests in classes (e.g., `TestTemperatureHandling`)

### Manual Testing

For end-to-end verification, run through the UI workflow:

1. Run `uv run ea`
2. Go through: Settings → Agent → Synthetic → Sessions → Taxonomy
3. Verify each feature works

## Troubleshooting

### Port already in use

The CLI auto-detects available ports. If you need specific ports:

```bash
uv run ea --port 3001 --backend-port 8001
```

Or use `--strict-ports` to fail instead of auto-detect.

### API key not working

1. Check `.env` file exists in root directory
2. Verify no extra quotes: `OPENAI_API_KEY=sk-xxx` (not `"sk-xxx"`)
3. Check Settings tab - UI settings override env vars

### Weave traces not showing

1. Verify `WANDB_API_KEY`, `WANDB_ENTITY`, `WEAVE_PROJECT` are set
2. Check Settings tab for configuration status
3. Ensure your agent is actually logging to the configured project

