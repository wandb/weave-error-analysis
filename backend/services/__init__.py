"""Services package for Weave API interactions and data processing."""

from .weave_client import weave_client, WeaveClient
from .trace_discovery import trace_discovery_service, TraceDiscoveryService
from .dataset_publisher import publish_batch_dataset, get_batch_dataset_ref

__all__ = [
    # Weave Client (Python SDK wrapper)
    "weave_client",
    "WeaveClient",
    # Trace Discovery (links batch queries to Weave traces via query_id attribute)
    "trace_discovery_service",
    "TraceDiscoveryService",
    # Dataset Publishing (publishes batches as Weave Datasets)
    "publish_batch_dataset",
    "get_batch_dataset_ref",
]

