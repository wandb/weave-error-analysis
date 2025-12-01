"""
Pydantic models for request/response validation.
"""

from typing import Optional
from pydantic import BaseModel


class CategorizeRequest(BaseModel):
    """Request body for note categorization."""
    notes: list[str]


class FeedbackRequest(BaseModel):
    """Request body for adding feedback to a trace."""
    trace_id: str
    feedback_type: str
    value: Optional[str] = None

