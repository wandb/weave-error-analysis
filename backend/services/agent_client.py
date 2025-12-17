"""
Simple HTTP client for connecting to user's agent endpoints.

This replaces the AG-UI client with a much simpler request/response model.
Users define the full endpoint URL where queries should be sent.

Endpoint Specification:
    POST <user-defined-endpoint>
    Request:  {"query": "...", "thread_id": "optional"}
    Response: {"response": "...", "thread_id": "...", "error": null}
"""

import httpx
from typing import Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel

from config import get_agent_query_timeout, get_health_check_timeout
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
    
    def __init__(self, endpoint_url: str, timeout: Optional[float] = None):
        """
        Initialize the agent client.
        
        Args:
            endpoint_url: Full URL of the agent query endpoint (e.g., http://localhost:9000/query)
            timeout: Request timeout in seconds. If not provided, uses configured agent_query_timeout.
        """
        self.endpoint_url = endpoint_url
        self._custom_timeout = timeout  # None means use config
    
    @property
    def timeout(self) -> float:
        """Get the timeout value, using config if not explicitly set."""
        if self._custom_timeout is not None:
            return self._custom_timeout
        return get_agent_query_timeout()
    
    def _get_base_url(self) -> str:
        """Derive base URL from the endpoint URL."""
        from urllib.parse import urlparse, urlunparse
        parsed = urlparse(self.endpoint_url)
        # Return just scheme + netloc (e.g., http://localhost:9000)
        return urlunparse((parsed.scheme, parsed.netloc, '', '', '', ''))
    
    async def health_check(self) -> Dict[str, Any]:
        """
        Check if the agent endpoint is reachable and healthy.
        
        Returns:
            Dict with 'healthy', 'status_code', 'response_time_ms', and 'error' keys
        """
        start_time = datetime.utcnow()
        base_url = self._get_base_url()
        
        async with httpx.AsyncClient() as client:
            # Try common health endpoints
            endpoints_to_try = [
                f"{base_url}/health",
                f"{base_url}/api/health",
                f"{base_url}/",
            ]
            
            health_timeout = get_health_check_timeout()
            for endpoint in endpoints_to_try:
                try:
                    response = await client.get(endpoint, timeout=health_timeout)
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
                    self.endpoint_url,
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
        base_url = self._get_base_url()
        
        async with httpx.AsyncClient() as client:
            endpoints_to_try = [
                (f"{base_url}/agent-info/json", "json"),
                (f"{base_url}/agent-info", "markdown"),
                (f"{base_url}/api/agent-info/json", "json"),
                (f"{base_url}/api/agent-info", "markdown"),
            ]
            
            info_timeout = get_health_check_timeout()  # Use health check timeout for metadata fetches
            for endpoint, format_type in endpoints_to_try:
                try:
                    response = await client.get(endpoint, timeout=info_timeout)
                    
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
    timeout: Optional[float] = None
) -> QueryResponse:
    """
    Convenience function to run a query against an agent.
    
    Args:
        endpoint_url: The full agent query endpoint URL (e.g., http://localhost:9000/query)
        query: The query to send
        thread_id: Optional thread ID for conversation continuity
        timeout: Request timeout in seconds. If None, uses configured agent_query_timeout.
        
    Returns:
        QueryResponse with the agent's response or error
    """
    client = AgentClient(endpoint_url, timeout=timeout)
    return await client.query(query, thread_id)

