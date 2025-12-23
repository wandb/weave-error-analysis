"""
Synthetic Data Generation Service

Generates realistic test queries based on testing dimensions.
Uses a two-step process:
1. Generate dimension tuples (combinations of persona, scenario, complexity, etc.)
using LLM when LLM Guided is enabled.
2. Convert tuples to natural language queries using LLM

Also provides LLM-powered dimension design:
- suggest_dimensions_llm: Generate dimension schema from agent context
- suggest_values_for_bucket: Expand a bucket with additional values
"""

import json
import uuid
import random
import asyncio
from math import prod
from typing import AsyncGenerator
from datetime import datetime, timezone
from collections import defaultdict
from pydantic import BaseModel
from enum import Enum

import weave

from services.agent_info import AgentInfo, TestingDimension
from services.llm import LLMClient
from logger import get_logger, log_event, LOG_LLM_CONTENT
from prompts import prompt_manager

logger = get_logger("synthetic")


# =============================================================================
# LLM-Powered Dimension Design
# =============================================================================

class SuggestedDimensionValue(BaseModel):
    """A suggested value for a dimension."""
    id: str
    label: str


class SuggestedDimension(BaseModel):
    """A suggested testing dimension with values."""
    name: str
    description: str | None = None
    values: list[SuggestedDimensionValue]


@weave.op(name="suggest_dimensions")
async def suggest_dimensions_llm(
    agent_name: str | None = None,
    agent_context: str | None = None,
    testing_goals: str | None = None,
    count: int = 4,
) -> list[SuggestedDimension]:
    """
    Use LLM to suggest testing dimensions based on agent context.
    
    Works in two modes:
    - Cold start (no agent info): Generate generic but useful dimensions
    - Agent-aware: Generate dimensions relevant to agent's context
    
    Decorated with @weave.op so dimension suggestions appear as traces.
    
    Args:
        agent_name: Name of the agent (optional)
        agent_context: Free-form description of the agent (optional)
        testing_goals: User-specified testing focus areas (optional)
        count: Number of dimensions to suggest (default: 4)
    
    Returns:
        List of SuggestedDimension objects
    """
    # Build agent context section
    if agent_name or agent_context:
        context_lines = []
        if agent_name:
            context_lines.append(f"**Agent:** {agent_name}")
        if agent_context:
            context_lines.append(agent_context)
        agent_context_section = "\n\n".join(context_lines)
    else:
        agent_context_section = "No specific agent context provided. Generate generic testing dimensions suitable for any conversational AI agent."
    
    # Build testing goals section
    if testing_goals:
        testing_goals_section = f"**Testing Goals:** {testing_goals}"
    else:
        testing_goals_section = ""
    
    # Get prompt and format
    prompt_config = prompt_manager.get_prompt("dimension_suggestion")
    variables = {
        "agent_context_section": agent_context_section,
        "count": str(count),
        "testing_goals_section": testing_goals_section,
    }
    
    # Build messages
    messages = []
    if prompt_config.system_prompt:
        messages.append({
            "role": "system",
            "content": prompt_config.system_prompt
        })
    messages.append({
        "role": "user",
        "content": prompt_config.user_prompt_template.format(**variables)
    })
    
    log_event(logger, "llm.dimension_suggestion_start",
        operation="suggest_dimensions",
        has_agent_context=bool(agent_name or agent_context),
        has_testing_goals=bool(testing_goals),
        requested_count=count
    )
    
    # Create LLM client and generate
    llm = LLMClient.for_prompt(prompt_config)
    content = await llm.complete(messages=messages, json_mode=True)
    
    # Parse response
    data = json.loads(content)
    
    # Extract dimensions from response
    dimensions_data = data.get("dimensions", [])
    if not dimensions_data and isinstance(data, list):
        dimensions_data = data
    
    dimensions = []
    for dim in dimensions_data:
        values = []
        for v in dim.get("values", []):
            if isinstance(v, dict):
                values.append(SuggestedDimensionValue(
                    id=v.get("id", v.get("label", "").lower().replace(" ", "_")),
                    label=v.get("label", v.get("id", ""))
                ))
            elif isinstance(v, str):
                values.append(SuggestedDimensionValue(id=v.lower().replace(" ", "_"), label=v))
        
        dimensions.append(SuggestedDimension(
            name=dim.get("name", ""),
            description=dim.get("description"),
            values=values
        ))
    
    log_event(logger, "llm.dimension_suggestion_complete",
        operation="suggest_dimensions",
        dimensions_count=len(dimensions),
        dimension_names=[d.name for d in dimensions]
    )
    
    return dimensions


