"""
Pydantic models for request/response validation.
"""

from typing import Any, Optional, List
from pydantic import BaseModel, Field


class CategorizeRequest(BaseModel):
    """Request body for note categorization."""
    notes: list[str]


class FeedbackRequest(BaseModel):
    """Request body for adding feedback to a trace."""
    trace_id: str
    feedback_type: str
    value: Optional[str] = None


# =============================================================================
# Agent Stats Models
# =============================================================================

class AgentStats(BaseModel):
    """Comprehensive statistics for an agent."""
    agent_id: str
    agent_name: str
    
    # Batch stats
    total_batches: int = 0
    pending_batches: int = 0
    completed_batches: int = 0
    
    # Query stats
    total_queries: int = 0
    executed_queries: int = 0
    success_queries: int = 0
    failed_queries: int = 0
    
    # Review stats (from Weave feedback, not local sessions)
    total_traces: int = 0
    reviewed_traces: int = 0
    unreviewed_traces: int = 0
    review_progress_percent: float = 0.0
    
    # Failure mode stats
    total_failure_modes: int = 0
    total_categorized_notes: int = 0
    saturation_score: float = 0.0
    saturation_status: str = "discovering"  # "discovering", "approaching", "saturated"
    top_failure_mode: Optional[str] = None
    top_failure_mode_percent: Optional[float] = None
    
    # Activity
    latest_batch_name: Optional[str] = None
    latest_batch_completed_at: Optional[str] = None


# =============================================================================
# Saturation History Models
# =============================================================================

class SaturationSnapshot(BaseModel):
    """A single point on the saturation discovery curve."""
    threads_reviewed: int
    failure_modes_count: int
    categorized_notes: int = 0
    saturation_score: float = 0.0
    snapshot_date: str


class SaturationHistory(BaseModel):
    """Complete saturation history with discovery curve and recommendations."""
    # Discovery curve data points
    snapshots: List[SaturationSnapshot]
    
    # Current state
    current_threads: int
    current_modes: int
    current_notes: int
    
    # Discovery tracking
    last_discovery_at_threads: int = 0
    threads_since_last_discovery: int = 0
    
    # Saturation metrics
    saturation_score: float = 0.0
    saturation_status: str = "no_data"  # "no_data", "discovering", "approaching_saturation", "saturated"
    
    # Actionable recommendation
    recommendation: str = ""
    recommendation_type: str = "info"  # "info", "action", "success"
    
    # Recent activity
    recent_discoveries: int = 0  # New modes in last 20 threads
