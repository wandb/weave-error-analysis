"""
Synthetic Data Generation API Endpoints

Provides endpoints for:
- Managing testing dimensions
- Generating dimension tuples
- Converting tuples to natural language queries
- Creating and managing synthetic query batches
"""

import json
import uuid
from datetime import datetime
from typing import List, Optional, Dict
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import get_default_batch_size
from database import get_db, now_iso
from logger import get_logger

logger = get_logger("synthetic_api")

router = APIRouter(prefix="/api", tags=["synthetic"])


# =============================================================================
# Request/Response Models
# =============================================================================

class DimensionCreate(BaseModel):
    """Request to create/update a dimension."""
    name: str
    values: List[str]
    descriptions: Optional[Dict[str, str]] = None


class DimensionResponse(BaseModel):
    """Response for a dimension."""
    id: str
    agent_id: str
    name: str
    values: List[str]
    descriptions: Optional[Dict[str, str]] = None


class TupleGenerateRequest(BaseModel):
    """Request to generate dimension tuples."""
    agent_id: str
    count: Optional[int] = None  # None = use configured default_batch_size
    focus_areas: Optional[List[str]] = None
    custom_dimensions: Optional[Dict[str, List[str]]] = None


class TupleResponse(BaseModel):
    """Response for a generated tuple."""
    id: str
    values: Dict[str, str]


class QueryGenerateRequest(BaseModel):
    """Request to generate queries from tuples."""
    agent_id: str
    tuples: List[Dict[str, str]]  # List of dimension value dicts


class QueryResponse(BaseModel):
    """Response for a generated query."""
    id: str
    tuple_values: Dict[str, str]
    query_text: str
    execution_status: Optional[str] = None
    response_text: Optional[str] = None
    trace_id: Optional[str] = None
    error_message: Optional[str] = None


class BatchCreateRequest(BaseModel):
    """Request to create a synthetic batch."""
    agent_id: str
    name: Optional[str] = None
    count: Optional[int] = None  # None = use configured default_batch_size
    # Custom query prompt (optional - uses default if not provided)
    custom_query_prompt: Optional[str] = None  # Prompt for generating queries
    # Selected dimensions (dimension_name -> values)
    selected_dimensions: Optional[Dict[str, List[str]]] = None
    # Heuristic sampling parameters
    variety: float = 0.5  # 0.0 = predictable (favor favorites), 1.0 = surprising (uniform + diversity)
    favorites: Optional[Dict[str, List[str]]] = None  # dimension_name -> list of favorite values (5x weight)
    no_duplicates: bool = True  # Ensure unique tuple combinations


class BatchResponse(BaseModel):
    """Response for a batch."""
    id: str
    agent_id: str
    name: str
    status: str
    query_count: int
    created_at: str
    queries: Optional[List[QueryResponse]] = None
    # Enhanced stats for batch selector
    executed_count: Optional[int] = None
    success_count: Optional[int] = None
    failure_count: Optional[int] = None
    pending_count: Optional[int] = None


# =============================================================================
# Helper Functions
# =============================================================================

async def get_agent_info_for_generation(agent_id: str):
    """Get AgentInfo for synthetic generation."""
    from services.agent_info import AgentInfo, TestingDimension
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Get agent
        cursor.execute("SELECT * FROM agents WHERE id = ?", (agent_id,))
        agent_row = cursor.fetchone()
        if not agent_row:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        # Get dimensions from database
        cursor.execute("""
            SELECT * FROM agent_dimensions WHERE agent_id = ? ORDER BY name
        """, (agent_id,))
        dim_rows = cursor.fetchall()
    
    row_keys = agent_row.keys()
    
    # Build dimensions from database
    dimensions = []
    for row in dim_rows:
        dimensions.append(TestingDimension(
            name=row["name"],
            values=json.loads(row["dimension_values"]) if row["dimension_values"] else [],
            descriptions=json.loads(row["descriptions"]) if row["descriptions"] else None
        ))
    
    agent_context = ""
    if "agent_context" in row_keys and agent_row["agent_context"]:
        agent_context = agent_row["agent_context"]
    
    agent_info = AgentInfo(
        name=agent_row["name"] or "Unknown Agent",
        agent_context=agent_context,
        testing_dimensions=dimensions,
    )
    
    return agent_info


