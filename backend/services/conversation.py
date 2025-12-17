"""
Conversation Extraction from Weave Traces

This module provides framework-agnostic conversation extraction using pluggable
extractors. Each extractor handles a specific framework's trace format (ADK, OpenAI,
Anthropic, LangChain, etc.).

Architecture:
    CONVERSATION_EXTRACTORS = {
        "google_adk": GoogleADKExtractor,
        "openai": OpenAIExtractor,
        "anthropic": AnthropicExtractor,
        ...
    }

    def extract_conversation(calls, framework=None):
        extractor = CONVERSATION_EXTRACTORS.get(framework, GenericExtractor)
        return extractor.extract(calls)

Framework is auto-detected from call signatures when not specified.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Set, Type
from utils import truncate_value

MAX_CONTENT_LEN = 2000


# =============================================================================
# Data Types
# =============================================================================

@dataclass
class Message:
    """A single message in a conversation."""
    type: str  # "user", "assistant", "tool_call", "system"
    content: str
    call_id: Optional[str] = None
    timestamp: Optional[str] = None
    
    # For tool calls
    tool_name: Optional[str] = None
    tool_input: Optional[Any] = None
    tool_output: Optional[Any] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dict for API responses."""
        d = {
            "type": self.type,
            "content": self.content,
            "call_id": self.call_id,
            "timestamp": self.timestamp,
        }
        if self.type == "tool_call":
            d["tool_name"] = self.tool_name
            d["tool_input"] = self.tool_input
            d["tool_output"] = self.tool_output
        return d


# =============================================================================
# Base Extractor
# =============================================================================

class ConversationExtractor(ABC):
    """
    Base class for conversation extractors.
    
    Each extractor knows how to parse a specific framework's trace format
    into a normalized conversation.
    """
    
    # Override in subclasses with identifying patterns
    FRAMEWORK_PATTERNS: List[str] = []
    
    @classmethod
    def matches(cls, calls: List[dict]) -> bool:
        """
        Check if this extractor can handle the given calls.
        
        Override in subclasses to provide framework detection.
        """
        if not cls.FRAMEWORK_PATTERNS:
            return False
        
        # Check if any call matches the framework patterns
        for call in calls[:10]:  # Only check first 10 calls
            op_name = call.get("op_name", "").lower()
            inputs = call.get("inputs", {})
            output = call.get("output", {})
            
            for pattern in cls.FRAMEWORK_PATTERNS:
                if pattern in op_name:
                    return True
                if pattern in str(inputs.keys()):
                    return True
                if isinstance(output, dict) and pattern in str(output.keys()):
                    return True
        
        return False
    
    @abstractmethod
    def extract(self, calls: List[dict]) -> List[Message]:
        """
        Extract conversation messages from calls.
        
        Args:
            calls: List of Weave call dicts
            
        Returns:
            List of Message objects in chronological order
        """
        pass
    
    # =========================================================================
    # Shared Utilities
    # =========================================================================
    
    @staticmethod
    def _truncate(text: str, max_len: int = MAX_CONTENT_LEN) -> str:
        """Truncate text to max length."""
        if not text:
            return ""
        if len(text) > max_len:
            return text[:max_len] + "..."
        return text
    
    @staticmethod
    def _content_key(text: str) -> str:
        """Generate a key for deduplication (first 200 chars, lowercased)."""
        return text[:200].strip().lower() if text else ""
    
    @staticmethod
    def _extract_text_from_parts(parts: list) -> str:
        """Extract text from a parts array (Gemini/ADK format)."""
        if not isinstance(parts, list):
            return ""
        texts = []
        for part in parts[:10]:
            if isinstance(part, dict) and "text" in part:
                texts.append(str(part["text"]))
            elif isinstance(part, str):
                texts.append(part)
        return " ".join(texts)
    
    @staticmethod
    def _group_calls_by_trace(calls: List[dict]) -> Dict[str, List[dict]]:
        """Group calls by trace_id for turn-by-turn processing."""
        traces: Dict[str, List[dict]] = {}
        for call in calls:
            trace_id = call.get("trace_id", call.get("id"))
            if trace_id not in traces:
                traces[trace_id] = []
            traces[trace_id].append(call)
        
        # Sort each trace by started_at
        for trace_calls in traces.values():
            trace_calls.sort(key=lambda c: c.get("started_at", ""))
        
        return traces


