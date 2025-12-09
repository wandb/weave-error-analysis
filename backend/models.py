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
# Session Models (Phase 2 - Session Sync)
# =============================================================================

class SessionFilters(BaseModel):
    """Comprehensive session filtering options."""
    
    # Batch Association
    batch_id: Optional[str] = Field(None, description="Filter by batch ID")
    exclude_batches: bool = Field(False, description="Show only organic (non-batch) sessions")
    
    # Turn Count
    min_turns: Optional[int] = Field(None, ge=1, description="Minimum turn count")
    max_turns: Optional[int] = Field(None, ge=1, description="Maximum turn count")
    
    # Review Status
    is_reviewed: Optional[bool] = Field(None, description="Filter by review status")
    
    # Error Status
    has_error: Optional[bool] = Field(None, description="Filter by error status")
    
    # Token Usage
    min_tokens: Optional[int] = Field(None, ge=0, description="Minimum total tokens")
    max_tokens: Optional[int] = Field(None, ge=0, description="Maximum total tokens")
    
    # Cost
    min_cost: Optional[float] = Field(None, ge=0, description="Minimum cost in USD")
    max_cost: Optional[float] = Field(None, ge=0, description="Maximum cost in USD")
    
    # Date Range
    started_after: Optional[str] = Field(None, description="Sessions started after (ISO timestamp)")
    started_before: Optional[str] = Field(None, description="Sessions started before (ISO timestamp)")
    
    # Search
    note_search: Optional[str] = Field(None, description="Search notes content")
    
    # Sampling
    random_sample: Optional[int] = Field(None, ge=1, le=100, description="Return random N sessions")


class SessionSummary(BaseModel):
    """Session summary for list display."""
    id: str
    weave_session_id: Optional[str] = None
    weave_url: Optional[str] = None
    
    # Batch context
    batch_id: Optional[str] = None
    batch_name: Optional[str] = None
    
    # Metrics
    turn_count: int = 0
    call_count: int = 0
    total_latency_ms: float = 0.0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0
    primary_model: Optional[str] = None
    
    # Status
    has_error: bool = False
    is_reviewed: bool = False
    
    # Timestamps
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    
    class Config:
        from_attributes = True


class SessionListResponse(BaseModel):
    """Response for session list endpoint."""
    sessions: List[SessionSummary]
    total_count: int
    page: int = 1
    page_size: int = 50
    has_more: bool = False


class SessionNote(BaseModel):
    """Session note model."""
    id: str
    session_id: str
    call_id: Optional[str] = None
    content: str
    note_type: str = "observation"
    weave_feedback_id: Optional[str] = None
    synced_to_weave: bool = False
    created_at: str
    updated_at: str
    created_by: Optional[str] = None


class ConversationMessage(BaseModel):
    """Message in a conversation."""
    type: str  # 'user', 'assistant', 'tool_call', 'system'
    content: Optional[str] = None
    call_id: Optional[str] = None
    timestamp: Optional[str] = None
    tool_name: Optional[str] = None
    tool_input: Optional[Any] = None  # Tool arguments/input
    tool_output: Optional[Any] = None  # Tool result/output
    tool_result: Optional[str] = None  # Legacy field for backwards compat


class SessionDetail(BaseModel):
    """Full session detail for single session view."""
    # Identity
    id: str
    weave_session_id: Optional[str] = None
    weave_url: Optional[str] = None
    
    # Batch Context
    batch_id: Optional[str] = None
    batch_name: Optional[str] = None
    query_text: Optional[str] = None  # If from synthetic batch
    
    # Metrics
    turn_count: int = 0
    call_count: int = 0
    total_latency_ms: float = 0.0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0
    primary_model: Optional[str] = None
    
    # Status
    has_error: bool = False
    error_summary: Optional[str] = None
    is_reviewed: bool = False
    reviewed_at: Optional[str] = None
    
    # Timestamps
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    
    # Conversation (from Weave)
    conversation: List[ConversationMessage] = []
    
    # Notes (from local DB)
    notes: List[SessionNote] = []


class SyncStatusResponse(BaseModel):
    """Response for sync status endpoint."""
    status: str  # 'idle', 'syncing', 'error'
    last_sync_completed_at: Optional[str] = None
    last_sync_type: Optional[str] = None  # 'full', 'incremental', 'batch'
    sessions_added: int = 0
    sessions_updated: int = 0
    is_syncing: bool = False
    current_sync_progress: float = 0.0
    error_message: Optional[str] = None


class SyncTriggerResponse(BaseModel):
    """Response for sync trigger endpoint."""
    status: str  # 'started', 'already_syncing'
    message: str


class BatchReviewProgress(BaseModel):
    """Review progress for a specific batch."""
    batch_id: str
    batch_name: Optional[str] = None
    
    # Counts
    total_sessions: int = 0
    reviewed_sessions: int = 0
    unreviewed_sessions: int = 0
    
    # Progress
    progress_percent: float = 0.0
    
    # Targets
    review_target: Optional[int] = None
    remaining_to_target: Optional[int] = None
    
    # Activity
    recent_reviews_24h: int = 0
    last_review_at: Optional[str] = None


class CreateNoteRequest(BaseModel):
    """Request to create a session note."""
    content: str
    call_id: Optional[str] = None
    note_type: str = Field("observation", description="Type: observation, bug, success, question")


class MarkSessionReviewedRequest(BaseModel):
    """Request to mark a session as reviewed."""
    notes: Optional[str] = None

