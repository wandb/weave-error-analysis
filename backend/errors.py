"""
Standardized Error Handling

This module provides consistent error handling across the API:
1. Custom exception classes for different error types
2. Standardized error response format
3. Exception handlers for FastAPI

Error Response Format:
{
    "error": true,
    "code": "NOT_FOUND",
    "message": "Agent not found",
    "details": {...}  # Optional additional context
}

Usage in routers:
    from errors import NotFoundError, ValidationError, ServiceError
    
    # Raise custom exceptions - they're automatically formatted
    raise NotFoundError("Agent", agent_id)
    raise ValidationError("Invalid batch size", {"max": 100, "provided": 500})
    raise ServiceError("Weave API unavailable")
    
    # Or use the helper function
    from errors import api_error
    return api_error("NOT_FOUND", "Agent not found")
"""

from typing import Any, Dict, Optional
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse


# =============================================================================
# Error Codes
# =============================================================================

class ErrorCode:
    """Standard error codes for API responses."""
    # Client errors (4xx)
    BAD_REQUEST = "BAD_REQUEST"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    RATE_LIMITED = "RATE_LIMITED"
    
    # Server errors (5xx)
    INTERNAL_ERROR = "INTERNAL_ERROR"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
    EXTERNAL_API_ERROR = "EXTERNAL_API_ERROR"
    DATABASE_ERROR = "DATABASE_ERROR"
    TIMEOUT = "TIMEOUT"


# =============================================================================
# Custom Exceptions
# =============================================================================

class APIError(HTTPException):
    """
    Base class for all API errors.
    
    Provides a consistent interface for error handling.
    """
    status_code: int = 500
    error_code: str = ErrorCode.INTERNAL_ERROR
    
    def __init__(
        self,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        status_code: Optional[int] = None,
        error_code: Optional[str] = None
    ):
        self.message = message
        self.details = details or {}
        if status_code:
            self.status_code = status_code
        if error_code:
            self.error_code = error_code
        
        super().__init__(
            status_code=self.status_code,
            detail=self.to_dict()
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to standard error response format."""
        response = {
            "error": True,
            "code": self.error_code,
            "message": self.message,
        }
        if self.details:
            response["details"] = self.details
        return response


class NotFoundError(APIError):
    """Resource not found (404)."""
    status_code = 404
    error_code = ErrorCode.NOT_FOUND
    
    def __init__(
        self,
        resource_type: str,
        resource_id: Optional[str] = None,
        message: Optional[str] = None
    ):
        if message:
            msg = message
        elif resource_id:
            msg = f"{resource_type} not found: {resource_id}"
        else:
            msg = f"{resource_type} not found"
        
        super().__init__(
            message=msg,
            details={"resource_type": resource_type, "resource_id": resource_id}
        )


class ValidationError(APIError):
    """Validation error (400)."""
    status_code = 400
    error_code = ErrorCode.VALIDATION_ERROR
    
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message=message, details=details)


class ConflictError(APIError):
    """Conflict error (409)."""
    status_code = 409
    error_code = ErrorCode.CONFLICT
    
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message=message, details=details)


class ServiceError(APIError):
    """External service error (503)."""
    status_code = 503
    error_code = ErrorCode.SERVICE_UNAVAILABLE
    
    def __init__(self, message: str, service: Optional[str] = None):
        details = {"service": service} if service else None
        super().__init__(message=message, details=details)


class ExternalAPIError(APIError):
    """External API error (502)."""
    status_code = 502
    error_code = ErrorCode.EXTERNAL_API_ERROR
    
    def __init__(self, message: str, api_name: str, original_error: Optional[str] = None):
        super().__init__(
            message=message,
            details={"api": api_name, "original_error": original_error}
        )


class DatabaseError(APIError):
    """Database error (500)."""
    status_code = 500
    error_code = ErrorCode.DATABASE_ERROR
    
    def __init__(self, message: str = "Database operation failed"):
        super().__init__(message=message)


class RateLimitError(APIError):
    """Rate limit exceeded (429)."""
    status_code = 429
    error_code = ErrorCode.RATE_LIMITED
    
    def __init__(self, message: str = "Rate limit exceeded", retry_after: Optional[int] = None):
        details = {"retry_after_seconds": retry_after} if retry_after else None
        super().__init__(message=message, details=details)


# =============================================================================
# Helper Functions
# =============================================================================

def api_error(
    code: str,
    message: str,
    details: Optional[Dict[str, Any]] = None,
    status_code: int = 500
) -> Dict[str, Any]:
    """
    Create a standard error response dict.
    
    Use this when you need to return an error in a response body
    rather than raising an exception.
    
    Example:
        return api_error("NOT_FOUND", "Agent not found")
    """
    response = {
        "error": True,
        "code": code,
        "message": message,
    }
    if details:
        response["details"] = details
    return response


def api_success(
    data: Any = None,
    message: Optional[str] = None
) -> Dict[str, Any]:
    """
    Create a standard success response dict.
    
    Example:
        return api_success({"id": "123"}, "Agent created")
    """
    response = {"error": False}
    if data is not None:
        response["data"] = data
    if message:
        response["message"] = message
    return response


# =============================================================================
# Exception Handlers (for FastAPI app)
# =============================================================================

async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
    """
    Handle APIError exceptions and return standardized JSON response.
    
    Add to FastAPI app:
        from errors import APIError, api_error_handler
        app.add_exception_handler(APIError, api_error_handler)
    """
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_dict()
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Handle unexpected exceptions with a generic error response.
    
    Add to FastAPI app:
        from errors import generic_exception_handler
        app.add_exception_handler(Exception, generic_exception_handler)
    
    Note: Only use in production. In development, you may want to let
    exceptions propagate for better debugging.
    """
    return JSONResponse(
        status_code=500,
        content={
            "error": True,
            "code": ErrorCode.INTERNAL_ERROR,
            "message": "An unexpected error occurred",
            # Don't expose internal error details in production
            # "details": {"type": type(exc).__name__, "message": str(exc)}
        }
    )


# =============================================================================
# Common Error Messages
# =============================================================================

class ErrorMessages:
    """Reusable error messages for common scenarios."""
    
    # Configuration errors
    WEAVE_NOT_CONFIGURED = "Weave is not configured. Please set up your W&B API key and project in Settings."
    LLM_NOT_CONFIGURED = "LLM is not configured. Please set up your LLM API key in Settings."
    AGENT_NOT_RUNNING = "Agent is not running. Please start your agent and try again."
    
    # Resource errors
    BATCH_NOT_FOUND = "Batch not found"
    AGENT_NOT_FOUND = "Agent not found"
    QUERY_NOT_FOUND = "Query not found"
    
    # Validation errors
    INVALID_BATCH_SIZE = "Invalid batch size. Must be between 1 and 100."
    NO_QUERIES_PROVIDED = "No queries provided"
    NO_DIMENSIONS_FOUND = "No testing dimensions found. Add dimensions in the Taxonomy tab or use AI suggestions."
    
    # State errors
    BATCH_ALREADY_RUNNING = "Batch is already running"
    NO_PENDING_QUERIES = "No pending queries to execute"

