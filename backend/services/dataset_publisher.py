"""
Dataset Publisher - Publishes synthetic batches as Weave Datasets.

When a batch is created, we publish its queries as a Weave Dataset
to the USER'S Weave project. This provides:

1. Visibility: Dataset appears in user's Weave UI under "Datasets" tab
2. Linkage: Each row has an ID we can reference via Weave attributes
3. Data lineage: Weave tracks the relationship between datasets and traces

The dataset name follows the pattern: batch_{batch_id_short}
Each row contains: id, query, dimensions, batch_id
"""

import os
import weave
from weave import Dataset

from config import get_target_project_id, get_wandb_api_key, get_tool_project_id
from database import get_db
from logger import get_logger

logger = get_logger("dataset_publisher")


async def publish_batch_dataset(batch_id: str) -> str:
    """
    Publish a batch's queries as a Weave Dataset to the user's project.
    
    Args:
        batch_id: The batch to publish
        
    Returns:
        The Weave dataset reference URI (e.g., weave:///entity/project/object/batch_abc:v0)
        
    Raises:
        ValueError: If batch not found or target project not configured
    """
    # Initialize Weave with USER's project
    project_id = get_target_project_id()
    if not project_id:
        raise ValueError(
            "Target project not configured. "
            "Please configure 'weave_entity' and 'weave_project' in Settings."
        )
    
    # Set API key
    api_key = get_wandb_api_key()
    if api_key:
        os.environ["WANDB_API_KEY"] = api_key
    
    # Initialize Weave with user's project for publishing
    weave.init(project_id)
    
    # Get queries from database
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT sq.id, sq.query_text, sq.dimension_tuple, sb.name as batch_name
            FROM synthetic_queries sq
            JOIN synthetic_batches sb ON sq.batch_id = sb.id
            WHERE sq.batch_id = ?
        """, (batch_id,))
        queries = cursor.fetchall()
    
    if not queries:
        raise ValueError(f"No queries found for batch {batch_id}")
    
    # Build dataset rows
    rows = []
    for q in queries:
        rows.append({
            "id": q["id"],
            "query": q["query_text"],
            "dimensions": q["dimension_tuple"],  # JSON string
            "batch_id": batch_id,
        })
    
    # Create and publish dataset to user's project
    # Use short ID for readability in Weave UI
    dataset_name = f"batch_{batch_id[:8]}"
    dataset = Dataset(name=dataset_name, rows=rows)
    ref = weave.publish(dataset)
    
    logger.info(f"Published dataset '{dataset_name}' with {len(rows)} rows to {project_id}")
    logger.info(f"Dataset ref: {ref}")
    
    # Store dataset reference in batch record
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE synthetic_batches 
            SET weave_dataset_ref = ? 
            WHERE id = ?
        """, (str(ref), batch_id))
    
    # Restore tool project context after publishing to user's project
    tool_project = get_tool_project_id()
    if tool_project:
        try:
            weave.init(tool_project)
        except Exception:
            pass  # Non-critical
    
    return str(ref)


async def get_batch_dataset_ref(batch_id: str) -> str | None:
    """
    Get the Weave dataset reference for a batch.
    
    Args:
        batch_id: The batch ID to look up
        
    Returns:
        The Weave dataset reference URI, or None if not published
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT weave_dataset_ref FROM synthetic_batches WHERE id = ?",
            (batch_id,)
        )
        row = cursor.fetchone()
        return row["weave_dataset_ref"] if row else None


async def get_dataset_rows(batch_id: str) -> list[dict]:
    """
    Get the dataset rows for a batch from local database.
    
    This is faster than fetching from Weave and we always have
    the data locally after batch creation.
    
    Args:
        batch_id: The batch ID
        
    Returns:
        List of query rows from the batch
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, query_text as query, dimension_tuple as dimensions
            FROM synthetic_queries
            WHERE batch_id = ?
        """, (batch_id,))
        
        rows = []
        for row in cursor.fetchall():
            rows.append({
                "id": row["id"],
                "query": row["query"],
                "dimensions": row["dimensions"],
                "batch_id": batch_id,
            })
        
        return rows
