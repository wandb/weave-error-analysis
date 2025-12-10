"""
Weave API client for interacting with the Weave Trace API.
"""

import base64
import json
import httpx

from config import WANDB_API_KEY, WEAVE_API_BASE, PROJECT_ID
from utils import truncate_dict, truncate_value


class WeaveClient:
    """Client for Weave Trace API operations."""

    def __init__(self):
        self.base_url = WEAVE_API_BASE
        self.project_id = PROJECT_ID

    def _get_auth_header(self) -> dict:
        """Get HTTP Basic auth header for Weave API."""
        if not WANDB_API_KEY:
            return {}
        auth = base64.b64encode(f"api:{WANDB_API_KEY}".encode()).decode()
        return {
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/json"
        }

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
        """Query calls from Weave API."""
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

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/calls/stream_query",
                headers=self._get_auth_header(),
                json=request_body,
                timeout=60.0
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
        """Read a single call by ID."""
        request_body = {
            "project_id": self.project_id,
            "id": call_id
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/call/read",
                headers=self._get_auth_header(),
                json=request_body,
                timeout=30.0
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
        """Query feedback from Weave API."""
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

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/feedback/query",
                headers=self._get_auth_header(),
                json=request_body,
                timeout=30.0
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
            print(f"Error fetching feedback: {e}")
            return []

    async def create_feedback(
        self,
        call_id: str,
        feedback_type: str,
        payload: dict
    ) -> dict:
        """Create feedback for a call."""
        weave_ref = f"weave:///{self.project_id}/call/{call_id}"

        request_body = {
            "project_id": self.project_id,
            "weave_ref": weave_ref,
            "feedback_type": feedback_type,
            "payload": payload
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/feedback/create",
                headers=self._get_auth_header(),
                json=request_body,
                timeout=30.0
            )

            if response.status_code != 200:
                raise Exception(f"API error: {response.status_code} - {response.text}")

            return response.json()


# Singleton instance
weave_client = WeaveClient()

