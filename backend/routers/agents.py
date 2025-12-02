"""
Agent registry API endpoints.

Provides CRUD operations for registered agents and their AGENT_INFO.
"""

import json
import httpx
import asyncio
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from database import get_db, generate_id, now_iso
from services.agent_info import parse_agent_info, validate_agent_info, generate_template
from services.agui_client import AGUIClient, AGUIEvent

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


@router.post("/agents/{agent_id}/test-connection", response_model=ConnectionTestResult)
async def test_agent_connection(agent_id: str):
    """
    Test connectivity to the agent's AG-UI endpoint.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT endpoint_url FROM agents WHERE id = ?", (agent_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        endpoint_url = row["endpoint_url"].rstrip('/')
    
    # Try to connect to the agent
    import time
    start_time = time.time()
    
    try:
        async with httpx.AsyncClient() as client:
            # Try health endpoint first
            try:
                response = await client.get(f"{endpoint_url}/health", timeout=10.0)
                response_time = (time.time() - start_time) * 1000
                
                success = response.status_code == 200
                status = "connected" if success else "error"
                
            except httpx.RequestError:
                # Try root endpoint as fallback
                response = await client.get(endpoint_url, timeout=10.0)
                response_time = (time.time() - start_time) * 1000
                
                success = response.status_code in [200, 404]  # 404 is ok for root
                status = "connected" if success else "error"
        
        # Update connection status in database
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE agents 
                SET connection_status = ?, last_connection_test = ?
                WHERE id = ?
            """, (status, now_iso(), agent_id))
        
        return ConnectionTestResult(
            success=success,
            status_code=response.status_code,
            response_time_ms=round(response_time, 2),
            error=None if success else f"Unexpected status code: {response.status_code}"
        )
        
    except httpx.TimeoutException:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE agents 
                SET connection_status = 'error', last_connection_test = ?
                WHERE id = ?
            """, (now_iso(), agent_id))
        
        return ConnectionTestResult(
            success=False,
            error="Connection timed out"
        )
        
    except Exception as e:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE agents 
                SET connection_status = 'error', last_connection_test = ?
                WHERE id = ?
            """, (now_iso(), agent_id))
        
        return ConnectionTestResult(
            success=False,
            error=str(e)
        )


@router.get("/agents/{agent_id}/agent-info")
async def get_agent_remote_info(agent_id: str):
    """
    Fetch AGENT_INFO.md from the agent's AG-UI endpoint.
    
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
    
    # Use AGUIClient to fetch agent info
    from services.agui_client import AGUIClient
    client = AGUIClient(endpoint_url)
    
    try:
        agent_info = await client.get_agent_info()
        return agent_info
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch agent info: {str(e)}")


@router.get("/agents/{agent_id}/dimensions")
async def get_agent_dimensions(agent_id: str):
    """
    Get testing dimensions for an agent.
    """
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
    
    dimensions = []
    for row in rows:
        dimensions.append({
            "id": row["id"],
            "name": row["name"],
            "values": json.loads(row["dimension_values"]) if row["dimension_values"] else [],
            "descriptions": json.loads(row["descriptions"]) if row["descriptions"] else None
        })
    
    return {"agent_id": agent_id, "dimensions": dimensions}


# =============================================================================
# Agent Execution Endpoints (AG-UI Protocol)
# =============================================================================

@router.post("/agents/{agent_id}/run")
async def run_agent(agent_id: str, request: RunAgentRequest):
    """
    Run a query against an agent using the AG-UI protocol.
    
    Returns a Server-Sent Events (SSE) stream of AG-UI events.
    Events include:
    - started: Connection initiated
    - text_chunk: Streaming text response
    - tool_start: Agent is calling a tool
    - tool_args: Tool arguments
    - tool_end: Tool call completed
    - complete: Run finished successfully
    - error: An error occurred
    """
    # Get agent from database
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM agents WHERE id = ?", (agent_id,))
        row = cursor.fetchone()
    
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    endpoint_url = row["endpoint_url"]
    
    async def event_generator():
        """Generate SSE events from AG-UI client."""
        client = AGUIClient(endpoint_url)
        
        try:
            async for event in client.run(
                message=request.message,
                thread_id=request.thread_id,
                context=request.context
            ):
                # Convert event to JSON for SSE
                event_data = {
                    "type": event.type,
                    "content": event.content,
                    "message_id": event.message_id,
                    "tool_name": event.tool_name,
                    "tool_args": event.tool_args,
                    "tool_result": event.tool_result,
                    "call_id": event.call_id,
                    "trace_id": event.trace_id,
                    "error": event.error,
                    "timestamp": event.timestamp
                }
                
                # Remove None values for cleaner output
                event_data = {k: v for k, v in event_data.items() if v is not None}
                
                yield f"data: {json.dumps(event_data)}\n\n"
                
                # Small delay to prevent overwhelming the client
                await asyncio.sleep(0.01)
                
        except Exception as e:
            # Send error event
            error_event = {
                "type": "error",
                "error": str(e)
            }
            yield f"data: {json.dumps(error_event)}\n\n"
        
        # Send done marker
        yield "data: [DONE]\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # Disable buffering in nginx
        }
    )


@router.post("/agents/{agent_id}/run-sync")
async def run_agent_sync(agent_id: str, request: RunAgentRequest):
    """
    Run a query against an agent and return the complete response (non-streaming).
    
    Useful for simple queries where streaming isn't needed.
    Returns the full response text, tool calls, and any errors.
    """
    # Get agent from database
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM agents WHERE id = ?", (agent_id,))
        row = cursor.fetchone()
    
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    endpoint_url = row["endpoint_url"]
    client = AGUIClient(endpoint_url)
    
    try:
        result = await client.run_sync(
            message=request.message,
            thread_id=request.thread_id,
            context=request.context
        )
        
        return {
            "success": result["error"] is None,
            "response": result["response"],
            "tool_calls": result["tool_calls"],
            "trace_id": result["trace_id"],
            "error": result["error"]
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    client = AGUIClient(row["endpoint_url"])
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

