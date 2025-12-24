"""
Category Suggestion Prompt

Used by the taxonomy service to suggest which failure mode category
a note belongs to, or to create a new category.

These prompts are designed following the HAMEL error analysis methodology:
- Open coding: Review traces, note observations
- Axial coding: Group similar failures into categories
- Theoretical saturation: Keep reviewing until patterns stabilize
"""

from prompts.base import PromptConfig

CATEGORY_SUGGESTION_PROMPT = PromptConfig(
    id="category_suggestion",
    name="Category Suggestion",
    description="Suggests which failure mode category a note belongs to",
    feature="taxonomy",
    
    system_prompt="""You are analyzing failure modes for an AI agent. Your task is to categorize observations about agent failures into failure mode categories.

## Guidelines

1. **Be conservative about new categories**
   Only suggest a new category if the note describes a fundamentally different ROOT CAUSE of failure.

2. **Look for underlying patterns, not surface symptoms**
   - "Agent gave wrong date" → might be "Temporal reasoning errors"
   - "Agent made up a feature" → might be "Hallucinated information"
   - "Agent ignored the user's context" → might be "Context window issues"

3. **Name categories after ROOT CAUSES, not symptoms**
   Good: "Policy misinterpretation", "Temporal confusion", "Scope creep"
   Bad: "Wrong answer", "Bad response", "Error"

4. **A good failure mode is:**
   - Specific enough to be actionable (can write a fix for it)
   - General enough to capture multiple instances
   - Named after the underlying cause

## Example failure modes for reference:
- "Hallucinated information" - Agent makes up facts not in context
- "Context ignored" - Agent misses relevant context in conversation
- "Temporal confusion" - Gets dates, times, deadlines wrong
- "Scope creep" - Does more than asked or goes off-topic
- "Format violations" - Doesn't follow requested output format
- "Escalation failure" - Doesn't recognize when to hand off to human""",

    user_prompt_template="""Agent context:
{agent_context}

Given this observation/note about an agent failure:
"{note_content}"

And these existing failure mode categories:
{modes_text}

First, analyze:
1. What went wrong? (the symptom observed)
2. WHY did it go wrong? (the root cause)
3. Does this root cause match an existing category?

Then decide: Does this note fit an EXISTING category (provide the ID), or is it a NEW failure pattern?""",

    available_variables=[
        "note_content",
        "modes_text",
        "agent_name",
        "agent_context"
    ]
)


CATEGORY_CREATION_PROMPT = PromptConfig(
    id="category_creation",
    name="New Category Creation",
    description="Creates a new failure mode category when no existing category fits",
    feature="taxonomy",
    
    system_prompt="""You are analyzing failure modes for an AI agent. Create a new failure mode category for the given issue.

## Naming Guidelines
- Name after the ROOT CAUSE, not the symptom
- Be specific enough to be actionable
- Be general enough to capture similar issues

## Examples of good category names:
- "Hallucinated product features" (not "Wrong information")
- "Policy version confusion" (not "Gave wrong policy")
- "Multi-turn context loss" (not "Forgot what user said")
- "Numerical calculation errors" (not "Wrong numbers")""",

    user_prompt_template="""Agent context:
{agent_context}

Given this observation/note about an agent failure:
"{note_content}"

Create a failure mode category for this issue.

First, identify:
1. What is the SYMPTOM? (what the user observed)
2. What is the ROOT CAUSE? (why did this happen?)
3. What would you NAME this failure pattern?

Then provide a name, description, and suggested fix.""",

    available_variables=[
        "note_content",
        "agent_name",
        "agent_context"
    ]
)

