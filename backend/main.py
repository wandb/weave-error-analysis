"""
Backend Service for Error Analysis Workflow

Uses Weave Trace API (https://trace.wandb.ai) to query traces and feedback.

Key Features:
- Weave integration for tracing and prompt versioning
- Background session sync from Weave to local SQLite
- Fast, local-first session browsing
- Auto-sync after batch execution
"""

import os
import asyncio
from contextlib import asynccontextmanager

import weave
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import CORS_ORIGINS, CORS_ALLOW_ALL, get_target_project_id, get_tool_project_id
from logger import setup_logging, get_logger

# Initialize logging before anything else
setup_logging()
logger = get_logger("main")

from routers import (
    feedback_router,
    taxonomy_router,
    agents_router,
    synthetic_router,
    settings_router,
    sessions_router,
    suggestions_router,
    prompts_router,
)


# =============================================================================
# Weave Initialization (Tool Project - for internal traces/prompts)
# =============================================================================

def init_weave():
    """
    Initialize Weave for the TOOL's internal tracing and prompt management.
    
    IMPORTANT: This initializes the TOOL project (error-analysis-tool), NOT
    the user's target project. The target project is accessed via WeaveClient
    using direct API calls with the user-configured project ID.
    
    This separation ensures:
    - Tool traces (prompt management, analysis) don't pollute user's agent project
    - User can analyze their agent project without tool interference
    - Prompt versions are stored in a dedicated tool project
    """
    tool_project_id = get_tool_project_id()
    
    try:
        weave.init(tool_project_id)
        logger.info(f"Weave (tool project) initialized: https://wandb.ai/{tool_project_id}/weave")
        logger.info("Note: User's agent traces are fetched via separate API calls to their configured project")
        return True
    except Exception as e:
        logger.warning(f"Failed to initialize Weave tool project: {e}")
        return False


# =============================================================================
# Lifespan: Startup and Shutdown Events
# =============================================================================

