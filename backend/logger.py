"""
Centralized logging module for Weave Error Analysis.

Usage:
    from logger import get_logger, log_event
    
    logger = get_logger("settings")
    log_event(logger, "llm.config_resolved", model="gpt-4o", has_api_key=True)

Design:
    - Stable event names (e.g., "llm.request_start") for easy aggregation
    - Structured data in extra fields, not embedded JSON
    - Automatic secret masking
    - Uvicorn-compatible handler setup
"""

import logging
import os
from typing import Any, Dict

# Patterns that indicate sensitive values to mask
SECRET_PATTERNS = {'key', 'token', 'secret', 'bearer', 'auth', 'password', 'credential'}

# Opt-in for logging LLM prompt/response content (privacy risk in production)
LOG_LLM_CONTENT = os.getenv("LOG_LLM_CONTENT", "false").lower() == "true"

# Track if logging has been set up
_logging_configured = False


class StructuredFormatter(logging.Formatter):
    """
    Formatter that includes extra fields in a readable format.
    
    Output format:
        2025-12-08 14:32:01 | INFO    | weave.settings | llm.config_resolved | model=gpt-4o has_api_key=True
    """
    
    def format(self, record: logging.LogRecord) -> str:
        # Start with base format
        base = super().format(record)
        
        # Extract extra fields (exclude standard LogRecord attributes)
        standard_attrs = {
            'name', 'msg', 'args', 'created', 'filename', 'funcName',
            'levelname', 'levelno', 'lineno', 'module', 'msecs',
            'pathname', 'process', 'processName', 'relativeCreated',
            'stack_info', 'exc_info', 'exc_text', 'thread', 'threadName',
            'taskName', 'message'
        }
        
        extra_fields = {
            k: v for k, v in record.__dict__.items() 
            if k not in standard_attrs and not k.startswith('_')
        }
        
        if extra_fields:
            # Format extra fields as key=value pairs
            extra_str = ' '.join(f"{k}={v}" for k, v in extra_fields.items())
            return f"{base} | {extra_str}"
        
        return base


def setup_logging() -> None:
    """
    Configure logging explicitly (uvicorn-safe).
    
    Call this once at application startup (in main.py).
    """
    global _logging_configured
    
    if _logging_configured:
        return
    
    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    
    # Create handler with structured formatter
    handler = logging.StreamHandler()
    handler.setFormatter(StructuredFormatter(
        '%(asctime)s | %(levelname)-7s | %(name)s | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    ))
    
    # Configure root logger for our namespace
    root = logging.getLogger("weave")
    root.setLevel(getattr(logging, log_level, logging.INFO))
    root.addHandler(handler)
    root.propagate = False  # Don't duplicate to uvicorn's handler
    
    _logging_configured = True
    
    # Log that we're set up
    root.info("Logging initialized", extra={"level": log_level})


def get_logger(name: str) -> logging.Logger:
    """
    Get a namespaced logger.
    
    Args:
        name: Logger name (will be prefixed with "weave.")
        
    Returns:
        Configured logger instance
    """
    return logging.getLogger(f"weave.{name}")


def mask_secrets(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Mask values for keys that look like secrets.
    
    Keys containing 'key', 'token', 'secret', 'bearer', 'auth', 
    'password', or 'credential' will have their values replaced with '***'.
    """
    result = {}
    for k, v in data.items():
        if any(pattern in k.lower() for pattern in SECRET_PATTERNS):
            result[k] = "***"
        elif isinstance(v, dict):
            result[k] = mask_secrets(v)
        else:
            result[k] = v
    return result


def log_event(
    logger: logging.Logger, 
    event: str, 
    level: str = "info",
    **kwargs
) -> None:
    """
    Log a structured event with masked secrets.
    
    This is the primary logging function. Use stable event names
    and pass all context as keyword arguments.
    
    Args:
        logger: Logger instance from get_logger()
        event: Stable event name (e.g., "llm.request_complete")
        level: Log level ("debug", "info", "warning", "error")
        **kwargs: Context data (will be masked for secrets)
    
    Examples:
        log_event(logger, "llm.config_resolved", model="gpt-4o", has_api_key=True)
        log_event(logger, "batch.execution_failed", level="error", error="timeout")
    """
    safe_data = mask_secrets(kwargs)
    log_fn = getattr(logger, level.lower(), logger.info)
    log_fn(event, extra=safe_data)


def generate_correlation_id() -> str:
    """
    Generate a short correlation ID for tracing related operations.
    
    Returns:
        12-character alphanumeric ID
    """
    import uuid
    return uuid.uuid4().hex[:12]

