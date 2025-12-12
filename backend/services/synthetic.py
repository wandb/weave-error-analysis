"""
Synthetic Data Generation Service

Generates realistic test queries based on AGENT_INFO testing dimensions.
Uses a two-step process:
1. Generate dimension tuples (combinations of persona, scenario, complexity, etc.) using LLM
2. Convert tuples to natural language queries using LLM
"""

import json
import uuid
import asyncio
from typing import List, Dict, Any, Optional, AsyncGenerator
from datetime import datetime
from pydantic import BaseModel

from services.agent_info import AgentInfo, TestingDimension
from services.llm import LLMClient
from logger import get_logger, log_event, LOG_LLM_CONTENT
from prompts import prompt_manager

logger = get_logger("synthetic")


class DimensionTuple(BaseModel):
    """A combination of dimension values."""
    id: str
    values: Dict[str, str]  # e.g., {"persona": "frustrated_customer", "scenario": "refund_request"}
    created_at: str


class SyntheticQuery(BaseModel):
    """A generated synthetic query."""
    id: str
    tuple_id: str
    dimension_values: Dict[str, str]
    query_text: str
    batch_id: Optional[str] = None
    created_at: str


class SyntheticBatch(BaseModel):
    """A batch of synthetic queries."""
    id: str
    agent_id: str
    name: str
    query_count: int
    status: str  # 'pending', 'generating', 'ready', 'running', 'completed'
    created_at: str
    queries: List[SyntheticQuery] = []


