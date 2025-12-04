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
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from database import get_db

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
    count: int = 20
    strategy: str = "llm_guided"  # "cross_product" or "llm_guided"
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
    count: int = 20
    strategy: str = "llm_guided"
    focus_areas: Optional[List[str]] = None


class BatchResponse(BaseModel):
    """Response for a batch."""
    id: str
    agent_id: str
    name: str
    status: str
    query_count: int
    created_at: str
    queries: Optional[List[QueryResponse]] = None


# =============================================================================
# Helper Functions
# =============================================================================

def now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


async def get_agent_info_for_generation(agent_id: str):
    """Get parsed AgentInfo for synthetic generation."""
    from services.agent_info import AgentInfo, TestingDimension, parse_agent_info
    
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
    
    # Build AgentInfo
    dimensions = []
    for row in dim_rows:
        dimensions.append(TestingDimension(
            name=row["name"],
            values=json.loads(row["dimension_values"]) if row["dimension_values"] else [],
            descriptions=json.loads(row["descriptions"]) if row["descriptions"] else None
        ))
    
    # If no dimensions in DB, try to parse from agent_info_raw
    if not dimensions and agent_row["agent_info_raw"]:
        try:
            parsed = parse_agent_info(agent_row["agent_info_raw"])
            dimensions = parsed.testing_dimensions
        except:
            pass
    
    # Build minimal AgentInfo for generation
    # Parse purpose from agent_info_parsed if available
    purpose = "AI assistant"
    if agent_row["agent_info_parsed"]:
        try:
            parsed = json.loads(agent_row["agent_info_parsed"])
            purpose = parsed.get("purpose", purpose)
        except:
            pass
    
    agent_info = AgentInfo(
        name=agent_row["name"] or "Unknown Agent",
        version=agent_row["version"] or "1.0.0",
        purpose=purpose,
        testing_dimensions=dimensions,
        system_prompt="",
        capabilities=[],
        limitations=[],
        target_audience=[],
        success_criteria=[]
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


@router.post("/agents/{agent_id}/dimensions/import-from-agent")
async def import_dimensions_from_agent(agent_id: str):
    """
    Import testing dimensions from the agent's AGENT_INFO.
    
    This fetches the AGENT_INFO from the remote agent and extracts
    the testing dimensions, saving them to the database.
    """
    from services.agui_client import AGUIClient
    from services.agent_info import parse_agent_info
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT endpoint_url, agent_info_raw FROM agents WHERE id = ?", (agent_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Agent not found")
    
    # Try to get from remote agent first
    dimensions = []
    if row["endpoint_url"]:
        try:
            client = AGUIClient(row["endpoint_url"])
            agent_info_data = await client.get_agent_info()
            
            if "testing_dimensions" in agent_info_data:
                for dim in agent_info_data["testing_dimensions"]:
                    dimensions.append({
                        "name": dim.get("name", ""),
                        "values": dim.get("values", []),
                        "descriptions": dim.get("descriptions")
                    })
        except:
            pass
    
    # Fallback to stored agent_info_raw
    if not dimensions and row["agent_info_raw"]:
        try:
            parsed = parse_agent_info(row["agent_info_raw"])
            for dim in parsed.testing_dimensions:
                dimensions.append({
                    "name": dim.name,
                    "values": dim.values,
                    "descriptions": dim.descriptions
                })
        except:
            pass
    
    if not dimensions:
        raise HTTPException(status_code=400, detail="No testing dimensions found in AGENT_INFO")
    
    # Save dimensions to database
    imported = []
    with get_db() as conn:
        cursor = conn.cursor()
        
        for dim in dimensions:
            # Check if exists
            cursor.execute("""
                SELECT id FROM agent_dimensions WHERE agent_id = ? AND name = ?
            """, (agent_id, dim["name"]))
            existing = cursor.fetchone()
            
            if existing:
                cursor.execute("""
                    UPDATE agent_dimensions 
                    SET dimension_values = ?, descriptions = ?
                    WHERE id = ?
                """, (
                    json.dumps(dim["values"]),
                    json.dumps(dim["descriptions"]) if dim["descriptions"] else None,
                    existing["id"]
                ))
                dim_id = existing["id"]
            else:
                dim_id = f"dim_{uuid.uuid4().hex[:12]}"
                cursor.execute("""
                    INSERT INTO agent_dimensions (id, agent_id, name, dimension_values, descriptions, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    dim_id,
                    agent_id,
                    dim["name"],
                    json.dumps(dim["values"]),
                    json.dumps(dim["descriptions"]) if dim["descriptions"] else None,
                    now_iso()
                ))
            
            imported.append({
                "id": dim_id,
                "name": dim["name"],
                "values": dim["values"]
            })
    
    return {"imported": len(imported), "dimensions": imported}


# =============================================================================
# Tuple Generation Endpoints
# =============================================================================

@router.post("/synthetic/tuples")
async def generate_tuples(request: TupleGenerateRequest) -> List[TupleResponse]:
    """
    Generate dimension tuples for synthetic data.
    
    Strategies:
    - "cross_product": Generate all combinations (up to count)
    - "llm_guided": Use LLM to generate realistic combinations
    """
    from services.synthetic import SyntheticGenerator, merge_dimensions
    
    agent_info = await get_agent_info_for_generation(request.agent_id)
    
    # Merge with custom dimensions if provided
    if request.custom_dimensions:
        agent_info.testing_dimensions = merge_dimensions(
            agent_info.testing_dimensions,
            request.custom_dimensions
        )
    
    if not agent_info.testing_dimensions:
        raise HTTPException(
            status_code=400, 
            detail="No testing dimensions defined. Import from AGENT_INFO or add custom dimensions."
        )
    
    generator = SyntheticGenerator(agent_info)
    
    if request.strategy == "llm_guided":
        tuples = await generator.generate_tuples_llm_guided(
            n=request.count,
            focus_areas=request.focus_areas
        )
    else:
        tuples = generator.generate_tuples_cross_product(max_tuples=request.count)
    
    return [
        TupleResponse(id=t.id, values=t.values)
        for t in tuples
    ]


# =============================================================================
# Query Generation Endpoints
# =============================================================================

@router.post("/synthetic/queries")
async def generate_queries(request: QueryGenerateRequest) -> List[QueryResponse]:
    """
    Generate natural language queries from dimension tuples.
    
    This uses LLM to convert dimension tuples into realistic user messages.
    """
    from services.synthetic import SyntheticGenerator, DimensionTuple
    
    agent_info = await get_agent_info_for_generation(request.agent_id)
    generator = SyntheticGenerator(agent_info)
    
    # Convert request tuples to DimensionTuple objects
    tuples = [
        DimensionTuple(
            id=f"tuple_{uuid.uuid4().hex[:12]}",
            values=t,
            created_at=now_iso()
        )
        for t in request.tuples
    ]
    
    # Generate queries
    queries = await generator.generate_queries_from_tuples(tuples)
    
    return [
        QueryResponse(
            id=q.id,
            tuple_values=q.dimension_values,
            query_text=q.query_text
        )
        for q in queries
    ]


@router.post("/synthetic/query-single")
async def generate_single_query(agent_id: str, tuple_values: Dict[str, str]) -> QueryResponse:
    """Generate a single query from a dimension tuple."""
    from services.synthetic import SyntheticGenerator, DimensionTuple
    
    agent_info = await get_agent_info_for_generation(agent_id)
    generator = SyntheticGenerator(agent_info)
    
    dt = DimensionTuple(
        id=f"tuple_{uuid.uuid4().hex[:12]}",
        values=tuple_values,
        created_at=now_iso()
    )
    
    query_text = await generator.tuple_to_query(dt)
    
    return QueryResponse(
        id=f"query_{uuid.uuid4().hex[:12]}",
        tuple_values=tuple_values,
        query_text=query_text
    )


# =============================================================================
# Batch Management Endpoints
# =============================================================================

@router.post("/synthetic/batches")
async def create_batch(request: BatchCreateRequest) -> BatchResponse:
    """
    Create a new synthetic query batch.
    
    This generates tuples and queries in one operation, saving them to the database.
    """
    from services.synthetic import SyntheticGenerator
    
    agent_info = await get_agent_info_for_generation(request.agent_id)
    
    if not agent_info.testing_dimensions:
        raise HTTPException(
            status_code=400,
            detail="No testing dimensions defined. Import from AGENT_INFO first."
        )
    
    generator = SyntheticGenerator(agent_info)
    
    # Generate batch
    batch = await generator.generate_batch(
        n=request.count,
        name=request.name,
        strategy=request.strategy,
        focus_areas=request.focus_areas
    )
    batch.agent_id = request.agent_id
    
    # Save to database
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Save batch
        cursor.execute("""
            INSERT INTO synthetic_batches (id, agent_id, name, status, query_count, generation_strategy, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            batch.id,
            batch.agent_id,
            batch.name,
            batch.status,
            batch.query_count,
            request.strategy,
            batch.created_at
        ))
        
        # Save queries
        for query in batch.queries:
            cursor.execute("""
                INSERT INTO synthetic_queries (id, batch_id, dimension_tuple, query_text, execution_status)
                VALUES (?, ?, ?, ?, ?)
            """, (
                query.id,
                batch.id,
                json.dumps(query.dimension_values),
                query.query_text,
                "pending"
            ))
    
    return BatchResponse(
        id=batch.id,
        agent_id=batch.agent_id,
        name=batch.name,
        status=batch.status,
        query_count=batch.query_count,
        created_at=batch.created_at,
        queries=[
            QueryResponse(
                id=q.id,
                tuple_values=q.dimension_values,
                query_text=q.query_text
            )
            for q in batch.queries
        ]
    )


