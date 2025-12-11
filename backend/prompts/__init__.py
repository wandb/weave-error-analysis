"""
Prompt Management System

Provides centralized prompt management with optional Weave versioning.

Usage:
    from prompts import prompt_manager, get_prompt
    
    # Get a prompt
    prompt = prompt_manager.get_prompt("trace_analysis")
    
    # Format with variables
    messages = []
    if prompt.system_prompt:
        messages.append({"role": "system", "content": prompt.system_prompt.format(**variables)})
    messages.append({"role": "user", "content": prompt.user_prompt_template.format(**variables)})
"""

from typing import Optional, Dict, List

from prompts.base import PromptConfig, PromptVersion
from prompts.defaults import DEFAULT_PROMPTS, PROMPTS_BY_FEATURE


class PromptManager:
    """
    Manages prompts with optional Weave versioning.
    
    Workflow:
    1. On initialization, load defaults into memory cache
    2. Cache active prompt versions in memory
    3. On edit, save to local cache (Weave integration in Phase 2)
    4. Support resetting to defaults
    """
    
    def __init__(self):
        self._active_prompts: Dict[str, PromptConfig] = {}
        self._initialized = False
    
    def initialize(self):
        """Initialize the prompt manager with default prompts."""
        if self._initialized:
            return
        
        # Load defaults into active cache
        for prompt_id, default_prompt in DEFAULT_PROMPTS.items():
            self._active_prompts[prompt_id] = default_prompt.model_copy()
        
        self._initialized = True
    
    def get_prompt(self, prompt_id: str) -> Optional[PromptConfig]:
        """Get the active version of a prompt."""
        if not self._initialized:
            self.initialize()
        return self._active_prompts.get(prompt_id)
    
    def get_all_prompts(self) -> List[PromptConfig]:
        """Get all prompts."""
        if not self._initialized:
            self.initialize()
        return list(self._active_prompts.values())
    
    def get_prompts_by_feature(self, feature: str) -> List[PromptConfig]:
        """Get prompts for a specific feature."""
        if not self._initialized:
            self.initialize()
        prompt_ids = PROMPTS_BY_FEATURE.get(feature, [])
        return [self._active_prompts[pid] for pid in prompt_ids if pid in self._active_prompts]
    
    def update_prompt(
        self, 
        prompt_id: str,
        system_prompt: Optional[str] = None,
        user_prompt_template: Optional[str] = None
    ) -> PromptConfig:
        """
        Update a prompt.
        
        Updates the local cache immediately.
        Weave versioning will be added in Phase 2.
        """
        if not self._initialized:
            self.initialize()
        
        if prompt_id not in self._active_prompts:
            raise ValueError(f"Unknown prompt: {prompt_id}")
        
        current = self._active_prompts[prompt_id]
        
        # Create updated copy
        updated = current.model_copy(update={
            "system_prompt": system_prompt if system_prompt is not None else current.system_prompt,
            "user_prompt_template": user_prompt_template if user_prompt_template is not None else current.user_prompt_template,
            "is_default": False,
            "version": None,  # Will be set by Weave in Phase 2
        })
        
        # Update local cache immediately
        self._active_prompts[prompt_id] = updated
        
        return updated
    
    def get_versions(self, prompt_id: str) -> List[PromptVersion]:
        """Get all versions of a prompt from Weave."""
        # TODO: Implement via Weave API in Phase 2
        # For now, return empty list - versions will be visible in Weave UI
        return []
    
    def set_version(self, prompt_id: str, version: str) -> PromptConfig:
        """Switch to a specific version of a prompt."""
        # TODO: Fetch from Weave using ref in Phase 2
        raise NotImplementedError("Version switching from Weave not yet implemented")
    
    def reset_to_default(self, prompt_id: str) -> PromptConfig:
        """Reset a prompt to its default version."""
        if prompt_id not in DEFAULT_PROMPTS:
            raise ValueError(f"Unknown prompt: {prompt_id}")
        
        default = DEFAULT_PROMPTS[prompt_id].model_copy()
        self._active_prompts[prompt_id] = default
        
        return default


# Singleton instance
prompt_manager = PromptManager()


def get_prompt(prompt_id: str) -> Optional[PromptConfig]:
    """Convenience function to get a prompt."""
    return prompt_manager.get_prompt(prompt_id)


# Re-export for convenience
__all__ = [
    "prompt_manager",
    "get_prompt",
    "PromptConfig",
    "PromptVersion",
    "PromptManager",
]

