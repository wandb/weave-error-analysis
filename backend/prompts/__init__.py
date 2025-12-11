"""
Prompt Management System with Weave Versioning

Provides centralized prompt management with Weave versioning for tracking
and comparing prompt changes over time.

Usage:
    from prompts import prompt_manager, get_prompt
    
    # Initialize (done on startup)
    await prompt_manager.initialize()
    
    # Get a prompt
    prompt = prompt_manager.get_prompt("trace_analysis")
    
    # Format with variables
    messages = []
    if prompt.system_prompt:
        messages.append({"role": "system", "content": prompt.system_prompt.format(**variables)})
    messages.append({"role": "user", "content": prompt.user_prompt_template.format(**variables)})
"""

import os
import asyncio
from typing import Optional, Dict, List
import logging

from prompts.base import PromptConfig, PromptVersion
from prompts.defaults import DEFAULT_PROMPTS, PROMPTS_BY_FEATURE

logger = logging.getLogger(__name__)


class PromptManager:
    """
    Manages prompts with Weave versioning.
    
    Workflow:
    1. On initialization, load defaults and optionally publish to Weave
    2. Cache active prompt versions in memory
    3. On edit, save to local cache and publish to Weave (background)
    4. Support resetting to defaults
    
    Weave Integration:
    - Uses the global Weave init from main.py (error-analysis-dev project)
    - Each prompt edit creates a new version in Weave
    - Versions can be browsed in the Weave UI
    """
    
    def __init__(self):
        self._active_prompts: Dict[str, PromptConfig] = {}
        self._initialized = False
        self._weave_enabled = False
        
        # Weave project info (from environment)
        self.weave_entity = os.getenv("WANDB_ENTITY", "")
        self.weave_project = "error-analysis-dev"
    
    def _get_weave_project_id(self) -> str:
        """Get the full Weave project ID."""
        if self.weave_entity:
            return f"{self.weave_entity}/{self.weave_project}"
        return self.weave_project
    
    async def initialize(self, enable_weave: bool = True):
        """
        Initialize the prompt manager.
        
        Args:
            enable_weave: If True, enable Weave publishing.
                         Weave should already be initialized in main.py.
        """
        if self._initialized:
            return
        
        # Load defaults into active cache
        for prompt_id, default_prompt in DEFAULT_PROMPTS.items():
            self._active_prompts[prompt_id] = default_prompt.model_copy()
        
        self._initialized = True
        self._weave_enabled = enable_weave
        
        logger.info(f"Loaded {len(self._active_prompts)} default prompts")
        
        # Publish defaults to Weave in background
        if self._weave_enabled:
            asyncio.create_task(self._publish_defaults())
    
    async def _publish_defaults(self):
        """Publish default prompts to Weave for initial version tracking."""
        if not self._weave_enabled:
            return
        
        try:
            import weave
            
            published_count = 0
            for prompt_id, prompt in DEFAULT_PROMPTS.items():
                try:
                    weave_prompt = self._create_weave_prompt(prompt)
                    ref = weave.publish(weave_prompt, name=prompt_id)
                    
                    # Update the version in our cache (extract digest from ObjectRef)
                    if prompt_id in self._active_prompts:
                        version_str = ref.digest if hasattr(ref, 'digest') else str(ref)
                        self._active_prompts[prompt_id].version = version_str
                    
                    published_count += 1
                    logger.debug(f"Published default prompt: {prompt_id}")
                    
                except Exception as e:
                    logger.debug(f"Could not publish prompt {prompt_id}: {e}")
            
            logger.info(f"Published {published_count} default prompts to Weave")
            
        except Exception as e:
            logger.warning(f"Failed to publish default prompts: {e}")
    
    def _create_weave_prompt(self, prompt: PromptConfig):
        """Create a Weave-compatible prompt object from our PromptConfig."""
        import weave
        
        # Build messages list for Weave MessagesPrompt
        messages = []
        
        if prompt.system_prompt:
            messages.append({
                "role": "system",
                "content": prompt.system_prompt
            })
        
        messages.append({
            "role": "user",
            "content": prompt.user_prompt_template
        })
        
        return weave.MessagesPrompt(messages=messages)
    
    def get_prompt(self, prompt_id: str) -> Optional[PromptConfig]:
        """Get the active version of a prompt."""
        if not self._initialized:
            # Sync initialization for backwards compatibility
            for pid, default_prompt in DEFAULT_PROMPTS.items():
                self._active_prompts[pid] = default_prompt.model_copy()
            self._initialized = True
        return self._active_prompts.get(prompt_id)
    
    def get_all_prompts(self) -> List[PromptConfig]:
        """Get all prompts."""
        if not self._initialized:
            self.get_prompt("")  # Trigger lazy init
        return list(self._active_prompts.values())
    
    def get_prompts_by_feature(self, feature: str) -> List[PromptConfig]:
        """Get prompts for a specific feature."""
        if not self._initialized:
            self.get_prompt("")  # Trigger lazy init
        prompt_ids = PROMPTS_BY_FEATURE.get(feature, [])
        return [self._active_prompts[pid] for pid in prompt_ids if pid in self._active_prompts]
    
    async def update_prompt(
        self, 
        prompt_id: str,
        system_prompt: Optional[str] = None,
        user_prompt_template: Optional[str] = None
    ) -> PromptConfig:
        """
        Update a prompt and create a new version in Weave.
        
        Updates the local cache immediately and publishes to Weave in background.
        """
        if not self._initialized:
            await self.initialize()
        
        if prompt_id not in self._active_prompts:
            raise ValueError(f"Unknown prompt: {prompt_id}")
        
        current = self._active_prompts[prompt_id]
        
        # Create updated copy
        updated = current.model_copy(update={
            "system_prompt": system_prompt if system_prompt is not None else current.system_prompt,
            "user_prompt_template": user_prompt_template if user_prompt_template is not None else current.user_prompt_template,
            "is_default": False,
            "version": None,  # Will be set after Weave publish
        })
        
        # Update local cache immediately
        self._active_prompts[prompt_id] = updated
        
        # Publish to Weave in background
        if self._weave_enabled:
            asyncio.create_task(self._publish_prompt(prompt_id, updated))
        
        logger.info(f"Updated prompt: {prompt_id}")
        return updated
    
    async def _publish_prompt(self, prompt_id: str, prompt: PromptConfig):
        """Publish a prompt to Weave (runs in background)."""
        try:
            import weave
            
            weave_prompt = self._create_weave_prompt(prompt)
            ref = weave.publish(weave_prompt, name=prompt_id)
            
            # Update version in cache (extract digest from ObjectRef)
            if prompt_id in self._active_prompts:
                version_str = ref.digest if hasattr(ref, 'digest') else str(ref)
                self._active_prompts[prompt_id].version = version_str
            
            logger.info(f"Published prompt to Weave: {prompt_id} -> {ref.digest if hasattr(ref, 'digest') else ref}")
            
        except Exception as e:
            logger.warning(f"Failed to publish prompt {prompt_id} to Weave: {e}")
    
    def get_versions(self, prompt_id: str) -> List[PromptVersion]:
        """
        Get all versions of a prompt from Weave.
        
        Note: Full version listing requires Weave's HTTP API.
        For now, returns empty list - versions are visible in Weave UI.
        """
        return []
    
    async def set_version(self, prompt_id: str, version: str) -> PromptConfig:
        """
        Switch to a specific version of a prompt from Weave.
        
        Args:
            prompt_id: The prompt ID
            version: The Weave version hash to switch to
        """
        if not self._weave_enabled:
            raise RuntimeError("Weave is not enabled, cannot switch versions")
        
        try:
            import weave
            
            # Construct the Weave ref for this version
            project_id = self._get_weave_project_id()
            ref_str = f"weave:///{project_id}/object/{prompt_id}:{version}"
            ref = weave.ref(ref_str)
            prompt_data = ref.get()
            
            if not prompt_data:
                raise ValueError(f"Version {version} not found for prompt {prompt_id}")
            
            # Extract messages from the Weave prompt
            messages = prompt_data.messages if hasattr(prompt_data, 'messages') else []
            
            system_prompt = None
            user_prompt_template = ""
            
            for msg in messages:
                if msg.get("role") == "system":
                    system_prompt = msg.get("content", "")
                elif msg.get("role") == "user":
                    user_prompt_template = msg.get("content", "")
            
            # Update our cached prompt
            if prompt_id not in self._active_prompts:
                raise ValueError(f"Unknown prompt: {prompt_id}")
            
            current = self._active_prompts[prompt_id]
            updated = current.model_copy(update={
                "system_prompt": system_prompt,
                "user_prompt_template": user_prompt_template,
                "version": version,
                "is_default": False,
            })
            
            self._active_prompts[prompt_id] = updated
            logger.info(f"Switched prompt {prompt_id} to version {version}")
            
            return updated
            
        except Exception as e:
            logger.error(f"Failed to switch to version {version}: {e}")
            raise ValueError(f"Could not load version {version}: {e}")
    
    async def reset_to_default(self, prompt_id: str) -> PromptConfig:
        """Reset a prompt to its default version."""
        if prompt_id not in DEFAULT_PROMPTS:
            raise ValueError(f"Unknown prompt: {prompt_id}")
        
        default = DEFAULT_PROMPTS[prompt_id].model_copy()
        self._active_prompts[prompt_id] = default
        
        logger.info(f"Reset prompt to default: {prompt_id}")
        return default
    
    def is_weave_enabled(self) -> bool:
        """Check if Weave versioning is enabled."""
        return self._weave_enabled
    
    def get_weave_project_url(self) -> Optional[str]:
        """Get the Weave project URL for viewing prompts."""
        if not self.weave_entity:
            return None
        return f"https://wandb.ai/{self.weave_entity}/{self.weave_project}/weave"


# Singleton instance
prompt_manager = PromptManager()


async def get_prompt(prompt_id: str) -> Optional[PromptConfig]:
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
