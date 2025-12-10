"""
Agent registry API endpoints.

Provides CRUD operations for registered agents and their AGENT_INFO.
"""

import json
import httpx
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from database import get_db, get_db_readonly, generate_id, now_iso
from services.agent_info import parse_agent_info, validate_agent_info, generate_template
from services.agent_client import AgentClient
from models import AgentStats

router = APIRouter(prefix="/api", tags=["agents"])


# =============================================================================
# Request/Response Models
# =============================================================================

class AgentCreateRequest(BaseModel):
    """Request to register a new agent."""
    name: str = Field(..., description="Display name for the agent")
    endpoint_url: str = Field(..., description="AG-UI compatible endpoint URL")
    agent_info_content: str = Field(..., description="Raw AGENT_INFO.md content")


class AgentUpdateRequest(BaseModel):
    """Request to update an agent."""
    name: Optional[str] = None
    endpoint_url: Optional[str] = None
    agent_info_content: Optional[str] = None


class AgentResponse(BaseModel):
    """Agent response model."""
    id: str
    name: str
    version: str
    agent_type: Optional[str]
    framework: Optional[str]
    endpoint_url: str
    connection_status: str
    last_connection_test: Optional[str]
    created_at: str
    updated_at: str
    # Parsed info summary
    purpose: Optional[str] = None
    capabilities: List[str] = []
    testing_dimensions_count: int = 0


class AgentDetailResponse(AgentResponse):
    """Detailed agent response including full parsed info."""
    agent_info_raw: str
    agent_info_parsed: Optional[dict] = None
    limitations: List[str] = []
    success_criteria: List[str] = []
    tools: List[dict] = []
    testing_dimensions: List[dict] = []


class ConnectionTestResult(BaseModel):
    """Result of testing agent connection."""
    success: bool
    status_code: Optional[int] = None
    response_time_ms: Optional[float] = None
    error: Optional[str] = None


class RunAgentRequest(BaseModel):
    """Request to run a query against an agent."""
    message: str = Field(..., description="The message to send to the agent")
    thread_id: Optional[str] = Field(None, description="Optional thread ID for conversation continuity")
    context: Optional[dict] = Field(None, description="Optional context to pass to the agent")


class AgentInfoValidationResult(BaseModel):
    """Result of validating AGENT_INFO content."""
    valid: bool
    parsed: Optional[dict] = None
    warnings: List[str] = []
    errors: List[str] = []


# =============================================================================
# API Endpoints
# =============================================================================

