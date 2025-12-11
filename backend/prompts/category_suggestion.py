"""
Category Suggestion Prompt

Used by the taxonomy service to suggest which failure mode category
a note belongs to, or to create a new category.
"""

from prompts.base import PromptConfig

CATEGORY_SUGGESTION_PROMPT = PromptConfig(
    id="category_suggestion",
    name="Category Suggestion",
    description="Suggests which failure mode category a note belongs to",
    feature="taxonomy",
    
    system_prompt="""You are analyzing failure modes in an AI system.
Be conservative about creating new categories. Only suggest a new category if the note describes a fundamentally different type of failure.""",

    user_prompt_template="""Given this observation/note about an AI failure:
"{note_content}"

And these existing failure mode categories:
{modes_text}

Does this note fit into one of the existing categories, or does it represent a NEW type of failure?""",

    available_variables=[
        "note_content",
        "modes_text"
    ]
)


CATEGORY_CREATION_PROMPT = PromptConfig(
    id="category_creation",
    name="New Category Creation",
    description="Creates a new failure mode category when no existing category fits",
    feature="taxonomy",
    
    system_prompt="You are analyzing failure modes in an AI system. Create a new failure mode category for the given issue.",

    user_prompt_template="""Given this observation/note about an AI failure:
"{note_content}"

Create a failure mode category for this issue. Since there are no existing categories, this will be the first one.""",

    available_variables=[
        "note_content"
    ]
)