# =============================================================================
# Google ADK Extractor
# =============================================================================

class GoogleADKExtractor(ConversationExtractor):
    """
    Extractor for Google Agent Development Kit (ADK) traces.
    
    ADK uses Vertex AI's format with:
    - gcp.vertex.agent.llm_request/llm_response keys
    - contents array with role-based messages
    - parts array for message content
    """
    
    FRAMEWORK_PATTERNS = [
        "gcp.vertex.agent",
        "adk",
        "vertex_ai",
    ]
    
    def extract(self, calls: List[dict]) -> List[Message]:
        messages: List[Message] = []
        seen_user: Set[str] = set()
        seen_assistant: Set[str] = set()
        seen_tools: Set[str] = set()
        
        traces = self._group_calls_by_trace(calls)
        
        for trace_id, trace_calls in traces.items():
            self._process_trace(
                trace_calls, messages, seen_user, seen_assistant, seen_tools
            )
        
        return messages
    
    def _process_trace(
        self,
        trace_calls: List[dict],
        messages: List[Message],
        seen_user: Set[str],
        seen_assistant: Set[str],
        seen_tools: Set[str]
    ):
        """Process a single trace to extract messages."""
        for call in trace_calls:
            op_name = call.get("op_name", "").lower()
            inputs = call.get("inputs", {})
            output = call.get("output")
            call_id = call.get("id")
            started_at = call.get("started_at")
            
            # Handle invocation/agent calls (root calls)
            if call.get("parent_id") is None:
                self._process_invocation(
                    inputs, output, call_id, started_at,
                    messages, seen_user, seen_assistant
                )
            
            # Handle LLM calls
            if "llm" in op_name or "call_llm" in op_name:
                self._process_llm_call(
                    inputs, output, call_id, started_at,
                    messages, seen_user, seen_assistant
                )
            
            # Handle tool calls
            elif self._is_tool_call(op_name):
                tool_key = self._get_tool_key(inputs, op_name)
                if tool_key not in seen_tools:
                    seen_tools.add(tool_key)
                    self._process_tool_call(
                        inputs, output, call_id, started_at, op_name, messages
                    )
    
    def _process_invocation(
        self,
        inputs: dict,
        output: Any,
        call_id: str,
        started_at: str,
        messages: List[Message],
        seen_user: Set[str],
        seen_assistant: Set[str]
    ):
        """Extract user message and response from invocation call."""
        # ADK: new_message contains the user's input for this turn
        new_message = inputs.get("new_message", {})
        if isinstance(new_message, dict):
            parts = new_message.get("parts", [])
            user_text = self._extract_text_from_parts(parts)
            if user_text:
                key = self._content_key(user_text)
                if key not in seen_user:
                    seen_user.add(key)
                    messages.append(Message(
                        type="user",
                        content=self._truncate(user_text),
                        call_id=call_id,
                        timestamp=started_at
                    ))
        
        # Extract response
        if output:
            output_text = self._extract_output_text(output)
            if output_text:
                key = self._content_key(output_text)
                if key not in seen_assistant:
                    seen_assistant.add(key)
                    messages.append(Message(
                        type="assistant",
                        content=self._truncate(output_text),
                        call_id=call_id,
                        timestamp=started_at
                    ))
    
    def _process_llm_call(
        self,
        inputs: dict,
        output: Any,
        call_id: str,
        started_at: str,
        messages: List[Message],
        seen_user: Set[str],
        seen_assistant: Set[str]
    ):
        """Extract messages from LLM call."""
        # ADK format: gcp.vertex.agent.llm_request.contents
        llm_request = inputs.get("gcp.vertex.agent.llm_request", {})
        contents = llm_request.get("contents", [])
        
        # Get the last user message (the new input for this turn)
        if contents:
            for content_item in reversed(contents):
                if isinstance(content_item, dict) and content_item.get("role") == "user":
                    parts = content_item.get("parts", [])
                    user_text = self._extract_text_from_parts(parts)
                    if user_text:
                        key = self._content_key(user_text)
                        if key not in seen_user:
                            seen_user.add(key)
                            messages.append(Message(
                                type="user",
                                content=self._truncate(user_text),
                                call_id=call_id,
                                timestamp=started_at
                            ))
                            break
        
        # Extract output
        if output:
            output_text = self._extract_llm_output_text(output)
            if output_text:
                key = self._content_key(output_text)
                if key not in seen_assistant:
                    seen_assistant.add(key)
                    messages.append(Message(
                        type="assistant",
                        content=self._truncate(output_text),
                        call_id=call_id,
                        timestamp=started_at
                    ))
    
    def _extract_output_text(self, output: Any) -> str:
        """Extract text from ADK output formats."""
        if isinstance(output, list):
            # ADK returns list of events
            for item in reversed(output):
                if isinstance(item, dict):
                    content = item.get("content", {})
                    if isinstance(content, dict):
                        parts = content.get("parts", [])
                        text = self._extract_text_from_parts(parts)
                        if text:
                            return text
        elif isinstance(output, dict):
            parts = output.get("parts", [])
            text = self._extract_text_from_parts(parts)
            if text:
                return text
            return output.get("text", "") or output.get("content", "")
        elif isinstance(output, str):
            return output
        return ""
    
    def _extract_llm_output_text(self, output: Any) -> str:
        """Extract text from LLM output (ADK/Vertex format)."""
        if isinstance(output, dict):
            # ADK format: gcp.vertex.agent.llm_response.content.parts
            llm_response = output.get("gcp.vertex.agent.llm_response", {})
            if llm_response:
                content = llm_response.get("content", {})
                if isinstance(content, dict):
                    parts = content.get("parts", [])
                    text = self._extract_text_from_parts(parts)
                    if text:
                        return text
            
            # Fallback to direct text/content
            text = output.get("text", "") or output.get("content", "")
            if text:
                return text
            
            # Check for nested parts
            parts = output.get("parts", [])
            text = self._extract_text_from_parts(parts)
            if text:
                return text
            
            # Gemini candidates format
            candidates = output.get("candidates", [])
            if candidates:
                content = candidates[0].get("content", {})
                parts = content.get("parts", [])
                return self._extract_text_from_parts(parts)
        
        elif isinstance(output, str):
            return output
        
        elif isinstance(output, list):
            texts = []
            for item in output:
                if isinstance(item, dict):
                    llm_response = item.get("gcp.vertex.agent.llm_response", {})
                    if llm_response:
                        content = llm_response.get("content", {})
                        if isinstance(content, dict):
                            parts = content.get("parts", [])
                            text = self._extract_text_from_parts(parts)
                            if text:
                                texts.append(text)
                                continue
                    
                    text = item.get("text", "") or item.get("content", "")
                    if not text:
                        content = item.get("content", {})
                        if isinstance(content, dict):
                            parts = content.get("parts", [])
                            text = self._extract_text_from_parts(parts)
                    if text:
                        texts.append(text)
                elif isinstance(item, str):
                    texts.append(item)
            return " ".join(texts) if texts else ""
        
        return ""
    
    @staticmethod
    def _is_tool_call(op_name: str) -> bool:
        """Check if op_name indicates a tool call."""
        return (
            "execute_tool" in op_name or
            ("tool" in op_name and "execute" in op_name) or
            "tool_call" in op_name or
            op_name.startswith("tools.") or
            "_tool_" in op_name
        )
    
    @staticmethod
    def _get_tool_key(inputs: dict, op_name: str) -> str:
        """Get deduplication key for tool call."""
        tool_name = inputs.get("tool_name", op_name.split("/")[-1] if "/" in op_name else op_name)
        return f"{tool_name}:{str(inputs.get('args', ''))[:100]}"
    
    def _process_tool_call(
        self,
        inputs: dict,
        output: Any,
        call_id: str,
        started_at: str,
        op_name: str,
        messages: List[Message]
    ):
        """Process a tool execution call."""
        tool_name = inputs.get("tool_name", op_name.split("/")[-1] if "/" in op_name else op_name)
        tool_input = inputs.get("args", inputs.get("input", {}))
        
        messages.append(Message(
            type="tool_call",
            content="",
            tool_name=tool_name,
            tool_input=truncate_value(tool_input, 500),
            tool_output=truncate_value(output, 500),
            call_id=call_id,
            timestamp=started_at
        ))


