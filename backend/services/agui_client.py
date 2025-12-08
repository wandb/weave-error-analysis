"""
AG-UI Client for connecting to user's externally-hosted agents.

The AG-UI protocol is an event-based streaming protocol that enables
real-time communication between agents and UIs. This client implements
the client-side of the protocol to connect to user's AG-UI compatible endpoints.

AG-UI Events:
- RUN_STARTED - Agent run begins
- TEXT_MESSAGE_CHUNK - Streaming text response
- TEXT_MESSAGE_END - Text message complete
- TOOL_CALL_START - Agent is calling a tool
- TOOL_CALL_ARGS - Tool call arguments (streamed)
- TOOL_CALL_END - Tool call complete
- RUN_FINISHED - Agent run complete
- RUN_ERROR - Error occurred
"""

import json
import httpx
import asyncio
from typing import AsyncGenerator, Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel

from logger import get_logger, log_event, generate_correlation_id

logger = get_logger("agent")


class AGUIEvent(BaseModel):
    """Parsed AG-UI event."""
    type: str
    content: Optional[str] = None
    message_id: Optional[str] = None
    tool_name: Optional[str] = None
    tool_args: Optional[Dict[str, Any]] = None
    tool_result: Optional[Any] = None
    call_id: Optional[str] = None
    trace_id: Optional[str] = None
    thread_id: Optional[str] = None
    error: Optional[str] = None
    raw: Optional[Dict[str, Any]] = None
    timestamp: str = ""
    
    def __init__(self, **data):
        if "timestamp" not in data or not data["timestamp"]:
            data["timestamp"] = datetime.utcnow().isoformat()
        super().__init__(**data)