@router.post("/agents", response_model=AgentResponse)
async def create_agent(request: AgentCreateRequest):
    """
    Register a new agent with AGENT_INFO.md content.
    """
    # Validate and parse AGENT_INFO
    validation = validate_agent_info(request.agent_info_content)
    if not validation["valid"]:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid AGENT_INFO.md: {', '.join(validation['errors'])}"
        )
    
    parsed = validation["parsed"]
    agent_id = generate_id()
    now = now_iso()
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Insert agent
        cursor.execute("""
            INSERT INTO agents (
                id, name, version, agent_type, framework, endpoint_url,
                agent_info_raw, agent_info_parsed, connection_status,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?)
        """, (
            agent_id,
            request.name,
            parsed.get("version", "1.0.0"),
            parsed.get("agent_type"),
            parsed.get("framework"),
            request.endpoint_url,
            request.agent_info_content,
            json.dumps(parsed),
            now,
            now
        ))
        
        # Insert testing dimensions
        for dim in parsed.get("testing_dimensions", []):
            cursor.execute("""
                INSERT INTO agent_dimensions (id, agent_id, name, dimension_values, descriptions, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                generate_id(),
                agent_id,
                dim.get("name"),
                json.dumps(dim.get("values", [])),
                json.dumps(dim.get("descriptions")) if dim.get("descriptions") else None,
                now
            ))
    
    return AgentResponse(
        id=agent_id,
        name=request.name,
        version=parsed.get("version", "1.0.0"),
        agent_type=parsed.get("agent_type"),
        framework=parsed.get("framework"),
        endpoint_url=request.endpoint_url,
        connection_status="unknown",
        last_connection_test=None,
        created_at=now,
        updated_at=now,
        purpose=parsed.get("purpose"),
        capabilities=parsed.get("capabilities", []),
        testing_dimensions_count=len(parsed.get("testing_dimensions", []))
    )


@router.get("/agents", response_model=List[AgentResponse])
async def list_agents():
    """
    List all registered agents.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM agents ORDER BY created_at DESC
        """)
        rows = cursor.fetchall()
    
    agents = []
    for row in rows:
        parsed = json.loads(row["agent_info_parsed"]) if row["agent_info_parsed"] else {}
        agents.append(AgentResponse(
            id=row["id"],
            name=row["name"],
            version=row["version"] or "1.0.0",
            agent_type=row["agent_type"],
            framework=row["framework"],
            endpoint_url=row["endpoint_url"],
            connection_status=row["connection_status"],
            last_connection_test=row["last_connection_test"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            purpose=parsed.get("purpose"),
            capabilities=parsed.get("capabilities", []),
            testing_dimensions_count=len(parsed.get("testing_dimensions", []))
        ))
    
    return agents


# NOTE: Static routes must be defined BEFORE dynamic /{agent_id} routes
@router.get("/agents/template")
async def get_agent_info_template(
    name: str = Query("My Agent", description="Agent name"),
    agent_type: str = Query("General", description="Agent type"),
    framework: str = Query("Unknown", description="Framework"),
    purpose: str = Query("Describe what your agent does.", description="Purpose")
):
    """
    Get a blank AGENT_INFO.md template.
    """
    template = generate_template(
        name=name,
        agent_type=agent_type,
        framework=framework,
        purpose=purpose
    )
    return {"template": template}


@router.post("/agents/validate-info", response_model=AgentInfoValidationResult)
async def validate_agent_info_endpoint(content: str = Query(..., description="AGENT_INFO.md content")):
    """
    Validate AGENT_INFO.md content without creating an agent.
    """
    result = validate_agent_info(content)
    return AgentInfoValidationResult(**result)


@router.get("/agents/{agent_id}/stats", response_model=AgentStats)
async def get_agent_stats(agent_id: str):
    """
    Get comprehensive statistics for an agent.
    
    Returns batch counts, query stats, thread review progress,
    failure mode stats, and recent activity.
    """
    with get_db_readonly() as conn:
        cursor = conn.cursor()
        
        # Verify agent exists and get name
        cursor.execute("SELECT id, name FROM agents WHERE id = ?", (agent_id,))
        agent_row = cursor.fetchone()
        if not agent_row:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        agent_name = agent_row["name"]
        
        # Batch stats
        cursor.execute("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
            FROM synthetic_batches
            WHERE agent_id = ?
        """, (agent_id,))
        batch_row = cursor.fetchone()
        total_batches = batch_row["total"] or 0
        pending_batches = batch_row["pending"] or 0
        completed_batches = batch_row["completed"] or 0
        
        # Query stats - join with batches to filter by agent
        cursor.execute("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN sq.execution_status != 'pending' THEN 1 ELSE 0 END) as executed,
                SUM(CASE WHEN sq.execution_status = 'success' THEN 1 ELSE 0 END) as success,
                SUM(CASE WHEN sq.execution_status = 'error' THEN 1 ELSE 0 END) as failed
            FROM synthetic_queries sq
            JOIN synthetic_batches sb ON sq.batch_id = sb.id
            WHERE sb.agent_id = ?
        """, (agent_id,))
        query_row = cursor.fetchone()
        total_queries = query_row["total"] or 0
        executed_queries = query_row["executed"] or 0
        success_queries = query_row["success"] or 0
        failed_queries = query_row["failed"] or 0
        
        # Thread/Session stats - sessions linked to this agent's batches
        cursor.execute("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN s.is_reviewed = 1 THEN 1 ELSE 0 END) as reviewed,
                SUM(CASE WHEN s.is_reviewed = 0 OR s.is_reviewed IS NULL THEN 1 ELSE 0 END) as unreviewed
            FROM sessions s
            JOIN synthetic_batches sb ON s.batch_id = sb.id
            WHERE sb.agent_id = ?
        """, (agent_id,))
        thread_row = cursor.fetchone()
        total_threads = thread_row["total"] or 0
        reviewed_threads = thread_row["reviewed"] or 0
        unreviewed_threads = thread_row["unreviewed"] or 0
        review_progress_percent = (reviewed_threads / total_threads * 100) if total_threads > 0 else 0.0
        
        # Failure mode stats - global (not per-agent yet, as failure modes are agent-agnostic)
        cursor.execute("SELECT COUNT(*) as total FROM failure_modes")
        fm_row = cursor.fetchone()
        total_failure_modes = fm_row["total"] or 0
        
        cursor.execute("SELECT COUNT(*) as total FROM notes WHERE failure_mode_id IS NOT NULL")
        cat_row = cursor.fetchone()
        total_categorized_notes = cat_row["total"] or 0
        
        # Calculate saturation from saturation_log
        cursor.execute("""
            SELECT 
                SUM(new_modes_created) as new_modes,
                SUM(existing_modes_matched) as matched
            FROM saturation_log
            ORDER BY timestamp DESC
            LIMIT 20
        """)
        sat_row = cursor.fetchone()
        window_new_modes = sat_row["new_modes"] or 0 if sat_row else 0
        window_matched = sat_row["matched"] or 0 if sat_row else 0
        
        total_window = window_new_modes + window_matched
        saturation_score = (window_matched / total_window * 100) if total_window > 0 else 0.0
        
        if saturation_score >= 90:
            saturation_status = "saturated"
        elif saturation_score >= 70:
            saturation_status = "approaching"
        else:
            saturation_status = "discovering"
        
        # Top failure mode (by note count)
        cursor.execute("""
            SELECT fm.name, COUNT(n.id) as note_count
            FROM failure_modes fm
            LEFT JOIN notes n ON n.failure_mode_id = fm.id
            GROUP BY fm.id
            ORDER BY note_count DESC
            LIMIT 1
        """)
        top_fm_row = cursor.fetchone()
        top_failure_mode = top_fm_row["name"] if top_fm_row and top_fm_row["note_count"] > 0 else None
        top_failure_mode_percent = None
        if top_fm_row and top_fm_row["note_count"] > 0 and total_categorized_notes > 0:
            top_failure_mode_percent = round(top_fm_row["note_count"] / total_categorized_notes * 100, 1)
        
        # Latest batch activity for this agent
        cursor.execute("""
            SELECT name, completed_at
            FROM synthetic_batches
            WHERE agent_id = ? AND status = 'completed'
            ORDER BY completed_at DESC
            LIMIT 1
        """, (agent_id,))
        latest_row = cursor.fetchone()
        latest_batch_name = latest_row["name"] if latest_row else None
        latest_batch_completed_at = latest_row["completed_at"] if latest_row else None
    
    return AgentStats(
        agent_id=agent_id,
        agent_name=agent_name,
        total_batches=total_batches,
        pending_batches=pending_batches,
        completed_batches=completed_batches,
        total_queries=total_queries,
        executed_queries=executed_queries,
        success_queries=success_queries,
        failed_queries=failed_queries,
        total_threads=total_threads,
        reviewed_threads=reviewed_threads,
        unreviewed_threads=unreviewed_threads,
        review_progress_percent=round(review_progress_percent, 1),
        total_failure_modes=total_failure_modes,
        total_categorized_notes=total_categorized_notes,
        saturation_score=round(saturation_score, 1),
        saturation_status=saturation_status,
        top_failure_mode=top_failure_mode,
        top_failure_mode_percent=top_failure_mode_percent,
        latest_batch_name=latest_batch_name,
        latest_batch_completed_at=latest_batch_completed_at
    )


