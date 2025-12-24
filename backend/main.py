"""
Backend Service for Error Analysis Workflow

Uses Weave Trace API (https://trace.wandb.ai) to query traces and feedback.

Key Features:
- Weave integration for tracing and prompt versioning
- Synthetic batch generation and execution with batch_id attribution
- Deep links to Weave UI for trace review
- Feedback sync from Weave for taxonomy building
- AI-assisted failure mode categorization
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
    prompts_router,
)


# =============================================================================
# Weave Initialization (Tool Project - for internal traces/prompts)
# Lazy initialization - only initializes when credentials are available
# =============================================================================

# Track if Weave has been initialized
_weave_initialized = False


def weave_credentials_configured() -> bool:
    """
    Check if Weave credentials are available for the tool's internal project.
    
    Checks for WANDB_API_KEY in:
    1. Database settings (weave_api_key)
    2. Environment variable (WANDB_API_KEY)
    """
    from services.settings import get_setting
    import os
    
    # Check database setting first
    api_key = get_setting("weave_api_key")
    if api_key:
        return True
    
    # Fall back to environment variable
    return bool(os.getenv("WANDB_API_KEY"))


def init_weave() -> bool:
    """
    Initialize Weave for the TOOL's internal tracing and prompt management.
    
    This is a LAZY initialization - only called when credentials are available.
    
    IMPORTANT: This initializes the TOOL project (error-analysis-tool), NOT
    the user's target project. The target project is accessed via WeaveClient
    using direct API calls with the user-configured project ID.
    
    This separation ensures:
    - Tool traces (prompt management, analysis) don't pollute user's agent project
    - User can analyze their agent project without tool interference
    - Prompt versions are stored in a dedicated tool project
    """
    global _weave_initialized
    
    if _weave_initialized:
        return True
    
    tool_project_id = get_tool_project_id()
    
    # Only initialize if we have a tool project configured
    if not tool_project_id:
        logger.info("Tool project not configured - skipping Weave initialization")
        return False
    
    try:
        weave.init(tool_project_id)
        _weave_initialized = True
        logger.info(f"Weave (tool project) initialized: https://wandb.ai/{tool_project_id}/weave")
        logger.debug("Note: User's agent traces are fetched via separate API calls to their configured project")
        return True
    except Exception as e:
        logger.warning(f"Failed to initialize Weave tool project: {e}")
        return False


def is_weave_initialized() -> bool:
    """Check if Weave has been initialized."""
    return _weave_initialized


async def ensure_weave_and_prompts():
    """
    Ensure Weave is initialized and prompts are published.
    Called when settings are saved or when Weave features are first used.
    """
    global _weave_initialized
    
    if not weave_credentials_configured():
        logger.debug("Weave credentials not configured - skipping initialization")
        return False
    
    # Initialize Weave if not already done
    if not _weave_initialized:
        if not init_weave():
            return False
    
    # Enable Weave for prompt manager (will publish prompts if upgrading from local mode)
    try:
        from prompts import prompt_manager
        await prompt_manager.enable_weave()
    except Exception as e:
        logger.warning(f"Failed to enable Weave for prompt manager: {e}")
    
    return True


# =============================================================================
# Lifespan: Startup and Shutdown Events
# =============================================================================

def register_example_agent():
    """
    Register the Example Agent if not already present.
    
    This ensures users see the Example Agent in the Agents tab on first run,
    even before they've configured API keys or generated any data.
    """
    from database import get_db, generate_id, now_iso
    
    # Example agent context - simple description
    EXAMPLE_AGENT_CONTEXT = """TaskFlow Support Agent is a customer support bot for TaskFlow, a productivity and task management application.

The agent can:
- Answer pricing questions using the get_product_info tool
- Check subscription status for users
- Process refund requests with eligibility verification
- Help users compare plans and upgrade

Target users are free tier explorers, pro users with billing questions, and business admins managing teams. The agent cannot access real payment systems (demo mode), modify accounts directly, or make promises about unreleased features.

The system prompt emphasizes using tools for accurate information rather than making up prices or policies."""
    
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Check if Example Agent already exists
            cursor.execute("SELECT id FROM agents WHERE is_example = 1")
            if cursor.fetchone():
                logger.debug("Example Agent already registered")
                return
            
            agent_id = generate_id()
            now = now_iso()
            
            # Insert Example Agent with simplified schema
            cursor.execute("""
                INSERT INTO agents (
                    id, name, endpoint_url, weave_project, agent_context,
                    connection_status, is_example, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'unknown', 1, ?, ?)
            """, (
                agent_id,
                "Example Agent (TaskFlow Support)",
                "http://localhost:9000/query",
                "error-analysis-demo",
                EXAMPLE_AGENT_CONTEXT,
                now,
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
    - Lazy Weave initialization (only if credentials configured)
    - Deferred prompt publishing (only when Weave is ready)
    - Initializes Weave API client for trace fetching
    
    Note: Weave and prompts are initialized lazily. If credentials aren't
    configured at startup, they'll be initialized when the user saves
    settings for the first time.
    """
    # --- STARTUP ---
    logger.info("Starting Error Analysis Backend...")
    
    # Initialize database first (must happen before any DB access)
    from database import ensure_initialized
    ensure_initialized()
    logger.debug("Database initialized")
    
    # Register Example Agent (so it appears in Agents tab on first run)
    register_example_agent()
    
    # Lazy Weave initialization - only if credentials are already configured
    if weave_credentials_configured():
        weave_enabled = init_weave()
        
        # Initialize prompt manager with Weave versioning
        try:
            from prompts import prompt_manager
            await prompt_manager.initialize(enable_weave=weave_enabled)
            logger.info(f"Prompt manager initialized ({len(prompt_manager.get_all_prompts())} prompts)")
        except Exception as e:
            logger.warning(f"Failed to initialize prompt manager: {e}")
    else:
        logger.info("Weave credentials not configured - will initialize when settings are provided")
        # Initialize prompt manager without Weave (local-only mode)
        try:
            from prompts import prompt_manager
            await prompt_manager.initialize(enable_weave=False)
            logger.info(f"Prompt manager initialized in local mode ({len(prompt_manager.get_all_prompts())} prompts)")
        except Exception as e:
            logger.warning(f"Failed to initialize prompt manager: {e}")
    
    # Initialize Weave API client (connection pooling) - this is for fetching traces
    try:
        from services.weave_client import weave_client
        await weave_client.init()
        logger.info("WeaveClient HTTP connection pool initialized")
    except Exception as e:
        logger.warning(f"Failed to initialize WeaveClient: {e}")
    
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
