"""
Settings API Router

Endpoints for managing application settings.
"""

from typing import Dict, List, Any, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.settings import (
    get_setting,
    set_setting,
    delete_setting,
    get_all_settings,
    get_settings_grouped,
    check_llm_configured,
    check_weave_configured,
    SettingValue,
    SettingsGroup,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


class UpdateSettingRequest(BaseModel):
    """Request to update a single setting."""
    value: str


class BulkUpdateRequest(BaseModel):
    """Request to update multiple settings at once."""
    settings: Dict[str, str]


class SettingsResponse(BaseModel):
    """Response containing all settings."""
    settings: Dict[str, SettingValue]


class SettingsGroupedResponse(BaseModel):
    """Response containing settings grouped by category."""
    groups: List[SettingsGroup]


class ConfigStatusResponse(BaseModel):
    """Response containing configuration status."""
    llm: Dict[str, Any]
    weave: Dict[str, Any]


# ============================================================================
# Read Settings
# ============================================================================

@router.get("", response_model=SettingsResponse)
async def get_settings():
    """
    Get all settings.
    
    Secret values are masked (e.g., API keys show as "••••••••xxxx").
    """
    settings = get_all_settings(include_secrets=False)
    return {"settings": settings}


@router.get("/grouped", response_model=SettingsGroupedResponse)
async def get_settings_by_group():
    """
    Get settings organized by category for UI display.
    
    Groups: LLM Configuration, Weave Configuration, Auto-Review Settings
    """
    groups = get_settings_grouped()
    return {"groups": groups}


@router.get("/status", response_model=ConfigStatusResponse)
async def get_config_status():
    """
    Check if required services are configured.
    
    Returns status for LLM and Weave configuration.
    """
    return {
        "llm": check_llm_configured(),
        "weave": check_weave_configured(),
    }


@router.get("/{key}")
async def get_single_setting(key: str):
    """
    Get a single setting value.
    
    Secret values are masked in the response.
    """
    all_settings = get_all_settings(include_secrets=False)
    
    if key not in all_settings:
        raise HTTPException(status_code=404, detail=f"Setting '{key}' not found")
    
    return all_settings[key]


# ============================================================================
# Update Settings
# ============================================================================

@router.put("/{key}")
async def update_setting(key: str, request: UpdateSettingRequest):
    """
    Update a single setting.
    
    For API keys and other secrets, the value will be encoded before storage.
    """
    # Don't allow empty values for required settings
    required_for_function = {
        "llm_api_key": "LLM features (synthetic generation, AI suggestions)",
        "weave_api_key": "Weave trace retrieval",
    }
    
    set_setting(key, request.value)
    
    return {
        "status": "updated",
        "key": key,
        "message": f"Setting '{key}' updated successfully"
    }


@router.post("/bulk")
async def bulk_update_settings(request: BulkUpdateRequest):
    """
    Update multiple settings at once.
    
    Useful for saving an entire settings form.
    """
    updated = []
    
    for key, value in request.settings.items():
        set_setting(key, value)
        updated.append(key)
    
    return {
        "status": "updated",
        "updated_count": len(updated),
        "keys": updated
    }


@router.delete("/{key}")
async def reset_setting(key: str):
    """
    Reset a setting to its default value.
    
    Removes the custom value from the database, falling back to
    environment variables or built-in defaults.
    """
    delete_setting(key)
    
    return {
        "status": "reset",
        "key": key,
        "message": f"Setting '{key}' reset to default"
    }


# ============================================================================
# Validation & Testing
# ============================================================================

@router.post("/test-llm")
async def test_llm_connection():
    """
    Test the LLM connection with current settings.
    
    Makes a simple API call to verify the configuration works.
    """
    from services.llm import llm_client
    
    # Use the LLM client's built-in test method
    result = await llm_client.test_connection()
    return result


@router.post("/test-weave")
async def test_weave_connection():
    """
    Test the Weave/W&B connection with current settings.
    
    Uses wandb.login to verify the API key is valid.
    """
    import wandb
    
    api_key = get_setting("weave_api_key")
    entity = get_setting("weave_entity")
    project = get_setting("weave_project")
    
    if not api_key:
        return {
            "success": False,
            "error": "W&B API key not configured",
            "message": "Please set your W&B API key in Settings"
        }
    
    try:
        # Use wandb.login to verify the API key
        result = wandb.login(key=api_key, verify=True, relogin=True)
        
        if result:
            return {
                "success": True,
                "entity": entity,
                "project": project,
                "project_id": f"{entity}/{project}" if entity and project else None,
                "message": "W&B API key is valid"
            }
        else:
            return {
                "success": False,
                "error": "Invalid API key",
                "message": "The W&B API key is invalid"
            }
    except wandb.errors.AuthenticationError as e:
        return {
            "success": False,
            "error": "Authentication failed",
            "message": str(e)
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "message": "Failed to verify W&B API key"
        }


@router.get("/llm-api-key")
async def get_llm_api_key():
    """
    Get the LLM API key for internal use (e.g., example agent).
    
    This endpoint is for local use only - the example agent calls this
    to get the API key configured in settings.
    
    Uses get_setting which properly decodes base64-encoded secrets.
    """
    # get_setting properly decodes base64-encoded secrets
    api_key = get_setting("llm_api_key")
    return {"api_key": api_key if api_key else None}


# ============================================================================
# Database Management
# ============================================================================

class DatabaseResetRequest(BaseModel):
    """Request to reset the database."""
    keep_settings: bool = True
    keep_agents: bool = True


class DatabaseResetResponse(BaseModel):
    """Response from database reset."""
    status: str
    keep_settings: bool
    keep_agents: bool
    tables_cleared: List[str]


@router.post("/database/reset", response_model=DatabaseResetResponse)
async def reset_database(request: DatabaseResetRequest = DatabaseResetRequest()):
    """
    Reset the database for a fresh start with a new agent.
    
    Clears:
    - All synthetic batches and queries
    - All sessions and session notes
    - All failure modes and notes
    - All saturation data
    - All auto-reviews and suggestions
    
    Optionally keeps:
    - App settings (API keys, etc.) if keep_settings=True
    - Agents if keep_agents=True
    """
    from database import get_db
    
    tables_cleared = []
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Clear data tables (order matters due to foreign keys)
        data_tables = [
            "trace_suggestions",
            "session_notes",
            "sessions",
            "auto_reviews",
            "synthetic_queries",
            "synthetic_batches",
            "notes",
            "failure_modes",
            "saturation_log",
            "saturation_snapshots",
            "reviewed_threads",
            "sync_status",
        ]
        
        for table in data_tables:
            try:
                cursor.execute(f"DELETE FROM {table}")
                tables_cleared.append(table)
            except Exception:
                pass  # Table might not exist
        
        # Reset sync_status to idle state
        cursor.execute("""
            INSERT OR REPLACE INTO sync_status (id, status) VALUES ('sessions', 'idle')
        """)
        
        if not request.keep_agents:
            cursor.execute("DELETE FROM agent_dimensions")
            cursor.execute("DELETE FROM agent_versions")
            cursor.execute("DELETE FROM agents")
            tables_cleared.extend(["agent_dimensions", "agent_versions", "agents"])
        
        if not request.keep_settings:
            cursor.execute("DELETE FROM app_settings")
            tables_cleared.append("app_settings")
    
    return DatabaseResetResponse(
        status="reset",
        keep_settings=request.keep_settings,
        keep_agents=request.keep_agents,
        tables_cleared=tables_cleared
    )

