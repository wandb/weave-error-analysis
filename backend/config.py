"""
Configuration for the Error Analysis Backend.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from parent directory (project root)
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

# W&B / Weave Configuration
WANDB_API_KEY = os.getenv("WANDB_API_KEY")
WANDB_ENTITY = os.getenv("WANDB_ENTITY")
WEAVE_PROJECT = os.getenv("WEAVE_PROJECT", "error-analysis-demo")
PROJECT_ID = f"{WANDB_ENTITY}/{WEAVE_PROJECT}" if WANDB_ENTITY else WEAVE_PROJECT

# Weave Trace API
WEAVE_API_BASE = "https://trace.wandb.ai"

# LLM Configuration
CATEGORIZATION_MODEL = os.getenv("CATEGORIZATION_MODEL", "gpt-4o-mini")

# CORS Origins
CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