@router.post("/synthetic/batches/generate-stream")
async def create_batch_streaming(request: BatchCreateRequest):
    """
    Create a new synthetic query batch with streaming progress.
    
    Returns an SSE stream of generation events, allowing the frontend to show
    real-time progress and populate queries as they're generated.
    
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
            detail="No testing dimensions defined. Import from AGENT_INFO first."
        )
    
    generator = SyntheticGenerator(agent_info)
    
    async def event_stream():
        batch_id = None
        queries = []
        
        try:
            async for event in generator.generate_batch_streaming(
                n=request.count,
                name=request.name,
                strategy=request.strategy,
                focus_areas=request.focus_areas
            ):
                if event["type"] == "batch_started":
                    batch_id = event["batch_id"]
                
                elif event["type"] == "query_generated":
                    # Track queries for database save
                    queries.append(event["query"])
                
                elif event["type"] == "batch_complete":
                    # Save everything to database
                    with get_db() as conn:
                        cursor = conn.cursor()
                        
                        # Save batch
                        cursor.execute("""
                            INSERT INTO synthetic_batches (id, agent_id, name, status, query_count, generation_strategy, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, (
                            event["batch_id"],
                            request.agent_id,
                            event["name"],
                            "ready",
                            event["query_count"],
                            request.strategy,
                            now_iso()
                        ))
                        
                        # Save queries
                        for query in event["queries"]:
                            cursor.execute("""
                                INSERT INTO synthetic_queries (id, batch_id, dimension_tuple, query_text, execution_status)
                                VALUES (?, ?, ?, ?, ?)
                            """, (
                                query["id"],
                                event["batch_id"],
                                json.dumps(query["tuple_values"]),
                                query["query_text"],
                                "pending"
                            ))
                
                # Yield event as SSE
                yield f"data: {json.dumps(event)}\n\n"
        
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
    """List all synthetic batches, optionally filtered by agent."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        if agent_id:
            cursor.execute("""
                SELECT * FROM synthetic_batches WHERE agent_id = ? ORDER BY created_at DESC
            """, (agent_id,))
        else:
            cursor.execute("""
                SELECT * FROM synthetic_batches ORDER BY created_at DESC
            """)
        
        rows = cursor.fetchall()
    
    return [
        BatchResponse(
            id=row["id"],
            agent_id=row["agent_id"],
            name=row["name"] or f"Batch {row['id'][:8]}",
            status=row["status"],
            query_count=row["query_count"],
            created_at=row["created_at"]
        )
        for row in rows
    ]


@router.get("/synthetic/batches/{batch_id}")
async def get_batch(batch_id: str, include_queries: bool = True) -> BatchResponse:
    """Get a specific batch with its queries."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM synthetic_batches WHERE id = ?", (batch_id,))
        batch_row = cursor.fetchone()
        
        if not batch_row:
            raise HTTPException(status_code=404, detail="Batch not found")
        
        queries = None
        if include_queries:
            cursor.execute("""
                SELECT * FROM synthetic_queries WHERE batch_id = ? ORDER BY id
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


@router.post("/synthetic/batches/{batch_id}/regenerate-query/{query_id}")
async def regenerate_query(batch_id: str, query_id: str) -> QueryResponse:
    """Regenerate a single query in a batch."""
    from services.synthetic import SyntheticGenerator, DimensionTuple
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Get the query
        cursor.execute("""
            SELECT sq.*, sb.agent_id 
            FROM synthetic_queries sq
            JOIN synthetic_batches sb ON sq.batch_id = sb.id
            WHERE sq.id = ? AND sq.batch_id = ?
        """, (query_id, batch_id))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Query not found")
    
    # Regenerate
    agent_info = await get_agent_info_for_generation(row["agent_id"])
    generator = SyntheticGenerator(agent_info)
    
    tuple_values = json.loads(row["dimension_tuple"]) if row["dimension_tuple"] else {}
    dt = DimensionTuple(
        id=f"tuple_{uuid.uuid4().hex[:12]}",
        values=tuple_values,
        created_at=now_iso()
    )
    
    new_query_text = await generator.tuple_to_query(dt)
    
    # Update in database
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE synthetic_queries SET query_text = ? WHERE id = ?
        """, (new_query_text, query_id))
    
    return QueryResponse(
        id=query_id,
        tuple_values=tuple_values,
        query_text=new_query_text
    )


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


