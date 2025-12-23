"""
Query Generation Prompt

Used by the synthetic service to convert dimension tuples
into natural language user queries.
"""

from prompts.base import PromptConfig

QUERY_GENERATION_PROMPT = PromptConfig(
    id="query_generation",
    name="Query Generation",
    description="Converts dimension tuples into natural language user queries",
    feature="synthetic",
    
    system_prompt=None,  # No system prompt - single user prompt

    user_prompt_template="""You are generating a realistic user message for testing an AI agent.

Agent: {agent_name}

{agent_context}

Generate a user message matching these characteristics:
{dimension_values}

Guidelines:
- Sound natural and conversational, not formulaic
- Match the persona's communication style
- Reflect the scenario's topic and urgency
- Include relevant details that the persona would provide
- For multi_step complexity, may require multiple pieces of information or actions
- For edge_case complexity, present unusual or boundary conditions
- For adversarial, try to get something outside normal policy

Return ONLY the user message, nothing else. No quotes around it.""",

    available_variables=[
        "agent_name",
        "agent_context",
        "dimension_values"
    ]
)

