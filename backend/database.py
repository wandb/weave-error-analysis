"""
SQLite database setup for taxonomy persistence.

Stores:
- Failure modes (the taxonomy categories)
- Note assignments (which notes belong to which failure mode)
- Saturation tracking (new failure modes discovered over time)
"""

import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from contextlib import contextmanager
from typing import Optional

# Database file location
DB_PATH = Path(__file__).parent / "taxonomy.db"


def get_connection() -> sqlite3.Connection:
    """Get a database connection with row factory."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def get_db():
    """Context manager for database connections."""
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Initialize the database schema."""
    with get_db() as conn:
        cursor = conn.cursor()
        
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


def generate_id() -> str:
    """Generate a unique ID."""
    return str(uuid.uuid4())


def now_iso() -> str:
    """Get current timestamp in ISO format."""
    return datetime.utcnow().isoformat()


# Initialize database on import
init_db()

