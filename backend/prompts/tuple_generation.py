"""
Tuple Generation Prompt

Used by the synthetic service to generate dimension tuples
(combinations of testing dimensions like persona, scenario, complexity).
"""

from prompts.base import PromptConfig

TUPLE_GENERATION_PROMPT = PromptConfig(
    id="tuple_generation",
    name="Tuple Generation",
    description="Generates dimension tuples for synthetic test case generation",
    feature="synthetic",
    
    system_prompt=None,  # No system prompt - single user prompt

    user_prompt_template="""You are generating test case combinations for testing an AI agent.

Agent: {agent_name}
Purpose: {agent_purpose}

Generate {count} diverse and realistic combinations. Each combination should represent 
a plausible user interaction. Include a mix of:
- Common/typical cases
- Edge cases
- Challenging scenarios

These are the available testing dimensions that you can use as inspiration:
{dimensions}
{focus_instruction}

However, feel free to generate tuples that makes sense for the agent and the purpose.

Return a JSON object with a "tuples" key containing an array of test case objects.""",

    available_variables=[
        "agent_name",
        "agent_purpose",
        "count",
        "dimensions",
        "focus_instruction"
    ]
)


TUPLE_GENERATION_FREE_PROMPT = PromptConfig(
    id="tuple_generation_free",
    name="Tuple Generation (Free)",
    description="Generates dimension tuples without predefined dimensions",
    feature="synthetic",
    
    system_prompt=None,

    user_prompt_template="""You are generating test case combinations for testing an AI agent.

Agent: {agent_name}
Purpose: {agent_purpose}
{focus_instruction}

Generate {count} diverse and realistic test case combinations. Each combination should represent 
a plausible user interaction scenario. You decide what dimensions to use (e.g., persona, scenario, 
complexity, mood, intent, etc.) based on what's relevant for testing this agent.

Include a mix of:
- Common/typical cases
- Edge cases
- Challenging/adversarial scenarios

Return a JSON object with a "tuples" key containing an array of test case objects.""",

    available_variables=[
        "agent_name",
        "agent_purpose",
        "count",
        "focus_instruction"
    ]
)