# =============================================================================
# OpenAI Extractor
# =============================================================================

class OpenAIExtractor(ConversationExtractor):
    """
    Extractor for OpenAI-format traces.
    
    Handles:
    - messages array with role/content format
    - choices[0].message.content responses
    - Function/tool calls in assistant messages
    """
    
    FRAMEWORK_PATTERNS = [
        "openai",
        "chatcompletion",
        "chat.completions",
    ]
    
    def extract(self, calls: List[dict]) -> List[Message]:
        messages: List[Message] = []
        seen_user: Set[str] = set()
        seen_assistant: Set[str] = set()
        seen_tools: Set[str] = set()
        
        traces = self._group_calls_by_trace(calls)
        
        for trace_id, trace_calls in traces.items():
            for call in trace_calls:
                op_name = call.get("op_name", "").lower()
                inputs = call.get("inputs", {})
                output = call.get("output")
                call_id = call.get("id")
                started_at = call.get("started_at")
                
                # Handle chat completion calls
                input_messages = inputs.get("messages", [])
                if input_messages:
                    # Get the last user message
                    for msg in reversed(input_messages):
                        if isinstance(msg, dict) and msg.get("role") == "user":
                            content = msg.get("content", "")
                            if content:
                                key = self._content_key(content)
                                if key not in seen_user:
                                    seen_user.add(key)
                                    messages.append(Message(
                                        type="user",
                                        content=self._truncate(content),
                                        call_id=call_id,
                                        timestamp=started_at
                                    ))
                                    break
                
                # Extract response
                if output:
                    output_text = self._extract_openai_output(output)
                    if output_text:
                        key = self._content_key(output_text)
                        if key not in seen_assistant:
                            seen_assistant.add(key)
                            messages.append(Message(
                                type="assistant",
                                content=self._truncate(output_text),
                                call_id=call_id,
                                timestamp=started_at
                            ))
                    
                    # Check for tool calls in response
                    tool_calls = self._extract_tool_calls(output)
                    for tool_call in tool_calls:
                        tool_key = f"{tool_call['name']}:{str(tool_call['arguments'])[:100]}"
                        if tool_key not in seen_tools:
                            seen_tools.add(tool_key)
                            messages.append(Message(
                                type="tool_call",
                                content="",
                                tool_name=tool_call["name"],
                                tool_input=tool_call["arguments"],
                                call_id=call_id,
                                timestamp=started_at
                            ))
        
        return messages
    
    def _extract_openai_output(self, output: Any) -> str:
        """Extract text from OpenAI response format."""
        if isinstance(output, dict):
            # Standard format: choices[0].message.content
            choices = output.get("choices", [])
            if choices:
                msg = choices[0].get("message", {})
                return msg.get("content", "") or ""
            
            # Direct content
            return output.get("content", "") or output.get("text", "")
        
        elif isinstance(output, str):
            return output
        
        return ""
    
    def _extract_tool_calls(self, output: Any) -> List[Dict[str, Any]]:
        """Extract tool calls from OpenAI response."""
        tool_calls = []
        
        if isinstance(output, dict):
            choices = output.get("choices", [])
            if choices:
                msg = choices[0].get("message", {})
                for tc in msg.get("tool_calls", []):
                    if isinstance(tc, dict):
                        func = tc.get("function", {})
                        tool_calls.append({
                            "name": func.get("name", "unknown"),
                            "arguments": func.get("arguments", "")
                        })
        
        return tool_calls


