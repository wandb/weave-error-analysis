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
    1. Group calls by their trace_id (each trace = one turn/invocation)
    2. For each trace, find the conversation data from the relevant calls
    3. Deduplicate messages by content
    """
    conversation = []
    seen_user_messages = set()
    seen_assistant_messages = set()
    seen_tool_calls = set()

    # Group calls by trace_id - each trace represents one "turn" or invocation
    traces = {}  # trace_id -> list of calls
    for call in calls:
        trace_id = call.get("trace_id", call.get("id"))
        if trace_id not in traces:
            traces[trace_id] = []
        traces[trace_id].append(call)
    
    # Process each trace as a unit
    for trace_id, trace_calls in traces.items():
        # Sort by started_at to process in order
        trace_calls.sort(key=lambda c: c.get("started_at", ""))
        
        # Find the root call (parent_id is None)
        root_call = None
        for call in trace_calls:
            if call.get("parent_id") is None:
                root_call = call
                break
        
        # Process the trace to extract conversation
        _process_trace(
            trace_calls, root_call, conversation,
            seen_user_messages, seen_assistant_messages, seen_tool_calls
        )

    return conversation


def _process_trace(
    trace_calls: list,
    root_call: dict,
    conversation: list,
    seen_user_messages: set,
    seen_assistant_messages: set,
    seen_tool_calls: set
):
    """Process a single trace (one invocation/turn) to extract conversation."""
    
    # Try to get user message and response from root call first
    if root_call:
        op_name = root_call.get("op_name", "").lower()
        if "invoke" in op_name or "invocation" in op_name or "agent" in op_name:
            inputs = root_call.get("inputs", {})
            output = root_call.get("output")
            call_id = root_call.get("id")
            started_at = root_call.get("started_at")
            
            _process_invocation_call(
                inputs, output, call_id, started_at,
                conversation, seen_user_messages, seen_assistant_messages
            )
    
    # Process ALL calls in the trace to find user messages, assistant responses, and tool calls
    for call in trace_calls:
        op_name = call.get("op_name", "").lower()
        inputs = call.get("inputs", {})
        output = call.get("output")
        call_id = call.get("id")
        started_at = call.get("started_at")
        
        # Process LLM calls for user messages AND responses
        if "llm" in op_name or "call_llm" in op_name or "chat" in op_name:
            _process_llm_call(
                inputs, output, call_id, started_at,
                conversation, seen_user_messages, seen_assistant_messages
            )
        
        # Process tool calls - be more flexible with detection
        elif ("execute_tool" in op_name or 
              ("tool" in op_name and "execute" in op_name) or
              "tool_call" in op_name or
              op_name.startswith("tools.") or
              "_tool_" in op_name):
            # Deduplicate tool calls by their name + input
            tool_name = inputs.get("tool_name", op_name.split("/")[-1] if "/" in op_name else op_name)
            tool_key = f"{tool_name}:{str(inputs.get('args', ''))[:100]}"
            
            if tool_key not in seen_tool_calls:
                seen_tool_calls.add(tool_key)
                _process_tool_call(
                    inputs, output, call_id, started_at, op_name, conversation
                )
        
        # For any call with output that looks like assistant text, try to extract it
        elif output and call.get("parent_id") is None:
            # This is a root call - try to get assistant response from output
            output_text = _extract_llm_output_text(output)
            if output_text and len(output_text) > 10:  # Only meaningful responses
                key = _content_key(output_text)
                if key not in seen_assistant_messages:
                    seen_assistant_messages.add(key)
                    conversation.append({
                        "type": "assistant",
                        "content": _truncate(output_text),
                        "call_id": call_id,
                        "timestamp": started_at
                    })


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
        # ADK/Vertex Agent format: gcp.vertex.agent.llm_response.content.parts
        llm_response = output.get("gcp.vertex.agent.llm_response", {})
        if llm_response:
            content = llm_response.get("content", {})
            if isinstance(content, dict):
                parts = content.get("parts", [])
                output_text = _extract_text_from_parts(parts)
                if output_text:
                    return output_text
        
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
        # Check for nested parts format
        if not output_text:
            parts = output.get("parts", [])
            output_text = _extract_text_from_parts(parts)
        # Check for candidates array (Gemini format)
        if not output_text:
            candidates = output.get("candidates", [])
            if candidates:
                content = candidates[0].get("content", {})
                parts = content.get("parts", [])
                output_text = _extract_text_from_parts(parts)
        return output_text
    elif isinstance(output, str):
        return output
    elif isinstance(output, list):
        # Handle list of responses
        texts = []
        for item in output:
            if isinstance(item, dict):
                # Check ADK format first
                llm_response = item.get("gcp.vertex.agent.llm_response", {})
                if llm_response:
                    content = llm_response.get("content", {})
                    if isinstance(content, dict):
                        parts = content.get("parts", [])
                        text = _extract_text_from_parts(parts)
                        if text:
                            texts.append(text)
                            continue
                
                text = item.get("text", "") or item.get("content", "")
                if not text:
                    # Check for nested content
                    content = item.get("content", {})
                    if isinstance(content, dict):
                        parts = content.get("parts", [])
                        text = _extract_text_from_parts(parts)
                if text:
                    texts.append(text)
            elif isinstance(item, str):
                texts.append(item)
        return " ".join(texts) if texts else ""
    return ""