@router.get("/agents/{agent_id}", response_model=AgentDetailResponse)
async def get_agent(agent_id: str):
    """
    Get detailed information about an agent.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM agents WHERE id = ?", (agent_id,))
        row = cursor.fetchone()
    
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    parsed = json.loads(row["agent_info_parsed"]) if row["agent_info_parsed"] else {}
    
    return AgentDetailResponse(
        id=row["id"],
        name=row["name"],
        version=row["version"] or "1.0.0",
        agent_type=row["agent_type"],
        framework=row["framework"],
        endpoint_url=row["endpoint_url"],
        connection_status=row["connection_status"],
        last_connection_test=row["last_connection_test"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        agent_info_raw=row["agent_info_raw"],
        agent_info_parsed=parsed,
        purpose=parsed.get("purpose"),
        capabilities=parsed.get("capabilities", []),
        limitations=parsed.get("limitations", []),
        success_criteria=parsed.get("success_criteria", []),
        tools=parsed.get("tools", []),
        testing_dimensions=parsed.get("testing_dimensions", []),
        testing_dimensions_count=len(parsed.get("testing_dimensions", []))
    )


@router.put("/agents/{agent_id}", response_model=AgentResponse)
async def update_agent(agent_id: str, request: AgentUpdateRequest):
    """
    Update an agent's information.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM agents WHERE id = ?", (agent_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        # Build update fields
        updates = []
        params = []
        
        if request.name is not None:
            updates.append("name = ?")
            params.append(request.name)
        
        if request.endpoint_url is not None:
            updates.append("endpoint_url = ?")
            params.append(request.endpoint_url)
            # Reset connection status when URL changes
            updates.append("connection_status = 'unknown'")
        
        if request.agent_info_content is not None:
            # Validate and parse new AGENT_INFO
            validation = validate_agent_info(request.agent_info_content)
            if not validation["valid"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid AGENT_INFO.md: {', '.join(validation['errors'])}"
                )
            
            parsed = validation["parsed"]
            updates.extend([
                "agent_info_raw = ?",
                "agent_info_parsed = ?",
                "version = ?",
                "agent_type = ?",
                "framework = ?"
            ])
            params.extend([
                request.agent_info_content,
                json.dumps(parsed),
                parsed.get("version", "1.0.0"),
                parsed.get("agent_type"),
                parsed.get("framework")
            ])
            
            # Update dimensions
            cursor.execute("DELETE FROM agent_dimensions WHERE agent_id = ?", (agent_id,))
            for dim in parsed.get("testing_dimensions", []):
                cursor.execute("""
                    INSERT INTO agent_dimensions (id, agent_id, name, dimension_values, descriptions, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    generate_id(),
                    agent_id,
                    dim.get("name"),
                    json.dumps(dim.get("values", [])),
                    json.dumps(dim.get("descriptions")) if dim.get("descriptions") else None,
                    now_iso()
                ))
        
        if updates:
            updates.append("updated_at = ?")
            params.append(now_iso())
            params.append(agent_id)
            
            cursor.execute(f"""
                UPDATE agents SET {', '.join(updates)} WHERE id = ?
            """, params)
        
        # Fetch updated record
        cursor.execute("SELECT * FROM agents WHERE id = ?", (agent_id,))
        row = cursor.fetchone()
    
    parsed = json.loads(row["agent_info_parsed"]) if row["agent_info_parsed"] else {}
    
    return AgentResponse(
        id=row["id"],
        name=row["name"],
        version=row["version"] or "1.0.0",
        agent_type=row["agent_type"],
        framework=row["framework"],
        endpoint_url=row["endpoint_url"],
        connection_status=row["connection_status"],
        last_connection_test=row["last_connection_test"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        purpose=parsed.get("purpose"),
        capabilities=parsed.get("capabilities", []),
        testing_dimensions_count=len(parsed.get("testing_dimensions", []))
    )


@router.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str):
    """
    Delete an agent registration.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM agents WHERE id = ?", (agent_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Agent not found")
        
        # Delete agent (cascades to dimensions, batches, etc.)
        cursor.execute("DELETE FROM agents WHERE id = ?", (agent_id,))
    
    return {"status": "deleted", "agent_id": agent_id}


