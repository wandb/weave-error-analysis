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
    synthetic_router,
    settings_router,
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
app.include_router(synthetic_router)
app.include_router(settings_router)


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "error-analysis-backend",
        "project": PROJECT_ID
    }


@app.get("/api/db-stats")
async def db_stats():
    """Get database statistics for monitoring."""
    from database import get_db_stats, optimize_db
    return get_db_stats()


@app.post("/api/db-optimize")
async def db_optimize():
    """Trigger database optimization (analyze tables)."""
    from database import optimize_db
    optimize_db()
    return {"status": "optimized"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