# =============================================================================
# Anthropic Extractor
# =============================================================================

class AnthropicExtractor(ConversationExtractor):
    """
    Extractor for Anthropic Claude traces.
    
    Handles:
    - messages array with role/content format
    - content array with text blocks
    - Tool use blocks
    """
    
    FRAMEWORK_PATTERNS = [
        "anthropic",
        "claude",
        "messages.create",
    ]
    
    def extract(self, calls: List[dict]) -> List[Message]:
        messages: List[Message] = []
        seen_user: Set[str] = set()
        seen_assistant: Set[str] = set()
        seen_tools: Set[str] = set()
        
        traces = self._group_calls_by_trace(calls)
        
        for trace_id, trace_calls in traces.items():
            for call in trace_calls:
                inputs = call.get("inputs", {})
                output = call.get("output")
                call_id = call.get("id")
                started_at = call.get("started_at")
                
                # Get user messages
                input_messages = inputs.get("messages", [])
                if input_messages:
                    for msg in reversed(input_messages):
                        if isinstance(msg, dict) and msg.get("role") == "user":
                            content = self._extract_anthropic_content(msg.get("content"))
                            if content:
                                key = self._content_key(content)
                                if key not in seen_user:
                                    seen_user.add(key)
                                    messages.append(Message(
                                        type="user",
                                        content=self._truncate(content),
                                        call_id=call_id,
                                        timestamp=started_at
                                    ))
                                    break
                
                # Extract response
                if output:
                    output_text, tool_uses = self._extract_anthropic_output(output)
                    
                    if output_text:
                        key = self._content_key(output_text)
                        if key not in seen_assistant:
                            seen_assistant.add(key)
                            messages.append(Message(
                                type="assistant",
                                content=self._truncate(output_text),
                                call_id=call_id,
                                timestamp=started_at
                            ))
                    
                    for tool_use in tool_uses:
                        tool_key = f"{tool_use['name']}:{str(tool_use['input'])[:100]}"
                        if tool_key not in seen_tools:
                            seen_tools.add(tool_key)
                            messages.append(Message(
                                type="tool_call",
                                content="",
                                tool_name=tool_use["name"],
                                tool_input=tool_use["input"],
                                call_id=call_id,
                                timestamp=started_at
                            ))
        
        return messages
    
    def _extract_anthropic_content(self, content: Any) -> str:
        """Extract text from Anthropic content format."""
        if isinstance(content, str):
            return content
        
        if isinstance(content, list):
            texts = []
            for block in content:
                if isinstance(block, dict):
                    if block.get("type") == "text":
                        texts.append(block.get("text", ""))
                    elif "text" in block:
                        texts.append(block.get("text", ""))
                elif isinstance(block, str):
                    texts.append(block)
            return " ".join(texts)
        
        return ""
    
    def _extract_anthropic_output(self, output: Any) -> tuple:
        """Extract text and tool uses from Anthropic response."""
        texts = []
        tool_uses = []
        
        if isinstance(output, dict):
            content = output.get("content", [])
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        if block.get("type") == "text":
                            texts.append(block.get("text", ""))
                        elif block.get("type") == "tool_use":
                            tool_uses.append({
                                "name": block.get("name", "unknown"),
                                "input": block.get("input", {})
                            })
            elif isinstance(content, str):
                texts.append(content)
        
        return " ".join(texts), tool_uses


