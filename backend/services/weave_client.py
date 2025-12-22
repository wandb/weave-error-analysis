"""
Weave Client using the Python SDK.

This module wraps the Weave Python SDK to provide a clean interface for:
- Querying calls (traces) from the user's project
- Managing feedback (read and write)
- Publishing datasets

The SDK handles authentication via WANDB_API_KEY environment variable.

This replaces the old httpx-based implementation with the cleaner SDK approach:
- No manual HTTP calls or auth headers
- Clean method-based API
- Better error handling with context
- Automatic project context management

IMPORTANT: Context Management
This client accesses the USER's Weave project to query their agent traces.
However, the tool's LLM calls should be logged to the TOOL project.

When weave.init() is called to switch to the user's project, it changes
the global Weave context. To prevent tool LLM calls from being logged to
the user's project, we restore the tool project context after operations.
"""

import os
import weave
from weave.trace.weave_client import WeaveClient as SDKClient
from typing import Iterator

from config import get_target_project_id, get_wandb_api_key, get_tool_project_id
from logger import get_logger
from utils import truncate_dict, truncate_value

logger = get_logger("weave_client")


def _restore_tool_project_context() -> None:
    """
    Restore the Weave global context to the tool project.
    
    Call this after any operation that switches to the user's project
    to ensure subsequent LLM calls are logged to the tool project.
    """
    tool_project = get_tool_project_id()
    if tool_project:
        try:
            weave.init(tool_project)
        except Exception as e:
            # Non-critical - just log and continue
            logger.debug(f"Failed to restore tool project context: {e}")


