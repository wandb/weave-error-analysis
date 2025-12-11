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

import litellm

from services.agent_info import AgentInfo, TestingDimension
from logger import get_logger, log_event, LOG_LLM_CONTENT

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
    
    def __init__(self, agent_info: AgentInfo, llm_client=None):
        """
        Initialize the generator.
        
        Args:
            agent_info: Parsed AGENT_INFO containing testing dimensions
            llm_client: LLM client for query generation (uses litellm if not provided)
        """
        self.agent_info = agent_info
        self.dimensions = agent_info.testing_dimensions
        self.llm_client = llm_client
    
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
        from litellm import acompletion
        from services.settings import get_litellm_kwargs
        
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
            prompt = f"""You are generating test case combinations for testing an AI agent.

Agent: {self.agent_info.name}
Purpose: {self.agent_info.purpose or "AI assistant"}
{focus_instruction}

Generate {n} diverse and realistic test case combinations. Each combination should represent 
a plausible user interaction scenario. You decide what dimensions to use (e.g., persona, scenario, 
complexity, mood, intent, etc.) based on what's relevant for testing this agent.

Include a mix of:
- Common/typical cases
- Edge cases
- Challenging/adversarial scenarios

Return a JSON object with a "tuples" key containing an array of test case objects."""
        elif custom_prompt:
            # Replace placeholders in custom prompt
            prompt = custom_prompt.replace("{agent_name}", self.agent_info.name)
            prompt = prompt.replace("{agent_purpose}", self.agent_info.purpose or "AI assistant")
            prompt = prompt.replace("{dimensions}", json.dumps(dim_values, indent=2))
            prompt = prompt.replace("{count}", str(n))
            prompt = prompt.replace("{focus_instruction}", focus_instruction)
        else:
            prompt = f"""You are generating test case combinations for testing an AI agent.

Agent: {self.agent_info.name}
Purpose: {self.agent_info.purpose or "AI assistant"}

Generate {n} diverse and realistic combinations. Each combination should represent 
a plausible user interaction. Include a mix of:
- Common/typical cases
- Edge cases
- Challenging scenarios

These are the available testing dimensions that you can use as inspiration:
{json.dumps(dim_values, indent=2)}
{focus_instruction}

However, feel free to generate tuples that makes sense for the agent and the purpose.

Return a JSON object with a "tuples" key containing an array of test case objects."""

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

        # Get LLM settings
        llm_kwargs = get_litellm_kwargs()

        response = await acompletion(
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},  # Use JSON mode for dynamic schemas
            **llm_kwargs
        )
        
        content = response.choices[0].message.content
        
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
                tuples.append(DimensionTuple(
                    id=f"tuple_{uuid.uuid4().hex[:12]}",
                    values=combo,
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
        from litellm import acompletion
        from services.settings import get_litellm_kwargs
        
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
        
        if custom_prompt:
            # Replace placeholders in custom prompt
            prompt = custom_prompt.replace("{agent_name}", self.agent_info.name)
            prompt = prompt.replace("{agent_purpose}", agent_purpose)
            prompt = prompt.replace("{agent_capabilities}", agent_capabilities)
            prompt = prompt.replace("{dimension_values}", chr(10).join(value_context))
        else:
            prompt = f"""You are generating a realistic user message for testing an AI agent.

Agent: {self.agent_info.name}
Purpose: {agent_purpose}
Capabilities: {agent_capabilities}

Generate a user message matching these characteristics:
{chr(10).join(value_context)}

Guidelines:
- Sound natural and conversational, not formulaic
- Match the persona's communication style
- Reflect the scenario's topic and urgency
- Include relevant details that the persona would provide
- For multi_step complexity, may require multiple pieces of information or actions
- For edge_case complexity, present unusual or boundary conditions
- For adversarial, try to get something outside normal policy

Return ONLY the user message, nothing else. No quotes around it."""

        # Get LLM settings (this logs the resolved config)
        llm_kwargs = get_litellm_kwargs()
        
        log_event(logger, "llm.request_start",
            operation="query_generation",
            model=llm_kwargs.get("model"),
            tuple_id=dimension_tuple.id,
            dimensions=list(dimension_tuple.values.keys())
        )
        
        response = await acompletion(
            messages=[{"role": "user", "content": prompt}],
            **llm_kwargs
        )
        
        query_text = response.choices[0].message.content.strip()
        
        # Remove quotes if LLM added them
        if query_text.startswith('"') and query_text.endswith('"'):
            query_text = query_text[1:-1]
        
        # Log success with actual model used
        log_extra = {
            "operation": "query_generation",
            "requested_model": llm_kwargs.get("model"),
            "actual_model": getattr(response, "model", "unknown"),
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