@router.delete("/synthetic/queries/{query_id}")
async def delete_query(query_id: str):
    """Delete a single query from a batch."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Get batch_id first to update count
        cursor.execute("SELECT batch_id FROM synthetic_queries WHERE id = ?", (query_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Query not found")
        
        batch_id = row["batch_id"]
        
        # Delete the query
        cursor.execute("DELETE FROM synthetic_queries WHERE id = ?", (query_id,))
        
        # Update the batch query count
        cursor.execute("""
            UPDATE synthetic_batches 
            SET query_count = (SELECT COUNT(*) FROM synthetic_queries WHERE batch_id = ?)
            WHERE id = ?
        """, (batch_id, batch_id))
    
    return {"status": "deleted", "query_id": query_id, "batch_id": batch_id}


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
    get_batch_execution_status,
    get_batch_traces,
    reset_batch_queries
)


class ExecuteBatchRequest(BaseModel):
    timeout_per_query: float = 60.0


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
    
    agent_endpoint = batch_data["endpoint_url"]
    
    async def event_generator():
        """Generate SSE events for batch execution progress."""
        try:
            async for progress in execute_batch(
                agent_endpoint=agent_endpoint,
                batch_id=batch_id,
                timeout_per_query=request.timeout_per_query
            ):
                yield f"data: {progress.model_dump_json()}\n\n"
        except Exception as e:
            error_data = json.dumps({
                "batch_id": batch_id,
                "status": "error",
                "error": str(e)
            })
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


@router.get("/synthetic/batches/{batch_id}/status")
async def get_batch_status(batch_id: str):
    """
    Get the current execution status of a batch.
    
    Returns detailed status including per-query results.
    """
    status = get_batch_execution_status(batch_id)
    
    if "error" in status:
        raise HTTPException(status_code=404, detail=status["error"])
    
    return status


@router.get("/synthetic/batches/{batch_id}/traces")
async def get_batch_traces_endpoint(batch_id: str):
    """
    Get all traces linked to a batch.
    
    Returns queries that have been executed with their trace IDs.
    """
    traces = get_batch_traces(batch_id)
    return {"batch_id": batch_id, "traces": traces, "count": len(traces)}


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


@router.post("/synthetic/batches/{batch_id}/execute-sync")
async def execute_synthetic_batch_sync(batch_id: str, request: ExecuteBatchRequest = None):
    """
    Execute a batch synchronously (non-streaming).
    
    Returns final status when execution is complete.
    Useful for programmatic access or testing.
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
    
    agent_endpoint = batch_data["endpoint_url"]
    
    # Execute and collect final result
    final_progress = None
    async for progress in execute_batch(
        agent_endpoint=agent_endpoint,
        batch_id=batch_id,
        timeout_per_query=request.timeout_per_query
    ):
        final_progress = progress
    
    if final_progress:
        return final_progress.model_dump()
    else:
        return {"status": "error", "message": "Execution produced no results"}