def register_example_agent():
    """
    Register the Example Agent if not already present.
    
    This ensures users see the Example Agent in the Agents tab on first run,
    even before they've configured API keys or generated any data.
    """
    import json
    from pathlib import Path
    from database import get_db, generate_id, now_iso
    from services.agent_info import validate_agent_info
    
    AGENT_DIR = Path(__file__).parent.parent / "agent"
    AGENT_INFO_PATH = AGENT_DIR / "AGENT_INFO.md"
    
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Check if Example Agent already exists
            cursor.execute("SELECT id FROM agents WHERE is_example = 1")
            if cursor.fetchone():
                logger.debug("Example Agent already registered")
                return
            
            # Read AGENT_INFO.md
            if not AGENT_INFO_PATH.exists():
                logger.warning(f"AGENT_INFO.md not found at {AGENT_INFO_PATH}")
                return
            
            agent_info_content = AGENT_INFO_PATH.read_text()
            
            # Validate and parse
            validation = validate_agent_info(agent_info_content)
            if not validation["valid"]:
                logger.warning(f"Invalid AGENT_INFO.md: {validation['errors']}")
                return
            
            parsed = validation["parsed"]
            agent_id = generate_id()
            now = now_iso()
            
            # Insert Example Agent
            cursor.execute("""
                INSERT INTO agents (
                    id, name, version, agent_type, framework, endpoint_url,
                    weave_project, agent_info_raw, agent_info_parsed, 
                    connection_status, is_example, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', 1, ?, ?)
            """, (
                agent_id,
                "Example Agent (TaskFlow Support)",
                parsed.get("version", "1.0.0"),
                parsed.get("agent_type"),
                parsed.get("framework"),
                "http://localhost:9000/query",
                "error-analysis-demo",  # Example agent's Weave project
                agent_info_content,
                json.dumps(parsed),
                now,
                now
            ))
            
            # Insert testing dimensions
            for dim in parsed.get("testing_dimensions", []):
                cursor.execute("""
                    INSERT INTO agent_dimensions (id, agent_id, name, dimension_values, descriptions, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    generate_id(),
                    agent_id,
                    dim.get("name"),
                    json.dumps(dim.get("values", [])),
                    json.dumps(dim.get("descriptions")) if dim.get("descriptions") else None,
                    now
                ))
            
            logger.info("Registered Example Agent (TaskFlow Support)")
            
    except Exception as e:
        logger.warning(f"Failed to register Example Agent: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan context manager for startup/shutdown events.
    
    On startup:
    - Initializes database (creates tables if needed)
    - Registers Example Agent if not present
    - Initializes Weave for tracing
    - Initializes prompt manager
    - Triggers background incremental sync to refresh sessions cache
    """
    # --- STARTUP ---
    logger.info("Starting Error Analysis Backend...")
    
    # Initialize database first (must happen before any DB access)
    from database import ensure_initialized
    ensure_initialized()
    logger.debug("Database initialized")
    
    # Register Example Agent (so it appears in Agents tab on first run)
    register_example_agent()
    
    # Initialize Weave (single init for the entire backend)
    weave_enabled = init_weave()
    
    # Initialize prompt manager (will use existing Weave init)
    try:
        from prompts import prompt_manager
        await prompt_manager.initialize(enable_weave=weave_enabled)
        logger.info(f"Prompt manager initialized ({len(prompt_manager.get_all_prompts())} prompts)")
    except Exception as e:
        logger.warning(f"Failed to initialize prompt manager: {e}")
    
    # Initialize Weave API client (connection pooling)
    try:
        from services.weave_client import weave_client
        await weave_client.init()
        logger.info("WeaveClient HTTP connection pool initialized")
    except Exception as e:
        logger.warning(f"Failed to initialize WeaveClient: {e}")
    
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
    
    # Close Weave API client connections
    try:
        from services.weave_client import weave_client
        await weave_client.close()
        logger.info("WeaveClient HTTP connection pool closed")
    except Exception as e:
        logger.warning(f"Error closing WeaveClient: {e}")


app = FastAPI(
    title="Error Analysis Backend",
    description="Backend service for AI error analysis workflow",
    version="1.0.0",
    lifespan=lifespan,
)

# =============================================================================
# Exception Handlers (Standardized Error Responses)
# =============================================================================

from errors import APIError, api_error_handler

# Handle custom API errors with standardized response format
app.add_exception_handler(APIError, api_error_handler)

# Note: We don't add a generic exception handler here because FastAPI's
# default handler provides better debugging info. In production, you may
# want to add: app.add_exception_handler(Exception, generic_exception_handler)

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
app.include_router(feedback_router)
app.include_router(taxonomy_router)
app.include_router(agents_router)
app.include_router(synthetic_router)
app.include_router(settings_router)
app.include_router(sessions_router)  # Local-first session management (replaces threads)
app.include_router(suggestions_router)  # AI suggestion service for trace quality
app.include_router(prompts_router)  # Prompt management


# =============================================================================
# Core Endpoints
# =============================================================================

@app.get("/")
async def root():
    """Health check endpoint."""
    target_project = get_target_project_id()
    return {
        "status": "healthy",
        "service": "error-analysis-backend",
        "tool_project": get_tool_project_id(),
        "target_project": target_project or "(not configured - set in Settings)",
    }


# =============================================================================
# Internal/Maintenance Endpoints
# These endpoints are for debugging and maintenance. They are not exposed in
# the frontend UI but can be called directly for troubleshooting.
# =============================================================================

@app.get("/api/db-stats", include_in_schema=False)
async def db_stats():
    """
    INTERNAL: Get database statistics for monitoring.
    
    Returns table sizes, row counts, and SQLite stats.
    Useful for debugging performance issues or data growth.
    """
    from database import get_db_stats, optimize_db
    return get_db_stats()


@app.post("/api/db-optimize", include_in_schema=False)
async def db_optimize():
    """
    INTERNAL: Trigger database optimization.
    
    Runs ANALYZE on SQLite tables to update query planner statistics.
    Call this after large data imports or when queries seem slow.
    """
    from database import optimize_db
    optimize_db()
    return {"status": "optimized"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
