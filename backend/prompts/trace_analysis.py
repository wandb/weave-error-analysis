"""
Trace Analysis Prompt

Used by the suggestion service to analyze conversation traces
and identify quality issues.
"""

from prompts.base import PromptConfig

TRACE_ANALYSIS_PROMPT = PromptConfig(
    id="trace_analysis",
    name="Trace Analysis",
    description="Analyzes conversation traces to identify quality issues",
    feature="suggestions",
    
    system_prompt="""You are analyzing traces from {agent_name} to identify quality issues.

=== AGENT CONTEXT ===
{agent_context}

=== EXISTING FAILURE MODES ===
These are the established failure categories. Use these when applicable:

{failure_modes_text}

=== RECENT NOTES (for style reference) ===
{recent_notes_text}""",

    user_prompt_template="""=== TRACE TO ANALYZE ===
{trace_text}

=== TASK ===
Analyze this trace for quality issues. Consider:
1. Did the agent use appropriate tools?
2. Is the information accurate per the agent's knowledge base?
3. Was the tone appropriate?
4. Were any agent's capabilities or limitations violated?
5. Did the agent follow documented policies?

If there's an issue:
- Use an existing failure mode category if one fits (set failure_mode_id to the category ID)
- Write a note in similar style to the examples
- If no existing category fits, suggest a new category name

If the response looks good, set has_issue to false.""",

    available_variables=[
        "agent_name",
        "agent_context", 
        "failure_modes_text",
        "recent_notes_text",
        "trace_text"
    ]
)

