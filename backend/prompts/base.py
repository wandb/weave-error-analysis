"""
Base classes for prompt configuration.

Defines the PromptConfig and PromptVersion models used throughout
the prompt management system.
"""

from typing import Optional, List
from pydantic import BaseModel, Field


class PromptConfig(BaseModel):
    """Configuration for a single prompt."""
    
    id: str = Field(description="Unique identifier, e.g., 'trace_analysis'")
    name: str = Field(description="Human-readable name")
    description: str = Field(description="What this prompt does")
    feature: str = Field(description="Which feature uses this: 'suggestions', 'synthetic', 'taxonomy'")
    
    # The actual prompt content
    system_prompt: Optional[str] = Field(default=None, description="System message")
    user_prompt_template: str = Field(description="User message with {placeholders}")
    
    # Metadata for UI
    available_variables: List[str] = Field(
        default_factory=list,
        description="Variables that can be used in templates, e.g., ['agent_name', 'trace_data']"
    )
    
    # Version tracking (set by PromptManager)
    version: Optional[str] = Field(default=None, description="Weave version hash")
    is_default: bool = Field(default=True, description="True if using default, False if user-edited")


class PromptVersion(BaseModel):
    """A specific version of a prompt (from Weave)."""
    
    version: str  # Weave version hash
    created_at: str
    system_prompt: Optional[str]
    user_prompt_template: str
    is_current: bool = False

