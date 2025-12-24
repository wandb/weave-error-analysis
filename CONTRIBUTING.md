# Contributing to Weave Error Analysis

## Prerequisites

- Python 3.11+
- Node.js 18+ (for frontend)
- [uv](https://docs.astral.sh/uv/) - Fast Python package manager
- pnpm (recommended) or npm

## Quick Start

```bash
git clone <repo>
cd weave-error-analysis

# Install dependencies and run
uv sync
uv run ea
```

Opens http://localhost:3000 with backend on :8000.

**First-time setup:** The app prompts you to configure API keys through the UI on first launch. No `.env` file needed.

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

### Configuration

All configuration is managed through the **Settings UI** in the app. Settings are stored in the local SQLite database.

**Priority order:**
1. Settings UI (stored in database) — **primary**
2. Environment variables (optional override)
3. Default values in code

This means:
- Most users configure everything through the UI
- Developers can optionally use environment variables for automation
- All settings have sensible defaults

### Environment Variables (Optional)

You can override settings via environment variables if needed (e.g., for CI or automation):

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key | (configured via UI) |
| `WANDB_API_KEY` | W&B API key for Weave | (configured via UI) |
| `WANDB_ENTITY` | W&B username or team | (optional) |
| `WEAVE_PROJECT` | Agent's trace project | (optional) |
| `TOOL_PROJECT_NAME` | Tool's internal traces | `error-analysis-tool` |

To use environment variables, create a `.env` file in the project root. The app loads it automatically.

### Adding New Configuration

1. Add to `DefaultSettings` in `backend/services/settings.py`
2. Add getter function in `backend/config.py` if needed
3. If user-facing, add to Settings UI groups in `get_settings_grouped()`

## Project Structure

```
weave-error-analysis/
├── pyproject.toml       # Python package definition (uv)
├── .env                 # Optional local config (gitignored)
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
2. Go through: Settings → Agent → Synthetic → Taxonomy
3. Verify each feature works

## Troubleshooting

### Port already in use

The CLI auto-detects available ports. If you need specific ports:

```bash
uv run ea --port 3001 --backend-port 8001
```

Or use `--strict-ports` to fail instead of auto-detect.

### API key not working

1. Check Settings tab in the UI — this is where keys should be configured
2. Verify no extra quotes around values
3. If using `.env` file, ensure format is `KEY=value` (no quotes needed)

### Weave traces not showing

1. Verify W&B API key is set in Settings
2. Check that your agent is configured with the correct Weave project
3. Ensure your agent is actually logging traces to that project
