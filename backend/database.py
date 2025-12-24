"""
SQLite database setup for error analysis application with optimized connection handling.

Stores:
- Failure modes (the taxonomy categories)
- Note assignments (which notes belong to which failure mode)
- Saturation tracking (new failure modes discovered over time)
- Agents and their context
- Synthetic batches and queries
- Auto-review results
- Weave feedback (synced from Weave for taxonomy analysis)
- AI suggestions for trace quality issues

Note: Session management has been removed from local storage. Users review
traces directly in Weave's native UI and feedback is synced back for taxonomy.

Optimizations:
- Connection pooling via thread-local storage
- WAL mode for better concurrent read/write performance
- Deferred transaction handling
- Configurable database path via environment variable
- Comprehensive indexes for fast filtering
"""

import os
import sqlite3
import uuid
import threading
from datetime import datetime
from pathlib import Path
from contextlib import contextmanager
from typing import Optional

# Database file location - configurable via environment variable
DEFAULT_DB_PATH = Path(__file__).parent / "taxonomy.db"
DB_PATH = Path(os.environ.get("ERROR_ANALYSIS_DB_PATH", str(DEFAULT_DB_PATH)))

# Thread-local storage for connections (connection pooling)
_local = threading.local()

# Lock for initialization
_init_lock = threading.Lock()
_initialized = False


def _get_thread_connection() -> sqlite3.Connection:
    """
    Get or create a database connection for the current thread.
    Uses thread-local storage to reuse connections within the same thread.
    """
    if not hasattr(_local, "connection") or _local.connection is None:
        conn = sqlite3.connect(
            str(DB_PATH),
            check_same_thread=False,  # Allow connection sharing within thread
            timeout=30.0,  # Wait up to 30s for locks
        )
        conn.row_factory = sqlite3.Row
        
        # Enable WAL mode for better concurrency (write-ahead logging)
        conn.execute("PRAGMA journal_mode=WAL")
        
        # Enable foreign keys
        conn.execute("PRAGMA foreign_keys=ON")
        
        # Optimize for speed while maintaining safety
        conn.execute("PRAGMA synchronous=NORMAL")
        
        # Increase cache size (negative = KB, so -64000 = 64MB)
        conn.execute("PRAGMA cache_size=-64000")
        
        # Memory-map size (256MB)
        conn.execute("PRAGMA mmap_size=268435456")
        
        # Temp store in memory
        conn.execute("PRAGMA temp_store=MEMORY")
        
        _local.connection = conn
    
    return _local.connection


def close_thread_connection():
    """Close the connection for the current thread. Call this when thread is done."""
    if hasattr(_local, "connection") and _local.connection is not None:
        try:
            _local.connection.close()
        except Exception:
            pass
        _local.connection = None


@contextmanager
def get_db():
    """
    Context manager for database operations.
    Reuses the thread-local connection for efficiency.
    Uses deferred transactions for better performance.
    """
    conn = _get_thread_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("BEGIN DEFERRED")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


@contextmanager  
def get_db_readonly():
    """
    Context manager for read-only database operations.
    Uses BEGIN DEFERRED which won't acquire locks until first write.
    """
    conn = _get_thread_connection()
    try:
        yield conn
    except Exception:
        raise


