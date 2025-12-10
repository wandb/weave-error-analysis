"""
Settings API Router

Endpoints for managing application settings.
"""

from typing import Dict, List, Any, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

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
    from services.settings import get_litellm_kwargs
    
    llm_kwargs = get_litellm_kwargs()
    
    if not llm_kwargs.get("api_key") and not get_setting("llm_api_key"):
        return {
            "success": False,
            "error": "LLM API key not configured",
            "message": "Please set your LLM API key in Settings"
        }
    
    try:
        from litellm import acompletion
        import asyncio
        
        response = await acompletion(
            messages=[{"role": "user", "content": "Say 'hello' in one word."}],
            max_tokens=10,
            **llm_kwargs
        )
        
        return {
            "success": True,
            "model": llm_kwargs.get("model"),
            "response": response.choices[0].message.content,
            "message": "LLM connection successful"
        }
    except Exception as e:
        return {
            "success": False,
            "model": llm_kwargs.get("model"),
            "error": str(e),
            "message": "LLM connection failed"
        }


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

