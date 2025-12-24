"""
Settings Service

Manages application settings stored in the database.
Handles secure storage of API keys and provides defaults.
"""

import os
import base64
from typing import Dict, Any, List
from pydantic import BaseModel
from database import get_db, get_db_readonly, now_iso
from logger import get_logger, log_event

logger = get_logger("settings")


# =============================================================================
# Encoding Utilities
# =============================================================================

def _encode_secret(value: str) -> str:
    """Encode a secret value for storage."""
    return base64.b64encode(value.encode()).decode()


def _decode_secret(encoded: str) -> str:
    """Decode a stored secret value."""
    return base64.b64decode(encoded.encode()).decode()


# =============================================================================
# Pydantic Models
# =============================================================================

class SettingDefinition(BaseModel):
    """Definition of a single setting with its default value and metadata."""
    value: str = ""
    is_secret: bool = False
    description: str = ""
    internal: bool = False  # Not shown in Settings UI


class DefaultSettings(BaseModel):
    """All application settings with their defaults and metadata."""
    
    # LLM Settings
    llm_provider: SettingDefinition = SettingDefinition(
        value="openai",
        description="LLM provider (openai, anthropic, google, etc.)"
    )
    llm_model: SettingDefinition = SettingDefinition(
        value="gpt-4o-mini",
        description="Model name for synthetic data generation and AI suggestions"
    )
    llm_api_key: SettingDefinition = SettingDefinition(
        is_secret=True,
        description="API key for the LLM provider"
    )
    llm_api_base: SettingDefinition = SettingDefinition(
        description="Custom API base URL (optional, for proxies or custom endpoints)"
    )
    llm_max_concurrent: SettingDefinition = SettingDefinition(
        value="10",
        description="Maximum concurrent LLM API calls (rate limiting)",
        internal=True
    )
    
    # Weave Settings
    weave_api_key: SettingDefinition = SettingDefinition(
        is_secret=True,
        description="W&B API key for Weave access (required to fetch agent traces)"
    )
    tool_project_name: SettingDefinition = SettingDefinition(
        value="error-analysis-tool",
        description="Where this tool logs its own traces (optional). Format: entity/project or just project name."
    )
    # Legacy settings - kept for backward compatibility but marked as internal
    weave_entity: SettingDefinition = SettingDefinition(
        description="W&B entity (username or team) - now parsed from project name",
        internal=True
    )
    weave_project: SettingDefinition = SettingDefinition(
        description="Weave project - now configured per-agent",
        internal=True
    )
    weave_api_base: SettingDefinition = SettingDefinition(
        value="https://trace.wandb.ai",
        description="Weave API base URL (default: https://trace.wandb.ai)",
        internal=True
    )
    
    # Internal Settings (not exposed in Settings UI)
    suggestion_confidence_threshold: SettingDefinition = SettingDefinition(
        value="0.6",
        description="Minimum confidence level (0.0-1.0) for showing AI suggestions",
        internal=True
    )
    sync_query_limit: SettingDefinition = SettingDefinition(
        value="500",
        description="Maximum number of calls to fetch per sync operation (higher = more data, slower sync)",
        internal=True
    )
    feedback_query_limit: SettingDefinition = SettingDefinition(
        value="500",
        description="Maximum number of feedback entries to fetch per query",
        internal=True
    )
    agent_query_timeout: SettingDefinition = SettingDefinition(
        value="300",
        description="Timeout in seconds for agent query requests (5 min default - increase for very slow agents)",
        internal=True
    )
    weave_api_timeout: SettingDefinition = SettingDefinition(
        value="60",
        description="Timeout in seconds for Weave API requests",
        internal=True
    )
    health_check_timeout: SettingDefinition = SettingDefinition(
        value="10",
        description="Timeout in seconds for agent health checks",
        internal=True
    )
    default_batch_size: SettingDefinition = SettingDefinition(
        value="20",
        description="Default number of queries per synthetic batch",
        internal=True
    )


# Single instance of default settings
DEFAULT_SETTINGS = DefaultSettings()


