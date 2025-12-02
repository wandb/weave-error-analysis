"""
Backend Service for Error Analysis Workflow

Uses Weave Trace API (https://trace.wandb.ai) to query traces and feedback.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import CORS_ORIGINS, PROJECT_ID
from routers import (
    threads_router,
    traces_router,
    feedback_router,
    categorize_router,
    taxonomy_router,
    agents_router,
)

app = FastAPI(
    title="Error Analysis Backend",
    description="Backend service for AI error analysis workflow",
    version="1.0.0"
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(threads_router)
app.include_router(traces_router)
app.include_router(feedback_router)
app.include_router(categorize_router)
app.include_router(taxonomy_router)
app.include_router(agents_router)


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "error-analysis-backend",
        "project": PROJECT_ID
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
