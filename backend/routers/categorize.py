"""
LLM-powered categorization endpoint.
"""

import json

from fastapi import APIRouter, HTTPException
import litellm

from config import CATEGORIZATION_MODEL
from models import CategorizeRequest

router = APIRouter(prefix="/api", tags=["categorize"])


CATEGORIZATION_PROMPT = """You are an expert at analyzing AI system failures. Given the following notes/observations about AI system behavior, identify and categorize the common failure modes.

NOTES:
{notes_text}

Your task:
1. Identify distinct failure mode categories (cluster similar issues together)
2. Give each category a clear, descriptive name
3. Provide a brief description of each category
4. List which notes belong to each category

Respond in this JSON format:
{{
    "categories": [
        {{
            "name": "Category Name",
            "description": "Brief description of this failure mode",
            "note_indices": [0, 2, 5],
            "severity": "high|medium|low",
            "suggested_fix": "Brief suggestion for addressing this issue"
        }}
    ],
    "summary": "Overall summary of the main issues found"
}}

Be specific and actionable. Focus on patterns that appear multiple times."""


@router.post("/categorize")
async def categorize_notes(request: CategorizeRequest):
    """Use LLM to categorize notes into failure modes."""
    if not request.notes:
        return {"categories": [], "summary": "No notes to categorize"}

    try:
        notes_text = "\n".join([f"- {note}" for note in request.notes])
        prompt = CATEGORIZATION_PROMPT.format(notes_text=notes_text)

        response = litellm.completion(
            model=CATEGORIZATION_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"}
        )

        result = json.loads(response.choices[0].message.content)
        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error categorizing notes: {str(e)}")

