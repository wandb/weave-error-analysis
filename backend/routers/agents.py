"""
Agent registry API endpoints.

Provides CRUD operations for registered agents.
"""

from typing import Optional, List
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from database import get_db, get_db_readonly, generate_id, now_iso
from services.agent_info import generate_template
from services.agent_client import AgentClient
from models import AgentStats

router = APIRouter(prefix="/api", tags=["agents"])


# =============================================================================
# Request/Response Models
# =============================================================================

class AgentCreateRequest(BaseModel):
    """Request to register a new agent."""
    name: str = Field(..., description="Display name for the agent")
    endpoint_url: str = Field(..., description="Agent query endpoint URL")
    weave_project: Optional[str] = Field(
        default=None,
        description="Weave project where this agent logs traces (e.g., 'my-chatbot')"
    )
    agent_context: str = Field(
        default="",
        description="Free-form description of the agent (optional)"
    )


class AgentUpdateRequest(BaseModel):
    """Request to update an agent."""
    name: Optional[str] = None
    endpoint_url: Optional[str] = None
    weave_project: Optional[str] = None
    agent_context: Optional[str] = None


class AgentResponse(BaseModel):
    """Agent response model."""
    id: str
    name: str
    endpoint_url: str
    weave_project: Optional[str] = None
    agent_context: str = ""
    connection_status: str
    last_connection_test: Optional[str] = None
    is_example: bool = False
    created_at: str
    updated_at: str




class ConnectionTestResult(BaseModel):
    """Result of testing agent connection."""
    success: bool
    status_code: Optional[int] = None
    response_time_ms: Optional[float] = None
    error: Optional[str] = None


# =============================================================================
# API Endpoints
# =============================================================================

