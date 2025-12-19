"""
Dimension Suggestion Prompt

Used to suggest testing dimensions (buckets + values) for synthetic query generation.
Works in two modes:
- Cold start: No agent info available, generate generic but useful buckets
- Agent-aware: Generate buckets relevant to the agent's capabilities and domain
"""

from prompts.base import PromptConfig

DIMENSION_SUGGESTION_PROMPT = PromptConfig(
    id="dimension_suggestion",
    name="Dimension Suggestion",
    description="Suggests testing dimensions (buckets) and their values for synthetic query generation. Uses agent context when available.",
    feature="synthetic",
    
    system_prompt="""You are an expert in AI agent testing and evaluation. Your job is to design 
testing dimensions that help systematically evaluate an AI agent's behavior across diverse scenarios.

Each dimension represents a "bucket" that slices the test space. Good dimensions are:
- Orthogonal (measure different aspects)
- Meaningful (impact agent behavior)
- Practical (3-6 values per dimension)
- Comprehensive (cover edge cases)""",

    user_prompt_template="""{agent_context_section}

Design {count} testing dimensions to systematically evaluate this agent. Each dimension should have 3-6 values.

Consider dimensions like:
- User characteristics (persona, expertise level, mood)
- Request complexity (simple, multi-step, edge case)
- Scenario types (common use cases, edge cases, adversarial)
- Domain-specific factors based on agent capabilities

Focus on the user defined testing goals if provided.

{testing_goals_section}

Return a JSON object with this exact structure:
{{"dimensions": [{{"name": "dimension_name", "description": "Brief description", "values": [{{"id": "value_id", "label": "Human-readable label"}}]}}]}}

Make dimensions specific to the agent's domain. Avoid generic dimensions unless truly relevant.""",

    available_variables=[
        "agent_context_section",  # Agent name, purpose, capabilities (or empty for cold start)
        "count",                  # Number of dimensions to suggest (default: 4)
        "testing_goals_section"   # Optional testing goals from user
    ]
)

