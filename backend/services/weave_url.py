"""
Generate deep links to Weave UI with pre-applied filters.

This service generates URLs that take users directly to Weave's trace viewer
with filters already applied (e.g., batch_id, time range). This enables
the "Review in Weave" workflow where users:

1. Generate synthetic queries in our app
2. Execute them against their agent
3. Click "Review in Weave" to see all traces for that batch
4. Add feedback/annotations in Weave's native UI
5. Sync feedback back for taxonomy building

The URL structure matches Weave's query parameter format for filters and sorting.
"""

import json
import urllib.parse
from datetime import datetime

from config import get_wandb_entity, get_target_project


def generate_batch_review_url(
    batch_id: str,
    started_after: datetime | None = None,
    entity: str | None = None,
    project: str | None = None,
) -> str:
    """
    Generate Weave URL filtered to a specific batch.
    
    Creates a deep link to Weave's traces view with the batch_id filter pre-applied.
    Users can click this to immediately see all traces from a synthetic batch execution.
    
    Args:
        batch_id: The batch ID to filter by (set as weave.attributes during execution)
        started_after: Optional time filter (e.g., batch start time) to narrow results
        entity: W&B entity (org/user). If None, uses configured value.
        project: W&B project name. If None, uses configured value.
        
    Returns:
        Full Weave URL with filters applied, ready to open in browser
    """
    entity = entity or get_wandb_entity()
    project = project or get_target_project()
    
    if not entity or not project:
        # Return a helpful error URL if not configured
        return f"#error:weave-not-configured"
    
    base = f"https://wandb.ai/{entity}/{project}/weave/traces"
    
    # Sort by most recent first
    sort = [{"field": "started_at", "sort": "desc"}]
    
    # Build filter items
    items = []
    filter_id = 0
    
    # Time filter (optional) - helps narrow down to just this batch's traces
    if started_after:
        # Format date correctly: use Z suffix for UTC, not both offset and Z
        # If datetime is timezone-aware, convert to UTC and use isoformat without offset
        if started_after.tzinfo is not None:
            # Replace timezone with UTC notation (Z suffix)
            iso_str = started_after.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        else:
            # Naive datetime, assume UTC
            iso_str = started_after.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        
        items.append({
            "id": filter_id,
            "field": "started_at",
            "operator": "(date): after",
            "value": iso_str
        })
        filter_id += 1
    
    # Batch filter (required) - the key filter for this workflow
    items.append({
        "id": filter_id,
        "field": "attributes.batch_id",
        "operator": "(string): equals",
        "value": batch_id
    })
    
    filters = {
        "items": items,
        "logicOperator": "and"
    }
    
    # Build URL with encoded query parameters
    url = (
        f"{base}?view=traces_default"
        f"&sort={urllib.parse.quote(json.dumps(sort, separators=(',', ':')))}"
        f"&filters={urllib.parse.quote(json.dumps(filters, separators=(',', ':')))}"
    )
    
    return url


def generate_trace_url(trace_id: str, entity: str | None = None, project: str | None = None) -> str:
    """
    Generate direct link to a specific trace.
    
    Args:
        trace_id: The Weave trace/call ID
        entity: W&B entity (org/user). If None, uses configured value.
        project: W&B project name. If None, uses configured value.
        
    Returns:
        Direct URL to the trace in Weave UI
    """
    entity = entity or get_wandb_entity()
    project = project or get_target_project()
    
    if not entity or not project:
        return f"#error:weave-not-configured"
    
    return f"https://wandb.ai/{entity}/{project}/r/call/{trace_id}"


def generate_filtered_traces_url(
    filters: dict,
    entity: str | None = None,
    project: str | None = None,
) -> str:
    """
    Generate a Weave URL with custom filters.
    
    This is a lower-level function for cases where you need more control
    over the filter structure.
    
    Args:
        filters: Dict with 'items' (list of filter dicts) and 'logicOperator'
        entity: W&B entity. If None, uses configured value.
        project: W&B project. If None, uses configured value.
        
    Returns:
        Full Weave URL with filters applied
    """
    entity = entity or get_wandb_entity()
    project = project or get_target_project()
    
    if not entity or not project:
        return f"#error:weave-not-configured"
    
    base = f"https://wandb.ai/{entity}/{project}/weave/traces"
    sort = [{"field": "started_at", "sort": "desc"}]
    
    url = (
        f"{base}?view=traces_default"
        f"&sort={urllib.parse.quote(json.dumps(sort, separators=(',', ':')))}"
        f"&filters={urllib.parse.quote(json.dumps(filters, separators=(',', ':')))}"
    )
    
    return url

