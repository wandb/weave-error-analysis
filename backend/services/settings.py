"""
Settings Service

Manages application settings stored in the database.
Handles secure storage of API keys and provides defaults.
"""

import os
import base64
from typing import Optional, Dict, Any, List
from datetime import datetime
from pydantic import BaseModel
from database import get_db, get_db_readonly, now_iso
from logger import get_logger, log_event

logger = get_logger("settings")


# Simple encoding for API keys (not true encryption, but obfuscates in DB)
# For production, use proper encryption with a key stored securely
def _encode_secret(value: str) -> str:
    """Encode a secret value for storage."""
    if not value:
        return ""
    return base64.b64encode(value.encode()).decode()


def _decode_secret(encoded: str) -> str:
    """Decode a stored secret value."""
    if not encoded:
        return ""
    try:
        return base64.b64decode(encoded.encode()).decode()
    except Exception:
        return encoded  # Return as-is if not encoded


# Default settings with descriptions
DEFAULT_SETTINGS = {
    # LLM Settings
    "llm_provider": {
        "value": "openai",
        "is_secret": False,
        "description": "LLM provider (openai, anthropic, google, etc.)"
    },
    "llm_model": {
        "value": "gpt-5-mini",
        "is_secret": False,
        "description": "Model name for synthetic data generation and AI suggestions"
    },
    "llm_api_key": {
        "value": "",
        "is_secret": True,
        "description": "API key for the LLM provider"
    },
    "llm_api_base": {
        "value": "",
        "is_secret": False,
        "description": "Custom API base URL (optional, for proxies or custom endpoints)"
    },
    
    # Weave Settings (for connecting to USER'S agent project)
    "weave_api_key": {
        "value": "",
        "is_secret": True,
        "description": "W&B API key for Weave access"
    },
    "weave_entity": {
        "value": "",
        "is_secret": False,
        "description": "W&B entity (username or team) where your agent's traces are logged"
    },
    "weave_project": {
        "value": "",
        "is_secret": False,
        "description": "Weave project name where your agent logs traces (e.g., 'customer-support-agent')"
    },
    "weave_api_base": {
        "value": "https://trace.wandb.ai",
        "is_secret": False,
        "description": "Weave API base URL (default: https://trace.wandb.ai, change for enterprise/self-hosted)"
    },
    
    # Internal Settings (not exposed in Settings UI)
    # These are used by services but configured programmatically or kept at defaults
    "suggestion_confidence_threshold": {
        "value": "0.6",
        "is_secret": False,
        "description": "Minimum confidence level (0.0-1.0) for showing AI suggestions",
        "internal": True,  # Not shown in Settings UI
    },
}


class SettingValue(BaseModel):
    """A single setting value."""
    key: str
    value: str
    is_secret: bool = False
    description: Optional[str] = None
    updated_at: Optional[str] = None


class SettingsGroup(BaseModel):
    """A group of related settings."""
    name: str
    description: str
    settings: List[SettingValue]


def get_setting(key: str, default: Optional[str] = None) -> Optional[str]:
    """
    Get a setting value by key.
    
    First checks the database, then falls back to environment variables,
    then to defaults.
    """
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
    
    # Fall back to default
    if key in DEFAULT_SETTINGS:
        return DEFAULT_SETTINGS[key]["value"]
    
    return default


def set_setting(key: str, value: str, is_secret: Optional[bool] = None) -> None:
    """
    Set a setting value.
    
    If is_secret is not provided, uses the default from DEFAULT_SETTINGS.
    """
    if is_secret is None:
        is_secret = DEFAULT_SETTINGS.get(key, {}).get("is_secret", False)
    
    description = DEFAULT_SETTINGS.get(key, {}).get("description", "")
    
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


def get_all_settings(include_secrets: bool = False) -> Dict[str, SettingValue]:
    """
    Get all settings with their current values.
    
    Secret values are masked unless include_secrets is True.
    Falls back to env vars and defaults for missing settings.
    """
    result = {}
    
    # Start with defaults
    for key, config in DEFAULT_SETTINGS.items():
        # Get actual value (from DB, env, or default)
        actual_value = get_setting(key, config["value"])
        
        # Mask secrets
        display_value = actual_value
        if config["is_secret"] and not include_secrets:
            if actual_value:
                display_value = "••••••••" + actual_value[-4:] if len(actual_value) > 4 else "••••••••"
            else:
                display_value = ""
        
        result[key] = SettingValue(
            key=key,
            value=display_value,
            is_secret=config["is_secret"],
            description=config["description"]
        )
    
    # Also get any custom settings from DB
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
    
    Only returns user-facing settings. Internal settings (like suggestion_confidence_threshold)
    are not exposed in the Settings UI - they're configured per-prompt or kept at defaults.
    """
    all_settings = get_all_settings(include_secrets=False)
    
    groups = [
        SettingsGroup(
            name="LLM Configuration",
            description="Default LLM settings. Individual prompts can override model and temperature.",
            settings=[
                all_settings.get("llm_provider", SettingValue(key="llm_provider", value="")),
                all_settings.get("llm_model", SettingValue(key="llm_model", value="")),
                all_settings.get("llm_api_key", SettingValue(key="llm_api_key", value="", is_secret=True)),
                all_settings.get("llm_api_base", SettingValue(key="llm_api_base", value="")),
            ]
        ),
        SettingsGroup(
            name="Weave Configuration",
            description="Settings for connecting to W&B Weave for trace retrieval",
            settings=[
                all_settings.get("weave_api_key", SettingValue(key="weave_api_key", value="", is_secret=True)),
                all_settings.get("weave_entity", SettingValue(key="weave_entity", value="")),
                all_settings.get("weave_project", SettingValue(key="weave_project", value="")),
                all_settings.get("weave_api_base", SettingValue(key="weave_api_base", value="https://trace.wandb.ai")),
            ]
        ),
    ]
    
    return groups


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


def check_weave_configured() -> Dict[str, Any]:
    """Check if Weave is properly configured."""
    api_key = get_setting("weave_api_key")
    entity = get_setting("weave_entity")
    project = get_setting("weave_project")
    
    configured = bool(api_key and entity)
    
    return {
        "configured": configured,
        "entity": entity,
        "project": project,
        "project_id": f"{entity}/{project}" if entity and project else None,
        "message": "Weave is configured" if configured else "Weave credentials not set. Configure in Settings."
    }


def get_litellm_kwargs() -> Dict[str, Any]:
    """
    Get kwargs for litellm calls based on current settings.
    
    This allows synthetic generation and AI suggestions to use the configured LLM.
    Logs the resolved configuration for visibility.
    
    The default model comes from DEFAULT_SETTINGS to ensure a single source of truth.
    """
    kwargs = {}
    
    # Use DEFAULT_SETTINGS as the single source of truth for the default model
    default_model = DEFAULT_SETTINGS["llm_model"]["value"]
    model = get_setting("llm_model", default_model)
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
    
    # Log the resolved configuration - this answers "is my model being used?"
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

