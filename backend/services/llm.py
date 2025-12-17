"""
LLM Client Abstraction

Centralizes all LLM calls with consistent:
- Configuration (model, api key, etc.)
- Structured outputs via Pydantic
- Async execution with rate limiting
- Logging and error handling

Rate Limiting:
    The client uses a semaphore to limit concurrent LLM calls and avoid hitting
    rate limits. Default is 10 concurrent requests, configurable via settings.

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
import random
from typing import Any, Dict, List, Optional, Type, TypeVar, Union, overload, TYPE_CHECKING

import litellm
from pydantic import BaseModel

from logger import get_logger, log_event, LOG_LLM_CONTENT

# Default max concurrent LLM requests (configurable via settings)
DEFAULT_MAX_CONCURRENT_LLM = 10

# Retry configuration for rate limit errors
MAX_RETRIES = 3
INITIAL_RETRY_DELAY = 1.0  # seconds
MAX_RETRY_DELAY = 30.0  # seconds

if TYPE_CHECKING:
    from prompts.base import PromptConfig

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
    - Rate limiting via semaphore (configurable max concurrent requests)
    - Exponential backoff retry for rate limit errors
    - Consistent logging
    - Temperature defaults
    
    Configuration Priority:
    1. Instance overrides (set in __init__)
    2. Database settings (via get_litellm_kwargs from Settings UI)
    3. Environment variables (handled by settings module)
    4. DEFAULT_MODEL constant (bootstrap fallback when DB unavailable)
    
    The single source of truth for the default model is the Settings database.
    DEFAULT_MODEL is only used during bootstrap before DB is initialized.
    """
    
    DEFAULT_TEMPERATURE = 0.3
    # Bootstrap fallback - only used when settings module unavailable.
    # The actual default is in settings.py DEFAULT_SETTINGS["llm_model"]
    # Using gpt-5-mini: modern model with good cost/performance for tool operations
    DEFAULT_MODEL = "gpt-5-mini"
    
    # Class-level semaphore for rate limiting (shared across instances)
    _semaphore: Optional[asyncio.Semaphore] = None
    _semaphore_limit: int = DEFAULT_MAX_CONCURRENT_LLM
    
    def __init__(
        self,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        api_key: Optional[str] = None,
        api_base: Optional[str] = None,
        max_concurrent: Optional[int] = None,
    ):
        """
        Initialize with optional overrides.
        
        Args:
            model: Model to use (overrides settings if provided)
            temperature: Default temperature for completions
            api_key: API key override
            api_base: API base URL override
            max_concurrent: Override max concurrent requests (rate limiting)
        """
        self._model_override = model
        self._temperature = temperature if temperature is not None else self.DEFAULT_TEMPERATURE
        self._api_key = api_key
        self._api_base = api_base
        self._max_concurrent_override = max_concurrent
    
    @classmethod
    def _get_max_concurrent(cls) -> int:
        """Get max concurrent LLM requests from settings."""
        try:
            from services.settings import get_setting
            value = get_setting("llm_max_concurrent")
            if value:
                return int(value)
        except Exception:
            pass
        return DEFAULT_MAX_CONCURRENT_LLM
    
    @classmethod
    def _get_semaphore(cls) -> asyncio.Semaphore:
        """
        Get or create the rate limiting semaphore.
        
        The semaphore limits concurrent LLM API calls to avoid hitting rate limits.
        """
        desired_limit = cls._get_max_concurrent()
        
        # Create or recreate semaphore if limit changed
        if cls._semaphore is None or cls._semaphore_limit != desired_limit:
            cls._semaphore = asyncio.Semaphore(desired_limit)
            cls._semaphore_limit = desired_limit
            log_event(logger, "llm.semaphore_created", level="debug",
                max_concurrent=desired_limit
            )
        
        return cls._semaphore
    
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
        max_retries: int = MAX_RETRIES,
        **kwargs: Any
    ) -> Union[str, T]:
        """
        Make an async LLM completion call with rate limiting and retry logic.
        
        Args:
            messages: List of message dicts with 'role' and 'content'
            response_model: Optional Pydantic model for structured output
            temperature: Override default temperature
            json_mode: If True (and no response_model), request JSON output
            max_retries: Maximum retries for rate limit errors (default: 3)
            **kwargs: Additional kwargs passed to litellm
        
        Returns:
            - If response_model: Validated Pydantic model instance
            - Otherwise: Raw response string
        
        Rate Limiting:
            Uses a semaphore to limit concurrent requests. If the limit is reached,
            requests will wait for a slot to become available.
        
        Retry Logic:
            For rate limit errors (429), uses exponential backoff with jitter.
        
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
        
        # Get semaphore for rate limiting
        semaphore = self._get_semaphore()
        
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
        
        last_error: Optional[Exception] = None
        
        for attempt in range(max_retries + 1):
            try:
                # Acquire semaphore slot (rate limiting)
                async with semaphore:
                    # Log if we had to wait
                    if attempt > 0:
                        log_event(logger, "llm.retry_attempt",
                            attempt=attempt + 1,
                            max_retries=max_retries,
                            model=request_kwargs.get("model")
                        )
                    
                    # Use acompletion for native async
                    response = await litellm.acompletion(**request_kwargs)
                    content = response.choices[0].message.content
                    
                    # Log response
                    log_event(logger, "llm.request_complete",
                        model=request_kwargs.get("model"),
                        actual_model=getattr(response, "model", "unknown"),
                        response_length=len(content) if content else 0,
                        has_response_model=response_model is not None,
                        attempt=attempt + 1
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
                last_error = e
                error_str = str(e).lower()
                
                # Check if this is a rate limit error
                is_rate_limit = (
                    "rate" in error_str and "limit" in error_str
                ) or "429" in error_str or "too many requests" in error_str
                
                if is_rate_limit and attempt < max_retries:
                    # Exponential backoff with jitter
                    delay = min(
                        INITIAL_RETRY_DELAY * (2 ** attempt) + random.uniform(0, 1),
                        MAX_RETRY_DELAY
                    )
                    log_event(logger, "llm.rate_limited", level="warning",
                        model=request_kwargs.get("model"),
                        attempt=attempt + 1,
                        retry_delay=delay,
                        error=str(e)
                    )
                    await asyncio.sleep(delay)
                else:
                    # Non-retryable error or max retries exceeded
                    log_event(logger, "llm.request_error", level="error",
                        model=request_kwargs.get("model"),
                        error=str(e),
                        error_type=type(e).__name__,
                        attempt=attempt + 1,
                        is_rate_limit=is_rate_limit
                    )
                    raise
        
        # Should not reach here, but just in case
        if last_error:
            raise last_error
        raise RuntimeError("Unexpected error in LLM completion")
    
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
    
    @classmethod
    def for_prompt(cls, prompt: "PromptConfig") -> "LLMClient":
        """
        Create an LLM client configured for a specific prompt.
        
        Uses the prompt's LLM settings if specified, otherwise falls back to
        global settings. This enables per-prompt model and temperature control.
        
        Args:
            prompt: The PromptConfig to use for configuration
        
        Returns:
            An LLMClient instance with appropriate settings
        
        Example:
            from prompts import prompt_manager
            
            prompt = prompt_manager.get_prompt("trace_analysis")
            client = LLMClient.for_prompt(prompt)
            result = await client.complete(messages=[...])
        """
        return cls(
            model=prompt.llm_model,  # None means use global
            temperature=prompt.llm_temperature if prompt.llm_temperature is not None else cls.DEFAULT_TEMPERATURE,
        )


# Default singleton instance
llm_client = LLMClient()