class WeaveClientWrapper:
    """
    Wrapper around Weave Python SDK for our application needs.
    
    The SDK client is initialized lazily when first needed.
    All operations use the user's configured target project.
    """
    
    def __init__(self):
        self._client: SDKClient | None = None
        self._initialized_project: str | None = None
    
    async def init(self) -> None:
        """
        Initialize the Weave client.
        
        Call this at application startup (e.g., in FastAPI lifespan).
        Note: Actual SDK init happens lazily on first use to handle
        project configuration changes via Settings UI.
        """
        logger.info("WeaveClient ready (lazy initialization)")
    
    async def close(self) -> None:
        """
        Close the Weave client.
        
        Call this at application shutdown.
        """
        # SDK doesn't require explicit cleanup, but we clear our reference
        self._client = None
        self._initialized_project = None
        logger.info("WeaveClient closed")
    
    def _ensure_initialized(self) -> SDKClient:
        """
        Ensure the Weave client is initialized for the current project.
        
        Re-initializes if the target project has changed (user updated settings).
        
        NOTE: This switches the global Weave context to the user's project.
        Call _restore_tool_project_context() after operations to restore
        the tool project context for LLM calls.
        """
        project_id = get_target_project_id()
        if not project_id:
            raise ValueError(
                "Weave target project not configured. "
                "Please configure 'weave_entity' and 'weave_project' in Settings."
            )
        
        # Set API key in environment (SDK reads from there)
        api_key = get_wandb_api_key()
        if api_key:
            os.environ["WANDB_API_KEY"] = api_key
        
        # Re-initialize if project changed
        if self._client is None or self._initialized_project != project_id:
            logger.info(f"Initializing Weave SDK for user project: {project_id}")
            self._client = weave.init(project_id)
            self._initialized_project = project_id
        
        return self._client
    
    def restore_tool_context(self) -> None:
        """
        Restore the global Weave context to the tool project.
        
        Call this after a batch of operations on the user's project
        to ensure subsequent LLM calls are logged to the tool project.
        """
        _restore_tool_project_context()
    
    @property
    def client(self) -> SDKClient:
        """Get the initialized SDK client."""
        return self._ensure_initialized()
    
    @property
    def project_id(self) -> str:
        """Get the current target project ID."""
        return get_target_project_id()
    
    def _check_configured(self) -> None:
        """Check if the target project is configured."""
        if not get_target_project_id():
            raise ValueError(
                "Weave target project not configured. "
                "Please configure 'weave_entity' and 'weave_project' in Settings "
                "to point to the Weave project where your agent logs traces."
            )
    
    # =========================================================================
    # CALL QUERIES
    # =========================================================================
    
    async def read_call(self, call_id: str) -> dict | None:
        """
        Get a single call by ID.
        
        Args:
            call_id: The call UUID
            
        Returns:
            Call object as dict, or None if not found
        """
        try:
            call = self.client.get_call(call_id)
            return self._call_to_dict(call) if call else None
        except Exception as e:
            logger.warning(f"Error fetching call {call_id}: {e}")
            return None
    
    async def query_calls(
        self,
        limit: int = 100,
        offset: int = 0,
        op_names: list[str] | None = None,
        trace_roots_only: bool = False,
        parent_ids: list[str] | None = None,
        thread_ids: list[str] | None = None,
        sort_field: str = "started_at",
        sort_direction: str = "desc"
    ) -> list[dict]:
        """
        Query calls from the project.
        
        Args:
            limit: Maximum number of calls to return
            offset: Pagination offset (note: SDK uses cursor-based, we implement offset)
            op_names: Filter by operation names
            trace_roots_only: Only return root calls (no parent)
            parent_ids: Filter by parent call IDs
            thread_ids: Filter by thread IDs
            sort_field: Field to sort by (used for ordering)
            sort_direction: Sort direction ("asc" or "desc")
            
        Returns:
            List of call objects as dicts
        """
        self._check_configured()
        
        try:
            # Build filter dict
            filter_dict = {}
            if op_names:
                filter_dict["op_names"] = op_names
            if trace_roots_only:
                filter_dict["trace_roots_only"] = True
            if parent_ids:
                filter_dict["parent_ids"] = parent_ids
            if thread_ids:
                filter_dict["thread_ids"] = thread_ids
            
            # Build sort_by parameter (SDK format: list of tuples/dicts)
            # Default to descending order by started_at (newest first)
            sort_by_param = [{"field": sort_field, "direction": sort_direction}]
            
            # Query calls - returns an iterator
            # Use SDK's built-in limit, offset, and sort_by
            calls_iter = self.client.get_calls(
                filter=filter_dict if filter_dict else None,
                limit=limit,
                offset=offset,
                sort_by=sort_by_param
            )
            
            # Convert to list of dicts
            results = []
            for call in calls_iter:
                results.append(self._call_to_dict(call))
            
            return results
            
        except Exception as e:
            logger.error(f"Error querying calls: {e}")
            return []
    
    async def get_child_calls(self, parent_id: str, limit: int = 50) -> list[dict]:
        """Get child calls for a parent call."""
        calls = await self.query_calls(limit=limit, parent_ids=[parent_id])
        
        return [
            {
                "id": call.get("id"),
                "op_name": call.get("op_name"),
                "started_at": call.get("started_at"),
                "ended_at": call.get("ended_at"),
                "inputs_preview": truncate_dict(call.get("inputs", {})),
                "output_preview": truncate_value(call.get("output"))
            }
            for call in calls
        ]
    
    def _call_to_dict(self, call) -> dict:
        """Convert SDK Call object to dict for our use."""
        return {
            "id": call.id,
            "trace_id": getattr(call, "trace_id", None),
            "parent_id": getattr(call, "parent_id", None),
            "thread_id": getattr(call, "thread_id", None),
            "op_name": getattr(call, "op_name", None),
            "display_name": getattr(call, "display_name", None),
            "started_at": str(call.started_at) if hasattr(call, "started_at") and call.started_at else None,
            "ended_at": str(call.ended_at) if hasattr(call, "ended_at") and call.ended_at else None,
            "inputs": getattr(call, "inputs", {}),
            "output": getattr(call, "output", None),
            "exception": getattr(call, "exception", None),
            "attributes": getattr(call, "attributes", {}),
            "summary": getattr(call, "summary", {}),
        }
    
    # =========================================================================
    # FEEDBACK OPERATIONS
    # =========================================================================
    
    async def query_feedback(
        self,
        weave_ref: str | None = None,
        limit: int = 100
    ) -> list[dict]:
        """
        Query feedback from the project.
        
        Args:
            weave_ref: Filter to feedback for a specific call reference
            limit: Maximum number of feedback items
            
        Returns:
            List of feedback objects
        """
        self._check_configured()
        
        try:
            # Get all feedback in project
            feedback_iter = self.client.get_feedback()
            results = []
            for fb in feedback_iter:
                # If weave_ref filter is specified, check match
                if weave_ref:
                    fb_ref = getattr(fb, "weave_ref", None)
                    if fb_ref and str(fb_ref) != weave_ref:
                        continue
                
                fb_dict = {
                    "id": getattr(fb, "id", None),
                    "feedback_type": getattr(fb, "feedback_type", None),
                    "payload": getattr(fb, "payload", {}),
                    "created_at": str(fb.created_at) if hasattr(fb, "created_at") and fb.created_at else None,
                    "weave_ref": str(getattr(fb, "weave_ref", "")) if hasattr(fb, "weave_ref") else None,
                }
                results.append(fb_dict)
                if len(results) >= limit:
                    break
            return results
                
        except Exception as e:
            logger.warning(f"Error fetching feedback: {e}")
            return []
    
    async def get_feedback_for_call(self, call_id: str) -> list[dict]:
        """Get feedback for a specific call."""
        try:
            call = self.client.get_call(call_id)
            if not call:
                return []
            
            # Iterate through call's feedback
            feedback_list = []
            for fb in call.feedback:
                fb_dict = {
                    "id": getattr(fb, "id", None),
                    "type": getattr(fb, "feedback_type", None),
                    "payload": getattr(fb, "payload", {}),
                    "created_at": str(fb.created_at) if hasattr(fb, "created_at") and fb.created_at else None,
                }
                feedback_list.append(fb_dict)
            return feedback_list
            
        except Exception as e:
            logger.warning(f"Error fetching feedback for call {call_id}: {e}")
            return []
    
    async def add_feedback_reaction(self, call_id: str, reaction: str) -> bool:
        """
        Add a reaction (emoji) to a call.
        
        Args:
            call_id: The call to add feedback to
            reaction: The emoji reaction (e.g., "👍", "👎")
            
        Returns:
            True if successful
        """
        try:
            call = self.client.get_call(call_id)
            if not call:
                logger.warning(f"Call not found: {call_id}")
                return False
            
            call.feedback.add_reaction(reaction)
            return True
            
        except Exception as e:
            logger.error(f"Error adding reaction: {e}")
            return False
    
    async def add_feedback_note(self, call_id: str, note: str) -> bool:
        """
        Add a note to a call.
        
        Args:
            call_id: The call to add the note to
            note: The note text (max 1024 chars)
            
        Returns:
            True if successful
        """
        try:
            call = self.client.get_call(call_id)
            if not call:
                logger.warning(f"Call not found: {call_id}")
                return False
            
            call.feedback.add_note(note)
            return True
            
        except Exception as e:
            logger.error(f"Error adding note: {e}")
            return False
    
    async def create_feedback(
        self, 
        call_id: str, 
        feedback_type: str, 
        payload: dict
    ) -> dict:
        """
        Add custom feedback to a call.
        
        Args:
            call_id: The call to add feedback to
            feedback_type: Custom type label (e.g., "correctness", "quality")
            payload: JSON-serializable payload (must be < 1KB)
            
        Returns:
            Dict with result info or raises exception
        """
        self._check_configured()
        
        try:
            call = self.client.get_call(call_id)
            if not call:
                raise ValueError(f"Call not found: {call_id}")
            
            call.feedback.add(feedback_type, payload)
            return {"success": True, "call_id": call_id, "feedback_type": feedback_type}
            
        except Exception as e:
            logger.error(f"Error adding custom feedback: {e}")
            raise
    
    async def delete_feedback(self, call_id: str, feedback_id: str) -> bool:
        """
        Delete feedback from a call.
        
        Args:
            call_id: The call containing the feedback
            feedback_id: The feedback UUID to delete
            
        Returns:
            True if successful
        """
        try:
            call = self.client.get_call(call_id)
            if not call:
                return False
            
            call.feedback.purge(feedback_id)
            return True
            
        except Exception as e:
            logger.error(f"Error deleting feedback: {e}")
            return False


class WeaveClient(WeaveClientWrapper):
    """
    Alias for WeaveClientWrapper to maintain backwards compatibility.
    
    The class is named WeaveClient to match the existing API, while
    WeaveClientWrapper is the actual implementation to avoid confusion
    with the Weave SDK's WeaveClient.
    """
    pass


# Singleton instance
weave_client = WeaveClient()
