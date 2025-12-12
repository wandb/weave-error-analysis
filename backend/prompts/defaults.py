"""
Default Prompts Registry

Central registry of all default prompts used in the application.
"""

from prompts.trace_analysis import TRACE_ANALYSIS_PROMPT
from prompts.category_suggestion import CATEGORY_SUGGESTION_PROMPT, CATEGORY_CREATION_PROMPT
from prompts.taxonomy_improvement import TAXONOMY_IMPROVEMENT_PROMPT
from prompts.tuple_generation import TUPLE_GENERATION_PROMPT, TUPLE_GENERATION_FREE_PROMPT
from prompts.query_generation import QUERY_GENERATION_PROMPT


# All default prompts, keyed by ID
DEFAULT_PROMPTS = {
    "trace_analysis": TRACE_ANALYSIS_PROMPT,
    "category_suggestion": CATEGORY_SUGGESTION_PROMPT,
    "category_creation": CATEGORY_CREATION_PROMPT,
    "taxonomy_improvement": TAXONOMY_IMPROVEMENT_PROMPT,
    "tuple_generation": TUPLE_GENERATION_PROMPT,
    "tuple_generation_free": TUPLE_GENERATION_FREE_PROMPT,
    "query_generation": QUERY_GENERATION_PROMPT,
}


# Group by feature for UI display
# Note: tuple_generation_free is now an alias for tuple_generation (merged prompt)
PROMPTS_BY_FEATURE = {
    "suggestions": ["trace_analysis"],
    "taxonomy": ["category_suggestion", "category_creation", "taxonomy_improvement"],
    "synthetic": ["tuple_generation", "query_generation"],
}

