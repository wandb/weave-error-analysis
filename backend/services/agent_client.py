"""
Simple HTTP client for connecting to user's agent endpoints.

This replaces the AG-UI client with a much simpler request/response model.
Agents only need to expose a POST /query endpoint that accepts a query
and returns a response string.

Endpoint Specification:
    POST /query
    Request:  {"query": "...", "thread_id": "optional"}
    Response: {"response": "...", "thread_id": "...", "error": null}
"""

import httpx
from typing import Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel

from logger import get_logger, log_event, generate_correlation_id

logger = get_logger("agent")


class QueryRequest(BaseModel):
    """Request to send a query to the agent."""
    query: str
    thread_id: Optional[str] = None


class QueryResponse(BaseModel):
    """Response from the agent."""
    response: str
    thread_id: Optional[str] = None
    error: Optional[str] = None


class AgentClient:
    """
    Simple HTTP client for agent communication.
    
    This client connects to user-hosted agents using a simple HTTP API.
    No streaming, no SSE, just plain request/response.
    """
    
    def __init__(self, endpoint_url: str, timeout: float = 120.0):
        """
        Initialize the agent client.
        
        Args:
            endpoint_url: Base URL of the agent endpoint (e.g., http://localhost:9000)
            timeout: Request timeout in seconds (default 120s for long agent runs)
        """
        self.endpoint_url = endpoint_url.rstrip('/')
        self.timeout = timeout
    
    async def health_check(self) -> Dict[str, Any]:
        """
        Check if the agent endpoint is reachable and healthy.
        
        Returns:
            Dict with 'healthy', 'status_code', 'response_time_ms', and 'error' keys
        """
        start_time = datetime.utcnow()
        
        async with httpx.AsyncClient() as client:
            # Try common health endpoints
            endpoints_to_try = [
                f"{self.endpoint_url}/health",
                f"{self.endpoint_url}/api/health",
                f"{self.endpoint_url}/",
            ]
            
            for endpoint in endpoints_to_try:
                try:
                    response = await client.get(endpoint, timeout=10.0)
                    response_time = (datetime.utcnow() - start_time).total_seconds() * 1000
                    
                    if response.status_code == 200:
                        return {
                            "healthy": True,
                            "status_code": response.status_code,
                            "response_time_ms": round(response_time, 2),
                            "endpoint_checked": endpoint,
                            "error": None
                        }
                except httpx.TimeoutException:
                    continue
                except httpx.RequestError:
                    continue
            
            # All endpoints failed
            response_time = (datetime.utcnow() - start_time).total_seconds() * 1000
            return {
                "healthy": False,
                "status_code": None,
                "response_time_ms": round(response_time, 2),
                "endpoint_checked": None,
                "error": "Could not connect to any health endpoint"
            }
    
    async def query(
        self,
        query: str,
        thread_id: Optional[str] = None,
        correlation_id: Optional[str] = None
    ) -> QueryResponse:
        """
        Send a query to the agent and get the response.
        
        Args:
            query: The user query to send to the agent
            thread_id: Optional thread ID for conversation continuity
            correlation_id: Optional correlation ID for tracing
            
        Returns:
            QueryResponse with the agent's response or error
        """
        request_id = correlation_id or generate_correlation_id()[:8]
        start_time = datetime.utcnow()
        
        log_event(logger, "agent.query_start",
            correlation_id=request_id,
            endpoint=self.endpoint_url,
            query_length=len(query),
            has_thread_id=bool(thread_id)
        )
        
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.endpoint_url}/query",
                    json={"query": query, "thread_id": thread_id},
                    timeout=httpx.Timeout(self.timeout, connect=10.0)
                )
                
                duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
                
                if response.status_code != 200:
                    error_msg = f"Agent returned status {response.status_code}"
                    log_event(logger, "agent.query_failed", level="error",
                        correlation_id=request_id,
                        endpoint=self.endpoint_url,
                        status_code=response.status_code,
                        error=error_msg,
                        duration_ms=duration_ms
                    )
                    return QueryResponse(response="", error=error_msg)
                
                data = response.json()
                
                # Handle error in response body
                if data.get("error"):
                    log_event(logger, "agent.query_failed", level="error",
                        correlation_id=request_id,
                        endpoint=self.endpoint_url,
                        error=data["error"],
                        duration_ms=duration_ms
                    )
                    return QueryResponse(
                        response=data.get("response", ""),
                        thread_id=data.get("thread_id"),
                        error=data["error"]
                    )
                
                log_event(logger, "agent.query_complete",
                    correlation_id=request_id,
                    endpoint=self.endpoint_url,
                    thread_id=data.get("thread_id"),
                    response_length=len(data.get("response", "")),
                    duration_ms=duration_ms
                )
                
                return QueryResponse(
                    response=data.get("response", ""),
                    thread_id=data.get("thread_id"),
                    error=None
                )
                
            except httpx.TimeoutException:
                duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
                error_msg = f"Request timed out after {self.timeout}s"
                log_event(logger, "agent.query_timeout", level="error",
                    correlation_id=request_id,
                    endpoint=self.endpoint_url,
                    error=error_msg,
                    duration_ms=duration_ms
                )
                return QueryResponse(response="", error=error_msg)
                
            except httpx.RequestError as e:
                duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
                error_msg = f"Connection error: {str(e)}"
                log_event(logger, "agent.query_connection_error", level="error",
                    correlation_id=request_id,
                    endpoint=self.endpoint_url,
                    error=error_msg,
                    duration_ms=duration_ms
                )
                return QueryResponse(response="", error=error_msg)
                
            except Exception as e:
                duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
                error_msg = f"Unexpected error: {str(e)}"
                log_event(logger, "agent.query_unexpected_error", level="error",
                    correlation_id=request_id,
                    endpoint=self.endpoint_url,
                    error=error_msg,
                    duration_ms=duration_ms
                )
                return QueryResponse(response="", error=error_msg)
    
    async def get_agent_info(self) -> Dict[str, Any]:
        """
        Fetch AGENT_INFO from the agent endpoint.
        
        Returns:
            Dict with agent info including 'raw_content' or 'error'
        """
        async with httpx.AsyncClient() as client:
            endpoints_to_try = [
                (f"{self.endpoint_url}/agent-info/json", "json"),
                (f"{self.endpoint_url}/agent-info", "markdown"),
                (f"{self.endpoint_url}/api/agent-info/json", "json"),
                (f"{self.endpoint_url}/api/agent-info", "markdown"),
            ]
            
            for endpoint, format_type in endpoints_to_try:
                try:
                    response = await client.get(endpoint, timeout=10.0)
                    
                    if response.status_code == 200:
                        if format_type == "json":
                            return response.json()
                        else:
                            return {
                                "raw_content": response.text,
                                "format": "markdown"
                            }
                except:
                    continue
            
            return {
                "error": "Agent does not expose AGENT_INFO",
                "raw_content": None
            }


# Convenience function for one-off queries
async def query_agent(
    endpoint_url: str,
    query: str,
    thread_id: Optional[str] = None,
    timeout: float = 120.0
) -> QueryResponse:
    """
    Convenience function to run a query against an agent.
    
    Args:
        endpoint_url: The agent endpoint URL
        query: The query to send
        thread_id: Optional thread ID for conversation continuity
        timeout: Request timeout in seconds
        
    Returns:
        QueryResponse with the agent's response or error
    """
    client = AgentClient(endpoint_url, timeout=timeout)
    return await client.query(query, thread_id)