class SyntheticGenerator:
    """
    Generates synthetic test queries based on AGENT_INFO dimensions using LLM.
    
    The generation process:
    1. Extract testing dimensions from AGENT_INFO
    2. Generate dimension tuples using LLM (creates realistic combinations)
    3. Convert tuples to natural language queries using LLM
    """
    
    def __init__(self, agent_info: AgentInfo, llm_client: Optional[LLMClient] = None):
        """
        Initialize the generator.
        
        Args:
            agent_info: Parsed AGENT_INFO containing testing dimensions
            llm_client: LLM client for query generation (uses default if not provided)
        """
        self.agent_info = agent_info
        self.dimensions = agent_info.testing_dimensions
        # Default LLM client (fallback, but prefer prompt-specific clients)
        self._default_llm = llm_client or LLMClient()
    
    def get_dimension_values(self) -> Dict[str, List[str]]:
        """Get all dimension names and their possible values."""
        result = {}
        for dim in self.dimensions:
            result[dim.name] = dim.values
        return result
    
    async def generate_tuples_llm_guided(
        self, 
        n: int = 20,
        focus_areas: Optional[List[str]] = None
    ) -> List[DimensionTuple]:
        """
        Generate tuples using LLM to create realistic combinations.
        
        The LLM considers which combinations make sense together and generates
        diverse, realistic test case scenarios.
        
        When use_dimensions is False, the LLM generates tuples freely without
        being constrained to predefined dimension values.
        
        Args:
            n: Number of tuples to generate
            focus_areas: Optional areas to focus on (e.g., ["edge cases", "adversarial"])
        
        Returns:
            List of DimensionTuple objects
        """
        use_dimensions = getattr(self, '_use_dimensions', True)
        dim_values = self.get_dimension_values()
        
        focus_instruction = ""
        if focus_areas:
            focus_instruction = f"\nFocus on these areas: {', '.join(focus_areas)}"
        
        # Use custom prompt if provided, otherwise use default
        custom_prompt = getattr(self, '_custom_tuple_prompt', None)
        
        # Determine prompt mode for logging
        prompt_mode = "free_generation" if not use_dimensions else ("custom_prompt" if custom_prompt else "dimensions_guided")
        
        if not use_dimensions:
            # Free generation mode - LLM decides the dimensions and values
            prompt_config = prompt_manager.get_prompt("tuple_generation_free")
            variables = {
                "agent_name": self.agent_info.name,
                "agent_purpose": self.agent_info.purpose or "AI assistant",
                "count": str(n),
                "focus_instruction": focus_instruction,
            }
            prompt = prompt_config.user_prompt_template.format(**variables)
        elif custom_prompt:
            # Replace placeholders in custom prompt
            prompt = custom_prompt.replace("{agent_name}", self.agent_info.name)
            prompt = prompt.replace("{agent_purpose}", self.agent_info.purpose or "AI assistant")
            prompt = prompt.replace("{dimensions}", json.dumps(dim_values, indent=2))
            prompt = prompt.replace("{count}", str(n))
            prompt = prompt.replace("{focus_instruction}", focus_instruction)
        else:
            prompt_config = prompt_manager.get_prompt("tuple_generation")
            variables = {
                "agent_name": self.agent_info.name,
                "agent_purpose": self.agent_info.purpose or "AI assistant",
                "count": str(n),
                "dimensions": json.dumps(dim_values, indent=2),
                "focus_instruction": focus_instruction,
            }
            prompt = prompt_config.user_prompt_template.format(**variables)

        # Log the tuple generation request
        log_event(logger, "llm.tuple_generation_start",
            operation="generate_tuples_llm_guided",
            mode=prompt_mode,
            use_dimensions=use_dimensions,
            has_custom_prompt=custom_prompt is not None,
            dimension_count=len(dim_values) if use_dimensions else 0,
            dimension_names=list(dim_values.keys()) if use_dimensions and dim_values else [],
            requested_count=n,
            agent_name=self.agent_info.name,
            agent_purpose=self.agent_info.purpose or "AI assistant"
        )
        
        # Log the full prompt if LOG_LLM_CONTENT is enabled
        if LOG_LLM_CONTENT:
            log_event(logger, "llm.tuple_generation_prompt", level="debug",
                prompt=prompt,
                dimensions=dim_values if use_dimensions else None
            )

        # Create LLM client with prompt-specific configuration
        llm = LLMClient.for_prompt(prompt_config)
        
        # Use the LLM client for JSON mode completion
        content = await llm.generate(
            prompt=prompt,
            json_mode=True
        )
        
        # Log response received
        log_event(logger, "llm.tuple_generation_response",
            operation="generate_tuples_llm_guided",
            mode=prompt_mode,
            response_length=len(content) if content else 0
        )
        
        # Parse the response - handle both direct array and wrapped object
        data = json.loads(content)
        
        # Extract tuples from response
        tuples_data = []
        if isinstance(data, list):
            tuples_data = data
        elif isinstance(data, dict):
            # Find the array in the dict (could be "tuples", "test_cases", etc.)
            for key, value in data.items():
                if isinstance(value, list):
                    tuples_data = value
                    break
        
        tuples = []
        now = datetime.utcnow().isoformat() + "Z"
        
        for combo in tuples_data:
            if isinstance(combo, dict):
                # Flatten any nested values to strings (LLM sometimes returns nested dicts)
                flat_values = {}
                for k, v in combo.items():
                    if isinstance(v, str):
                        flat_values[k] = v
                    elif isinstance(v, dict):
                        # For nested dicts, use the first string value or JSON stringify
                        str_vals = [sv for sv in v.values() if isinstance(sv, str)]
                        flat_values[k] = str_vals[0] if str_vals else json.dumps(v)
                    else:
                        flat_values[k] = str(v)
                
                tuples.append(DimensionTuple(
                    id=f"tuple_{uuid.uuid4().hex[:12]}",
                    values=flat_values,
                    created_at=now
                ))
        
        # Log successful tuple generation
        log_event(logger, "llm.tuple_generation_complete",
            operation="generate_tuples_llm_guided",
            mode=prompt_mode,
            tuples_generated=len(tuples),
            requested_count=n,
            sample_tuple=tuples[0].values if tuples else None
        )
        
        return tuples
    
    async def tuple_to_query(self, dimension_tuple: DimensionTuple) -> str:
        """
        Convert a dimension tuple to a natural language query.
        
        Uses LLM to generate a realistic user message that matches
        the characteristics defined by the tuple.
        
        Args:
            dimension_tuple: The tuple to convert
        
        Returns:
            Natural language query string
        """
        # Get dimension descriptions if available
        dim_descriptions = {}
        for dim in self.dimensions:
            if dim.descriptions:
                dim_descriptions[dim.name] = dim.descriptions
        
        # Build context about each dimension value
        value_context = []
        for dim_name, dim_value in dimension_tuple.values.items():
            desc = ""
            if dim_name in dim_descriptions and dim_value in dim_descriptions[dim_name]:
                desc = f" - {dim_descriptions[dim_name][dim_value]}"
            value_context.append(f"- {dim_name}: {dim_value}{desc}")
        
        # Use custom prompt if provided, otherwise use default
        custom_prompt = getattr(self, '_custom_query_prompt', None)
        agent_purpose = self.agent_info.purpose or "AI assistant"
        agent_capabilities = ', '.join(self.agent_info.capabilities[:5]) if self.agent_info.capabilities else "General assistance"
        
        # Get the prompt config for query generation
        prompt_config = prompt_manager.get_prompt("query_generation")
        
        if custom_prompt:
            # Replace placeholders in custom prompt
            prompt = custom_prompt.replace("{agent_name}", self.agent_info.name)
            prompt = prompt.replace("{agent_purpose}", agent_purpose)
            prompt = prompt.replace("{agent_capabilities}", agent_capabilities)
            prompt = prompt.replace("{dimension_values}", chr(10).join(value_context))
        else:
            variables = {
                "agent_name": self.agent_info.name,
                "agent_purpose": agent_purpose,
                "agent_capabilities": agent_capabilities,
                "dimension_values": chr(10).join(value_context),
            }
            prompt = prompt_config.user_prompt_template.format(**variables)

        # Create LLM client with prompt-specific configuration
        llm = LLMClient.for_prompt(prompt_config)
        
        log_event(logger, "llm.request_start",
            operation="query_generation",
            model=llm.model,
            tuple_id=dimension_tuple.id,
            dimensions=list(dimension_tuple.values.keys())
        )
        
        # Use LLM client for simple text generation
        query_text = await llm.generate(prompt=prompt)
        query_text = query_text.strip()
        
        # Remove quotes if LLM added them
        if query_text.startswith('"') and query_text.endswith('"'):
            query_text = query_text[1:-1]
        
        # Log success
        log_extra = {
            "operation": "query_generation",
            "model": llm.model,
            "tuple_id": dimension_tuple.id,
            "response_chars": len(query_text)
        }
        if LOG_LLM_CONTENT:
            log_extra["response_preview"] = query_text[:100]
        
        log_event(logger, "llm.request_complete", **log_extra)
        
        return query_text
    
    async def generate_queries_from_tuples(
        self, 
        tuples: List[DimensionTuple],
        batch_id: Optional[str] = None
    ) -> List[SyntheticQuery]:
        """
        Generate queries from a list of tuples.
        
        Args:
            tuples: List of dimension tuples
            batch_id: Optional batch ID to associate queries with
        
        Returns:
            List of SyntheticQuery objects
        """
        import asyncio
        
        queries = []
        now = datetime.utcnow().isoformat() + "Z"
        
        # Generate queries concurrently with rate limiting
        semaphore = asyncio.Semaphore(5)  # Max 5 concurrent LLM calls
        
        async def generate_one(t: DimensionTuple) -> SyntheticQuery:
            async with semaphore:
                query_text = await self.tuple_to_query(t)
                return SyntheticQuery(
                    id=f"query_{uuid.uuid4().hex[:12]}",
                    tuple_id=t.id,
                    dimension_values=t.values,
                    query_text=query_text,
                    batch_id=batch_id,
                    created_at=now
                )
        
        tasks = [generate_one(t) for t in tuples]
        queries = await asyncio.gather(*tasks)
        
        return list(queries)
    
    async def generate_batch(
        self, 
        n: int = 20,
        name: Optional[str] = None,
        focus_areas: Optional[List[str]] = None
    ) -> SyntheticBatch:
        """
        Generate a complete batch of synthetic queries.
        
        This is the main entry point for generating test data.
        Uses LLM-guided tuple generation for realistic test cases.
        
        Args:
            n: Number of queries to generate
            name: Optional name for the batch
            focus_areas: Areas to focus on (e.g., ["edge cases", "adversarial"])
        
        Returns:
            SyntheticBatch with generated queries
        """
        # Generate a short ID that will be used consistently
        short_id = uuid.uuid4().hex[:6].upper()
        batch_id = f"batch_{short_id.lower()}"
        now = datetime.utcnow().isoformat() + "Z"
        
        if not name:
            # Use a consistent format: Batch YYYY-MM-DD #SHORTID
            name = f"Batch {now[:10]} #{short_id}"
        
        # Generate tuples using LLM
        tuples = await self.generate_tuples_llm_guided(n, focus_areas)
        
        # Generate queries from tuples
        queries = await self.generate_queries_from_tuples(tuples, batch_id)
        
        return SyntheticBatch(
            id=batch_id,
            agent_id="",  # Will be set when saving
            name=name,
            query_count=len(queries),
            status="ready",
            created_at=now,
            queries=queries
        )

    async def generate_batch_streaming(
        self,
        n: int = 20,
        name: Optional[str] = None,
        focus_areas: Optional[List[str]] = None,
        custom_tuple_prompt: Optional[str] = None,
        custom_query_prompt: Optional[str] = None,
        selected_dimensions: Optional[Dict[str, List[str]]] = None,
        use_dimensions: bool = True
    ) -> AsyncGenerator[Dict, None]:
        """
        Generate a batch of synthetic queries with streaming progress.
        
        Yields progress events as queries are generated, allowing real-time UI updates.
        Uses LLM-guided tuple generation for realistic test cases.
        
        Args:
            n: Number of queries to generate
            name: Batch name
            focus_areas: Optional areas to focus on (e.g., ["edge cases", "adversarial"])
            custom_tuple_prompt: Custom prompt for tuple generation
            custom_query_prompt: Custom prompt for query generation
            selected_dimensions: Optional dict of dimension_name -> values to use (overrides agent dimensions)
            use_dimensions: If True, use dimensions for tuple generation. If False, let LLM generate freely.
        
        Yields:
            Dict events:
                - {"type": "batch_started", "batch_id": str, "name": str, "total": int}
                - {"type": "tuples_generated", "count": int, "tuples": List}
                - {"type": "query_generated", "index": int, "total": int, "query": dict}
                - {"type": "batch_complete", "batch_id": str, "query_count": int}
        """
        # Store custom prompts for use in generation methods
        self._custom_tuple_prompt = custom_tuple_prompt
        self._custom_query_prompt = custom_query_prompt
        self._use_dimensions = use_dimensions
        
        # If selected_dimensions provided and use_dimensions is True, temporarily override the generator's dimensions
        original_dimensions = None
        if selected_dimensions and use_dimensions:
            original_dimensions = self.dimensions
            self.dimensions = [
                TestingDimension(name=dim_name, values=values)
                for dim_name, values in selected_dimensions.items()
            ]
        
        # Generate a short ID that will be used consistently
        short_id = uuid.uuid4().hex[:6].upper()
        batch_id = f"batch_{short_id.lower()}"
        now = datetime.utcnow().isoformat() + "Z"
        
        if not name:
            # Use a consistent format: Batch YYYY-MM-DD #SHORTID
            name = f"Batch {now[:10]} #{short_id}"
        
        # Emit batch started event
        yield {
            "type": "batch_started",
            "batch_id": batch_id,
            "name": name,
            "total": n,
            "timestamp": now
        }
        # Allow event loop to flush
        await asyncio.sleep(0)
        
        # Generate tuples using LLM
        tuples = await self.generate_tuples_llm_guided(n, focus_areas)
        
        total = len(tuples)
        
        # Emit tuple generation complete
        yield {
            "type": "tuples_generated",
            "count": total,
            "tuples": [{"id": t.id, "values": t.values} for t in tuples]
        }
        # Allow event loop to flush
        await asyncio.sleep(0)
        
        # Generate queries one by one with progress
        queries = []
        
        for i, t in enumerate(tuples):
            try:
                query_text = await self.tuple_to_query(t)
                query = SyntheticQuery(
                    id=f"query_{uuid.uuid4().hex[:12]}",
                    tuple_id=t.id,
                    dimension_values=t.values,
                    query_text=query_text,
                    batch_id=batch_id,
                    created_at=now
                )
                queries.append(query)
                
                # Emit query generated event
                yield {
                    "type": "query_generated",
                    "index": i,
                    "completed": i + 1,
                    "total": total,
                    "progress_percent": round(((i + 1) / total) * 100, 1),
                    "query": {
                        "id": query.id,
                        "tuple_values": query.dimension_values,
                        "query_text": query.query_text
                    }
                }
                # Allow event loop to flush after each query
                await asyncio.sleep(0)
            except Exception as e:
                # Emit error but continue
                yield {
                    "type": "query_error",
                    "index": i,
                    "error": str(e),
                    "tuple": t.values
                }
                await asyncio.sleep(0)
        
        # Emit batch complete event
        yield {
            "type": "batch_complete",
            "batch_id": batch_id,
            "name": name,
            "query_count": len(queries),
            "queries": [
                {
                    "id": q.id,
                    "tuple_values": q.dimension_values,
                    "query_text": q.query_text
                }
                for q in queries
            ]
        }
        
        # Restore original dimensions if they were overridden
        if original_dimensions is not None:
            self.dimensions = original_dimensions


