"""
Configuration for the Error Analysis Backend.

Configuration is loaded with the following priority:
1. Database settings (user-configured via UI)
2. Environment variables
3. Default values
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from parent directory (project root)
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)


def get_config_value(setting_key: str, env_key: str, default: str = "") -> str:
    """
    Get a configuration value with priority:
    1. Database setting
    2. Environment variable
    3. Default value
    """
    # Try database first (lazy import to avoid circular dependency)
    try:
        from services.settings import get_setting
        db_value = get_setting(setting_key)
        if db_value:
            return db_value
    except Exception:
        pass  # Settings table might not exist yet
    
    # Fall back to environment variable
    env_value = os.getenv(env_key)
    if env_value:
        return env_value
    
    return default


# W&B / Weave Configuration (these are now dynamic properties)
def get_wandb_api_key() -> str:
    return get_config_value("weave_api_key", "WANDB_API_KEY", "")


def get_wandb_entity() -> str:
    return get_config_value("weave_entity", "WANDB_ENTITY", "")


def get_weave_project() -> str:
    return get_config_value("weave_project", "WEAVE_PROJECT", "error-analysis-demo")


def get_project_id() -> str:
    entity = get_wandb_entity()
    project = get_weave_project()
    return f"{entity}/{project}" if entity else project


# Static values from env (for backwards compatibility)
WANDB_API_KEY = os.getenv("WANDB_API_KEY")
WANDB_ENTITY = os.getenv("WANDB_ENTITY")
WEAVE_PROJECT = os.getenv("WEAVE_PROJECT", "error-analysis-demo")
PROJECT_ID = f"{WANDB_ENTITY}/{WEAVE_PROJECT}" if WANDB_ENTITY else WEAVE_PROJECT

# Weave Trace API
WEAVE_API_BASE = "https://trace.wandb.ai"

# LLM Configuration
CATEGORIZATION_MODEL = os.getenv("CATEGORIZATION_MODEL", "gpt-4o-mini")

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

