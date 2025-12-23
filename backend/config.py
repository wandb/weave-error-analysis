"""
Configuration for the Error Analysis Backend.

Configuration is loaded with the following priority:
1. Database settings (user-configured via UI)
2. Environment variables
3. Default values

IMPORTANT: This tool uses TWO separate Weave projects:

1. TARGET PROJECT (user's agent traces):
   - Configured via Settings UI or environment variables
   - Where the user's agent logs traces that we want to analyze
   - Used by WeaveClient to fetch traces
   - Examples: "my-team/customer-support-agent", "my-team/chatbot-prod"

2. TOOL PROJECT (internal):
   - Fixed name: "error-analysis-tool"
   - Where THIS tool logs its own traces and prompts
   - Used by weave.init() in main.py for prompt versioning
   - Kept separate so tool traces don't pollute user's agent project
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root (one directory up from backend/)
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)


# =============================================================================
# Tool Project (Internal - for this tool's traces and prompts)
# =============================================================================

# Default project name for the tool's internal traces/prompts
# Can be overridden via TOOL_PROJECT_NAME env var or Settings
DEFAULT_TOOL_PROJECT_NAME = "error-analysis-tool"


def get_tool_project_name() -> str:
    """
    Get the tool project name from settings, env var, or default.
    
    Priority: Settings DB → TOOL_PROJECT_NAME env var → default
    """
    return get_config_value("tool_project_name", "TOOL_PROJECT_NAME", DEFAULT_TOOL_PROJECT_NAME)


def get_tool_project_id() -> str:
    """
    Get the full project ID for this tool's internal traces and prompts.
    
    This is always separate from the target project to avoid mixing
    tool traces with user's agent traces.
    
    The project name is configurable for:
    - Users who want to customize the tool's project name
    - Avoiding conflicts with existing projects
    """
    entity = os.getenv("WANDB_ENTITY", "")
    tool_project = get_tool_project_name()
    if entity:
        return f"{entity}/{tool_project}"
    return tool_project


# Legacy alias for backwards compatibility
TOOL_PROJECT_NAME = DEFAULT_TOOL_PROJECT_NAME


# =============================================================================
# Target Project (User's agent traces to analyze)
# =============================================================================

def get_config_value(setting_key: str, env_key: str, default: str = "") -> str:
    """
    Get a configuration value with priority:
    1. Database setting (if database is initialized)
    2. Environment variable
    3. Default value
    
    Note: Uses lazy import to avoid circular dependency with services.settings.
    Database errors are expected during startup before init_db() runs.
    """
    # Try database first (lazy import to avoid circular dependency)
    try:
        from services.settings import get_setting
        db_value = get_setting(setting_key)
        if db_value:
            return db_value
    except ImportError:
        pass  # Module not available (shouldn't happen in normal operation)
    except Exception:
        # Database not initialized yet - this is expected during startup
        # before ensure_initialized() is called in lifespan
        pass
    
    # Fall back to environment variable
    env_value = os.getenv(env_key)
    if env_value:
        return env_value
    
    return default


# W&B / Weave Configuration for TARGET project (user's agent traces)
def get_wandb_api_key() -> str:
    return get_config_value("weave_api_key", "WANDB_API_KEY", "")


def get_wandb_entity() -> str:
    return get_config_value("weave_entity", "WANDB_ENTITY", "")


def get_target_project() -> str:
    """
    Get the TARGET project name (user's agent traces).
    
    This is the Weave project where the user's agent logs traces.
    Must be configured by user - defaults to empty string to prompt configuration.
    """
    return get_config_value("weave_project", "WEAVE_PROJECT", "")


def get_target_project_id() -> str:
    """
    Get the full TARGET project ID (entity/project) for fetching user's agent traces.
    
    Returns empty string if not configured, which will cause WeaveClient
    operations to fail gracefully with a helpful error message.
    """
    entity = get_wandb_entity()
    project = get_target_project()
    
    if not project:
        return ""  # Not configured
    
    return f"{entity}/{project}" if entity else project


# Legacy aliases for backwards compatibility
# These now point to TARGET project (user's agent traces)
def get_weave_project() -> str:
    """DEPRECATED: Use get_target_project() instead."""
    return get_target_project()


def get_project_id() -> str:
    """DEPRECATED: Use get_target_project_id() instead."""
    return get_target_project_id()


# Static values from env (for backwards compatibility)
# These are now for the TARGET project (user's agent traces)
WANDB_API_KEY = os.getenv("WANDB_API_KEY")
WANDB_ENTITY = os.getenv("WANDB_ENTITY")
WEAVE_PROJECT = os.getenv("WEAVE_PROJECT", "")  # No default - must be configured
PROJECT_ID = f"{WANDB_ENTITY}/{WEAVE_PROJECT}" if WANDB_ENTITY and WEAVE_PROJECT else WEAVE_PROJECT


# =============================================================================
# Query/Sync Limits (Configurable via Settings)
# =============================================================================

def get_sync_query_limit() -> int:
    """Get the maximum number of calls to fetch per sync operation."""
    return int(get_config_value("sync_query_limit", "SYNC_QUERY_LIMIT", "500"))


def get_feedback_query_limit() -> int:
    """Get the maximum number of feedback entries to fetch per query."""
    return int(get_config_value("feedback_query_limit", "FEEDBACK_QUERY_LIMIT", "500"))


# =============================================================================
# Timeout Configuration (Configurable via Settings)
# =============================================================================

def get_agent_query_timeout() -> float:
    """Get timeout in seconds for agent query requests (5 min default)."""
    return float(get_config_value("agent_query_timeout", "AGENT_QUERY_TIMEOUT", "300"))


def get_weave_api_timeout() -> float:
    """Get timeout in seconds for Weave API requests."""
    return float(get_config_value("weave_api_timeout", "WEAVE_API_TIMEOUT", "60"))


def get_health_check_timeout() -> float:
    """Get timeout in seconds for agent health checks."""
    return float(get_config_value("health_check_timeout", "HEALTH_CHECK_TIMEOUT", "10"))


# =============================================================================
# Synthetic Query Configuration
# =============================================================================

def get_default_batch_size() -> int:
    """Get default number of queries per synthetic batch."""
    return int(get_config_value("default_batch_size", "DEFAULT_BATCH_SIZE", "20"))

# Weave Trace API
# Default to public Weave API; enterprise users can configure via Settings or WEAVE_API_BASE env var
def get_weave_api_base() -> str:
    """
    Get the Weave API base URL.
    
    Configurable for enterprise/self-hosted Weave deployments.
    Priority: Settings DB → WEAVE_API_BASE env var → default
    """
    return get_config_value("weave_api_base", "WEAVE_API_BASE", "https://trace.wandb.ai")


# Keep static value for backwards compatibility with imports, but prefer function
WEAVE_API_BASE = get_weave_api_base()

# CORS Origins - Configure for SSE streaming direct to backend
# In production, set CORS_ORIGINS env var to comma-separated list of allowed origins
# e.g., CORS_ORIGINS=https://app.example.com,https://www.example.com
_cors_env = os.getenv("CORS_ORIGINS", "")
if _cors_env:
    CORS_ORIGINS = [origin.strip() for origin in _cors_env.split(",") if origin.strip()]
else:
    # Default: allow common development origins
    CORS_ORIGINS = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]

# For SSE streaming, we also need to handle dynamic origins (same hostname, different port)
CORS_ALLOW_ALL = os.getenv("CORS_ALLOW_ALL", "false").lower() == "true"
