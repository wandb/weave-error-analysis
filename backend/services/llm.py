"""
LLM Client Abstraction

Centralizes all LLM calls with consistent:
- Configuration (model, api key, etc.)
- Structured outputs via Pydantic
- Async execution
- Logging and error handling

Usage:
    from services.llm import llm_client
    
    # Simple text completion
    response = await llm_client.complete(
        messages=[{"role": "user", "content": "Hello!"}]
    )
    
    # Structured output with Pydantic
    class Analysis(BaseModel):
        has_issue: bool
        reason: str
    
    result = await llm_client.complete(
        messages=[...],
        response_model=Analysis
    )
    # result is an Analysis instance
"""

import asyncio
from typing import Any, Dict, List, Optional, Type, TypeVar, Union, overload

import litellm
from pydantic import BaseModel

from logger import get_logger, log_event, LOG_LLM_CONTENT

logger = get_logger("llm")

# Generic type for Pydantic models
T = TypeVar("T", bound=BaseModel)


class LLMClient:
    """
    Unified LLM client that wraps litellm with consistent patterns.
    
    Features:
    - Lazy configuration loading (respects runtime settings)
    - Pydantic structured outputs
    - Async-first with sync wrapper
    - Consistent logging
    - Temperature defaults
    """
    
    DEFAULT_TEMPERATURE = 0.3
    DEFAULT_MODEL = "gpt-4o-mini"
    
    def __init__(
        self,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        api_key: Optional[str] = None,
        api_base: Optional[str] = None,
    ):
        """
        Initialize with optional overrides.
        
        Args:
            model: Model to use (overrides settings if provided)
            temperature: Default temperature for completions
            api_key: API key override
            api_base: API base URL override
        """
        self._model_override = model
        self._temperature = temperature if temperature is not None else self.DEFAULT_TEMPERATURE
        self._api_key = api_key
        self._api_base = api_base
    
    def _get_kwargs(self) -> Dict[str, Any]:
        """
        Get kwargs for litellm call, respecting settings hierarchy.
        
        Priority:
        1. Instance overrides (set in __init__)
        2. Database settings (user-configured via UI)
        3. Environment variables
        4. Defaults
        """
        # Start with settings-based config
        try:
            from services.settings import get_litellm_kwargs
            kwargs = get_litellm_kwargs()
        except ImportError:
            kwargs = {"model": self.DEFAULT_MODEL}
        
        # Apply instance overrides
        if self._model_override:
            kwargs["model"] = self._model_override
        if self._api_key:
            kwargs["api_key"] = self._api_key
        if self._api_base:
            kwargs["api_base"] = self._api_base
        
        # Ensure we always have a model
        if "model" not in kwargs:
            kwargs["model"] = self.DEFAULT_MODEL
        
        return kwargs
    
    @property
    def model(self) -> str:
        """Get the current model name."""
        return self._get_kwargs().get("model", self.DEFAULT_MODEL)
    
    # -------------------------------------------------------------------------
    # Core Completion Methods
    # -------------------------------------------------------------------------
    
    @overload
    async def complete(
        self,
        messages: List[Dict[str, str]],
        *,
        response_model: None = None,
        temperature: Optional[float] = None,
        json_mode: bool = False,
        **kwargs: Any
    ) -> str:
        """Text completion - returns raw string."""
        ...
    
    @overload
    async def complete(
        self,
        messages: List[Dict[str, str]],
        *,
        response_model: Type[T],
        temperature: Optional[float] = None,
        json_mode: bool = False,
        **kwargs: Any
    ) -> T:
        """Structured completion - returns Pydantic model instance."""
        ...
    
    async def complete(
        self,
        messages: List[Dict[str, str]],
        *,
        response_model: Optional[Type[T]] = None,
        temperature: Optional[float] = None,
        json_mode: bool = False,
        **kwargs: Any
    ) -> Union[str, T]:
        """
        Make an async LLM completion call.
        
        Args:
            messages: List of message dicts with 'role' and 'content'
            response_model: Optional Pydantic model for structured output
            temperature: Override default temperature
            json_mode: If True (and no response_model), request JSON output
            **kwargs: Additional kwargs passed to litellm
        
        Returns:
            - If response_model: Validated Pydantic model instance
            - Otherwise: Raw response string
        
        Example:
            # Simple text
            text = await client.complete([{"role": "user", "content": "Hi"}])
            
            # Structured output
            class Result(BaseModel):
                answer: str
                confidence: float
            
            result = await client.complete(
                messages=[...],
                response_model=Result
            )
        """
        llm_kwargs = self._get_kwargs()
        temp = temperature if temperature is not None else self._temperature
        
        # Build request kwargs
        request_kwargs = {
            **llm_kwargs,
            "messages": messages,
            "temperature": temp,
            **kwargs
        }
        
        # Handle structured output
        if response_model is not None:
            request_kwargs["response_format"] = response_model
        elif json_mode:
            request_kwargs["response_format"] = {"type": "json_object"}
        
        # Log request
        log_event(logger, "llm.request_start",
            model=request_kwargs.get("model"),
            message_count=len(messages),
            has_response_model=response_model is not None,
            response_model_name=response_model.__name__ if response_model else None,
            temperature=temp
        )
        
        if LOG_LLM_CONTENT:
            log_event(logger, "llm.request_messages", level="debug",
                messages=messages
            )
        
        try:
            # Use acompletion for native async
            response = await litellm.acompletion(**request_kwargs)
            content = response.choices[0].message.content
            
            # Log response
            log_event(logger, "llm.request_complete",
                model=request_kwargs.get("model"),
                actual_model=getattr(response, "model", "unknown"),
                response_length=len(content) if content else 0,
                has_response_model=response_model is not None
            )
            
            if LOG_LLM_CONTENT:
                log_event(logger, "llm.response_content", level="debug",
                    content_preview=content[:500] if content else None
                )
            
            # Parse structured output if model provided
            if response_model is not None:
                return response_model.model_validate_json(content)
            
            return content
            
        except Exception as e:
            log_event(logger, "llm.request_error", level="error",
                model=request_kwargs.get("model"),
                error=str(e),
                error_type=type(e).__name__
            )
            raise
    
    def complete_sync(
        self,
        messages: List[Dict[str, str]],
        *,
        response_model: Optional[Type[T]] = None,
        temperature: Optional[float] = None,
        json_mode: bool = False,
        **kwargs: Any
    ) -> Union[str, T]:
        """
        Synchronous wrapper for complete().
        
        Use this when you need to call from sync code.
        Internally runs the async method in a thread.
        """
        return asyncio.run(
            self.complete(
                messages=messages,
                response_model=response_model,
                temperature=temperature,
                json_mode=json_mode,
                **kwargs
            )
        )
    
    # -------------------------------------------------------------------------
    # Convenience Methods
    # -------------------------------------------------------------------------
    
    async def analyze(
        self,
        system_prompt: str,
        user_prompt: str,
        response_model: Type[T],
        temperature: Optional[float] = None,
    ) -> T:
        """
        Common pattern: system + user prompt with structured output.
        
        Args:
            system_prompt: System message content
            user_prompt: User message content
            response_model: Pydantic model for output
            temperature: Optional temperature override
        
        Returns:
            Parsed Pydantic model instance
        """
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        return await self.complete(
            messages=messages,
            response_model=response_model,
            temperature=temperature
        )
    
    async def generate(
        self,
        prompt: str,
        temperature: Optional[float] = None,
        json_mode: bool = False,
    ) -> str:
        """
        Simple single-prompt generation.
        
        Args:
            prompt: The prompt text
            temperature: Optional temperature override
            json_mode: Request JSON output
        
        Returns:
            Generated text
        """
        return await self.complete(
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            json_mode=json_mode
        )
    
    async def test_connection(self) -> Dict[str, Any]:
        """
        Test that the LLM connection works.
        
        Returns:
            Dict with success status, model info, and any error
        """
        try:
            response = await self.complete(
                messages=[{"role": "user", "content": "Say 'hello' and nothing else."}],
                temperature=0.0
            )
            return {
                "success": True,
                "model": self.model,
                "response": response.strip().lower(),
                "message": "LLM connection successful"
            }
        except Exception as e:
            return {
                "success": False,
                "model": self.model,
                "error": str(e),
                "message": "LLM connection failed"
            }
    
    # -------------------------------------------------------------------------
    # Factory Methods
    # -------------------------------------------------------------------------
    
    @classmethod
    def with_model(cls, model: str, **kwargs) -> "LLMClient":
        """Create a client with a specific model."""
        return cls(model=model, **kwargs)
    
    @classmethod
    def for_analysis(cls) -> "LLMClient":
        """Create a client optimized for analysis tasks (lower temperature)."""
        return cls(temperature=0.3)
    
    @classmethod
    def for_generation(cls) -> "LLMClient":
        """Create a client optimized for creative generation (higher temperature)."""
        return cls(temperature=0.7)


# Default singleton instance
llm_client = LLMClient()

