"""
Prompts Router

API endpoints for prompt management with Weave versioning.
Allows viewing, editing, resetting, and version management of prompts.
"""

from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from prompts import prompt_manager


router = APIRouter(prefix="/api/prompts", tags=["prompts"])


class PromptUpdateRequest(BaseModel):
    """Request body for updating a prompt."""
    system_prompt: Optional[str] = None
    user_prompt_template: Optional[str] = None
    llm_model: Optional[str] = None
    llm_temperature: Optional[float] = None


class VersionSelectRequest(BaseModel):
    """Request body for selecting a specific prompt version."""
    version: str


@router.get("")
async def list_prompts():
    """
    List all available prompts.
    
    Returns prompt configurations including current version info.
    """
    prompts = prompt_manager.get_all_prompts()
    return {
        "prompts": [p.model_dump() for p in prompts],
        "weave_enabled": prompt_manager.is_weave_enabled(),
        "weave_project_url": prompt_manager.get_weave_project_url(),
    }


@router.get("/by-feature/{feature}")
async def get_prompts_by_feature(feature: str):
    """
    Get prompts for a specific feature.
    
    Features: taxonomy, synthetic
    """
    prompts = prompt_manager.get_prompts_by_feature(feature)
    return {"prompts": [p.model_dump() for p in prompts]}


@router.get("/{prompt_id}")
async def get_prompt(prompt_id: str):
    """Get a specific prompt by ID."""
    prompt = prompt_manager.get_prompt(prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return prompt.model_dump()


@router.put("/{prompt_id}")
async def update_prompt(prompt_id: str, request: PromptUpdateRequest):
    """
    Update a prompt including LLM configuration.
    
    Creates a new version in Weave (if enabled).
    The update is applied immediately to the local cache.
    
    LLM Configuration:
    - llm_model: Override the model for this prompt (empty string clears override)
    - llm_temperature: Override the temperature for this prompt
    """
    try:
        updated = await prompt_manager.update_prompt(
            prompt_id=prompt_id,
            system_prompt=request.system_prompt,
            user_prompt_template=request.user_prompt_template,
            llm_model=request.llm_model,
            llm_temperature=request.llm_temperature
        )
        return {
            **updated.model_dump(),
            "weave_enabled": prompt_manager.is_weave_enabled(),
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{prompt_id}/reset")
async def reset_prompt(prompt_id: str):
    """
    Reset a prompt to its default version.
    
    This restores the original prompt content but doesn't delete
    the version history in Weave.
    """
    try:
        reset = await prompt_manager.reset_to_default(prompt_id)
        return reset.model_dump()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{prompt_id}/versions")
async def get_prompt_versions(prompt_id: str):
    """
    Get all versions of a prompt.
    
    Returns versions tracked locally since server startup. For complete
    version history, use the Weave UI link included in the response.
    
    Each version includes:
    - version: The version label (v0, v1, v2...)
    - digest: The full Weave hash for precise retrieval
    - created_at: ISO timestamp
    - is_current: Whether this is the active version
    """
    # Check prompt exists first
    prompt = prompt_manager.get_prompt(prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    
    versions = prompt_manager.get_versions(prompt_id)
    
    # Include link to Weave UI for full version history
    weave_url = prompt_manager.get_weave_project_url()
    version_url = f"{weave_url}/objects/{prompt_id}/versions" if weave_url else None
    
    return {
        "versions": [v.model_dump() for v in versions],
        "weave_versions_url": version_url,
        "current_version": prompt.version,
    }


@router.post("/{prompt_id}/set-version")
async def set_prompt_version(prompt_id: str, request: VersionSelectRequest):
    """
    Switch to a specific version of a prompt.
    
    Loads the specified version from Weave and makes it the active version.
    
    The version can be specified as:
    - A version label: "v0", "v1", "v2"...
    - A full digest hash
    
    Note: Requires Weave to be enabled and connected.
    """
    # Check prompt exists first
    prompt = prompt_manager.get_prompt(prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    
    if not prompt_manager.is_weave_enabled():
        raise HTTPException(
            status_code=400, 
            detail="Weave is not enabled, cannot switch versions"
        )
    
    try:
        updated = await prompt_manager.set_version(prompt_id, request.version)
        return {
            **updated.model_dump(),
            "message": f"Switched to version {request.version}",
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
