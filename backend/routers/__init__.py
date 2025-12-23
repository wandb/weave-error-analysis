"""Routers package for API endpoint handlers."""

from .feedback import router as feedback_router
from .taxonomy import router as taxonomy_router
from .agents import router as agents_router
from .synthetic import router as synthetic_router
from .settings import router as settings_router
from .prompts import router as prompts_router

__all__ = [
    "feedback_router",
    "taxonomy_router",
    "agents_router",
    "synthetic_router",
    "settings_router",
    "prompts_router",
]