class AGUIClient:
    """
    Client to connect to user's AG-UI compatible agent endpoint.
    
    The AG-UI protocol uses Server-Sent Events (SSE) for streaming responses.
    This client handles:
    - Health checks to verify agent connectivity
    - Sending messages and streaming responses
    - Parsing AG-UI events into a unified format
    """
    
    def __init__(self, endpoint_url: str, timeout: float = 120.0):
        """
        Initialize the AG-UI client.
        
        Args:
            endpoint_url: Base URL of the AG-UI endpoint (e.g., http://localhost:8000)
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
            # Try multiple common health endpoints
            endpoints_to_try = [
                f"{self.endpoint_url}/health",
                f"{self.endpoint_url}/api/health",
                f"{self.endpoint_url}/",
            ]
            
            for endpoint in endpoints_to_try:
                try:
                    response = await client.get(endpoint, timeout=10.0)
                    response_time = (datetime.utcnow() - start_time).total_seconds() * 1000
                    
                    # 200 is healthy, 404 on root might be ok (API server without root handler)
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
                except httpx.RequestError as e:
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
    
    async def run(
        self, 
        message: str, 
        thread_id: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
        correlation_id: Optional[str] = None
    ) -> AsyncGenerator[AGUIEvent, None]:
        """
        Send a message to the agent and stream AG-UI events.
        
        AG-UI uses Server-Sent Events (SSE) for streaming responses.
        
        Args:
            message: The user message to send to the agent
            thread_id: Optional thread ID for conversation continuity
            context: Optional additional context to pass to the agent
            correlation_id: Optional correlation ID for tracing
            
        Yields:
            AGUIEvent objects representing parsed events from the agent
        """
        request_id = correlation_id or generate_correlation_id()[:8]
        start_time = datetime.utcnow()
        
        log_event(logger, "agent.request_start",
            correlation_id=request_id,
            endpoint=self.endpoint_url,
            message_length=len(message),
            has_thread_id=bool(thread_id)
        )
        
        # Yield a started event
        yield AGUIEvent(type="started", content=f"Connecting to agent...")
        
        request_body = {
            "message": message,
        }
        
        if thread_id:
            request_body["thread_id"] = thread_id
        
        if context:
            request_body["context"] = context
        
        # Try different AG-UI endpoint patterns
        endpoints_to_try = [
            f"{self.endpoint_url}/v1/run",
            f"{self.endpoint_url}/api/run",
            f"{self.endpoint_url}/run",
        ]
        
        last_error = None
        
        for endpoint in endpoints_to_try:
            try:
                async with httpx.AsyncClient() as client:
                    async with client.stream(
                        "POST",
                        endpoint,
                        json=request_body,
                        headers={
                            "Accept": "text/event-stream",
                            "Content-Type": "application/json",
                        },
                        timeout=httpx.Timeout(self.timeout, connect=10.0)
                    ) as response:
                        if response.status_code != 200:
                            last_error = f"Endpoint {endpoint} returned status {response.status_code}"
                            continue
                        
                        # Successfully connected, stream events
                        async for line in response.aiter_lines():
                            if not line:
                                continue
                            
                            # Parse SSE format
                            if line.startswith("data: "):
                                data_str = line[6:]  # Remove "data: " prefix
                                if data_str.strip() == "[DONE]":
                                    yield AGUIEvent(type="complete")
                                    return
                                
                                try:
                                    data = json.loads(data_str)
                                    event = self._parse_event(data)
                                    yield event
                                    
                                    # Check for completion and log
                                    if event.type == "complete":
                                        duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
                                        log_event(logger, "agent.request_complete",
                                            correlation_id=request_id,
                                            endpoint=self.endpoint_url,
                                            trace_id=event.trace_id,
                                            thread_id=event.thread_id,
                                            duration_ms=duration_ms
                                        )
                                        return
                                    elif event.type == "error":
                                        log_event(logger, "agent.request_failed", level="error",
                                            correlation_id=request_id,
                                            endpoint=self.endpoint_url,
                                            error=event.error
                                        )
                                        return
                                        
                                except json.JSONDecodeError as e:
                                    yield AGUIEvent(
                                        type="warning",
                                        content=f"Failed to parse event: {data_str[:100]}",
                                        error=str(e)
                                    )
                            
                            elif line.startswith("event: "):
                                # Some SSE implementations use explicit event types
                                pass
                        
                        # Stream ended normally
                        yield AGUIEvent(type="complete")
                        return
                        
            except httpx.TimeoutException:
                last_error = f"Request to {endpoint} timed out after {self.timeout}s"
                continue
            except httpx.RequestError as e:
                last_error = f"Request to {endpoint} failed: {str(e)}"
                continue
            except Exception as e:
                last_error = f"Unexpected error with {endpoint}: {str(e)}"
                continue
        
        # All endpoints failed
        log_event(logger, "agent.connection_failed", level="error",
            correlation_id=request_id,
            endpoint=self.endpoint_url,
            error=last_error or "Failed to connect to agent"
        )
        yield AGUIEvent(
            type="error",
            error=last_error or "Failed to connect to agent"
        )
    
    def _parse_event(self, data: Dict[str, Any]) -> AGUIEvent:
        """
        Parse AG-UI event data into our internal format.
        
        Handles multiple AG-UI event formats and normalizes them.
        """
        event_type = data.get("type", "unknown")
        
        # Map AG-UI event types to our internal types
        if event_type == "RUN_STARTED":
            return AGUIEvent(
                type="run_started",
                content="Agent run started",
                raw=data
            )
        
        elif event_type == "TEXT_MESSAGE_START":
            return AGUIEvent(
                type="text_start",
                message_id=data.get("messageId") or data.get("message_id"),
                raw=data
            )
        
        elif event_type in ("TEXT_MESSAGE_CHUNK", "TEXT_MESSAGE_CONTENT"):
            return AGUIEvent(
                type="text_chunk",
                content=data.get("content") or data.get("delta", {}).get("content", ""),
                message_id=data.get("messageId") or data.get("message_id"),
                raw=data
            )
        
        elif event_type == "TEXT_MESSAGE_END":
            return AGUIEvent(
                type="text_end",
                message_id=data.get("messageId") or data.get("message_id"),
                raw=data
            )
        
        elif event_type == "TOOL_CALL_START":
            return AGUIEvent(
                type="tool_start",
                tool_name=data.get("toolName") or data.get("tool_name") or data.get("name"),
                call_id=data.get("toolCallId") or data.get("call_id") or data.get("id"),
                raw=data
            )
        
        elif event_type in ("TOOL_CALL_ARGS", "TOOL_CALL_ARGUMENTS"):
            args = data.get("args") or data.get("arguments")
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except:
                    pass
            return AGUIEvent(
                type="tool_args",
                tool_args=args,
                call_id=data.get("toolCallId") or data.get("call_id"),
                raw=data
            )
        
        elif event_type == "TOOL_CALL_END":
            return AGUIEvent(
                type="tool_end",
                tool_result=data.get("result") or data.get("output"),
                call_id=data.get("toolCallId") or data.get("call_id"),
                raw=data
            )
        
        elif event_type == "RUN_FINISHED":
            return AGUIEvent(
                type="complete",
                trace_id=data.get("traceId") or data.get("trace_id"),
                thread_id=data.get("threadId") or data.get("thread_id"),
                raw=data
            )
        
        elif event_type == "RUN_ERROR":
            return AGUIEvent(
                type="error",
                error=data.get("message") or data.get("error") or str(data),
                raw=data
            )
        
        elif event_type == "STATE_SNAPSHOT":
            # CopilotKit specific - agent state update
            return AGUIEvent(
                type="state_update",
                content=json.dumps(data.get("state", {})),
                raw=data
            )
        
        elif event_type == "STATE_DELTA":
            # CopilotKit specific - incremental state update
            return AGUIEvent(
                type="state_delta",
                content=json.dumps(data.get("delta", {})),
                raw=data
            )
        
        else:
            # Unknown event type - return as-is with raw data
            return AGUIEvent(
                type="unknown",
                content=data.get("content") or data.get("message"),
                raw=data
            )
    
    async def get_agent_info(self) -> Dict[str, Any]:
        """
        Fetch the AGENT_INFO from the agent endpoint.
        
        AG-UI agents should expose their AGENT_INFO.md at /agent-info or /agent-info/json.
        
        Returns:
            Dict with agent info including 'raw_content', 'sections', 'testing_dimensions'
        """
        async with httpx.AsyncClient() as client:
            # Try JSON endpoint first
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
                            # Return markdown as raw content
                            return {
                                "raw_content": response.text,
                                "format": "markdown"
                            }
                            
                except httpx.TimeoutException:
                    continue
                except httpx.RequestError:
                    continue
                except Exception:
                    continue
            
            # No agent info available
            return {
                "error": "Agent does not expose AGENT_INFO",
                "raw_content": None
            }
    
    async def run_sync(
        self,
        message: str,
        thread_id: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Send a message and collect all responses (non-streaming).
        
        Useful for batch operations where streaming isn't needed.
        
        Returns:
            Dict with 'response', 'tool_calls', 'trace_id', 'thread_id', and 'error' keys
        """
        response_text = ""
        tool_calls = []
        current_tool = {}
        trace_id = None
        result_thread_id = None
        error = None
        
        async for event in self.run(message, thread_id, context):
            if event.type == "text_chunk" and event.content:
                response_text += event.content
            elif event.type == "tool_start":
                current_tool = {
                    "call_id": event.call_id,
                    "tool_name": event.tool_name,
                    "args": {},
                    "result": None
                }
            elif event.type == "tool_args" and event.tool_args:
                if current_tool:
                    current_tool["args"] = event.tool_args
            elif event.type == "tool_end":
                if current_tool:
                    current_tool["result"] = event.tool_result
                    tool_calls.append(current_tool)
                    current_tool = {}
            elif event.type == "complete":
                trace_id = event.trace_id
                result_thread_id = event.thread_id
            elif event.type == "error":
                error = event.error
        
        return {
            "response": response_text,
            "tool_calls": tool_calls,
            "trace_id": trace_id,
            "thread_id": result_thread_id,
            "error": error
        }


# Convenience function for one-off runs
async def run_agent_query(
    endpoint_url: str,
    message: str,
    thread_id: Optional[str] = None
) -> AsyncGenerator[AGUIEvent, None]:
    """
    Convenience function to run a query against an AG-UI agent.
    
    Args:
        endpoint_url: The AG-UI endpoint URL
        message: The message to send
        thread_id: Optional thread ID for conversation continuity
        
    Yields:
        AGUIEvent objects
    """
    client = AGUIClient(endpoint_url)
    async for event in client.run(message, thread_id):
        yield event

