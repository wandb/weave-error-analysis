"""
Agent info models and utilities.

Agent context is a simple free-form text field that describes the agent.
The AgentInfo and TestingDimension models are used by the SyntheticGenerator.
"""

from typing import Optional, List, Dict
from pydantic import BaseModel, Field


# =============================================================================
# Data Models (used by SyntheticGenerator)
# =============================================================================

class TestingDimension(BaseModel):
    """A dimension for synthetic data generation."""
    name: str
    values: List[str]
    descriptions: Optional[Dict[str, str]] = None


class AgentInfo(BaseModel):
    """
    Agent information for synthetic generation.
    
    Used by SyntheticGenerator to provide context for query generation.
    """
    name: str
    agent_context: str = ""
    testing_dimensions: List[TestingDimension] = Field(default_factory=list)
