"""
Tuple Generation Prompt

Used by the synthetic service to generate dimension tuples
(combinations of testing dimensions like persona, scenario, complexity).

The prompt handles both modes:
- With dimensions: Uses provided testing dimensions as inspiration
- Without dimensions (free mode): LLM decides dimensions freely
"""

from prompts.base import PromptConfig

TUPLE_GENERATION_PROMPT = PromptConfig(
    id="tuple_generation",
    name="Tuple Generation",
    description="Generates dimension tuples for synthetic test case generation. Works with or without predefined dimensions.",
    feature="synthetic",
    
    system_prompt=None,  # No system prompt - single user prompt

    user_prompt_template="""You are generating test case combinations for testing an AI agent.

Agent: {agent_name}
Purpose: {agent_purpose}
{focus_instruction}

Generate {count} diverse and realistic test case combinations. Each combination should represent 
a plausible user interaction scenario.
{dimensions_section}
Include a mix of:
- Common/typical cases
- Edge cases
- Challenging/adversarial scenarios

Return a JSON object with a "tuples" key containing an array of test case objects.""",

    available_variables=[
        "agent_name",
        "agent_purpose",
        "count",
        "dimensions_section",  # Either contains dimensions or empty for free mode
        "focus_instruction"
    ]
)


# Keep alias for backward compatibility (deprecated, same as TUPLE_GENERATION_PROMPT)
TUPLE_GENERATION_FREE_PROMPT = TUPLE_GENERATION_PROMPT

