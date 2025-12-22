"""
Trace Discovery Service - Link batch queries to Weave traces via attributes.

This module provides attribute-based discovery of traces belonging to batches.

When batch executor sets Weave attributes (batch_id) before calling the agent,
traces automatically get these attributes. We query traces by batch_id to find
all traces from a batch execution.

Note: Users review traces in Weave UI directly via "Review in Weave" deep links.
"""

from datetime import datetime, timedelta
from typing import Dict, List

from services.weave_client import weave_client
from database import get_db
from logger import get_logger

logger = get_logger("trace_discovery")


class TraceDiscoveryService:
    """
    Discovers traces belonging to batches via Weave attributes.
    
    The batch executor calls the agent within a weave.attributes() context
    that sets batch_id. This attribute is attached to the @weave.op decorated
    call, allowing us to find all traces from a batch.
    """
    
    async def get_traces_for_batch(self, batch_id: str) -> List[dict]:
        """
        Get all traces that belong to a batch.
        
        Queries Weave for traces where attributes.batch_id matches.
        
        Args:
            batch_id: The batch to find traces for
            
        Returns:
            List of trace dicts from Weave
        """
        try:
            # Query Weave for traces with matching batch_id attribute
            # Note: The Weave SDK may not support attribute filtering directly,
            # so we fetch recent traces and filter client-side
            all_traces = await weave_client.query_calls(
                limit=500,
                trace_roots_only=True,
            )
            
            # Filter to traces with matching batch_id attribute
            batch_traces = []
            for trace in all_traces:
                attrs = trace.get("attributes", {})
                if attrs.get("batch_id") == batch_id:
                    batch_traces.append(trace)
            
            logger.info(f"Found {len(batch_traces)} traces for batch {batch_id}")
            return batch_traces
            
        except Exception as e:
            logger.error(f"Error fetching traces for batch {batch_id}: {e}")
            return []
    
    async def discover_traces_for_batch(self, batch_id: str) -> List[dict]:
        """
        Discover and return all traces for a batch.
        
        This is the main discovery method. It finds all traces with
        the batch_id attribute and returns them.
        
        Args:
            batch_id: The batch to process
            
        Returns:
            List of discovered traces
        """
        batch_traces = await self.get_traces_for_batch(batch_id)
        
        if not batch_traces:
            logger.info(f"No traces found with batch_id={batch_id} attribute")
            return []
        
        logger.info(f"Discovered {len(batch_traces)} traces for batch {batch_id}")
        return batch_traces
    
    async def get_traces_in_time_window(
        self,
        start_time: str,
        end_time: str,
        buffer_minutes: int = 10
    ) -> List[dict]:
        """
        Get traces within a time window.
        
        Useful for finding traces created during batch execution.
        
        Args:
            start_time: Window start (ISO format)
            end_time: Window end (ISO format)
            buffer_minutes: Extra time to add to end
            
        Returns:
            List of traces in the time window
        """
        try:
            all_traces = await weave_client.query_calls(
                limit=500,
                trace_roots_only=True,
            )
            
            # Filter by time
            filtered = []
            for trace in all_traces:
                if self._in_time_window(trace, start_time, end_time, buffer_minutes):
                    filtered.append(trace)
            
            return filtered
            
        except Exception as e:
            logger.error(f"Error fetching traces: {e}")
            return []
    
    def _in_time_window(
        self, 
        trace: dict, 
        start_time: str, 
        end_time: str,
        buffer_minutes: int = 10
    ) -> bool:
        """Check if trace started within the time window."""
        trace_start = trace.get("started_at")
        if not trace_start:
            return False
        
        try:
            trace_dt = datetime.fromisoformat(trace_start.replace("Z", "+00:00"))
            start_dt = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
            end_dt = datetime.fromisoformat(end_time.replace("Z", "+00:00"))
            
            end_dt += timedelta(minutes=buffer_minutes)
            
            return start_dt <= trace_dt <= end_dt
        except Exception:
            return False
    
    def extract_batch_info_from_trace(self, trace: dict) -> dict:
        """
        Extract batch-related info from a trace's attributes.
        
        Args:
            trace: The trace dict from Weave
            
        Returns:
            Dict with batch_id (if present)
        """
        attrs = trace.get("attributes", {})
        return {
            "batch_id": attrs.get("batch_id"),
        }


# Singleton instance
trace_discovery_service = TraceDiscoveryService()
