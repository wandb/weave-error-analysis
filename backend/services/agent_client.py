"""
Simple HTTP client for connecting to user's agent endpoints.

This replaces the AG-UI client with a much simpler request/response model.
Users define the full endpoint URL where queries should be sent.

Endpoint Specification:
    POST <user-defined-endpoint>
    Request:  {"query": "...", "batch_id": "...", "query_id": "..."}
    Response: {"response": "...", "error": null}

The agent is a black box: query in → response out. That's it.
Our application handles all the complexity of trace linkage via Weave attributes.

Trace Linking:
When executing batch queries, we pass batch_id and query_id to the agent.
The agent sets weave.attributes({"batch_id": ..., "query_id": ...}) which
allows granular query-to-trace linking after batch execution.
"""

import httpx
from typing import Any
from datetime import datetime
from pydantic import BaseModel

from config import get_agent_query_timeout, get_health_check_timeout
from logger import get_logger, log_event, generate_correlation_id

logger = get_logger("agent")


class QueryRequest(BaseModel):
    """Request to send a query to the agent."""
    query: str
    batch_id: str | None = None
    query_id: str | None = None


class QueryResponse(BaseModel):
    """Response from the agent."""
    response: str
    error: str | None = None


class AgentClient:
    """
    Simple HTTP client for agent communication.
    
    This client connects to user-hosted agents using a simple HTTP API.
    No streaming, no SSE, just plain request/response.
    """
    
    def __init__(self, endpoint_url: str, timeout: float | None = None):
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
    
    async def health_check(self) -> dict[str, Any]:
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
        correlation_id: str | None = None,
        batch_id: str | None = None,
        query_id: str | None = None
    ) -> QueryResponse:
        """
        Send a query to the agent and get the response.
        
        If batch_id and query_id are provided, they're passed to the agent server
        which wraps the execution in weave.attributes(). This enables granular
        trace linking - each synthetic query maps to its specific Weave trace.
        
        Args:
            query: The user query to send to the agent
            correlation_id: Optional correlation ID for tracing
            batch_id: Optional batch ID for batch filtering in Weave UI
            query_id: Optional query ID for granular query-to-trace linking
            
        Returns:
            QueryResponse with the agent's response or error
        """
        request_id = correlation_id or generate_correlation_id()[:8]
        start_time = datetime.utcnow()
        
        log_event(logger, "agent.query_start",
            correlation_id=request_id,
            endpoint=self.endpoint_url,
            query_length=len(query),
            batch_id=batch_id,
            query_id=query_id
        )
        
        # Build request body with trace linking attributes
        request_body = {"query": query}
        if batch_id:
            request_body["batch_id"] = batch_id
        if query_id:
            request_body["query_id"] = query_id
        
        # Execute the HTTP call to the agent
        return await self._execute_http_query(
            request_body=request_body,
            request_id=request_id,
            start_time=start_time
        )
    
    async def _execute_http_query(
        self,
        request_body: dict,
        request_id: str,
        start_time: datetime
    ) -> QueryResponse:
        """
        Execute the HTTP query to the agent.
        
        The agent server handles weave tracing - we just pass batch_id in the request
        and the agent sets weave.attributes() on its side. This ensures ALL agent
        traces (LLM calls, tool calls, etc.) inherit the batch_id attribute.
        """
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    self.endpoint_url,
                    json=request_body,
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
                
                if data.get("error"):
                    log_event(logger, "agent.query_failed", level="error",
                        correlation_id=request_id,
                        endpoint=self.endpoint_url,
                        error=data["error"],
                        duration_ms=duration_ms
                    )
                    return QueryResponse(
                        response=data.get("response", ""),
                        error=data["error"]
                    )
                
                log_event(logger, "agent.query_complete",
                    correlation_id=request_id,
                    endpoint=self.endpoint_url,
                    response_length=len(data.get("response", "")),
                    duration_ms=duration_ms
                )
                
                return QueryResponse(
                    response=data.get("response", ""),
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
    


# Convenience function for one-off queries
async def query_agent(
    endpoint_url: str,
    query: str,
    timeout: float | None = None
) -> QueryResponse:
    """
    Convenience function to run a query against an agent.
    
    Args:
        endpoint_url: The full agent query endpoint URL (e.g., http://localhost:9000/query)
        query: The query to send
        timeout: Request timeout in seconds. If None, uses configured agent_query_timeout.
        
    Returns:
        QueryResponse with the agent's response or error
    """
    client = AgentClient(endpoint_url, timeout=timeout)
    return await client.query(query)

