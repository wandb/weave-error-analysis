"""
Base classes for prompt configuration.

Defines the PromptConfig and PromptVersion models used throughout
the prompt management system.
"""

from typing import Optional, List
from pydantic import BaseModel, Field


class PromptConfig(BaseModel):
    """Configuration for a single prompt."""
    
    id: str = Field(description="Unique identifier, e.g., 'category_suggestion'")
    name: str = Field(description="Human-readable name")
    description: str = Field(description="What this prompt does")
    feature: str = Field(description="Which feature uses this: 'synthetic', 'taxonomy'")
    
    # The actual prompt content
    system_prompt: Optional[str] = Field(default=None, description="System message")
    user_prompt_template: str = Field(description="User message with {placeholders}")
    
    # Metadata for UI
    available_variables: List[str] = Field(
        default_factory=list,
        description="Variables that can be used in templates, e.g., ['agent_name', 'trace_data']"
    )
    
    # Version tracking (set by PromptManager)
    version: Optional[str] = Field(default=None, description="Weave version label (v0, v1, etc.)")
    digest: Optional[str] = Field(default=None, description="Weave version digest (full hash)")
    is_default: bool = Field(default=True, description="True if using default, False if user-edited")
    
    # LLM Configuration (per-prompt overrides)
    llm_model: Optional[str] = Field(
        default=None, 
        description="Model override for this prompt. If None, uses global setting."
    )
    llm_temperature: Optional[float] = Field(
        default=None, 
        description="Temperature override (0.0-1.0). If None, uses global default."
    )    
    include_agent_context: bool = Field(
        default=True,
        description="Whether to inject agent context into this prompt. "
                    "When True, the agent's description is prepended to the prompt."
    )
    
    def get_effective_model(self, global_model: str) -> str:
        """Get the effective model, preferring prompt override."""
        return self.llm_model or global_model
    
    def get_effective_temperature(self, global_temp: float = 0.3) -> float:
        """Get the effective temperature, preferring prompt override."""
        return self.llm_temperature if self.llm_temperature is not None else global_temp
    
    def format_with_agent_context(
        self, 
        agent_name: str, 
        agent_context: str,
        **kwargs
    ) -> str:
        """
        Format the user prompt template, optionally prepending agent context.
        
        Agent name is always available via {agent_name}.
        When include_agent_context is True, the full context block is prepended.
        """
        # Agent name is always available
        kwargs["agent_name"] = agent_name
        
        # Format the template
        formatted = self.user_prompt_template.format(**kwargs)
        
        # Prepend agent context block if enabled and context exists
        if self.include_agent_context and agent_context:
            context_block = f"""=== Agent Context ===
Agent: {agent_name}

{agent_context}
=====================

"""
            return context_block + formatted
        
        return formatted


class PromptVersion(BaseModel):
    """A specific version of a prompt (from Weave)."""
    
    version: str  # Version label (v0, v1, v2...)
    digest: str  # Full hash from Weave
    created_at: str
    system_prompt: Optional[str] = None
    user_prompt_template: str
    is_current: bool = False
