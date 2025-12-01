"""
Conversation processing logic for extracting messages from thread calls.
"""

from utils import truncate_value

MAX_CONTENT_LEN = 2000


def process_thread_calls(calls: list) -> list:
    """
    Process calls into a conversation format with user/assistant/tool messages.

    IMPORTANT: Only extracts turn-level interactions to avoid duplicating
    the full conversation history that accumulates in each LLM call.

    Strategy:
    1. Prioritize invocation/agent calls - these represent individual turns
    2. For LLM calls - only extract the LAST user message + OUTPUT
    3. For tool calls - show the tool execution
    4. Deduplicate messages by content to avoid duplicates from multiple LLM calls
    """
    conversation = []
    seen_user_messages = set()
    seen_assistant_messages = set()

    for call in calls:
        op_name = call.get("op_name", "")
        inputs = call.get("inputs", {})
        output = call.get("output")
        call_id = call.get("id")
        started_at = call.get("started_at")
        op_lower = op_name.lower()

        # Priority 1: Invocation / Agent calls - these are turn boundaries
        if "invoke" in op_lower or "invocation" in op_lower or "agent" in op_lower:
            _process_invocation_call(
                inputs, output, call_id, started_at,
                conversation, seen_user_messages, seen_assistant_messages
            )

        # Priority 2: Tool calls - show tool execution
        elif "execute_tool" in op_lower or ("tool" in op_lower and "execute" in op_lower):
            _process_tool_call(
                inputs, output, call_id, started_at, op_name, conversation
            )

        # Priority 3: LLM calls - extract LAST user message from contents + output
        elif "llm" in op_lower or "call_llm" in op_lower or "chat" in op_lower:
            _process_llm_call(
                inputs, output, call_id, started_at,
                conversation, seen_user_messages, seen_assistant_messages
            )

    return conversation


def _truncate(text: str) -> str:
    """Truncate text to max content length."""
    if not text:
        return ""
    if len(text) > MAX_CONTENT_LEN:
        return text[:MAX_CONTENT_LEN] + "..."
    return text


def _extract_text_from_parts(parts: list) -> str:
    """Extract text from a parts array."""
    texts = []
    if not isinstance(parts, list):
        return ""
    for part in parts[:10]:
        if isinstance(part, dict) and "text" in part:
            texts.append(str(part["text"]))
        elif isinstance(part, str):
            texts.append(part)
    return " ".join(texts)


def _content_key(text: str) -> str:
    """Generate a key for deduplication (first 200 chars)."""
    return text[:200].strip().lower() if text else ""


def _process_invocation_call(
    inputs: dict,
    output,
    call_id: str,
    started_at: str,
    conversation: list,
    seen_user_messages: set,
    seen_assistant_messages: set
):
    """Process an invocation/agent call to extract user message and response."""
    # Extract user's NEW message for this turn (not the full history)
    new_message = inputs.get("new_message", {})
    if isinstance(new_message, dict):
        parts = new_message.get("parts", [])
        user_text = _extract_text_from_parts(parts)
        if user_text:
            key = _content_key(user_text)
            if key not in seen_user_messages:
                seen_user_messages.add(key)
                conversation.append({
                    "type": "user",
                    "content": _truncate(user_text),
                    "call_id": call_id,
                    "timestamp": started_at
                })

    # Extract the final response for this turn
    if output:
        output_text = _extract_output_text(output)
        if output_text:
            key = _content_key(output_text)
            if key not in seen_assistant_messages:
                seen_assistant_messages.add(key)
                conversation.append({
                    "type": "assistant",
                    "content": _truncate(output_text),
                    "call_id": call_id,
                    "timestamp": started_at
                })


def _extract_output_text(output) -> str:
    """Extract text from various output formats."""
    if isinstance(output, list):
        # ADK returns list of events, get the last text response
        for item in reversed(output):
            if isinstance(item, dict):
                content = item.get("content", {})
                if isinstance(content, dict):
                    parts = content.get("parts", [])
                    text = _extract_text_from_parts(parts)
                    if text:
                        return text
    elif isinstance(output, dict):
        parts = output.get("parts", [])
        output_text = _extract_text_from_parts(parts)
        if not output_text:
            output_text = output.get("text", "") or output.get("content", "")
        return output_text
    elif isinstance(output, str):
        return output
    return ""


def _process_tool_call(
    inputs: dict,
    output,
    call_id: str,
    started_at: str,
    op_name: str,
    conversation: list
):
    """Process a tool execution call."""
    tool_name = inputs.get("tool_name", op_name.split("/")[-1] if "/" in op_name else op_name)
    tool_input = inputs.get("args", inputs.get("input", {}))

    # Truncate tool data for display
    truncated_input = truncate_value(tool_input, 500)
    truncated_output = truncate_value(output, 500)

    conversation.append({
        "type": "tool_call",
        "tool_name": tool_name,
        "tool_input": truncated_input,
        "tool_output": truncated_output,
        "call_id": call_id,
        "timestamp": started_at
    })


def _process_llm_call(
    inputs: dict,
    output,
    call_id: str,
    started_at: str,
    conversation: list,
    seen_user_messages: set,
    seen_assistant_messages: set
):
    """Process an LLM call to extract the last user message and response."""
    # ADK format: gcp.vertex.agent.llm_request
    llm_request = inputs.get("gcp.vertex.agent.llm_request", {})
    contents = llm_request.get("contents", [])

    # Get ONLY the last user message (the new input for this turn)
    if contents:
        for content_item in reversed(contents):
            if isinstance(content_item, dict) and content_item.get("role") == "user":
                parts = content_item.get("parts", [])
                user_text = _extract_text_from_parts(parts)
                if user_text:
                    key = _content_key(user_text)
                    if key not in seen_user_messages:
                        seen_user_messages.add(key)
                        conversation.append({
                            "type": "user",
                            "content": _truncate(user_text),
                            "call_id": call_id,
                            "timestamp": started_at
                        })
                    break  # Only get the LAST user message

    # Also check OpenAI format messages
    messages = inputs.get("messages", [])
    if messages and not contents:
        for msg in reversed(messages):
            if isinstance(msg, dict) and msg.get("role") == "user":
                content = msg.get("content", "")
                if content:
                    key = _content_key(content)
                    if key not in seen_user_messages:
                        seen_user_messages.add(key)
                        conversation.append({
                            "type": "user",
                            "content": _truncate(content),
                            "call_id": call_id,
                            "timestamp": started_at
                        })
                    break  # Only get the LAST user message

    # Extract the OUTPUT (the new response generated)
    if output:
        output_text = _extract_llm_output_text(output)
        if output_text:
            key = _content_key(output_text)
            if key not in seen_assistant_messages:
                seen_assistant_messages.add(key)
                conversation.append({
                    "type": "assistant",
                    "content": _truncate(output_text),
                    "call_id": call_id,
                    "timestamp": started_at
                })


def _extract_llm_output_text(output) -> str:
    """Extract text from LLM output formats."""
    if isinstance(output, dict):
        # Check for text field (ADK format)
        output_text = output.get("text", "")
        if not output_text:
            output_text = output.get("content", "")
        # OpenAI format
        if not output_text:
            choices = output.get("choices", [])
            if choices:
                msg = choices[0].get("message", {})
                output_text = msg.get("content", "")
        return output_text
    elif isinstance(output, str):
        return output
    return ""