# =============================================================================
# Generic Extractor (Fallback)
# =============================================================================

class GenericExtractor(ConversationExtractor):
    """
    Generic fallback extractor for unknown frameworks.
    
    Uses heuristics to find user messages and assistant responses
    in common formats.
    """
    
    FRAMEWORK_PATTERNS = []  # Matches nothing - used as fallback
    
    def extract(self, calls: List[dict]) -> List[Message]:
        messages: List[Message] = []
        seen_user: Set[str] = set()
        seen_assistant: Set[str] = set()
        
        traces = self._group_calls_by_trace(calls)
        
        for trace_id, trace_calls in traces.items():
            for call in trace_calls:
                inputs = call.get("inputs", {})
                output = call.get("output")
                call_id = call.get("id")
                started_at = call.get("started_at")
                
                # Try to find user input
                user_text = self._find_user_text(inputs)
                if user_text:
                    key = self._content_key(user_text)
                    if key not in seen_user:
                        seen_user.add(key)
                        messages.append(Message(
                            type="user",
                            content=self._truncate(user_text),
                            call_id=call_id,
                            timestamp=started_at
                        ))
                
                # Try to find assistant output (only for root calls)
                if call.get("parent_id") is None and output:
                    output_text = self._find_output_text(output)
                    if output_text and len(output_text) > 10:
                        key = self._content_key(output_text)
                        if key not in seen_assistant:
                            seen_assistant.add(key)
                            messages.append(Message(
                                type="assistant",
                                content=self._truncate(output_text),
                                call_id=call_id,
                                timestamp=started_at
                            ))
        
        return messages
    
    def _find_user_text(self, inputs: dict) -> str:
        """Try to find user text in inputs using heuristics."""
        # Common input field names
        for key in ["query", "message", "input", "prompt", "text", "question", "user_input"]:
            if key in inputs:
                val = inputs[key]
                if isinstance(val, str):
                    return val
                if isinstance(val, dict) and "content" in val:
                    return val["content"]
        
        # Check for messages array
        messages = inputs.get("messages", [])
        if messages:
            for msg in reversed(messages):
                if isinstance(msg, dict) and msg.get("role") == "user":
                    content = msg.get("content", "")
                    if isinstance(content, str):
                        return content
        
        return ""
    
    def _find_output_text(self, output: Any) -> str:
        """Try to find output text using heuristics."""
        if isinstance(output, str):
            return output
        
        if isinstance(output, dict):
            # Common output field names
            for key in ["response", "answer", "text", "content", "message", "output"]:
                if key in output:
                    val = output[key]
                    if isinstance(val, str):
                        return val
            
            # Check for choices array (OpenAI-like)
            choices = output.get("choices", [])
            if choices:
                msg = choices[0].get("message", {})
                return msg.get("content", "")
        
        return ""