def _update_agent_connection_status(agent_id: str, status: str) -> None:
    """Helper to update agent connection status in a single DB call."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE agents 
            SET connection_status = ?, last_connection_test = ?
            WHERE id = ?
        """, (status, now_iso(), agent_id))


@router.post("/agents/{agent_id}/test-connection", response_model=ConnectionTestResult)
async def test_agent_connection(agent_id: str):
    """
    Test connectivity to the agent's endpoint.
    
    Uses AgentClient which derives the base URL from the full endpoint
    to find health check endpoints.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT endpoint_url FROM agents WHERE id = ?", (agent_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        endpoint_url = row["endpoint_url"]
    
    # Use AgentClient to perform health check
    client = AgentClient(endpoint_url)
    health = await client.health_check()
    
    # Update connection status in database
    status = "connected" if health["healthy"] else "error"
    _update_agent_connection_status(agent_id, status)
    
    return ConnectionTestResult(
        success=health["healthy"],
        status_code=health.get("status_code"),
        response_time_ms=health.get("response_time_ms"),
        error=health.get("error")
    )


@router.get("/agents/{agent_id}/agent-info")
async def get_agent_remote_info(agent_id: str):
    """
    Fetch AGENT_INFO.md from the agent's endpoint.
    
    This retrieves the agent's self-description including purpose,
    capabilities, testing dimensions, and system prompts.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT endpoint_url FROM agents WHERE id = ?", (agent_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        endpoint_url = row["endpoint_url"]
    
    # Use AgentClient to fetch agent info
    client = AgentClient(endpoint_url)
    
    try:
        agent_info = await client.get_agent_info()
        return agent_info
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch agent info: {str(e)}")


