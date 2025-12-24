"""
Prompt Management System with Weave Versioning

Provides centralized prompt management with Weave versioning for tracking
and comparing prompt changes over time.

Usage:
    from prompts import prompt_manager, get_prompt
    
    # Initialize (done on startup)
    await prompt_manager.initialize()
    
    # Get a prompt
    prompt = prompt_manager.get_prompt("category_suggestion")
    
    # Format with variables
    messages = []
    if prompt.system_prompt:
        messages.append({"role": "system", "content": prompt.system_prompt.format(**variables)})
    messages.append({"role": "user", "content": prompt.user_prompt_template.format(**variables)})
"""

import os
import asyncio
from datetime import datetime
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
    5. Track version history locally for quick access
    
    Weave Integration:
    - Uses the global Weave init from main.py (error-analysis-dev project)
    - Each prompt edit creates a new version in Weave
    - Versions can be browsed in the Weave UI
    - Use weave.get('prompt_id:vN') for version retrieval
    """
    
    def __init__(self):
        self._active_prompts: dict[str, PromptConfig] = {}
        self._version_history: dict[str, list[PromptVersion]] = {}  # Track versions locally
        self._initialized = False
        self._weave_enabled = False
        
        # Weave project info - lazy loaded from config to avoid circular imports
        self._weave_entity: str | None = None
        self._weave_project: str | None = None
    
    @property
    def weave_entity(self) -> str:
        """Get WANDB entity, lazily loaded."""
        if self._weave_entity is None:
            self._weave_entity = os.getenv("WANDB_ENTITY", "")
        return self._weave_entity
    
    @property
    def weave_project(self) -> str:
        """Get tool project name from config, lazily loaded."""
        if self._weave_project is None:
            try:
                from config import get_tool_project_name
                self._weave_project = get_tool_project_name()
            except ImportError:
                self._weave_project = "error-analysis-tool"
        return self._weave_project
    
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
    
    async def enable_weave(self):
        """
        Enable Weave publishing after initial local-mode startup.
        
        Call this when Weave credentials become available after the prompt
        manager was initialized in local mode.
        """
        if self._weave_enabled:
            logger.debug("Weave already enabled for prompt manager")
            return
        
        if not self._initialized:
            # If not initialized yet, just initialize with Weave enabled
            await self.initialize(enable_weave=True)
            return
        
        # Upgrade from local mode to Weave mode
        self._weave_enabled = True
        logger.info("Upgrading prompt manager to Weave mode")
        
        # Publish all prompts to Weave
        await self._publish_defaults()
    
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
                    
                    # Extract version info from ref
                    digest = ref.digest if hasattr(ref, 'digest') else str(ref)
                    version_index = len(self._version_history.get(prompt_id, []))
                    version_label = f"v{version_index}"
                    
                    # Create version record
                    version = PromptVersion(
                        version=version_label,
                        digest=digest,
                        created_at=datetime.utcnow().isoformat(),
                        system_prompt=prompt.system_prompt,
                        user_prompt_template=prompt.user_prompt_template,
                        is_current=True
                    )
                    
                    # Initialize or update version history
                    if prompt_id not in self._version_history:
                        self._version_history[prompt_id] = []
                    
                    # Mark previous versions as not current
                    for v in self._version_history[prompt_id]:
                        v.is_current = False
                    
                    self._version_history[prompt_id].append(version)
                    
                    # Update the version in our cache
                    if prompt_id in self._active_prompts:
                        self._active_prompts[prompt_id].version = version_label
                        self._active_prompts[prompt_id].digest = digest
                    
                    published_count += 1
                    logger.debug(f"Published default prompt: {prompt_id} -> {version_label}")
                    
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
    
    def get_prompt(self, prompt_id: str) -> PromptConfig | None:
        """Get the active version of a prompt."""
        if not self._initialized:
            # Sync initialization for backwards compatibility
            for pid, default_prompt in DEFAULT_PROMPTS.items():
                self._active_prompts[pid] = default_prompt.model_copy()
            self._initialized = True
        return self._active_prompts.get(prompt_id)
    
    def get_all_prompts(self) -> list[PromptConfig]:
        """Get all prompts."""
        if not self._initialized:
            self.get_prompt("")  # Trigger lazy init
        return list(self._active_prompts.values())
    
    def get_prompts_by_feature(self, feature: str) -> list[PromptConfig]:
        """Get prompts for a specific feature."""
        if not self._initialized:
            self.get_prompt("")  # Trigger lazy init
        prompt_ids = PROMPTS_BY_FEATURE.get(feature, [])
        return [self._active_prompts[pid] for pid in prompt_ids if pid in self._active_prompts]
    
    async def update_prompt(
        self, 
        prompt_id: str,
        system_prompt: str | None = None,
        user_prompt_template: str | None = None,
        llm_model: str | None = None,
        llm_temperature: float | None = None
    ) -> PromptConfig:
        """
        Update a prompt and optionally create a new version in Weave.
        
        Updates the local cache immediately. Only publishes to Weave if prompt
        content (system_prompt or user_prompt_template) changed. LLM config
        changes (model, temperature) do NOT create new Weave versions.
        
        Args:
            prompt_id: The prompt ID to update
            system_prompt: New system prompt (None = keep current)
            user_prompt_template: New user template (None = keep current)
            llm_model: Model override for this prompt (empty string = clear override)
            llm_temperature: Temperature override for this prompt
        """
        if not self._initialized:
            await self.initialize()
        
        if prompt_id not in self._active_prompts:
            raise ValueError(f"Unknown prompt: {prompt_id}")
        
        current = self._active_prompts[prompt_id]
        
        # Track if prompt content is changing (triggers Weave version)
        prompt_content_changed = False
        
        # Build update dict, only include fields that are being changed
        updates = {}
        
        if system_prompt is not None:
            if system_prompt != current.system_prompt:
                prompt_content_changed = True
            updates["system_prompt"] = system_prompt
        if user_prompt_template is not None:
            if user_prompt_template != current.user_prompt_template:
                prompt_content_changed = True
            updates["user_prompt_template"] = user_prompt_template
        
        # LLM settings - allow explicit empty string to clear override
        # These do NOT trigger Weave version creation
        if llm_model is not None:
            updates["llm_model"] = llm_model if llm_model != "" else None
        if llm_temperature is not None:
            updates["llm_temperature"] = llm_temperature
        
        # Only mark as non-default if prompt content changed
        if prompt_content_changed:
            updates["is_default"] = False
            updates["version"] = None  # Will be set after Weave publish
        
        # Create updated copy
        updated = current.model_copy(update=updates)
        
        # Update local cache immediately
        self._active_prompts[prompt_id] = updated
        
        # Only publish to Weave if prompt content changed (not for LLM config only)
        if self._weave_enabled and prompt_content_changed:
            asyncio.create_task(self._publish_prompt(prompt_id, updated))
            logger.info(f"Updated prompt content: {prompt_id} (new Weave version)")
        else:
            logger.info(f"Updated prompt LLM config: {prompt_id} (no new version)")
        
        return updated
    
    async def _publish_prompt(self, prompt_id: str, prompt: PromptConfig):
        """Publish a prompt to Weave and track its version."""
        try:
            import weave
            
            weave_prompt = self._create_weave_prompt(prompt)
            ref = weave.publish(weave_prompt, name=prompt_id)
            
            # Extract version info from ref
            digest = ref.digest if hasattr(ref, 'digest') else str(ref)
            version_index = len(self._version_history.get(prompt_id, []))
            version_label = f"v{version_index}"
            
            # Create version record
            version = PromptVersion(
                version=version_label,
                digest=digest,
                created_at=datetime.utcnow().isoformat(),
                system_prompt=prompt.system_prompt,
                user_prompt_template=prompt.user_prompt_template,
                is_current=True
            )
            
            # Initialize or update version history
            if prompt_id not in self._version_history:
                self._version_history[prompt_id] = []
            
            # Mark previous versions as not current
            for v in self._version_history[prompt_id]:
                v.is_current = False
            
            self._version_history[prompt_id].append(version)
            
            # Update version in cache
            if prompt_id in self._active_prompts:
                self._active_prompts[prompt_id].version = version_label
                self._active_prompts[prompt_id].digest = digest
            
            logger.info(f"Published prompt to Weave: {prompt_id} -> {version_label} ({digest[:8]}...)")
            
        except Exception as e:
            logger.warning(f"Failed to publish prompt {prompt_id} to Weave: {e}")
    
    def get_versions(self, prompt_id: str) -> list[PromptVersion]:
        """
        Get all tracked versions of a prompt.
        
        Returns versions tracked locally since server startup. Versions are
        created when prompts are published to Weave (on startup and on edit).
        
        For complete version history, use the Weave UI link.
        """
        return self._version_history.get(prompt_id, [])
    
    async def set_version(self, prompt_id: str, version: str) -> PromptConfig:
        """
        Switch to a specific version of a prompt from Weave.
        
        Args:
            prompt_id: The prompt ID
            version: The version to switch to (v0, v1, v2... or full digest)
        
        Uses weave.get() with short form since weave.init() was already
        called for the TOOL PROJECT in main.py.
        """
        if not self._weave_enabled:
            raise RuntimeError("Weave is not enabled, cannot switch versions")
        
        if prompt_id not in self._active_prompts:
            raise ValueError(f"Unknown prompt: {prompt_id}")
        
        try:
            import weave
            
            # Use short form since we're in the same project context
            # weave.get('prompt_id:v0') or weave.get('prompt_id:DIGEST')
            prompt_data = weave.ref(f'{prompt_id}:{version}').get()
            
            if not prompt_data:
                raise ValueError(f"Version {version} not found for prompt {prompt_id}")
            
            # Extract messages from the Weave prompt
            messages = prompt_data.messages if hasattr(prompt_data, 'messages') else []
            
            system_prompt = None
            user_prompt_template = ""
            
            for msg in messages:
                role = msg.get("role") if isinstance(msg, dict) else getattr(msg, "role", None)
                content = msg.get("content") if isinstance(msg, dict) else getattr(msg, "content", "")
                
                if role == "system":
                    system_prompt = content
                elif role == "user":
                    user_prompt_template = content
            
            # Find the digest for this version from our history
            digest = None
            for v in self._version_history.get(prompt_id, []):
                if v.version == version or v.digest == version:
                    digest = v.digest
                    break
            
            # If not in history, use the version string as digest
            if digest is None:
                digest = version
            
            # Update version history - mark new version as current
            for v in self._version_history.get(prompt_id, []):
                v.is_current = (v.version == version or v.digest == version)
            
            # Update our cached prompt
            current = self._active_prompts[prompt_id]
            updated = current.model_copy(update={
                "system_prompt": system_prompt,
                "user_prompt_template": user_prompt_template,
                "version": version,
                "digest": digest,
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
    
    def get_weave_project_url(self) -> str | None:
        """Get the Weave project URL for viewing prompts."""
        if not self.weave_entity:
            return None
        return f"https://wandb.ai/{self.weave_entity}/{self.weave_project}/weave"


# Singleton instance
prompt_manager = PromptManager()


async def get_prompt(prompt_id: str) -> PromptConfig | None:
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
