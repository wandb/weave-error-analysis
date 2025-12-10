"""
Backend Service for Error Analysis Workflow

Uses Weave Trace API (https://trace.wandb.ai) to query traces and feedback.

Key Features:
- Background session sync from Weave to local SQLite (Phase 2)
- Fast, local-first session browsing
- Auto-sync after batch execution
"""

# =============================================================================
# Disable Weave/Wandb Tracing for Backend LLM Calls
# =============================================================================
# The backend uses litellm for internal LLM calls (taxonomy categorization, etc.)
# We don't want these internal calls traced to Weave - only agent traces should appear.
#
# IMPORTANT: These env vars must be set BEFORE importing weave/wandb/litellm:
# - WANDB_MODE=disabled prevents wandb SDK from logging
# - This does NOT affect our WeaveClient (which uses raw HTTP with API key)
import os
os.environ["WEAVE_DISABLED"] = "true"  # Disable wandb tracing for this process

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import CORS_ORIGINS, CORS_ALLOW_ALL, PROJECT_ID
from logger import setup_logging, get_logger

# Initialize logging before anything else
setup_logging()
logger = get_logger("main")

from routers import (
    threads_router,
    traces_router,
    feedback_router,
    categorize_router,
    taxonomy_router,
    agents_router,
    synthetic_router,
    settings_router,
    sessions_router,
    suggestions_router,
)


# =============================================================================
# Lifespan: Startup and Shutdown Events
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan context manager for startup/shutdown events.
    
    On startup:
    - Triggers background incremental sync to refresh sessions cache
    """
    # --- STARTUP ---
    logger.info("Starting Error Analysis Backend...")
    
    # Trigger initial session sync in background (non-blocking)
    try:
        from services.session_sync import startup_sync
        asyncio.create_task(startup_sync())
        logger.info("Scheduled startup session sync")
    except Exception as e:
        logger.warning(f"Failed to schedule startup sync: {e}")
    
    yield
    
    # --- SHUTDOWN ---
    logger.info("Shutting down Error Analysis Backend...")


app = FastAPI(
    title="Error Analysis Backend",
    description="Backend service for AI error analysis workflow",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS configuration for SSE streaming support
# SSE endpoints are called directly from frontend to backend (bypassing Next.js proxy)
# This requires proper CORS headers to be set
app.add_middleware(
    CORSMiddleware,
    # In development: explicit origins. Set CORS_ALLOW_ALL=true for wildcard.
    allow_origins=["*"] if CORS_ALLOW_ALL else CORS_ORIGINS,
    # Credentials not needed for SSE, disable to allow wildcard origins
    allow_credentials=not CORS_ALLOW_ALL,
    allow_methods=["*"],
    allow_headers=["*"],
    # Expose headers needed for SSE streaming
    expose_headers=["Content-Type", "Cache-Control", "Connection"],
)

# Register routers
app.include_router(threads_router)
app.include_router(traces_router)
app.include_router(feedback_router)
app.include_router(categorize_router)
app.include_router(taxonomy_router)
app.include_router(agents_router)
app.include_router(synthetic_router)
app.include_router(settings_router)
app.include_router(sessions_router)  # New: local-first session management
app.include_router(suggestions_router)  # AI suggestion service for trace quality


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "error-analysis-backend",
        "project": PROJECT_ID
    }


@app.get("/api/db-stats")
async def db_stats():
    """Get database statistics for monitoring."""
    from database import get_db_stats, optimize_db
    return get_db_stats()


@app.post("/api/db-optimize")
async def db_optimize():
    """Trigger database optimization (analyze tables)."""
    from database import optimize_db
    optimize_db()
    return {"status": "optimized"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
