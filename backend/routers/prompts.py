"""
Prompts Router

API endpoints for prompt management.
Allows viewing, editing, and resetting prompts.
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


@router.get("")
async def list_prompts():
    """List all available prompts."""
    prompts = prompt_manager.get_all_prompts()
    return {"prompts": [p.model_dump() for p in prompts]}


@router.get("/by-feature/{feature}")
async def get_prompts_by_feature(feature: str):
    """Get prompts for a specific feature (suggestions, taxonomy, synthetic)."""
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
    """Update a prompt. Creates a new version in Weave (when implemented)."""
    try:
        updated = prompt_manager.update_prompt(
            prompt_id=prompt_id,
            system_prompt=request.system_prompt,
            user_prompt_template=request.user_prompt_template
        )
        return updated.model_dump()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{prompt_id}/reset")
async def reset_prompt(prompt_id: str):
    """Reset a prompt to its default version."""
    try:
        reset = prompt_manager.reset_to_default(prompt_id)
        return reset.model_dump()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{prompt_id}/versions")
async def get_prompt_versions(prompt_id: str):
    """Get all versions of a prompt from Weave."""
    # Check prompt exists first
    prompt = prompt_manager.get_prompt(prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    
    versions = prompt_manager.get_versions(prompt_id)
    return {"versions": [v.model_dump() for v in versions]}

