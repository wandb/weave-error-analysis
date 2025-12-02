"""
Synthetic Data Generation Service

Generates realistic test queries based on AGENT_INFO testing dimensions.
Uses a two-step process:
1. Generate dimension tuples (combinations of persona, scenario, complexity, etc.)
2. Convert tuples to natural language queries using LLM
"""

import json
import uuid
import itertools
import random
from typing import List, Dict, Any, Optional
from datetime import datetime
from pydantic import BaseModel

from services.agent_info import AgentInfo, TestingDimension


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
    Generates synthetic test queries based on AGENT_INFO dimensions.
    
    The generation process:
    1. Extract testing dimensions from AGENT_INFO
    2. Generate dimension tuples (cross-product or LLM-guided)
    3. Convert tuples to natural language queries
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
    
    def generate_tuples_cross_product(
        self, 
        max_tuples: int = 100,
        sample_strategy: str = "random"
    ) -> List[DimensionTuple]:
        """
        Generate tuples using cross-product of all dimensions.
        
        Args:
            max_tuples: Maximum number of tuples to generate
            sample_strategy: How to sample if cross-product exceeds max_tuples
                           ("random", "stratified", "first")
        
        Returns:
            List of DimensionTuple objects
        """
        if not self.dimensions:
            return []
        
        # Build dimension values dict
        dim_values = self.get_dimension_values()
        dim_names = list(dim_values.keys())
        
        # Generate all combinations
        all_combinations = list(itertools.product(*[dim_values[name] for name in dim_names]))
        
        # Sample if needed
        if len(all_combinations) > max_tuples:
            if sample_strategy == "random":
                all_combinations = random.sample(all_combinations, max_tuples)
            elif sample_strategy == "stratified":
                # Ensure at least one from each dimension value
                all_combinations = self._stratified_sample(all_combinations, dim_names, dim_values, max_tuples)
            else:  # first
                all_combinations = all_combinations[:max_tuples]
        
        # Convert to DimensionTuple objects
        tuples = []
        now = datetime.utcnow().isoformat()
        
        for combo in all_combinations:
            values_dict = {dim_names[i]: combo[i] for i in range(len(dim_names))}
            tuples.append(DimensionTuple(
                id=f"tuple_{uuid.uuid4().hex[:12]}",
                values=values_dict,
                created_at=now
            ))
        
        return tuples
    
    def _stratified_sample(
        self, 
        combinations: List[tuple], 
        dim_names: List[str],
        dim_values: Dict[str, List[str]],
        max_tuples: int
    ) -> List[tuple]:
        """Stratified sampling ensuring coverage of each dimension value."""
        selected = set()
        
        # First pass: ensure each value is represented at least once
        for dim_idx, dim_name in enumerate(dim_names):
            for value in dim_values[dim_name]:
                for combo in combinations:
                    if combo[dim_idx] == value and combo not in selected:
                        selected.add(combo)
                        break
                if len(selected) >= max_tuples:
                    break
            if len(selected) >= max_tuples:
                break
        
        # Second pass: fill remaining slots randomly
        remaining = [c for c in combinations if c not in selected]
        slots_left = max_tuples - len(selected)
        if slots_left > 0 and remaining:
            selected.update(random.sample(remaining, min(slots_left, len(remaining))))
        
        return list(selected)
    
    async def generate_tuples_llm_guided(
        self, 
        n: int = 20,
        focus_areas: Optional[List[str]] = None
    ) -> List[DimensionTuple]:
        """
        Generate tuples using LLM to create realistic combinations.
        
        This produces more realistic combinations than pure cross-product,
        as the LLM considers which combinations make sense together.
        
        Args:
            n: Number of tuples to generate
            focus_areas: Optional areas to focus on (e.g., ["edge cases", "adversarial"])
        
        Returns:
            List of DimensionTuple objects
        """
        from litellm import acompletion
        
        dim_values = self.get_dimension_values()
        
        focus_instruction = ""
        if focus_areas:
            focus_instruction = f"\nFocus on these areas: {', '.join(focus_areas)}"
        
        prompt = f"""You are generating test case combinations for testing an AI agent.

Agent: {self.agent_info.name}
Purpose: {self.agent_info.purpose}

Available testing dimensions:
{json.dumps(dim_values, indent=2)}
{focus_instruction}

Generate {n} diverse and realistic combinations. Each combination should represent 
a plausible user interaction. Include a mix of:
- Common/typical cases
- Edge cases
- Challenging scenarios

Return as JSON array of objects, each with keys matching the dimension names.
Example: [{{"persona": "frustrated_customer", "scenario": "refund_request", "complexity": "multi_step"}}]

Return ONLY the JSON array, no other text."""

        response = await acompletion(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"}
        )
        
        content = response.choices[0].message.content
        
        # Parse the response
        try:
            # Handle both direct array and wrapped object
            data = json.loads(content)
            if isinstance(data, dict):
                # Find the array in the dict
                for key, value in data.items():
                    if isinstance(value, list):
                        data = value
                        break
            
            tuples = []
            now = datetime.utcnow().isoformat()
            
            for combo in data:
                if isinstance(combo, dict):
                    tuples.append(DimensionTuple(
                        id=f"tuple_{uuid.uuid4().hex[:12]}",
                        values=combo,
                        created_at=now
                    ))
            
            return tuples
            
        except json.JSONDecodeError:
            # Fallback to cross-product if LLM fails
            return self.generate_tuples_cross_product(max_tuples=n)
    
    def tuple_to_query_template(self, dimension_tuple: DimensionTuple) -> str:
        """
        Convert a dimension tuple to a query using simple templates.
        
        Fallback when LLM is not available.
        """
        values = dimension_tuple.values
        
        # Simple template-based generation
        persona = values.get("personas", values.get("persona", "user"))
        scenario = values.get("scenarios", values.get("scenario", "general"))
        complexity = values.get("complexity", "simple")
        
        # Map scenarios to template queries
        scenario_templates = {
            "pricing_inquiry": "What are the pricing options for your service?",
            "feature_question": "Can you tell me about the features available?",
            "refund_request": "I'd like to request a refund for my purchase.",
            "upgrade_inquiry": "I'm interested in upgrading my plan. What are my options?",
            "downgrade_request": "I need to downgrade my subscription.",
            "technical_issue": "I'm having a technical problem that I need help with.",
            "account_recovery": "I can't access my account and need help.",
            "billing_dispute": "I have a question about a charge on my account.",
        }
        
        base_query = scenario_templates.get(scenario, f"I have a question about {scenario}.")
        
        # Modify based on persona
        persona_prefixes = {
            "first_time_user": "Hi, I'm new here. ",
            "frustrated_customer": "This is really frustrating! ",
            "power_user": "I've been using your service for a while. ",
            "enterprise_prospect": "I'm evaluating this for my company. ",
            "budget_conscious": "I'm on a tight budget. ",
        }
        
        prefix = persona_prefixes.get(persona, "")
        
        # Add complexity modifier
        if complexity == "multi_step":
            base_query += " Also, can you check my account status?"
        elif complexity == "edge_case":
            base_query = base_query.replace("?", " in an unusual situation?")
        elif complexity == "adversarial":
            base_query = "I know this isn't normal, but " + base_query.lower()
        
        return prefix + base_query
    
    async def tuple_to_query(self, dimension_tuple: DimensionTuple, use_llm: bool = True) -> str:
        """
        Convert a dimension tuple to a natural language query.
        
        Uses LLM to generate a realistic user message that matches
        the characteristics defined by the tuple.
        
        Args:
            dimension_tuple: The tuple to convert
            use_llm: Whether to use LLM (if False, uses template)
        
        Returns:
            Natural language query string
        """
        if not use_llm:
            return self.tuple_to_query_template(dimension_tuple)
        
        try:
            from litellm import acompletion
        except ImportError:
            return self.tuple_to_query_template(dimension_tuple)
        
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
        
        prompt = f"""You are generating a realistic user message for testing an AI agent.

Agent: {self.agent_info.name}
Purpose: {self.agent_info.purpose}
Capabilities: {', '.join(self.agent_info.capabilities[:5])}

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

        try:
            response = await acompletion(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}]
            )
            
            query_text = response.choices[0].message.content.strip()
            
            # Remove quotes if LLM added them
            if query_text.startswith('"') and query_text.endswith('"'):
                query_text = query_text[1:-1]
            
            return query_text
        except Exception as e:
            # Fallback to template if LLM fails
            print(f"LLM query generation failed: {e}, using template")
            return self.tuple_to_query_template(dimension_tuple)
    
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
        now = datetime.utcnow().isoformat()
        
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
        strategy: str = "llm_guided",
        focus_areas: Optional[List[str]] = None
    ) -> SyntheticBatch:
        """
        Generate a complete batch of synthetic queries.
        
        This is the main entry point for generating test data.
        
        Args:
            n: Number of queries to generate
            name: Optional name for the batch
            strategy: "cross_product" or "llm_guided"
            focus_areas: Areas to focus on for LLM-guided generation
        
        Returns:
            SyntheticBatch with generated queries
        """
        batch_id = f"batch_{uuid.uuid4().hex[:12]}"
        now = datetime.utcnow().isoformat()
        
        if not name:
            name = f"Batch {now[:10]}"
        
        # Generate tuples
        if strategy == "llm_guided":
            tuples = await self.generate_tuples_llm_guided(n, focus_areas)
        else:
            tuples = self.generate_tuples_cross_product(max_tuples=n)
        
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