# =============================================================================
# Agent Execution Endpoints (Simple HTTP)
# =============================================================================
# Note: Dimension management endpoints are in routers/synthetic.py

@router.post("/agents/{agent_id}/run")
async def run_agent(agent_id: str, request: RunAgentRequest):
    """
    Run a query against an agent using simple HTTP.
    
    Returns a JSON response with the agent's reply.
    This replaces the previous SSE streaming endpoint with a simpler
    request/response model.
    """
    # Get agent from database
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM agents WHERE id = ?", (agent_id,))
        row = cursor.fetchone()
    
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    endpoint_url = row["endpoint_url"]
    client = AgentClient(endpoint_url)
    
    try:
        result = await client.query(
            query=request.message,
            thread_id=request.thread_id
        )
        
        return {
            "success": result.error is None,
            "response": result.response,
            "thread_id": result.thread_id,
            "error": result.error
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/agents/{agent_id}/run-sync")
async def run_agent_sync(agent_id: str, request: RunAgentRequest):
    """
    Run a query against an agent and return the complete response.
    
    This is now identical to /run since we no longer use SSE.
    Kept for backwards compatibility.
    """
    return await run_agent(agent_id, request)


@router.get("/agents/{agent_id}/status")
async def get_agent_status(agent_id: str):
    """
    Get the current status of an agent including connection health.
    
    Performs a live health check and returns current status.
    """
    # Get agent from database
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM agents WHERE id = ?", (agent_id,))
        row = cursor.fetchone()
    
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    # Perform health check
    client = AgentClient(row["endpoint_url"])
    health = await client.health_check()
    
    # Update status in database
    new_status = "connected" if health["healthy"] else "disconnected"
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE agents 
            SET connection_status = ?, last_connection_test = ?
            WHERE id = ?
        """, (new_status, now_iso(), agent_id))
    
    return {
        "agent_id": agent_id,
        "name": row["name"],
        "endpoint_url": row["endpoint_url"],
        "connection_status": new_status,
        "health_check": health,
        "last_updated": now_iso()
    }

