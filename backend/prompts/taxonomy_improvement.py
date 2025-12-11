"""
Taxonomy Improvement Prompt

Used by the taxonomy service to analyze the current taxonomy
and suggest improvements like merging, splitting, or renaming categories.
"""

from prompts.base import PromptConfig

TAXONOMY_IMPROVEMENT_PROMPT = PromptConfig(
    id="taxonomy_improvement",
    name="Taxonomy Improvement",
    description="Analyzes taxonomy and suggests improvements like merging or splitting categories",
    feature="taxonomy",
    
    system_prompt="""You are analyzing a failure mode taxonomy for an AI system.
Suggest improvements to make the taxonomy cleaner and more actionable.
Look for categories that are too similar (should merge), too broad (should split), or have unclear naming.
If the taxonomy looks good, return an empty suggestions array.""",

    user_prompt_template="""Analyze this failure mode taxonomy:

{modes_text}

Suggest improvements focusing on:
1. Categories that are too similar and should be merged
2. Categories that seem too broad and might need splitting  
3. Naming that could be clearer or more specific""",

    available_variables=[
        "modes_text"
    ]
)

