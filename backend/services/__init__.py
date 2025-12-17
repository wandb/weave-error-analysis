"""Services package for Weave API interactions and data processing."""

from .weave_client import WeaveClient
from .conversation import process_thread_calls, extract_conversation, detect_framework

__all__ = [
    "WeaveClient",
    "process_thread_calls",  # Deprecated - use extract_conversation
    "extract_conversation",
    "detect_framework",
]

