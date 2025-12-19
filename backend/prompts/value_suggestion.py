"""
Value Suggestion Prompt

Used to suggest additional values for an existing testing dimension (bucket).
Helps users expand their test coverage for a specific dimension.
"""

from prompts.base import PromptConfig

VALUE_SUGGESTION_PROMPT = PromptConfig(
    id="value_suggestion",
    name="Value Suggestion",
    description="Suggests additional values for an existing testing dimension to expand test coverage.",
    feature="synthetic",
    
    system_prompt="""You are helping expand testing coverage for an AI agent. 
Given an existing dimension with some values, suggest new values that:
- Are distinct from existing values
- Cover gaps in the current test space
- Include edge cases and less common scenarios
- Are relevant to the agent's domain""",

    user_prompt_template="""{agent_context_section}

Dimension being expanded: "{dimension_name}"
{dimension_description}

Existing values: {existing_values}

Suggest {count} new values for this dimension that are different from the existing ones.
Focus on gaps in coverage and edge cases.

Return a JSON object with this exact structure:
{{"new_values": [{{"id": "value_id", "label": "Human-readable label"}}]}}

Make values specific and actionable. Avoid overlap with existing values.""",

    available_variables=[
        "agent_context_section",   # Agent name, purpose (optional)
        "dimension_name",          # Name of the bucket being expanded
        "dimension_description",   # Optional description of the dimension
        "existing_values",         # Current values in the dimension
        "count"                    # Number of values to suggest (default: 5)
    ]
)