@weave.op(name="suggest_bucket_values")
async def suggest_values_for_bucket(
    dimension_name: str,
    existing_values: list[str],
    agent_name: str | None = None,
    agent_context: str | None = None,
    dimension_description: str | None = None,
    count: int = 5,
) -> list[SuggestedDimensionValue]:
    """
    Use LLM to suggest additional values for an existing dimension.
    
    Decorated with @weave.op so value suggestions appear as traces.
    
    Args:
        dimension_name: Name of the bucket to expand
        existing_values: Current values in the bucket
        agent_name: Agent name for context (optional)
        agent_context: Free-form description of the agent (optional)
        dimension_description: Description of what this dimension tests (optional)
        count: Number of values to suggest (default: 5)
    
    Returns:
        List of SuggestedDimensionValue objects
    """
    # Build agent context section
    if agent_name or agent_context:
        context_lines = []
        if agent_name:
            context_lines.append(f"**Agent:** {agent_name}")
        if agent_context:
            context_lines.append(agent_context)
        agent_context_section = "\n\n".join(context_lines)
    else:
        agent_context_section = ""
    
    # Build description line
    if dimension_description:
        desc_section = f"Description: {dimension_description}"
    else:
        desc_section = ""
    
    # Get prompt and format
    prompt_config = prompt_manager.get_prompt("value_suggestion")
    variables = {
        "agent_context_section": agent_context_section,
        "dimension_name": dimension_name,
        "dimension_description": desc_section,
        "existing_values": ", ".join(existing_values) if existing_values else "(none)",
        "count": str(count),
    }
    
    # Build messages
    messages = []
    if prompt_config.system_prompt:
        messages.append({
            "role": "system",
            "content": prompt_config.system_prompt
        })
    messages.append({
        "role": "user",
        "content": prompt_config.user_prompt_template.format(**variables)
    })
    
    log_event(logger, "llm.value_suggestion_start",
        operation="suggest_values",
        dimension_name=dimension_name,
        existing_count=len(existing_values),
        requested_count=count
    )
    
    # Create LLM client and generate
    llm = LLMClient.for_prompt(prompt_config)
    content = await llm.complete(messages=messages, json_mode=True)
    
    # Parse response
    data = json.loads(content)
    
    # Extract values from response
    values_data = data.get("new_values", [])
    if not values_data and isinstance(data, list):
        values_data = data
    
    values = []
    for v in values_data:
        if isinstance(v, dict):
            values.append(SuggestedDimensionValue(
                id=v.get("id", v.get("label", "").lower().replace(" ", "_")),
                label=v.get("label", v.get("id", ""))
            ))
        elif isinstance(v, str):
            values.append(SuggestedDimensionValue(id=v.lower().replace(" ", "_"), label=v))
    
    log_event(logger, "llm.value_suggestion_complete",
        operation="suggest_values",
        dimension_name=dimension_name,
        values_count=len(values),
        value_ids=[v.id for v in values]
    )
    
    return values


class DimensionTuple(BaseModel):
    """A combination of dimension values."""
    id: str
    values: dict[str, str]  # e.g., {"persona": "frustrated_customer", "scenario": "refund_request"}
    created_at: str


class SyntheticBatchStatus(Enum):
    PENDING = "pending"
    GENERATING = "generating"
    READY = "ready"
    RUNNING = "running"
    COMPLETED = "completed"


class SyntheticQuery(BaseModel):
    """A generated synthetic query."""
    id: str
    tuple_id: str
    dimension_values: dict[str, str]
    query_text: str
    batch_id: str | None = None
    created_at: str


class SyntheticBatch(BaseModel):
    """A batch of synthetic queries."""
    id: str
    agent_id: str
    name: str
    query_count: int
    status: SyntheticBatchStatus
    created_at: str
    queries: list[SyntheticQuery] = []