@router.post("/agents", response_model=AgentResponse)
async def create_agent(request: AgentCreateRequest):
    """
    Register a new agent.
    
    The agent_context field is a free-form text description of the agent.
    This context can be used by LLM prompts for context-aware generation.
    """
    agent_id = generate_id()
    now = now_iso()
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO agents (
                id, name, endpoint_url, weave_project, 
                agent_context, connection_status,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'unknown', ?, ?)
        """, (
            agent_id,
            request.name,
            request.endpoint_url,
            request.weave_project,
            request.agent_context,
            now,
            now
        ))
    
    return AgentResponse(
        id=agent_id,
        name=request.name,
        endpoint_url=request.endpoint_url,
        weave_project=request.weave_project,
        agent_context=request.agent_context,
        connection_status="unknown",
        last_connection_test=None,
        created_at=now,
        updated_at=now,
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
        row_keys = row.keys()
        
        agents.append(AgentResponse(
            id=row["id"],
            name=row["name"],
            endpoint_url=row["endpoint_url"],
            weave_project=row["weave_project"] if "weave_project" in row_keys else None,
            agent_context=row["agent_context"] if "agent_context" in row_keys else "",
            connection_status=row["connection_status"],
            last_connection_test=row["last_connection_test"],
            is_example=bool(row["is_example"]) if "is_example" in row_keys else False,
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        ))
    
    return agents


# NOTE: Static routes must be defined BEFORE dynamic /{agent_id} routes
@router.get("/agents/template")
async def get_agent_context_template(
    name: str = Query("My Agent", description="Agent name"),
    agent_type: str = Query("General", description="Agent type"),
    framework: str = Query("", description="Framework (optional)"),
    purpose: str = Query("Describe what your agent does.", description="Purpose")
):
    """
    Get an example agent context template.
    
    Agent context is free-form text that describes what the agent does.
    This template provides a suggested structure.
    """
    template = generate_template(
        name=name,
        agent_type=agent_type,
        framework=framework,
        purpose=purpose
    )
    return {"template": template}


# =============================================================================
# Example Agent Management (static routes - must come before /{agent_id})
# =============================================================================
# The example agent (TaskFlow Support) is started on-demand from the UI.
# This allows users to configure their API key in Settings first.

import subprocess
import sys
from pathlib import Path
from services.settings import get_setting

# Global reference to example agent process
_example_agent_process: Optional[subprocess.Popen] = None
AGENT_DIR = Path(__file__).parent.parent.parent / "agent"


class ExampleAgentStartRequest(BaseModel):
    """Request to start the example agent."""
    port: int = Field(default=9000, description="Port to run the agent on")


class ExampleAgentStatusResponse(BaseModel):
    """Status of the example agent."""
    running: bool
    port: Optional[int] = None
    pid: Optional[int] = None
    exit_code: Optional[int] = None
    requires_api_key: bool = False


@router.post("/agents/example/start")
async def start_example_agent(request: ExampleAgentStartRequest = ExampleAgentStartRequest()):
    """
    Start the example TaskFlow Support agent.
    
    Requires LLM API key to be configured in Settings.
    The agent fetches the API key from the backend settings.
    """
    global _example_agent_process
    
    port = request.port
    
    # Check if already running
    if _example_agent_process is not None and _example_agent_process.poll() is None:
        return {"status": "already_running", "port": port, "pid": _example_agent_process.pid}
    
    # Check if LLM API key is configured
    api_key = get_setting("llm_api_key")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="LLM API key not configured. Go to Settings to add your OpenAI API key."
        )
    
    # Start the agent with the API key from settings
    import os
    env = os.environ.copy()
    env["OPENAI_API_KEY"] = api_key
    env["PYTHONPATH"] = str(AGENT_DIR)
    
    # Also set Weave credentials if configured (for trace logging)
    weave_api_key = get_setting("weave_api_key")
    weave_entity = get_setting("weave_entity")
    if weave_api_key:
        env["WANDB_API_KEY"] = weave_api_key
    if weave_entity:
        env["WANDB_ENTITY"] = weave_entity
    env["WEAVE_PROJECT"] = "error-analysis-demo"  # Example agent's fixed project
    
    try:
        _example_agent_process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "agent_server:app",
             "--host", "0.0.0.0", "--port", str(port)],
            cwd=AGENT_DIR,
            env=env,
        )
        
        return {
            "status": "started",
            "port": port,
            "pid": _example_agent_process.pid
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start agent: {str(e)}")


@router.post("/agents/example/stop")
async def stop_example_agent():
    """Stop the example agent if running."""
    global _example_agent_process
    
    if _example_agent_process is None:
        return {"status": "not_running"}
    
    if _example_agent_process.poll() is None:
        _example_agent_process.terminate()
        try:
            _example_agent_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _example_agent_process.kill()
    
    exit_code = _example_agent_process.returncode
    _example_agent_process = None
    return {"status": "stopped", "exit_code": exit_code}


@router.get("/agents/example/status", response_model=ExampleAgentStatusResponse)
async def get_example_agent_status():
    """
    Check if the example agent is running.
    
    Also indicates if an API key is required to start the agent.
    """
    global _example_agent_process
    
    # Check if API key is configured
    api_key = get_setting("llm_api_key")
    requires_api_key = not bool(api_key)
    
    if _example_agent_process is None:
        return ExampleAgentStatusResponse(
            running=False,
            requires_api_key=requires_api_key
        )
    
    if _example_agent_process.poll() is None:
        return ExampleAgentStatusResponse(
            running=True,
            port=9000,
            pid=_example_agent_process.pid,
            requires_api_key=False
        )
    else:
        exit_code = _example_agent_process.returncode
        _example_agent_process = None
        return ExampleAgentStatusResponse(
            running=False,
            exit_code=exit_code,
            requires_api_key=requires_api_key
        )


# =============================================================================
# Dynamic /{agent_id} routes (must come after static routes)
# =============================================================================

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
        
        # Note: Trace review stats now come from Weave feedback, not local sessions.
        # These are set to 0 for now - could be populated via Weave API if needed.
        
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
        # Trace review stats - not populated locally, would come from Weave
        total_traces=0,
        reviewed_traces=0,
        unreviewed_traces=0,
        review_progress_percent=0.0,
        total_failure_modes=total_failure_modes,
        total_categorized_notes=total_categorized_notes,
        saturation_score=round(saturation_score, 1),
        saturation_status=saturation_status,
        top_failure_mode=top_failure_mode,
        top_failure_mode_percent=top_failure_mode_percent,
        latest_batch_name=latest_batch_name,
        latest_batch_completed_at=latest_batch_completed_at
    )


@router.get("/agents/{agent_id}", response_model=AgentResponse)
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
    
    row_keys = row.keys()
    
    return AgentResponse(
        id=row["id"],
        name=row["name"],
        endpoint_url=row["endpoint_url"],
        weave_project=row["weave_project"] if "weave_project" in row_keys else None,
        agent_context=row["agent_context"] if "agent_context" in row_keys else "",
        connection_status=row["connection_status"],
        last_connection_test=row["last_connection_test"],
        is_example=bool(row["is_example"]) if "is_example" in row_keys else False,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
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
        
        if request.weave_project is not None:
            updates.append("weave_project = ?")
            params.append(request.weave_project)
        
        if request.agent_context is not None:
            updates.append("agent_context = ?")
            params.append(request.agent_context)
        
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
    
    row_keys = row.keys()
    
    return AgentResponse(
        id=row["id"],
        name=row["name"],
        endpoint_url=row["endpoint_url"],
        weave_project=row["weave_project"] if "weave_project" in row_keys else None,
        agent_context=row["agent_context"] if "agent_context" in row_keys else "",
        connection_status=row["connection_status"],
        last_connection_test=row["last_connection_test"],
        is_example=bool(row["is_example"]) if "is_example" in row_keys else False,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
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


class AgentRunRequest(BaseModel):
    """Request to run a query through the agent playground."""
    message: str = Field(..., description="The message/query to send to the agent")


class AgentRunResponse(BaseModel):
    """Response from running an agent query."""
    response: str = ""
    error: str | None = None


@router.post("/agents/{agent_id}/run", response_model=AgentRunResponse)
async def run_agent_query(agent_id: str, request: AgentRunRequest):
    """
    Run a single query against an agent (playground mode).
    
    This endpoint allows testing an agent with a one-off query.
    Useful for quick testing before creating synthetic batches.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT endpoint_url FROM agents WHERE id = ?", (agent_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        endpoint_url = row["endpoint_url"]
    
    # Use AgentClient to send the query - simple request/response
    client = AgentClient(endpoint_url)
    result = await client.query(request.message)
    
    return AgentRunResponse(
        response=result.response,
        error=result.error
    )