class SettingValue(BaseModel):
    """A single setting value for API responses."""
    key: str
    value: str
    is_secret: bool = False
    description: str | None = None
    updated_at: str | None = None


class SettingsGroup(BaseModel):
    """A group of related settings for UI display."""
    name: str
    description: str
    settings: List[SettingValue]


# =============================================================================
# Core Settings Functions
# =============================================================================

def get_setting(key: str, default: str | None = None) -> str | None:
    """
    Get a setting value by key.
    
    First checks the database, then falls back to environment variables,
    then to defaults.
    """
    # Get the definition for this key
    definition = getattr(DEFAULT_SETTINGS, key, None)
    
    # Try database first
    with get_db_readonly() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT value, is_secret FROM app_settings WHERE key = ?",
            (key,)
        )
        row = cursor.fetchone()
        
        if row:
            value = row["value"]
            is_secret = row["is_secret"]
            if is_secret:
                value = _decode_secret(value)
            if value:  # Return if non-empty
                return value
    
    # Try environment variable (with common naming patterns)
    env_mappings = {
        "llm_api_key": ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "LLM_API_KEY"],
        "weave_api_key": ["WANDB_API_KEY"],
        "weave_entity": ["WANDB_ENTITY"],
        "weave_project": ["WANDB_PROJECT"],
    }
    
    if key in env_mappings:
        for env_var in env_mappings[key]:
            value = os.environ.get(env_var)
            if value:
                return value
    
    # Check direct environment variable (uppercase key)
    env_value = os.environ.get(key.upper())
    if env_value:
        return env_value
    
    # Fall back to default from Pydantic model
    if definition:
        return definition.value
    
    return default


def set_setting(key: str, value: str, is_secret: bool | None = None) -> None:
    """
    Set a setting value.
    
    If is_secret is not provided, uses the default from DefaultSettings.
    """
    definition = getattr(DEFAULT_SETTINGS, key, None)
    
    if is_secret is None:
        is_secret = definition.is_secret if definition else False
    
    description = definition.description if definition else ""
    
    # Encode secret values
    stored_value = _encode_secret(value) if is_secret else value
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO app_settings (key, value, is_secret, description, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                is_secret = excluded.is_secret,
                updated_at = excluded.updated_at
        """, (key, stored_value, is_secret, description, now_iso()))


def delete_setting(key: str) -> None:
    """Delete a setting (resets to default/env behavior)."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM app_settings WHERE key = ?", (key,))


# =============================================================================
# LLM-Related Functions
# =============================================================================

def get_litellm_kwargs() -> Dict[str, Any]:
    """
    Get kwargs for litellm calls based on current settings.
    
    This allows synthetic generation and AI suggestions to use the configured LLM.
    Logs the resolved configuration for visibility.
    """
    kwargs = {}
    
    # Use DEFAULT_SETTINGS as the single source of truth for the default model
    model = get_setting("llm_model", DEFAULT_SETTINGS.llm_model.value)
    api_key = get_setting("llm_api_key")
    api_base = get_setting("llm_api_base")
    
    # Determine the source of the API key
    api_key_source = "none"
    if api_key:
        kwargs["api_key"] = api_key
        # Check if it came from DB or env
        with get_db_readonly() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM app_settings WHERE key = 'llm_api_key' AND value != ''")
            api_key_source = "settings" if cursor.fetchone() else "environment"
    
    if api_base:
        kwargs["api_base"] = api_base
    
    # Log the resolved configuration
    log_event(logger, "llm.config_resolved",
        model=model,
        has_api_key=bool(api_key),
        api_key_source=api_key_source,
        api_key_suffix=api_key[-4:] if api_key and len(api_key) >= 4 else None,
        api_base=api_base or "default"
    )
    
    return {
        "model": model,
        **kwargs
    }