# =============================================================================
# Phase 5: Automated Review Endpoints
# =============================================================================

from services.auto_reviewer import (
    AutoReviewer,
    AutoReviewResult,
    AutoReviewStatus,
    get_auto_review,
    get_batch_reviews,
    get_latest_batch_review,
    delete_auto_review,
    run_auto_review,
)


class AutoReviewRequest(BaseModel):
    """Request to run an automated review."""
    model: Optional[str] = None  # Uses settings default if not provided
    max_concurrent_llm_calls: Optional[int] = None  # Uses settings default if not provided


class AutoReviewResponse(BaseModel):
    """Response containing review results."""
    id: str
    batch_id: str
    agent_id: str
    status: str
    model_used: str
    failure_categories: List[Dict[str, Any]]
    classifications: List[Dict[str, Any]]
    report_markdown: Optional[str] = None
    total_traces: int
    created_at: str
    completed_at: Optional[str] = None
    error_message: Optional[str] = None


@router.post("/synthetic/batches/{batch_id}/auto-review")
async def run_batch_auto_review(batch_id: str, request: AutoReviewRequest = None) -> AutoReviewResponse:
    """
    Trigger automated review of a completed batch.
    
    This uses the FAILS pipeline to analyze batch traces and categorize
    potential issues or patterns. The review uses AGENT_INFO context
    to understand what the agent should be doing.
    
    Args:
        batch_id: The batch to review
        request: Review configuration (model, concurrency)
        
    Returns:
        AutoReviewResponse with failure categories and classifications
    """
    from services.settings import get_setting
    
    if request is None:
        request = AutoReviewRequest()
    
    # Get model and concurrency from settings if not provided in request
    model = request.model or get_setting("auto_review_model", "openai/gpt-4o-mini")
    concurrency_str = get_setting("auto_review_concurrency", "10")
    max_concurrent = request.max_concurrent_llm_calls or int(concurrency_str)
    
    # Get batch and verify it's completed
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT sb.*, a.id as agent_id
            FROM synthetic_batches sb
            JOIN agents a ON sb.agent_id = a.id
            WHERE sb.id = ?
        """, (batch_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Batch not found")
        
        if row["status"] not in ("completed", "ready"):
            raise HTTPException(
                status_code=400, 
                detail=f"Batch must be completed to run auto-review. Current status: {row['status']}"
            )
        
        agent_id = row["agent_id"]
    
    try:
        # Run the automated review
        result = await run_auto_review(
            agent_id=agent_id,
            batch_id=batch_id,
            model=model,
            max_concurrent_llm_calls=max_concurrent
        )
        
        return AutoReviewResponse(
            id=result.id,
            batch_id=result.batch_id,
            agent_id=result.agent_id,
            status=result.status.value,
            model_used=result.model_used,
            failure_categories=[fc.model_dump() for fc in result.failure_categories],
            classifications=[c.model_dump() for c in result.classifications],
            report_markdown=result.report_markdown,
            total_traces=result.total_traces,
            created_at=result.created_at,
            completed_at=result.completed_at,
            error_message=result.error_message
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Auto-review failed: {str(e)}")


@router.get("/synthetic/batches/{batch_id}/reviews")
async def list_batch_reviews(batch_id: str) -> List[AutoReviewResponse]:
    """
    Get all auto-reviews for a batch.
    
    Returns reviews in reverse chronological order (newest first).
    """
    # Verify batch exists
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM synthetic_batches WHERE id = ?", (batch_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Batch not found")
    
    reviews = get_batch_reviews(batch_id)
    
    return [
        AutoReviewResponse(
            id=r["id"],
            batch_id=r["batch_id"],
            agent_id=r["agent_id"],
            status=r["status"],
            model_used=r.get("model_used", "unknown"),
            failure_categories=r.get("failure_categories", []),
            classifications=r.get("classifications", []),
            report_markdown=r.get("report_markdown"),
            total_traces=len(r.get("classifications", [])),
            created_at=r["created_at"],
            completed_at=r.get("completed_at"),
            error_message=r.get("error_message")
        )
        for r in reviews
    ]


@router.get("/synthetic/batches/{batch_id}/reviews/latest")
async def get_latest_review(batch_id: str) -> AutoReviewResponse:
    """
    Get the most recent auto-review for a batch.
    """
    review = get_latest_batch_review(batch_id)
    
    if not review:
        raise HTTPException(status_code=404, detail="No reviews found for this batch")
    
    return AutoReviewResponse(
        id=review["id"],
        batch_id=review["batch_id"],
        agent_id=review["agent_id"],
        status=review["status"],
        model_used=review.get("model_used", "unknown"),
        failure_categories=review.get("failure_categories", []),
        classifications=review.get("classifications", []),
        report_markdown=review.get("report_markdown"),
        total_traces=len(review.get("classifications", [])),
        created_at=review["created_at"],
        completed_at=review.get("completed_at"),
        error_message=review.get("error_message")
    )


@router.get("/synthetic/reviews/{review_id}")
async def get_review_by_id(review_id: str) -> AutoReviewResponse:
    """
    Get a specific auto-review by ID.
    """
    review = get_auto_review(review_id)
    
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    
    return AutoReviewResponse(
        id=review["id"],
        batch_id=review["batch_id"],
        agent_id=review["agent_id"],
        status=review["status"],
        model_used=review.get("model_used", "unknown"),
        failure_categories=review.get("failure_categories", []),
        classifications=review.get("classifications", []),
        report_markdown=review.get("report_markdown"),
        total_traces=len(review.get("classifications", [])),
        created_at=review["created_at"],
        completed_at=review.get("completed_at"),
        error_message=review.get("error_message")
    )


@router.delete("/synthetic/reviews/{review_id}")
async def delete_review(review_id: str):
    """
    Delete an auto-review.
    """
    if not delete_auto_review(review_id):
        raise HTTPException(status_code=404, detail="Review not found")
    
    return {"status": "deleted", "review_id": review_id}

