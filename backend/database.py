"""
SQLite database setup for taxonomy persistence with optimized connection handling.

Stores:
- Failure modes (the taxonomy categories)
- Note assignments (which notes belong to which failure mode)
- Saturation tracking (new failure modes discovered over time)

Optimizations:
- Connection pooling via thread-local storage
- WAL mode for better concurrent read/write performance
- Deferred transaction handling
- Configurable database path via environment variable
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
                    times_seen INTEGER DEFAULT 1
                )
            """)
            
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
                    FOREIGN KEY (failure_mode_id) REFERENCES failure_modes(id)
                )
            """)
            
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
                    version TEXT DEFAULT '1.0.0',
                    agent_type TEXT,
                    framework TEXT,
                    endpoint_url TEXT NOT NULL,
                    agent_info_raw TEXT NOT NULL,
                    agent_info_parsed JSON,
                    connection_status TEXT DEFAULT 'unknown',
                    last_connection_test TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            
            # Testing dimensions extracted from AGENT_INFO
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
                    agent_info_snapshot TEXT,
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
            
            # Migration: Add thread_id column if it doesn't exist (for existing databases)
            cursor.execute("PRAGMA table_info(synthetic_queries)")
            columns = [col[1] for col in cursor.fetchall()]
            if "thread_id" not in columns:
                cursor.execute("ALTER TABLE synthetic_queries ADD COLUMN thread_id TEXT")
            
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
            
            conn.commit()
            _initialized = True
            
        except Exception:
            conn.rollback()
            raise


def generate_id() -> str:
    """Generate a unique ID."""
    return str(uuid.uuid4())


def now_iso() -> str:
    """Get current timestamp in ISO format."""
    return datetime.utcnow().isoformat()


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
        "failure_modes", "notes", "saturation_log", "reviewed_threads",
        "agents", "agent_dimensions", "agent_versions", 
        "synthetic_batches", "synthetic_queries", "auto_reviews"
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


# Initialize database on import
init_db()