# =============================================================================
# Dimension Management Endpoints
# =============================================================================

@router.get("/agents/{agent_id}/dimensions")
async def get_dimensions(agent_id: str) -> List[DimensionResponse]:
    """Get all testing dimensions for an agent."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Verify agent exists
        cursor.execute("SELECT id FROM agents WHERE id = ?", (agent_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Agent not found")
        
        # Get dimensions
        cursor.execute("""
            SELECT * FROM agent_dimensions WHERE agent_id = ? ORDER BY name
        """, (agent_id,))
        rows = cursor.fetchall()
    
    return [
        DimensionResponse(
            id=row["id"],
            agent_id=row["agent_id"],
            name=row["name"],
            values=json.loads(row["dimension_values"]) if row["dimension_values"] else [],
            descriptions=json.loads(row["descriptions"]) if row["descriptions"] else None
        )
        for row in rows
    ]


@router.post("/agents/{agent_id}/dimensions")
async def create_or_update_dimension(agent_id: str, request: DimensionCreate) -> DimensionResponse:
    """Create or update a testing dimension for an agent."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Verify agent exists
        cursor.execute("SELECT id FROM agents WHERE id = ?", (agent_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Agent not found")
        
        # Check if dimension exists
        cursor.execute("""
            SELECT id FROM agent_dimensions WHERE agent_id = ? AND name = ?
        """, (agent_id, request.name))
        existing = cursor.fetchone()
        
        if existing:
            # Update existing
            cursor.execute("""
                UPDATE agent_dimensions 
                SET dimension_values = ?, descriptions = ?
                WHERE id = ?
            """, (
                json.dumps(request.values),
                json.dumps(request.descriptions) if request.descriptions else None,
                existing["id"]
            ))
            dim_id = existing["id"]
        else:
            # Create new
            dim_id = f"dim_{uuid.uuid4().hex[:12]}"
            cursor.execute("""
                INSERT INTO agent_dimensions (id, agent_id, name, dimension_values, descriptions, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                dim_id,
                agent_id,
                request.name,
                json.dumps(request.values),
                json.dumps(request.descriptions) if request.descriptions else None,
                now_iso()
            ))
    
    return DimensionResponse(
        id=dim_id,
        agent_id=agent_id,
        name=request.name,
        values=request.values,
        descriptions=request.descriptions
    )


@router.delete("/agents/{agent_id}/dimensions/{dimension_name}")
async def delete_dimension(agent_id: str, dimension_name: str):
    """Delete a testing dimension."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            DELETE FROM agent_dimensions WHERE agent_id = ? AND name = ?
        """, (agent_id, dimension_name))
        
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Dimension not found")
    
    return {"status": "deleted", "dimension": dimension_name}


# =============================================================================
# LLM-Powered Dimension Suggestion Endpoints
# =============================================================================

class SuggestDimensionsRequest(BaseModel):
    """Request to suggest testing dimensions using LLM."""
    testing_goals: Optional[str] = None
    count: int = 4


class SuggestedValueResponse(BaseModel):
    """A suggested value for a dimension."""
    id: str
    label: str


class SuggestedDimensionResponse(BaseModel):
    """A suggested testing dimension."""
    name: str
    description: Optional[str] = None
    values: List[SuggestedValueResponse]


class SuggestDimensionsResponse(BaseModel):
    """Response from dimension suggestion."""
    dimensions: List[SuggestedDimensionResponse]


@router.post("/agents/{agent_id}/dimensions/suggest")
async def suggest_dimensions(
    agent_id: str,
    request: SuggestDimensionsRequest = None
) -> SuggestDimensionsResponse:
    """
    Use LLM to suggest testing dimensions based on agent context.
    
    This helps users bootstrap their testing dimension setup without
    manually defining each bucket and value.
    
    The suggestions are NOT saved automatically - the frontend should
    present them as editable cards that the user can modify before saving.
    """
    from services.synthetic import suggest_dimensions_llm
    
    if request is None:
        request = SuggestDimensionsRequest()
    
    # Get agent context
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT name, agent_context FROM agents WHERE id = ?
        """, (agent_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Agent not found")
    
    # Extract agent info
    agent_name = row["name"]
    agent_context = row["agent_context"] or ""
    
    # Call LLM to suggest dimensions
    suggestions = await suggest_dimensions_llm(
        agent_name=agent_name,
        agent_context=agent_context,
        testing_goals=request.testing_goals,
        count=request.count,
    )
    
    # Convert to response format
    return SuggestDimensionsResponse(
        dimensions=[
            SuggestedDimensionResponse(
                name=dim.name,
                description=dim.description,
                values=[
                    SuggestedValueResponse(id=v.id, label=v.label)
                    for v in dim.values
                ]
            )
            for dim in suggestions
        ]
    )


class SuggestValuesRequest(BaseModel):
    """Request to suggest more values for a dimension."""
    count: int = 5


class SuggestValuesResponse(BaseModel):
    """Response from value suggestion."""
    dimension_name: str
    new_values: List[SuggestedValueResponse]


@router.post("/agents/{agent_id}/dimensions/{dimension_name}/suggest-values")
async def suggest_dimension_values(
    agent_id: str,
    dimension_name: str,
    request: SuggestValuesRequest = None
) -> SuggestValuesResponse:
    """
    Use LLM to suggest additional values for an existing dimension.
    
    This helps users expand their test coverage for a specific bucket
    without having to think of all edge cases manually.
    
    The suggestions are NOT saved automatically - they should be
    presented as addable values that the user can accept or modify.
    """
    from services.synthetic import suggest_values_for_bucket
    
    if request is None:
        request = SuggestValuesRequest()
    
    # Get agent and dimension info
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Get agent
        cursor.execute("""
            SELECT name, agent_context FROM agents WHERE id = ?
        """, (agent_id,))
        agent_row = cursor.fetchone()
        
        if not agent_row:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        # Get dimension
        cursor.execute("""
            SELECT dimension_values, descriptions FROM agent_dimensions 
            WHERE agent_id = ? AND name = ?
        """, (agent_id, dimension_name))
        dim_row = cursor.fetchone()
        
        if not dim_row:
            raise HTTPException(status_code=404, detail="Dimension not found")
    
    # Extract agent info
    agent_name = agent_row["name"]
    agent_context = agent_row["agent_context"] or ""
    
    # Get existing values
    existing_values = []
    if dim_row["dimension_values"]:
        existing_values = json.loads(dim_row["dimension_values"])
    
    # Get dimension description if available
    dimension_description = None
    if dim_row["descriptions"]:
        try:
            descs = json.loads(dim_row["descriptions"])
            # Use the first description as the dimension description
            if descs:
                dimension_description = list(descs.values())[0] if isinstance(descs, dict) else None
        except json.JSONDecodeError:
            pass
    
    # Call LLM to suggest values
    suggestions = await suggest_values_for_bucket(
        dimension_name=dimension_name,
        existing_values=existing_values,
        agent_name=agent_name,
        agent_context=agent_context,
        dimension_description=dimension_description,
        count=request.count,
    )
    
    # Convert to response format
    return SuggestValuesResponse(
        dimension_name=dimension_name,
        new_values=[
            SuggestedValueResponse(id=v.id, label=v.label)
            for v in suggestions
        ]
    )


# =============================================================================
# Batch Management Endpoints
# =============================================================================

@router.post("/synthetic/batches/generate-stream")
async def create_batch_streaming(request: BatchCreateRequest):
    """
    Create a new synthetic query batch with streaming progress.
    
    Returns an SSE stream of generation events, allowing the frontend to show
    real-time progress and populate queries as they're generated.
    Uses heuristic tuple generation with LLM query generation.
    
    Events:
    - batch_started: Generation has begun
    - tuples_generated: All tuples are ready
    - query_generated: A single query has been generated
    - query_error: A query failed to generate
    - batch_complete: All queries are done
    """
    from services.synthetic import SyntheticGenerator
    
    agent_info = await get_agent_info_for_generation(request.agent_id)
    
    if not agent_info.testing_dimensions:
        raise HTTPException(
            status_code=400,
            detail="No testing dimensions defined. Add dimensions in the Synthetic tab first."
        )
    
    generator = SyntheticGenerator(agent_info)
    
    # Use configured default if count not specified
    count = request.count if request.count is not None else get_default_batch_size()
    
    async def event_stream():
        batch_id = None
        batch_name = None
        query_count = 0
        
        try:
            async for event in generator.generate_batch_streaming(
                n=count,
                name=request.name,
                custom_query_prompt=request.custom_query_prompt,
                selected_dimensions=request.selected_dimensions,
                variety=request.variety,
                favorites=request.favorites,
                no_duplicates=request.no_duplicates,
            ):
                if event["type"] == "batch_started":
                    batch_id = event["batch_id"]
                    batch_name = event["name"]
                    
                    # Save batch immediately with 'generating' status
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute("""
                            INSERT INTO synthetic_batches (id, agent_id, name, status, query_count, generation_strategy, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, (
                            batch_id,
                            request.agent_id,
                            batch_name,
                            "generating",
                            0,
                            "heuristic",
                            now_iso()
                        ))
                
                elif event["type"] == "query_generated":
                    query_count += 1
                    query = event["query"]
                    
                    # Save query immediately to database
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute("""
                            INSERT INTO synthetic_queries (id, batch_id, dimension_tuple, query_text, execution_status)
                            VALUES (?, ?, ?, ?, ?)
                        """, (
                            query["id"],
                            batch_id,
                            json.dumps(query["tuple_values"]),
                            query["query_text"],
                            "pending"
                        ))
                        # Update batch query count
                        cursor.execute("""
                            UPDATE synthetic_batches SET query_count = ? WHERE id = ?
                        """, (query_count, batch_id))
                
                elif event["type"] == "batch_complete":
                    # Update batch status to 'ready'
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute("""
                            UPDATE synthetic_batches SET status = ?, query_count = ? WHERE id = ?
                        """, ("ready", event["query_count"], event["batch_id"]))
                
                # Yield event as SSE
                yield f"data: {json.dumps(event)}\n\n"
        
        except Exception as e:
            # If error occurs, mark batch as failed if it was created
            if batch_id:
                try:
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute("""
                            UPDATE synthetic_batches SET status = ? WHERE id = ?
                        """, ("failed", batch_id))
                except Exception:
                    pass  # Don't fail on cleanup error
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
    
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


class GenerateFromTuplesRequest(BaseModel):
    """Request to generate queries from pre-approved tuples."""
    agent_id: str
    tuples: List[Dict[str, str]]  # List of dimension value dicts (pre-approved by user)
    name: Optional[str] = None
    custom_query_prompt: Optional[str] = None


@router.post("/synthetic/batches/generate-from-tuples")
async def create_batch_from_tuples(request: GenerateFromTuplesRequest):
    """
    Create a batch by generating queries from user-approved tuples.
    
    This is Step 2 of the two-step generation flow:
    1. User generates tuples via /synthetic/tuples and reviews them
    2. User approves/edits tuples and submits them here for query generation
    
    Returns an SSE stream of generation events.
    
    Events:
    - batch_started: Generation has begun
    - query_generated: A single query has been generated  
    - query_error: A query failed to generate
    - batch_complete: All queries are done
    """
    from services.synthetic import SyntheticGenerator, DimensionTuple
    
    if not request.tuples:
        raise HTTPException(status_code=400, detail="No tuples provided")
    
    agent_info = await get_agent_info_for_generation(request.agent_id)
    generator = SyntheticGenerator(agent_info)
    
    # Store custom query prompt
    generator._custom_query_prompt = request.custom_query_prompt
    
    # Convert request tuples to DimensionTuple objects
    now = now_iso()
    tuples = [
        DimensionTuple(
            id=f"tuple_{uuid.uuid4().hex[:12]}",
            values=t,
            created_at=now
        )
        for t in request.tuples
    ]
    
    async def event_stream():
        batch_id = f"batch_{uuid.uuid4().hex[:6]}"
        batch_name = request.name or f"Batch {datetime.now().strftime('%Y-%m-%d')} #{batch_id[-6:].upper()}"
        queries = []
        
        try:
            # Emit batch started
            yield f"data: {json.dumps({'type': 'batch_started', 'batch_id': batch_id, 'name': batch_name, 'total': len(tuples)})}\n\n"
            
            # Generate queries one by one
            for i, t in enumerate(tuples):
                try:
                    query_text = await generator.tuple_to_query(t)
                    query_id = f"query_{uuid.uuid4().hex[:12]}"
                    
                    query = {
                        "id": query_id,
                        "tuple_values": t.values,
                        "query_text": query_text
                    }
                    queries.append(query)
                    
                    yield f"data: {json.dumps({'type': 'query_generated', 'index': i, 'completed': i + 1, 'total': len(tuples), 'progress_percent': round(((i + 1) / len(tuples)) * 100, 1), 'query': query})}\n\n"
                    
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'query_error', 'index': i, 'error': str(e), 'tuple': t.values})}\n\n"
            
            # Save to database
            with get_db() as conn:
                cursor = conn.cursor()
                
                cursor.execute("""
                    INSERT INTO synthetic_batches (id, agent_id, name, status, query_count, generation_strategy, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    batch_id,
                    request.agent_id,
                    batch_name,
                    "ready",
                    len(queries),
                    "llm_guided",
                    now_iso()
                ))
                
                for query in queries:
                    cursor.execute("""
                        INSERT INTO synthetic_queries (id, batch_id, dimension_tuple, query_text, execution_status)
                        VALUES (?, ?, ?, ?, ?)
                    """, (
                        query["id"],
                        batch_id,
                        json.dumps(query["tuple_values"]),
                        query["query_text"],
                        "pending"
                    ))
            
            # Emit completion
            yield f"data: {json.dumps({'type': 'batch_complete', 'batch_id': batch_id, 'name': batch_name, 'query_count': len(queries), 'queries': queries})}\n\n"
            
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
    
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.get("/synthetic/batches")
async def list_batches(agent_id: Optional[str] = None) -> List[BatchResponse]:
    """List all synthetic batches, optionally filtered by agent, with stats."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Query batches with aggregated query stats
        if agent_id:
            cursor.execute("""
                SELECT 
                    sb.*,
                    COUNT(sq.id) as total_queries,
                    SUM(CASE WHEN sq.execution_status = 'success' THEN 1 ELSE 0 END) as success_count,
                    SUM(CASE WHEN sq.execution_status = 'error' THEN 1 ELSE 0 END) as failure_count,
                    SUM(CASE WHEN sq.execution_status = 'pending' THEN 1 ELSE 0 END) as pending_count
                FROM synthetic_batches sb
                LEFT JOIN synthetic_queries sq ON sb.id = sq.batch_id
                WHERE sb.agent_id = ?
                GROUP BY sb.id
                ORDER BY sb.created_at DESC
            """, (agent_id,))
        else:
            cursor.execute("""
                SELECT 
                    sb.*,
                    COUNT(sq.id) as total_queries,
                    SUM(CASE WHEN sq.execution_status = 'success' THEN 1 ELSE 0 END) as success_count,
                    SUM(CASE WHEN sq.execution_status = 'error' THEN 1 ELSE 0 END) as failure_count,
                    SUM(CASE WHEN sq.execution_status = 'pending' THEN 1 ELSE 0 END) as pending_count
                FROM synthetic_batches sb
                LEFT JOIN synthetic_queries sq ON sb.id = sq.batch_id
                GROUP BY sb.id
                ORDER BY sb.created_at DESC
            """)
        
        rows = cursor.fetchall()
    
    return [
        BatchResponse(
            id=row["id"],
            agent_id=row["agent_id"],
            name=row["name"] or f"Batch {row['id'][:8]}",
            status=row["status"],
            query_count=row["query_count"],
            created_at=row["created_at"],
            executed_count=(row["success_count"] or 0) + (row["failure_count"] or 0),
            success_count=row["success_count"] or 0,
            failure_count=row["failure_count"] or 0,
            pending_count=row["pending_count"] or 0
        )
        for row in rows
    ]


@router.get("/synthetic/batches/{batch_id}")
async def get_batch(batch_id: str, include_queries: bool = True) -> BatchResponse:
    """Get a specific batch with its queries and session metrics."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM synthetic_batches WHERE id = ?", (batch_id,))
        batch_row = cursor.fetchone()
        
        if not batch_row:
            raise HTTPException(status_code=404, detail="Batch not found")
        
        queries = None
        if include_queries:
            cursor.execute("""
                SELECT * FROM synthetic_queries
                WHERE batch_id = ? 
                ORDER BY id
            """, (batch_id,))
            query_rows = cursor.fetchall()
            
            queries = [
                QueryResponse(
                    id=row["id"],
                    tuple_values=json.loads(row["dimension_tuple"]) if row["dimension_tuple"] else {},
                    query_text=row["query_text"],
                    execution_status=row["execution_status"],
                    response_text=row["response_text"],
                    trace_id=row["trace_id"],
                    error_message=row["error_message"]
                )
                for row in query_rows
            ]
    
    return BatchResponse(
        id=batch_row["id"],
        agent_id=batch_row["agent_id"],
        name=batch_row["name"] or f"Batch {batch_row['id'][:8]}",
        status=batch_row["status"],
        query_count=batch_row["query_count"],
        created_at=batch_row["created_at"],
        queries=queries
    )


@router.delete("/synthetic/batches/{batch_id}")
async def delete_batch(batch_id: str):
    """Delete a synthetic batch and its queries."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Delete queries first (foreign key)
        cursor.execute("DELETE FROM synthetic_queries WHERE batch_id = ?", (batch_id,))
        
        # Delete batch
        cursor.execute("DELETE FROM synthetic_batches WHERE id = ?", (batch_id,))
        
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Batch not found")
    
    return {"status": "deleted", "batch_id": batch_id}


class UpdateQueryRequest(BaseModel):
    query_text: str


@router.put("/synthetic/queries/{query_id}")
async def update_query(query_id: str, request: UpdateQueryRequest):
    """Update a query's text."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE synthetic_queries SET query_text = ? WHERE id = ?
        """, (request.query_text, query_id))
        
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Query not found")
    
    return {"status": "updated", "query_id": query_id, "query_text": request.query_text}


class BulkDeleteRequest(BaseModel):
    query_ids: list[str]


@router.post("/synthetic/queries/bulk-delete")
async def delete_queries_bulk(request: BulkDeleteRequest):
    """Delete multiple queries from a batch."""
    query_ids = request.query_ids
    if not query_ids:
        raise HTTPException(status_code=400, detail="No query IDs provided")
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Get affected batch IDs
        placeholders = ",".join("?" * len(query_ids))
        cursor.execute(f"""
            SELECT DISTINCT batch_id FROM synthetic_queries WHERE id IN ({placeholders})
        """, query_ids)
        batch_rows = cursor.fetchall()
        batch_ids = [row["batch_id"] for row in batch_rows]
        
        # Delete the queries
        cursor.execute(f"""
            DELETE FROM synthetic_queries WHERE id IN ({placeholders})
        """, query_ids)
        deleted_count = cursor.rowcount
        
        # Update batch query counts
        for batch_id in batch_ids:
            cursor.execute("""
                UPDATE synthetic_batches 
                SET query_count = (SELECT COUNT(*) FROM synthetic_queries WHERE batch_id = ?)
                WHERE id = ?
            """, (batch_id, batch_id))
    
    return {"status": "deleted", "deleted_count": deleted_count, "batch_ids": batch_ids}


# =============================================================================
# Phase 4: Batch Execution Endpoints
# =============================================================================

from fastapi.responses import StreamingResponse
from services.batch_executor import (
    BatchExecutor,
    execute_batch,
    reset_batch_queries
)


class ExecuteBatchRequest(BaseModel):
    timeout_per_query: Optional[float] = None  # None = use configured agent_query_timeout
    max_concurrent: int = 5  # Execute up to 5 queries concurrently


@router.post("/synthetic/batches/{batch_id}/execute")
async def execute_synthetic_batch(batch_id: str, request: ExecuteBatchRequest = None):
    """
    Execute a batch of synthetic queries against the connected agent.
    
    This endpoint streams progress updates via Server-Sent Events (SSE).
    """
    if request is None:
        request = ExecuteBatchRequest()
    
    # Get batch and agent info
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT sb.*, a.endpoint_url
            FROM synthetic_batches sb
            JOIN agents a ON sb.agent_id = a.id
            WHERE sb.id = ?
        """, (batch_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Batch not found")
        
        batch_data = dict(row)
        
        # Validate batch status before execution
        if batch_data["status"] == "running":
            raise HTTPException(status_code=409, detail="Batch is already running")
        
        # Check if there are any pending queries to execute
        cursor.execute("""
            SELECT COUNT(*) as pending_count 
            FROM synthetic_queries 
            WHERE batch_id = ? AND execution_status IN ('pending', 'error')
        """, (batch_id,))
        pending_row = cursor.fetchone()
        pending_count = pending_row["pending_count"] if pending_row else 0
        
        if pending_count == 0:
            raise HTTPException(status_code=400, detail="No pending queries to execute")
    
    agent_endpoint = batch_data["endpoint_url"]
    
    async def event_generator():
        """Generate SSE events for batch execution progress."""
        try:
            async for progress in execute_batch(
                agent_endpoint=agent_endpoint,
                batch_id=batch_id,
                timeout_per_query=request.timeout_per_query,
                max_concurrent=request.max_concurrent,
                batch_info=batch_data  # Pass pre-fetched data to avoid redundant query
            ):
                event_data = f"data: {progress.model_dump_json()}\n\n"
                logger.debug(f"SSE progress: {progress.completed_queries}/{progress.total_queries} - {progress.status}")
                yield event_data
        except Exception as e:
            error_data = json.dumps({
                "batch_id": batch_id,
                "status": "error",
                "error": str(e)
            })
            logger.error(f"SSE streaming error: {e}")
            yield f"data: {error_data}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # Disable nginx buffering
        }
    )


@router.post("/synthetic/batches/{batch_id}/reset")
async def reset_batch(batch_id: str, only_failed: bool = False):
    """
    Reset batch queries to allow re-execution.
    
    Args:
        only_failed: If true, only reset failed queries. Otherwise reset all.
    """
    # Verify batch exists
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM synthetic_batches WHERE id = ?", (batch_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Batch not found")
    
    reset_batch_queries(batch_id, only_failed=only_failed)
    
    return {
        "status": "reset",
        "batch_id": batch_id,
        "only_failed": only_failed
    }


@router.post("/synthetic/batches/{batch_id}/mark-ready")
async def mark_batch_ready(batch_id: str):
    """
    Mark an interrupted 'generating' batch as 'ready'.
    
    This is used when generation was interrupted (e.g., by page refresh) but the
    user wants to proceed with the queries that were already generated.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Verify batch exists and is in generating status
        cursor.execute("SELECT id, status, query_count FROM synthetic_batches WHERE id = ?", (batch_id,))
        batch = cursor.fetchone()
        
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        
        if batch["status"] != "generating":
            raise HTTPException(
                status_code=400, 
                detail=f"Batch is not in 'generating' status (current: {batch['status']})"
            )
        
        if batch["query_count"] == 0:
            raise HTTPException(
                status_code=400,
                detail="Batch has no queries. Delete it and generate a new one."
            )
        
        # Update status to ready
        cursor.execute("""
            UPDATE synthetic_batches SET status = 'ready' WHERE id = ?
        """, (batch_id,))
    
    return {
        "status": "ready",
        "batch_id": batch_id,
        "query_count": batch["query_count"]
    }


# =============================================================================
# Weave Integration Endpoints
# =============================================================================

class WeaveUrlResponse(BaseModel):
    """Response containing a Weave deep link URL."""
    url: str
    batch_id: str
    configured: bool


@router.get("/synthetic/batches/{batch_id}/weave-url")
async def get_batch_weave_url(batch_id: str) -> WeaveUrlResponse:
    """
    Get Weave URL with batch filter pre-applied.
    
    This generates a deep link to Weave's traces view, filtered to show only
    traces from this specific batch execution. Users can click "Review in Weave"
    to immediately see all traces, add feedback, and annotate results.
    
    The Weave project is determined from the agent's weave_project field,
    which is configured during agent registration - NOT from global Settings.
    
    The URL includes:
    - Filter by attributes.batch_id
    - Optional time filter (batch start time) for efficiency
    - Sort by started_at descending (newest first)
    """
    from services.weave_url import generate_batch_review_url
    from datetime import datetime
    from config import get_wandb_entity
    
    # Get batch info including agent_id and started_at
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT sb.id, sb.agent_id, sb.started_at, a.weave_project
            FROM synthetic_batches sb
            LEFT JOIN agents a ON sb.agent_id = a.id
            WHERE sb.id = ?
        """, (batch_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Batch not found")
        
        started_at = None
        if row["started_at"]:
            try:
                # Parse ISO format date string
                started_at = datetime.fromisoformat(row["started_at"].replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                pass
        
        # Get the agent's Weave project (configured during agent registration)
        agent_weave_project = row["weave_project"]
    
    # If agent has no Weave project configured, return helpful error
    if not agent_weave_project:
        return WeaveUrlResponse(
            url="#error:agent-weave-not-configured",
            batch_id=batch_id,
            configured=False
        )
    
    # Parse entity/project from the agent's weave_project
    # Format can be "entity/project" or just "project"
    if "/" in agent_weave_project:
        entity, project = agent_weave_project.split("/", 1)
    else:
        entity = get_wandb_entity()  # Fall back to global entity
        project = agent_weave_project
    
    url = generate_batch_review_url(
        batch_id=batch_id,
        started_after=started_at,
        entity=entity,
        project=project
    )
    
    # Check if URL was generated successfully
    is_configured = not url.startswith("#error:")
    
    return WeaveUrlResponse(
        url=url,
        batch_id=batch_id,
        configured=is_configured
    )


@router.post("/synthetic/batches/{batch_id}/link-traces")
async def link_batch_traces(batch_id: str):
    """
    Manually trigger trace linking for a batch.
    
    This is useful if automatic trace linking failed (e.g., due to
    configuration issues that have since been fixed).
    
    The endpoint:
    1. Queries Weave for traces with matching batch_id attribute
    2. Extracts query_id from each trace's attributes
    3. Updates synthetic_queries.trace_id in the database
    """
    from services.trace_discovery import trace_discovery_service
    
    # Verify batch exists
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM synthetic_batches WHERE id = ?", (batch_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Batch not found")
    
    # Link traces
    linked = await trace_discovery_service.link_batch_traces(batch_id)
    
    return {
        "status": "linked",
        "batch_id": batch_id,
        "linked_count": len(linked),
        "query_trace_map": linked
    }
