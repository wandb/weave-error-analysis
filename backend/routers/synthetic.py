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
    return datetime.utcnow().isoformat()


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
                    query_text=row["query_text"]
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

