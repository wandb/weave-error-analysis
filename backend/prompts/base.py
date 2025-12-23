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
    
    def get_effective_model(self, global_model: str) -> str:
        """Get the effective model, preferring prompt override."""
        return self.llm_model or global_model
    
    def get_effective_temperature(self, global_temp: float = 0.3) -> float:
        """Get the effective temperature, preferring prompt override."""
        return self.llm_temperature if self.llm_temperature is not None else global_temp


class PromptVersion(BaseModel):
    """A specific version of a prompt (from Weave)."""
    
    version: str  # Version label (v0, v1, v2...)
    digest: str  # Full hash from Weave
    created_at: str
    system_prompt: Optional[str] = None
    user_prompt_template: str
    is_current: bool = False