def check_llm_configured() -> Dict[str, Any]:
    """Check if LLM is properly configured."""
    api_key = get_setting("llm_api_key")
    model = get_setting("llm_model")
    
    return {
        "configured": bool(api_key),
        "model": model,
        "provider": get_setting("llm_provider"),
        "message": "LLM is configured" if api_key else "LLM API key not set. Configure in Settings."
    }


# =============================================================================
# Router-Friendly Functions
# =============================================================================

def get_all_settings(include_secrets: bool = False) -> Dict[str, SettingValue]:
    """
    Get all settings with their current values.
    
    Secret values are masked unless include_secrets is True.
    Falls back to env vars and defaults for missing settings.
    """
    result = {}
    
    # Iterate over all fields in DefaultSettings
    for key, _ in DEFAULT_SETTINGS.model_dump().items():
        definition_obj = getattr(DEFAULT_SETTINGS, key)
        
        # Get actual value (from DB, env, or default)
        actual_value = get_setting(key, definition_obj.value)
        
        # Mask secrets
        display_value = actual_value
        if definition_obj.is_secret and not include_secrets:
            if actual_value:
                display_value = "••••••••" + actual_value[-4:] if len(actual_value) > 4 else "••••••••"
            else:
                display_value = ""
        
        result[key] = SettingValue(
            key=key,
            value=display_value,
            is_secret=definition_obj.is_secret,
            description=definition_obj.description
        )
    
    # Also get any custom settings from DB not in defaults
    with get_db_readonly() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT key, value, is_secret, description, updated_at FROM app_settings")
        
        for row in cursor.fetchall():
            key = row["key"]
            if key not in result:
                value = row["value"]
                is_secret = row["is_secret"]
                
                if is_secret:
                    value = _decode_secret(value)
                    if not include_secrets:
                        value = "••••••••" + value[-4:] if len(value) > 4 else "••••••••"
                
                result[key] = SettingValue(
                    key=key,
                    value=value,
                    is_secret=is_secret,
                    description=row["description"],
                    updated_at=row["updated_at"]
                )
    
    return result


def get_settings_grouped() -> List[SettingsGroup]:
    """
    Get settings organized by group for UI display.
    
    Only returns user-facing settings. Internal settings are not exposed
    in the Settings UI - they're configured per-prompt or kept at defaults.
    
    Note: Weave configuration is simplified:
    - Only API key is required (for accessing agent traces)
    - Tool project is optional (for this tool's own observability)
    - Entity/Project for agent traces are configured per-agent, not globally
    """
    all_settings = get_all_settings(include_secrets=False)
    
    groups = [
        SettingsGroup(
            name="LLM Configuration",
            description="Default LLM settings. Individual prompts can override model and temperature.",
            settings=[
                all_settings.get("llm_api_key", SettingValue(key="llm_api_key", value="", is_secret=True)),
                all_settings.get("llm_model", SettingValue(key="llm_model", value="")),
            ]
        ),
        SettingsGroup(
            name="Weave Configuration",
            description="Connect to W&B Weave to fetch and analyze your agent's traces",
            settings=[
                all_settings.get("weave_api_key", SettingValue(key="weave_api_key", value="", is_secret=True)),
                all_settings.get("tool_project_name", SettingValue(key="tool_project_name", value="error-analysis-tool")),
            ]
        ),
    ]
    
    return groups


def check_weave_configured() -> Dict[str, Any]:
    """
    Check if Weave is properly configured.
    
    Only the API key is required - entity can be derived from the user's W&B account
    and project can be specified per-agent. The tool tracing project is optional.
    """
    api_key = get_setting("weave_api_key")
    entity = get_setting("weave_entity")
    tool_project = get_setting("tool_project_name") or "error-analysis-tool"
    
    # Only API key is required for basic Weave functionality
    configured = bool(api_key)
    
    # Build project_id if entity is available
    project_id = f"{entity}/{tool_project}" if entity else tool_project
    
    return {
        "configured": configured,
        "entity": entity,
        "tool_project": tool_project,
        "project_id": project_id if configured else None,
        "message": "Weave is configured" if configured else "W&B API key not set. Configure in Settings."
    }
