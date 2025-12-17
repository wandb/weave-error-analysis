"""
Weave API client for interacting with the Weave Trace API.

This client fetches traces from the user's TARGET project (their agent's traces),
NOT from the tool's internal project. The target project is configured by the
user via Settings UI or environment variables.

Connection Pooling:
- Uses a shared httpx.AsyncClient for all requests to Weave API
- Connections are kept alive and reused across requests
- Client lifecycle is managed via init/close methods
"""

import base64
import json
from typing import Optional
import httpx

from config import get_weave_api_base, get_wandb_api_key, get_target_project_id
from logger import get_logger
from utils import truncate_dict, truncate_value

logger = get_logger("weave_client")

# Connection pool limits for httpx client
POOL_LIMITS = httpx.Limits(
    max_keepalive_connections=10,
    max_connections=20,
    keepalive_expiry=30.0  # seconds
)

# Default timeout configuration
DEFAULT_TIMEOUT = httpx.Timeout(
    timeout=60.0,  # Total timeout
    connect=10.0,  # Connection timeout
    read=60.0,     # Read timeout (can be long for streaming)
    write=10.0     # Write timeout
)


class WeaveClient:
    """
    Client for Weave Trace API operations.
    
    Fetches data from the user's TARGET project (their agent traces).
    Project ID and base URL are resolved dynamically from settings on each call.
    
    Uses connection pooling for efficient HTTP communication.
    
    Lifecycle:
        # At app startup
        await weave_client.init()
        
        # At app shutdown
        await weave_client.close()
    """
    
    def __init__(self):
        self._client: Optional[httpx.AsyncClient] = None
    
    async def init(self) -> None:
        """
        Initialize the HTTP client with connection pooling.
        
        Call this at application startup (e.g., in FastAPI lifespan).
        """
        if self._client is None:
            self._client = httpx.AsyncClient(
                limits=POOL_LIMITS,
                timeout=DEFAULT_TIMEOUT
            )
            logger.info("WeaveClient HTTP client initialized with connection pooling")
    
    async def close(self) -> None:
        """
        Close the HTTP client and release connections.
        
        Call this at application shutdown.
        """
        if self._client is not None:
            await self._client.aclose()
            self._client = None
            logger.info("WeaveClient HTTP client closed")
    
    async def _get_client(self) -> httpx.AsyncClient:
        """
        Get the HTTP client, initializing if necessary.
        
        This allows lazy initialization for cases where init() wasn't called.
        """
        if self._client is None:
            await self.init()
        return self._client

    @property
    def base_url(self) -> str:
        """Get the Weave API base URL dynamically from settings."""
        return get_weave_api_base()

    @property
    def project_id(self) -> str:
        """
        Get the TARGET project ID dynamically from settings.
        
        This allows the project to be changed via Settings UI without restart.
        """
        return get_target_project_id()

    def _get_auth_header(self) -> dict:
        """Get HTTP Basic auth header for Weave API."""
        api_key = get_wandb_api_key()
        if not api_key:
            return {}
        auth = base64.b64encode(f"api:{api_key}".encode()).decode()
        return {
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/json"
        }
    
    def _check_configured(self) -> None:
        """
        Check if the target project is configured.
        
        Raises:
            ValueError: If target project is not configured
        """
        if not self.project_id:
            raise ValueError(
                "Weave target project not configured. "
                "Please configure 'weave_entity' and 'weave_project' in Settings "
                "to point to the Weave project where your agent logs traces."
            )

    async def query_calls(
        self,
        limit: int = 50,
        offset: int = 0,
        op_names: list[str] | None = None,
        thread_ids: list[str] | None = None,
        parent_ids: list[str] | None = None,
        sort_field: str = "started_at",
        sort_direction: str = "desc"
    ) -> list[dict]:
        """Query calls from the user's TARGET Weave project."""
        self._check_configured()
        
        request_body = {
            "project_id": self.project_id,
            "limit": limit,
            "offset": offset,
            "sort_by": [{"field": sort_field, "direction": sort_direction}]
        }

        filter_obj = {}
        if op_names:
            filter_obj["op_names"] = op_names
        if thread_ids:
            filter_obj["thread_ids"] = thread_ids
        if parent_ids:
            filter_obj["parent_ids"] = parent_ids

        if filter_obj:
            request_body["filter"] = filter_obj

        client = await self._get_client()
        response = await client.post(
            f"{self.base_url}/calls/stream_query",
            headers=self._get_auth_header(),
            json=request_body
        )

        if response.status_code != 200:
            raise Exception(f"API error: {response.status_code} - {response.text}")

        calls = []
        for line in response.text.strip().split("\n"):
            if line:
                call = json.loads(line)
                calls.append(call)

        return calls

    async def read_call(self, call_id: str) -> dict | None:
        """Read a single call by ID from the user's TARGET Weave project."""
        self._check_configured()
        
        request_body = {
            "project_id": self.project_id,
            "id": call_id
        }

        client = await self._get_client()
        response = await client.post(
            f"{self.base_url}/call/read",
            headers=self._get_auth_header(),
            json=request_body
        )

        if response.status_code != 200:
            raise Exception(f"API error: {response.status_code} - {response.text}")

        data = response.json()
        return data.get("call")

    async def get_child_calls(self, parent_id: str, limit: int = 50) -> list[dict]:
        """Get child calls for a parent call."""
        try:
            calls = await self.query_calls(
                limit=limit,
                parent_ids=[parent_id]
            )

            return [
                {
                    "id": call.get("id"),
                    "op_name": call.get("op_name"),
                    "started_at": call.get("started_at"),
                    "ended_at": call.get("ended_at"),
                    "inputs_preview": truncate_dict(call.get("inputs", {})),
                    "output_preview": truncate_value(call.get("output"))
                }
                for call in calls
            ]
        except Exception:
            return []

    async def query_feedback(
        self,
        weave_ref: str | None = None,
        limit: int = 500
    ) -> list[dict]:
        """Query feedback from the user's TARGET Weave project."""
        self._check_configured()
        
        request_body = {
            "project_id": self.project_id,
            "limit": limit
        }

        if weave_ref:
            request_body["query"] = {
                "$expr": {
                    "$eq": [
                        {"$getField": "weave_ref"},
                        {"$literal": weave_ref}
                    ]
                }
            }

        client = await self._get_client()
        response = await client.post(
            f"{self.base_url}/feedback/query",
            headers=self._get_auth_header(),
            json=request_body
        )

        if response.status_code != 200:
            return []

        data = response.json()
        return data.get("result", [])

    async def get_feedback_for_call(self, call_id: str) -> list[dict]:
        """Get feedback for a specific call."""
        try:
            weave_ref = f"weave:///{self.project_id}/call/{call_id}"
            feedback_list = await self.query_feedback(weave_ref=weave_ref)

            return [
                {
                    "id": fb.get("id"),
                    "type": fb.get("feedback_type"),
                    "payload": fb.get("payload"),
                    "created_at": fb.get("created_at")
                }
                for fb in feedback_list
            ]
        except Exception as e:
            logger.warning(f"Error fetching feedback: {e}")
            return []

    async def create_feedback(
        self,
        call_id: str,
        feedback_type: str,
        payload: dict
    ) -> dict:
        """Create feedback for a call in the user's TARGET Weave project."""
        self._check_configured()
        
        weave_ref = f"weave:///{self.project_id}/call/{call_id}"

        request_body = {
            "project_id": self.project_id,
            "weave_ref": weave_ref,
            "feedback_type": feedback_type,
            "payload": payload
        }

        client = await self._get_client()
        response = await client.post(
            f"{self.base_url}/feedback/create",
            headers=self._get_auth_header(),
            json=request_body
        )

        if response.status_code != 200:
            raise Exception(f"API error: {response.status_code} - {response.text}")

        return response.json()


# Singleton instance
weave_client = WeaveClient()