def init_db():
    """Initialize the database schema. Thread-safe, runs only once."""
    global _initialized
    
    if _initialized:
        return
    
    with _init_lock:
        if _initialized:
            return
        
        conn = _get_thread_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute("BEGIN EXCLUSIVE")  # Lock for schema changes
            
            # Failure modes table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS failure_modes (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    severity TEXT DEFAULT 'medium',
                    suggested_fix TEXT,
                    created_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    times_seen INTEGER DEFAULT 1,
                    status TEXT DEFAULT 'active',
                    status_changed_at TEXT
                )
            """)
            
            # Migration: Add status columns to failure_modes if they don't exist
            cursor.execute("PRAGMA table_info(failure_modes)")
            fm_columns = [col[1] for col in cursor.fetchall()]
            if "status" not in fm_columns:
                cursor.execute("ALTER TABLE failure_modes ADD COLUMN status TEXT DEFAULT 'active'")
            if "status_changed_at" not in fm_columns:
                cursor.execute("ALTER TABLE failure_modes ADD COLUMN status_changed_at TEXT")
            if "agent_id" not in fm_columns:
                cursor.execute("ALTER TABLE failure_modes ADD COLUMN agent_id TEXT")
            
            # Notes table - tracks which Weave notes are assigned to which failure mode
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS notes (
                    id TEXT PRIMARY KEY,
                    weave_feedback_id TEXT,
                    content TEXT NOT NULL,
                    trace_id TEXT,
                    weave_ref TEXT,
                    weave_url TEXT,
                    failure_mode_id TEXT,
                    assignment_method TEXT,
                    created_at TEXT NOT NULL,
                    assigned_at TEXT,
                    session_id TEXT,
                    source_type TEXT DEFAULT 'weave_feedback',
                    FOREIGN KEY (failure_mode_id) REFERENCES failure_modes(id)
                )
            """)
            
            # Migration: Add session_id, source_type, and agent_id columns if they don't exist
            cursor.execute("PRAGMA table_info(notes)")
            columns = [col[1] for col in cursor.fetchall()]
            if "session_id" not in columns:
                cursor.execute("ALTER TABLE notes ADD COLUMN session_id TEXT")
            if "source_type" not in columns:
                cursor.execute("ALTER TABLE notes ADD COLUMN source_type TEXT DEFAULT 'weave_feedback'")
            if "agent_id" not in columns:
                cursor.execute("ALTER TABLE notes ADD COLUMN agent_id TEXT")
            
            # Saturation log - tracks discovery of new failure modes over time
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS saturation_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    notes_processed INTEGER NOT NULL,
                    new_modes_created INTEGER NOT NULL,
                    existing_modes_matched INTEGER NOT NULL,
                    total_modes_after INTEGER NOT NULL
                )
            """)
            
            # Saturation snapshots - tracks cumulative discovery curve
            # Records a point on the "failure modes vs threads reviewed" chart
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS saturation_snapshots (
                    id TEXT PRIMARY KEY,
                    snapshot_date TEXT NOT NULL,
                    threads_reviewed INTEGER NOT NULL,
                    failure_modes_count INTEGER NOT NULL,
                    categorized_notes INTEGER NOT NULL DEFAULT 0,
                    saturation_score REAL NOT NULL DEFAULT 0.0
                )
            """)
            
            # Reviewed threads table - tracks which threads have been reviewed
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS reviewed_threads (
                    thread_id TEXT PRIMARY KEY,
                    reviewed_at TEXT NOT NULL,
                    reviewer_notes TEXT
                )
            """)
            
            # Annotation settings table - stores user preferences
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS annotation_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            """)
            
            # Initialize default review target
            cursor.execute("""
                INSERT OR IGNORE INTO annotation_settings (key, value) 
                VALUES ('review_target', '100')
            """)
            
            # =====================================================================
            # Phase 1: Agent Registry Tables
            # =====================================================================
            
            # Registered agents table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS agents (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    endpoint_url TEXT NOT NULL,
                    weave_project TEXT,
                    agent_context TEXT,
                    connection_status TEXT DEFAULT 'unknown',
                    last_connection_test TEXT,
                    is_example BOOLEAN DEFAULT FALSE,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            
            # Migration: Add is_example column if it doesn't exist
            cursor.execute("PRAGMA table_info(agents)")
            agent_columns = [col[1] for col in cursor.fetchall()]
            if "is_example" not in agent_columns:
                cursor.execute("ALTER TABLE agents ADD COLUMN is_example BOOLEAN DEFAULT FALSE")
            
            # Migration: Add weave_project column for tracking agent's trace project
            if "weave_project" not in agent_columns:
                cursor.execute("ALTER TABLE agents ADD COLUMN weave_project TEXT")
            
            # Migration: Add agent_context column for existing databases
            if "agent_context" not in agent_columns:
                cursor.execute("ALTER TABLE agents ADD COLUMN agent_context TEXT")
            
            # Testing dimensions for synthetic data generation
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS agent_dimensions (
                    id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    dimension_values JSON NOT NULL,
                    descriptions JSON,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
                )
            """)
            
            # Agent versions for tracking changes
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS agent_versions (
                    id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL,
                    version TEXT NOT NULL,
                    changes_summary TEXT,
                    agent_context_snapshot TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
                )
            """)
            
            # Synthetic batches for generated test data
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS synthetic_batches (
                    id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL,
                    name TEXT,
                    status TEXT DEFAULT 'pending',
                    generation_strategy TEXT,
                    query_count INTEGER DEFAULT 0,
                    success_count INTEGER DEFAULT 0,
                    failure_count INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    completed_at TEXT,
                    weave_dataset_ref TEXT,
                    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
                )
            """)
            
            # Individual synthetic queries within a batch
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS synthetic_queries (
                    id TEXT PRIMARY KEY,
                    batch_id TEXT NOT NULL,
                    dimension_tuple JSON,
                    query_text TEXT NOT NULL,
                    trace_id TEXT,
                    thread_id TEXT,
                    execution_status TEXT DEFAULT 'pending',
                    response_text TEXT,
                    error_message TEXT,
                    started_at TEXT,
                    completed_at TEXT,
                    FOREIGN KEY (batch_id) REFERENCES synthetic_batches(id) ON DELETE CASCADE
                )
            """)
            
            # Create indexes for common queries
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_notes_failure_mode 
                ON notes(failure_mode_id)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_notes_unassigned 
                ON notes(failure_mode_id) WHERE failure_mode_id IS NULL
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_saturation_timestamp 
                ON saturation_log(timestamp)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_saturation_snapshots_threads 
                ON saturation_snapshots(threads_reviewed)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_reviewed_threads_date 
                ON reviewed_threads(reviewed_at)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_agents_name 
                ON agents(name)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_agent_dimensions_agent 
                ON agent_dimensions(agent_id)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_synthetic_batches_agent 
                ON synthetic_batches(agent_id)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_synthetic_queries_batch 
                ON synthetic_queries(batch_id)
            """)
            
            # Composite indexes for common query patterns
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_batches_agent_status 
                ON synthetic_batches(agent_id, status)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_queries_batch_status 
                ON synthetic_queries(batch_id, execution_status)
            """)
            
            # Migration: Add thread_id column if it doesn't exist (for existing databases)
            cursor.execute("PRAGMA table_info(synthetic_queries)")
            columns = [col[1] for col in cursor.fetchall()]
            if "thread_id" not in columns:
                cursor.execute("ALTER TABLE synthetic_queries ADD COLUMN thread_id TEXT")
            
            # Migration: Add weave_dataset_ref column to synthetic_batches
            cursor.execute("PRAGMA table_info(synthetic_batches)")
            batch_columns = [col[1] for col in cursor.fetchall()]
            if "weave_dataset_ref" not in batch_columns:
                cursor.execute("ALTER TABLE synthetic_batches ADD COLUMN weave_dataset_ref TEXT")
            
            # Create index on thread_id (after ensuring the column exists)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_synthetic_queries_thread 
                ON synthetic_queries(thread_id)
            """)
            
            # =====================================================================
            # Phase 5: Auto Review Tables
            # =====================================================================
            
            # Auto reviews table - stores automated review results
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS auto_reviews (
                    id TEXT PRIMARY KEY,
                    batch_id TEXT NOT NULL,
                    agent_id TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    model_used TEXT,
                    failure_categories JSON,
                    classifications JSON,
                    report_markdown TEXT,
                    error_message TEXT,
                    created_at TEXT NOT NULL,
                    completed_at TEXT,
                    FOREIGN KEY (batch_id) REFERENCES synthetic_batches(id) ON DELETE CASCADE,
                    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
                )
            """)
            
            # Index for querying reviews by batch
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_auto_reviews_batch 
                ON auto_reviews(batch_id)
            """)
            
            # Index for querying reviews by agent
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_auto_reviews_agent 
                ON auto_reviews(agent_id)
            """)
            
            # =====================================================================
            # AI Suggestions Table (for suggestion service)
            # =====================================================================
            # 
            # Stores AI-generated suggestions for trace quality issues.
            # These are pre-computed during batch analysis and shown during
            # human review to speed up annotation.
            #
            # See: fails.md for full design
            # =====================================================================
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS trace_suggestions (
                    id TEXT PRIMARY KEY,
                    trace_id TEXT NOT NULL,
                    batch_id TEXT,
                    session_id TEXT,
                    
                    -- Analysis result
                    has_issue BOOLEAN NOT NULL,
                    suggested_note TEXT,
                    confidence REAL,
                    thinking TEXT,
                    
                    -- Category suggestion (one of these will be set)
                    failure_mode_id TEXT,
                    suggested_category TEXT,
                    
                    -- User action
                    status TEXT DEFAULT 'pending',
                    user_note_id TEXT,
                    
                    created_at TEXT DEFAULT (datetime('now')),
                    reviewed_at TEXT,
                    
                    FOREIGN KEY (batch_id) REFERENCES synthetic_batches(id),
                    FOREIGN KEY (failure_mode_id) REFERENCES failure_modes(id)
                )
            """)
            
            # Indexes for trace_suggestions
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_suggestions_batch 
                ON trace_suggestions(batch_id)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_suggestions_status 
                ON trace_suggestions(status)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_suggestions_failure_mode 
                ON trace_suggestions(failure_mode_id)
            """)
            
            # =====================================================================
            # Taxonomy Improvement Suggestions Table
            # =====================================================================
            # 
            # Stores AI-generated taxonomy improvement suggestions (merge, split, rename).
            # These persist across page refreshes and sessions until dismissed or applied.
            # =====================================================================
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS taxonomy_suggestions (
                    id TEXT PRIMARY KEY,
                    agent_id TEXT,
                    suggestion_type TEXT NOT NULL,
                    mode_ids JSON NOT NULL,
                    reason TEXT NOT NULL,
                    suggested_name TEXT,
                    status TEXT DEFAULT 'active',
                    dismissed_at TEXT,
                    applied_at TEXT,
                    created_at TEXT NOT NULL,
                    batch_id TEXT
                )
            """)
            
            # Indexes for taxonomy_suggestions
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_taxonomy_suggestions_agent 
                ON taxonomy_suggestions(agent_id)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_taxonomy_suggestions_status 
                ON taxonomy_suggestions(status)
            """)
            
            # =====================================================================
            # Settings Table - Application configuration
            # =====================================================================
            
            # Settings table for storing configuration (LLM, Weave, etc.)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    is_secret BOOLEAN DEFAULT FALSE,
                    description TEXT,
                    updated_at TEXT NOT NULL
                )
            """)
            
            # =====================================================================
            # Weave Feedback Table (for Clean Architecture - Weave-Native Review)
            # =====================================================================
            # 
            # Stores feedback synced from Weave for taxonomy analysis.
            # Users add feedback in Weave's native UI during trace review,
            # and we sync it back here for categorization into failure modes.
            #
            # See: architecture_clean.md for full design
            # =====================================================================
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS weave_feedback (
                    id TEXT PRIMARY KEY,
                    trace_id TEXT NOT NULL,
                    batch_id TEXT,
                    feedback_type TEXT,
                    payload TEXT,
                    created_at TEXT,
                    synced_at TEXT,
                    
                    FOREIGN KEY (batch_id) REFERENCES synthetic_batches(id) ON DELETE SET NULL
                )
            """)
            
            # Indexes for weave_feedback
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_weave_feedback_trace 
                ON weave_feedback(trace_id)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_weave_feedback_batch 
                ON weave_feedback(batch_id)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_weave_feedback_type 
                ON weave_feedback(feedback_type)
            """)
            
            conn.commit()
            _initialized = True
            
        except Exception:
            conn.rollback()
            raise


def generate_id() -> str:
    """Generate a unique ID."""
    return str(uuid.uuid4())


def now_iso() -> str:
    """Get current timestamp in ISO format with UTC timezone marker."""
    return datetime.utcnow().isoformat() + "Z"


def optimize_db():
    """
    Run database optimization. Call periodically or after major operations.
    """
    conn = _get_thread_connection()
    cursor = conn.cursor()
    
    # Analyze tables for query optimization
    cursor.execute("ANALYZE")
    
    # Optimize the database file (reclaim space)
    cursor.execute("PRAGMA optimize")
    
    conn.commit()


def vacuum_db():
    """
    Vacuum the database to reclaim space and defragment.
    Note: This rebuilds the entire database file and can be slow.
    Call infrequently (e.g., weekly maintenance).
    """
    conn = _get_thread_connection()
    conn.execute("VACUUM")
    conn.commit()


def get_db_stats() -> dict:
    """Get database statistics for monitoring."""
    conn = _get_thread_connection()
    cursor = conn.cursor()
    
    stats = {}
    
    # Get table counts
    tables = [
        "failure_modes", "notes", "saturation_log", "saturation_snapshots",
        "reviewed_threads", "agents", "agent_dimensions", "agent_versions", 
        "synthetic_batches", "synthetic_queries", "auto_reviews",
        "weave_feedback", "trace_suggestions", "taxonomy_suggestions"
    ]
    
    for table in tables:
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            stats[f"{table}_count"] = cursor.fetchone()[0]
        except Exception:
            stats[f"{table}_count"] = 0
    
    # Get database file size
    try:
        stats["db_size_bytes"] = DB_PATH.stat().st_size
        stats["db_size_mb"] = round(stats["db_size_bytes"] / (1024 * 1024), 2)
    except Exception:
        stats["db_size_bytes"] = 0
        stats["db_size_mb"] = 0
    
    # Get page stats
    cursor.execute("PRAGMA page_count")
    stats["page_count"] = cursor.fetchone()[0]
    
    cursor.execute("PRAGMA page_size")
    stats["page_size"] = cursor.fetchone()[0]
    
    cursor.execute("PRAGMA freelist_count")
    stats["freelist_pages"] = cursor.fetchone()[0]
    
    return stats


def ensure_initialized():
    """
    Ensure the database is initialized. Call this from FastAPI lifespan
    or before first database access.
    
    This is idempotent - safe to call multiple times.
    """
    init_db()
