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


def generate_id() -> str:
    """Generate a unique ID."""
    return str(uuid.uuid4())


def now_iso() -> str:
    """Get current timestamp in ISO format."""
    return datetime.utcnow().isoformat()


# Initialize database on import
init_db()