# =============================================================================
# Extractor Registry & Factory
# =============================================================================

# Registry of available extractors, in order of specificity
CONVERSATION_EXTRACTORS: Dict[str, Type[ConversationExtractor]] = {
    "google_adk": GoogleADKExtractor,
    "openai": OpenAIExtractor,
    "anthropic": AnthropicExtractor,
    "generic": GenericExtractor,
}


def detect_framework(calls: List[dict]) -> str:
    """
    Auto-detect the framework from call signatures.
    
    Returns:
        Framework name (e.g., "google_adk", "openai") or "generic" if unknown.
    """
    for name, extractor_class in CONVERSATION_EXTRACTORS.items():
        if name == "generic":
            continue
        if extractor_class.matches(calls):
            return name
    
    return "generic"


def extract_conversation(
    calls: List[dict],
    framework: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Extract conversation messages from Weave calls.
    
    Args:
        calls: List of Weave call dicts
        framework: Optional framework hint. If not provided, auto-detected.
        
    Returns:
        List of message dicts with type, content, call_id, timestamp, etc.
    """
    if not calls:
        return []
    
    # Detect framework if not specified
    if framework is None:
        framework = detect_framework(calls)
    
    # Get extractor
    extractor_class = CONVERSATION_EXTRACTORS.get(framework, GenericExtractor)
    extractor = extractor_class()
    
    # Extract messages
    messages = extractor.extract(calls)
    
    # Convert to dicts for API response
    return [msg.to_dict() for msg in messages]


# =============================================================================
# Backwards Compatibility
# =============================================================================

def process_thread_calls(calls: list) -> list:
    """
    DEPRECATED: Use extract_conversation() instead.
    
    This function is maintained for backwards compatibility.
    """
    return extract_conversation(calls)