class SyntheticGenerator:
    """
    Generates synthetic test queries based on testing dimensions using LLM.
    
    The generation process:
    1. Extract testing dimensions from AGENT_INFO if available.
    2. Generate dimension tuples using LLM (creates realistic combinations)
    3. Convert tuples to natural language queries using LLM
    """
    
    def __init__(self, agent_info: AgentInfo, llm_client: LLMClient | None = None):
        """
        Initialize the generator.

        Args:
            agent_info: Parsed AGENT_INFO containing testing dimensions
            llm_client: LLM client for query generation (uses default if not provided)
        """
        self.agent_info = agent_info
        # Todo: dimensions should not come from agent_info, but from the database.
        # if there is no database entry for the dimensiont, we should allow the user to either,
        # manually create it or create using LLM.
        self.dimensions: dict[str, list[str]] | None = agent_info.testing_dimensions
    
    def get_dimension_values(self) -> dict[str, list[str]]:
        """Get all dimension names and their possible values."""
        result: dict[str, list[str]] = {}
        for dim in self.dimensions:
            result[dim.name] = dim.values
        return result
    
    def generate_tuples_heuristic(
        self,
        n: int = 20,
        variety: float = 0.5,
        favorites: dict[str, set[str]] | None = None,
        no_duplicates: bool = True,
        seed: int | None = None,
    ) -> list[DimensionTuple]:
        """
        Generate tuples using weighted probabilistic sampling (no LLM call).
        
        This is used when the user has selected dimensions with predefined values.
        Instead of calling an LLM, we sample combinations heuristically based on:
        - Variety slider (0.0 = predictable/peaked, 1.0 = surprising/uniform)
        - Favorites (starred values get 5x weight)
        - Diversity penalty (avoid repeating same values at high variety)
        
        Args:
            n: Number of tuples to generate
            variety: 0.0 = peaked distribution favoring favorites
                     1.0 = uniform distribution with diversity penalty
            favorites: Dict mapping dimension_name -> set of favorite values (5x weight)
            no_duplicates: If True, ensure unique combinations
            seed: Random seed for reproducibility
        
        Returns:
            List of DimensionTuple objects
        """
        if seed is not None:
            random.seed(seed)
        
        favorites = favorites or {}
        dim_values = self.get_dimension_values()
        
        if not dim_values:
            log_event(logger, "synthetic.heuristic_no_dimensions", level="warning")
            return []
        
        # Calculate max possible unique combinations
        max_combinations = prod(len(v) for v in dim_values.values()) if dim_values else 0
        
        log_event(logger, "synthetic.heuristic_start",
            operation="generate_tuples_heuristic",
            requested_count=n,
            variety=variety,
            no_duplicates=no_duplicates,
            max_combinations=max_combinations,
            dimensions=list(dim_values.keys()),
            dimension_sizes={k: len(v) for k, v in dim_values.items()}
        )
        
        # Base weights: 5.0 for favorites, 1.0 for others
        base_weights: dict[str, dict[str, float]] = {}
        for dim_name, values in dim_values.items():
            dim_favorites = favorites.get(dim_name, set())
            base_weights[dim_name] = {
                v: 5.0 if v in dim_favorites else 1.0
                for v in values
            }
        
        tuples: list[DimensionTuple] = []
        seen_combinations: set[tuple] = set()
        seen_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        max_attempts = n * 20  # Prevent infinite loops
        
        for attempt in range(max_attempts):
            if len(tuples) >= n:
                break
            
            # Sample one tuple
            tuple_values: dict[str, str] = {}
            for dim_name, values in dim_values.items():
                weights = []
                for v in values:
                    w = base_weights[dim_name][v]
                    
                    # Diversity penalty: reduce weight for already-seen values
                    # Stronger penalty at high variety (explore all corners)
                    if variety > 0.3:
                        usage = seen_counts[dim_name][v]
                        # Penalty increases with usage and variety level
                        diversity_penalty = 1.0 / (1.0 + usage * variety * 2)
                        w *= diversity_penalty
                    
                    # Temperature effect: flatten distribution at high variety
                    # At variety=1.0, blend toward uniform distribution
                    # At variety=0.0, peaked distribution (favorites dominate)
                    if variety > 0.5:
                        uniform_weight = 1.0
                        blend = (variety - 0.5) * 2  # Maps 0.5-1.0 to 0-1
                        w = w * (1 - blend) + uniform_weight * blend
                    
                    weights.append(max(w, 0.01))  # Floor to prevent zero probability
                
                # Weighted random choice
                chosen = random.choices(values, weights=weights, k=1)[0]
                tuple_values[dim_name] = chosen
            
            # Check for duplicates if no_duplicates is enabled
            tuple_key = tuple(sorted(tuple_values.items()))
            if no_duplicates:
                if tuple_key in seen_combinations:
                    # Skip duplicate, but cap attempts if we've exhausted combinations
                    if len(seen_combinations) >= max_combinations:
                        log_event(logger, "synthetic.heuristic_exhausted",
                            level="warning",
                            generated=len(tuples),
                            requested=n,
                            max_combinations=max_combinations
                        )
                        break
                    continue
            
            seen_combinations.add(tuple_key)
            
            # Create tuple object
            tuples.append(DimensionTuple(
                id=f"tuple_{uuid.uuid4().hex[:12]}",
                values=tuple_values,
                created_at=now
            ))
            
            # Update seen counts for diversity penalty
            for dim_name, value in tuple_values.items():
                seen_counts[dim_name][value] += 1
        
        log_event(logger, "synthetic.heuristic_complete",
            operation="generate_tuples_heuristic",
            generated_count=len(tuples),
            requested_count=n,
            attempts=min(attempt + 1, max_attempts),
            sample_tuple=tuples[0].values if tuples else None
        )
        
        return tuples
    
    @weave.op(name="generate_query")
    async def tuple_to_query(self, dimension_tuple: DimensionTuple) -> str:
        """
        Convert a dimension tuple to a natural language query.
        
        Uses LLM to generate a realistic user message that matches
        the characteristics defined by the tuple.
        
        Decorated with @weave.op so each query generation appears as a trace.
        
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
        agent_context = self.agent_info.agent_context or "AI assistant"
        
        # Get the prompt config for query generation
        prompt_config = prompt_manager.get_prompt("query_generation")
        
        if custom_prompt:
            # Replace placeholders in custom prompt
            prompt = custom_prompt.replace("{agent_name}", self.agent_info.name)
            prompt = prompt.replace("{agent_context}", agent_context)
            prompt = prompt.replace("{dimension_values}", chr(10).join(value_context))
        else:
            variables = {
                "agent_name": self.agent_info.name,
                "agent_context": agent_context,
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

    @weave.op(name="generate_batch_streaming")
    async def generate_batch_streaming(
        self,
        n: int = 20,
        name: str | None = None,
        custom_query_prompt: str | None = None,
        selected_dimensions: dict[str, list[str]] | None = None,
        variety: float = 0.5,
        favorites: dict[str, list[str]] | None = None,
        no_duplicates: bool = True,
    ) -> AsyncGenerator[dict, None]:
        """
        Generate a batch of synthetic queries.
        
        Yields progress events as queries are generated, allowing real-time UI updates.
        Uses heuristic tuple generation with user-defined dimensions.
        
        Note: For weave tracing, use generate_batch() instead which wraps all
        query generations under a single parent trace.
        
        Args:
            n: Number of queries to generate
            name: Batch name
            custom_query_prompt: Custom prompt for query generation
            selected_dimensions: Optional dict of dimension_name -> values to use
            variety: 0.0 = predictable (favor favorites), 1.0 = surprising (uniform + diversity)
            favorites: Dict of dimension_name -> list of favorite values (get 5x weight)
            no_duplicates: If True, ensure unique tuple combinations
        
        Yields:
            Dict events:
                - {"type": "batch_started", "batch_id": str, "name": str, "total": int}
                - {"type": "tuples_generated", "count": int, "tuples": List, "method": str}
                - {"type": "query_generated", "index": int, "total": int, "query": dict}
                - {"type": "batch_complete", "batch_id": str, "query_count": int}
        """
        # Store custom query prompt for use in tuple_to_query
        self._custom_query_prompt = custom_query_prompt
        
        # If selected_dimensions provided, temporarily override the generator's dimensions
        original_dimensions = None
        if selected_dimensions:
            original_dimensions = self.dimensions
            self.dimensions = [
                TestingDimension(name=dim_name, values=values)
                for dim_name, values in selected_dimensions.items()
            ]
        
        # Convert favorites list to set for heuristic method.
        favorites_sets: dict[str, set[str]] | None = None
        if favorites:
            favorites_sets = {k: set[str](v) for k, v in favorites.items()}
        
        # Generate a short ID that will be used consistently.
        short_id = uuid.uuid4().hex[:6].upper()
        batch_id = f"batch_{short_id.lower()}"
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        
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
        
        # Use heuristic tuple generation (fast, deterministic)
        log_event(logger, "synthetic.tuple_generation_method",
            method="heuristic",
            variety=variety,
            no_duplicates=no_duplicates,
            has_favorites=favorites is not None and len(favorites) > 0
        )
        tuples = self.generate_tuples_heuristic(
            n=n,
            variety=variety,
            favorites=favorites_sets,
            no_duplicates=no_duplicates
        )
        
        total = len(tuples)
        
        # Emit tuple generation complete
        yield {
            "type": "tuples_generated",
            "count": total,
            "method": "heuristic",
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
