"""
Default Prompts Registry

Central registry of all default prompts used in the application.
"""

from prompts.category_suggestion import CATEGORY_SUGGESTION_PROMPT, CATEGORY_CREATION_PROMPT
from prompts.taxonomy_improvement import TAXONOMY_IMPROVEMENT_PROMPT
from prompts.query_generation import QUERY_GENERATION_PROMPT
from prompts.dimension_suggestion import DIMENSION_SUGGESTION_PROMPT
from prompts.value_suggestion import VALUE_SUGGESTION_PROMPT


# All default prompts, keyed by ID
DEFAULT_PROMPTS = {
    "category_suggestion": CATEGORY_SUGGESTION_PROMPT,
    "category_creation": CATEGORY_CREATION_PROMPT,
    "taxonomy_improvement": TAXONOMY_IMPROVEMENT_PROMPT,
    "query_generation": QUERY_GENERATION_PROMPT,
    "dimension_suggestion": DIMENSION_SUGGESTION_PROMPT,
    "value_suggestion": VALUE_SUGGESTION_PROMPT,
}


# Group by feature for UI display
PROMPTS_BY_FEATURE = {
    "taxonomy": ["category_suggestion", "category_creation", "taxonomy_improvement"],
    "synthetic": ["query_generation", "dimension_suggestion", "value_suggestion"],
}