# Utility functions for dimension manipulation

def merge_dimensions(
    agent_dimensions: List[TestingDimension],
    custom_dimensions: Dict[str, List[str]]
) -> List[TestingDimension]:
    """
    Merge agent's dimensions with custom user-provided dimensions.
    
    Args:
        agent_dimensions: Dimensions from AGENT_INFO
        custom_dimensions: Additional dimensions provided by user
    
    Returns:
        Merged list of TestingDimension objects
    """
    result = list(agent_dimensions)
    existing_names = {d.name for d in result}
    
    for name, values in custom_dimensions.items():
        if name in existing_names:
            # Extend existing dimension
            for dim in result:
                if dim.name == name:
                    dim.values = list(set(dim.values + values))
                    break
        else:
            # Add new dimension
            result.append(TestingDimension(name=name, values=values))
    
    return result


def filter_tuples_by_criteria(
    tuples: List[DimensionTuple],
    criteria: Dict[str, List[str]]
) -> List[DimensionTuple]:
    """
    Filter tuples to only include those matching criteria.
    
    Args:
        tuples: List of tuples to filter
        criteria: Dict of dimension name -> allowed values
    
    Returns:
        Filtered list of tuples
    """
    def matches(t: DimensionTuple) -> bool:
        for dim_name, allowed_values in criteria.items():
            if dim_name in t.values and t.values[dim_name] not in allowed_values:
                return False
        return True
    
    return [t for t in tuples if matches(t)]

