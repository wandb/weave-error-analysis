# Sessions Tab: Core Logic Improvements

A comprehensive technical document outlining the required improvements to the Sessions tab for robust session management, filtering, and review workflow integration.

---

## 1. Current State Analysis

### 1.1 How Sessions Work Today

The current Sessions tab implementation has several interconnected pieces that create a fragile system:

**Data Flow:**
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CURRENT DATA FLOW                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Weave API                        Backend (threads.py)                       │
│  ┌──────────────┐                 ┌──────────────────────────────────────┐  │
│  │ /calls/      │ ─────(500)────→ │ 1. Fetch ALL calls                   │  │
│  │ stream_query │                 │ 2. Group by session_id from summary  │  │
│  └──────────────┘                 │ 3. Build parent-child map            │  │
│                                   │ 4. Filter "real" sessions            │  │
│                                   │ 5. Check DB for review status        │  │
│                                   └──────────────────┬───────────────────┘  │
│                                                      │                       │
│                                                      ▼                       │
│                                   ┌──────────────────────────────────────┐  │
│                                   │ Return sessions list                 │  │
│                                   │ (thread_id, turn_count, timestamps)  │  │
│                                   └──────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key File Locations:**

| Component | File | Purpose |
|-----------|------|---------|
| Sessions List API | `backend/routers/threads.py:45-229` | Fetches and groups sessions |
| Session Detail API | `backend/routers/threads.py:232-338` | Gets conversation for a session |
| Weave Client | `backend/services/weave_client.py` | HTTP calls to Weave API |
| Conversation Parser | `backend/services/conversation.py` | Extracts user/assistant/tool messages |
| Annotation Service | `backend/services/annotation.py` | Tracks review status in local DB |
| Frontend Tab | `frontend/src/app/components/tabs/SessionsTab.tsx` | UI rendering |
| Frontend State | `frontend/src/app/context/AppContext.tsx` | State management |

### 1.2 Critical Problems

#### Problem 1: No Local Session Cache

Every time we display sessions, we:
1. Fetch 500 traces from Weave API (network call)
2. Group them in memory by `session_id`
3. Filter and sort in memory
4. Check local DB for review status

**Impact:** Slow initial load, no offline capability, repeated network calls, can't build rich local metadata.

#### Problem 2: Session-Batch Linkage is Fragile

When a batch is executed:
1. Each query runs through the agent
2. The agent logs traces to Weave with a `trace_id`
3. We store `trace_id` in `synthetic_queries.trace_id`
4. Session grouping uses `session_id` (often derived from `thread_id`)
5. The linkage depends on matching these IDs correctly

**Current code in `threads.py:131-174`:**
```python
# Get both thread_id and trace_id from synthetic_queries for the batch
cursor.execute("""
    SELECT thread_id, trace_id 
    FROM synthetic_queries 
    WHERE batch_id = ?
""", (batch_id,))

# ... matching logic is complex and brittle
if session_id not in batch_session_ids:
    call_trace_ids = set(c.get("trace_id") for c in session_data["calls"])
    if not call_trace_ids.intersection(batch_session_ids):
        continue
```

**Impact:** Batch filter often doesn't work correctly; sessions may not appear under their batch.

#### Problem 3: Hardcoded Filters

The "5+ turns" filter is the only turn-count option:

```typescript
// SessionsTab.tsx:181-188
<button
  onClick={() => setFilterMinTurns(filterMinTurns === 5 ? null : 5)}
  className={...}
>
  5+ turns
</button>
```

**Impact:** Can't filter by custom turn counts, no max turns filter, can't create ranges.

#### Problem 4: No Token/Cost/Latency Metadata

Session metadata is computed on-the-fly from traces:
- Latency: Calculated from `started_at`/`ended_at` timestamps
- Token counts: Not extracted
- Cost: Not calculated
- Model info: Not stored

**From `threads.py:280-296`:**
```python
for call in session_calls:
    if call.get("parent_id") is None:
        root_call_count += 1
        started = call.get("started_at")
        ended = call.get("ended_at")
        if started and ended:
            # Manual datetime parsing...
            total_latency_ms += (end_dt - start_dt).total_seconds() * 1000
```

**Impact:** No way to filter/sort by token usage or cost; metadata not persisted.

#### Problem 5: Review Progress Not Tied to Batches

The annotation progress is global across all sessions:

```python
# annotation.py:74-102
def get_annotation_progress(self) -> dict:
    cursor.execute("SELECT COUNT(*) as count FROM reviewed_threads")
    reviewed_count = cursor.fetchone()["count"]
    target = self.get_review_target()  # Global setting
```

**Impact:** When reviewing a batch, progress bar shows global numbers, not batch-specific.

#### Problem 6: Notes Don't Sync Back

Notes are created via Weave Feedback API but:
1. They're attached to call_ids, not session_ids
2. No local copy stored for filtering/searching
3. Can't search sessions by note content

---

## 2. Proposed Architecture

### 2.1 Background Sync Philosophy

**Key Principle: The Sessions tab reads from local DB only. It never waits for Weave.**

Sync happens in the background, triggered by:
1. **After batch execution completes** - Auto-sync that batch's sessions
2. **On app startup** - Light sync (new sessions since last sync)
3. **Periodically** - Optional background job (every 5-10 min if app is open)
4. **Manual trigger** - User clicks "Sync from Weave" button

The Sessions tab always shows what's in the local database - fast, instant, no spinners waiting for Weave API.

### 2.2 Local Session Store

Create a local cache of sessions that mirrors Weave data but adds our metadata:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PROPOSED DATA FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────┐        ┌─────────────────┐       ┌──────────────────┐  │
│  │   Weave API    │◄──────►│  Sync Service   │──────►│  Local SQLite    │  │
│  │   (source of   │        │  (periodic or   │       │  (fast queries,  │  │
│  │    truth)      │        │   on-demand)    │       │   rich metadata) │  │
│  └────────────────┘        └─────────────────┘       └────────┬─────────┘  │
│                                                               │             │
│                            ┌──────────────────────────────────┘             │
│                            │                                                │
│                            ▼                                                │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        Sessions API                                   │  │
│  │  • List sessions from LOCAL DB (fast)                                │  │
│  │  • Rich filtering (batch, turns, tokens, cost, reviewed, etc.)       │  │
│  │  • Fetch detail from Weave (for conversation)                        │  │
│  │  • Write notes to BOTH Weave AND local DB                            │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 New Database Schema

```sql
-- =====================================================================
-- Sessions Table: Local cache of Weave sessions with rich metadata
-- =====================================================================

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,                    -- session_id (thread_id or derived)
    
    -- Weave Identity
    weave_session_id TEXT,                  -- Original session_id from Weave
    root_trace_id TEXT,                     -- First/root trace_id in session
    weave_url TEXT,                         -- Direct link to Weave UI
    
    -- Batch Association (nullable for organic sessions)
    batch_id TEXT,                          -- Link to synthetic_batches.id
    query_id TEXT,                          -- Link to synthetic_queries.id
    
    -- Session Metrics (extracted from summary)
    turn_count INTEGER DEFAULT 0,
    call_count INTEGER DEFAULT 0,
    total_latency_ms REAL DEFAULT 0,
    
    -- Token & Cost Metrics (from summary.usage)
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    estimated_cost_usd REAL DEFAULT 0,
    
    -- Model Info
    primary_model TEXT,                     -- Most-used model in session
    
    -- Status
    has_error BOOLEAN DEFAULT FALSE,
    error_summary TEXT,
    
    -- Timestamps
    started_at TEXT,
    ended_at TEXT,
    
    -- Sync Metadata
    last_synced_at TEXT NOT NULL,
    sync_status TEXT DEFAULT 'synced',      -- 'synced', 'stale', 'error'
    
    -- Review Tracking (moved from reviewed_threads)
    is_reviewed BOOLEAN DEFAULT FALSE,
    reviewed_at TEXT,
    reviewed_by TEXT,                       -- For multi-user scenarios
    
    -- Created/Updated
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    
    -- Foreign Keys
    FOREIGN KEY (batch_id) REFERENCES synthetic_batches(id) ON DELETE SET NULL,
    FOREIGN KEY (query_id) REFERENCES synthetic_queries(id) ON DELETE SET NULL
);

-- =====================================================================
-- Session Notes Table: Local copy of notes with search capability
-- =====================================================================

CREATE TABLE session_notes (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    call_id TEXT,                           -- Specific call within session (optional)
    
    -- Note Content
    content TEXT NOT NULL,
    note_type TEXT DEFAULT 'observation',   -- 'observation', 'bug', 'success', 'question'
    
    -- Weave Sync
    weave_feedback_id TEXT,                 -- ID from Weave feedback API
    weave_ref TEXT,                         -- Full weave ref for the call
    synced_to_weave BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by TEXT,                        -- For multi-user scenarios
    
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- =====================================================================
-- Sync Status Table: Track background sync state
-- =====================================================================

CREATE TABLE sync_status (
    id TEXT PRIMARY KEY DEFAULT 'sessions',  -- Single row for session sync
    
    -- Last Successful Sync
    last_sync_started_at TEXT,
    last_sync_completed_at TEXT,
    last_sync_type TEXT,                    -- 'full', 'incremental', 'batch'
    last_sync_batch_id TEXT,                -- If sync was batch-specific
    
    -- Counts from Last Sync
    sessions_added INTEGER DEFAULT 0,
    sessions_updated INTEGER DEFAULT 0,
    sessions_failed INTEGER DEFAULT 0,
    
    -- Current Sync (if running)
    current_sync_started_at TEXT,
    current_sync_type TEXT,
    current_sync_progress REAL DEFAULT 0,   -- 0.0 to 1.0
    
    -- Status
    status TEXT DEFAULT 'idle',             -- 'idle', 'syncing', 'error'
    error_message TEXT,
    
    -- Weave Cursor (for incremental sync)
    last_weave_timestamp TEXT               -- Resume from here on next sync
);

-- Initialize with default row
INSERT OR IGNORE INTO sync_status (id) VALUES ('sessions');

-- =====================================================================
-- Indexes for Common Query Patterns
-- =====================================================================

-- Batch filtering (most common use case)
CREATE INDEX idx_sessions_batch ON sessions(batch_id);
CREATE INDEX idx_sessions_batch_reviewed ON sessions(batch_id, is_reviewed);

-- Turn-based filtering
CREATE INDEX idx_sessions_turns ON sessions(turn_count);

-- Time-based filtering/sorting
CREATE INDEX idx_sessions_started ON sessions(started_at DESC);
CREATE INDEX idx_sessions_ended ON sessions(ended_at DESC);

-- Review status
CREATE INDEX idx_sessions_reviewed ON sessions(is_reviewed);
CREATE INDEX idx_sessions_reviewed_at ON sessions(reviewed_at DESC);

-- Error filtering
CREATE INDEX idx_sessions_errors ON sessions(has_error);

-- Token/cost filtering
CREATE INDEX idx_sessions_tokens ON sessions(total_tokens);
CREATE INDEX idx_sessions_cost ON sessions(estimated_cost_usd);

-- Notes search
CREATE INDEX idx_notes_session ON session_notes(session_id);
CREATE INDEX idx_notes_content ON session_notes(content);
CREATE INDEX idx_notes_type ON session_notes(note_type);

-- Full-text search for notes (optional, for advanced search)
-- CREATE VIRTUAL TABLE session_notes_fts USING fts5(content, content=session_notes);
```

---

## 3. Detailed Requirements

### 3.1 Session Sync Service

**File:** `backend/services/session_sync.py`

A service responsible for syncing sessions from Weave to the local database. **This runs in the background, never blocking UI.**

#### 3.1.1 When Sync Happens

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SYNC TRIGGER POINTS                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. AFTER BATCH EXECUTION (Automatic)                                       │
│     ─────────────────────────────────                                       │
│     When: BatchExecutor completes a batch run                               │
│     Scope: Only sessions from that batch (using trace_ids)                  │
│     Blocking: No - fire and forget, UI doesn't wait                         │
│                                                                              │
│     async def on_batch_complete(batch_id: str):                              │
│         # Non-blocking: schedule sync in background                         │
│         asyncio.create_task(session_sync.sync_batch_sessions(batch_id))     │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  2. APP STARTUP (Automatic)                                                  │
│     ───────────────────────                                                  │
│     When: Backend server starts                                              │
│     Scope: Incremental - only sessions since last_synced_at                 │
│     Blocking: No - runs in background thread                                 │
│                                                                              │
│     @app.on_event("startup")                                                 │
│     async def startup_sync():                                                │
│         asyncio.create_task(session_sync.sync_incremental())                 │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  3. PERIODIC BACKGROUND JOB (Optional)                                       │
│     ──────────────────────────────────                                       │
│     When: Every 5-10 minutes while app is running                           │
│     Scope: Incremental sync                                                  │
│     Blocking: No - background task                                           │
│                                                                              │
│     # Using APScheduler or similar                                           │
│     scheduler.add_job(session_sync.sync_incremental, 'interval', minutes=5) │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  4. MANUAL TRIGGER (User-Initiated)                                          │
│     ─────────────────────────────────                                        │
│     When: User clicks "Sync from Weave" button in UI                         │
│     Scope: Full sync or incremental (user choice)                           │
│     Blocking: Shows progress indicator, but doesn't block other actions     │
│                                                                              │
│     POST /api/sessions/sync?full=false                                       │
│     → Returns immediately with sync_job_id                                   │
│     → Frontend polls or uses SSE for progress                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 3.1.2 What Sessions Tab Does

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SESSIONS TAB BEHAVIOR                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  User clicks "Sessions" tab                                                  │
│        │                                                                     │
│        ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ SELECT * FROM sessions                                              │   │
│  │ WHERE <filters>                                                      │   │
│  │ ORDER BY <sort>                                                      │   │
│  │ LIMIT 50                                                             │   │
│  └────────────────────────────────────┬────────────────────────────────┘   │
│                                       │                                      │
│                        LOCAL DB QUERY (< 50ms)                               │
│                                       │                                      │
│                                       ▼                                      │
│                              Render session list                             │
│                                                                              │
│  ❌ NO Weave API call                                                        │
│  ❌ NO waiting for sync                                                       │
│  ❌ NO "Loading..." spinner for data fetch                                   │
│  ✓ Instant response from local cache                                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 3.1.3 Sync Status Indicator

The UI should show sync status so users know if data is fresh:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Sessions                                             Last synced: 2 min ago │
│  ──────────────────────────────────────────────────  ○ Synced │ ⟳ Sync Now  │
└─────────────────────────────────────────────────────────────────────────────┘

// Sync status states:
// ○ Synced (green) - Last sync < 5 min ago
// ○ Stale (yellow) - Last sync > 5 min ago
// ○ Syncing... (blue spinner) - Background sync in progress
// ○ Error (red) - Last sync failed
```

**Requirements:**

| ID | Requirement | Priority |
|----|-------------|----------|
| SS-1 | Fetch sessions from Weave API | P0 |
| SS-2 | Extract `session_id` from summary or derive from thread_id/trace_id | P0 |
| SS-3 | Link sessions to batches using `synthetic_queries.trace_id` | P0 |
| SS-4 | Extract token counts from `summary.usage` | P1 |
| SS-5 | Calculate estimated cost based on model and token counts | P1 |
| SS-6 | Identify primary model from call data | P2 |
| SS-7 | Detect errors from `exception` field | P0 |
| SS-8 | Store first/last timestamps for session duration | P0 |
| SS-9 | Support incremental sync (only new sessions since last sync) | P0 |
| SS-10 | Handle sync failures gracefully (mark as stale) | P1 |
| SS-11 | **Non-blocking execution** - never block UI thread | P0 |
| SS-12 | Auto-trigger after batch execution | P0 |
| SS-13 | Startup sync on backend initialization | P1 |
| SS-14 | Track sync status (last_synced_at, sync_status) | P0 |

**Implementation Sketch:**

```python
# backend/services/session_sync.py

class SessionSyncService:
    """
    Syncs sessions from Weave to local SQLite database.
    
    The sync process:
    1. Fetch traces from Weave (with timestamp filter for incremental sync)
    2. Group traces by session_id (from summary or derived)
    3. Extract metrics (tokens, cost, latency, errors)
    4. Match to batch/query if trace_id exists in synthetic_queries
    5. Upsert to local sessions table
    """
    
    async def sync_sessions(
        self, 
        full_sync: bool = False,
        batch_id: Optional[str] = None
    ) -> SyncResult:
        """
        Sync sessions from Weave.
        
        Args:
            full_sync: If True, sync all sessions. If False, only sync since last sync.
            batch_id: If provided, only sync sessions linked to this batch.
            
        Returns:
            SyncResult with counts of synced/updated/failed sessions.
        """
        pass
    
    async def sync_batch_sessions(self, batch_id: str) -> SyncResult:
        """
        Sync only sessions from a specific batch.
        
        Called after batch execution completes to ensure all sessions are captured.
        """
        pass
    
    def _extract_session_metrics(self, calls: List[dict]) -> SessionMetrics:
        """Extract metrics from a list of calls belonging to one session."""
        pass
    
    def _match_to_batch(self, session_id: str, trace_ids: Set[str]) -> Optional[str]:
        """Find batch_id if any trace_id matches synthetic_queries."""
        pass
```

### 3.2 Session Repository

**File:** `backend/services/session_repository.py`

A repository for querying sessions from the local database with rich filtering.

**Requirements:**

| ID | Requirement | Priority |
|----|-------------|----------|
| SR-1 | List sessions with pagination (offset/limit) | P0 |
| SR-2 | Filter by batch_id | P0 |
| SR-3 | Filter by turn count (min/max range) | P0 |
| SR-4 | Filter by review status | P0 |
| SR-5 | Filter by has_error | P1 |
| SR-6 | Filter by token count range | P2 |
| SR-7 | Filter by cost range | P2 |
| SR-8 | Filter by date range (started_at) | P1 |
| SR-9 | Sort by any column (turn_count, latency, tokens, cost, started_at) | P0 |
| SR-10 | Search sessions by note content | P2 |
| SR-11 | Get session by ID with full metrics | P0 |
| SR-12 | Random sampling for review | P0 |

**Filter Model:**

```python
# backend/models.py

class SessionFilters(BaseModel):
    """Comprehensive session filtering options."""
    
    # Batch Association
    batch_id: Optional[str] = None
    exclude_batches: bool = False  # Show only organic (non-batch) sessions
    
    # Turn Count
    min_turns: Optional[int] = None
    max_turns: Optional[int] = None
    
    # Review Status
    is_reviewed: Optional[bool] = None
    
    # Error Status
    has_error: Optional[bool] = None
    
    # Token Usage
    min_tokens: Optional[int] = None
    max_tokens: Optional[int] = None
    
    # Cost
    min_cost: Optional[float] = None
    max_cost: Optional[float] = None
    
    # Date Range
    started_after: Optional[str] = None  # ISO timestamp
    started_before: Optional[str] = None
    
    # Search
    note_search: Optional[str] = None  # Search notes content
    
    # Sampling
    random_sample: Optional[int] = None  # Return random N sessions
```

### 3.3 Notes Service Enhancement

**File:** `backend/services/notes.py`

Enhance note handling to support local storage with Weave sync.

**Requirements:**

| ID | Requirement | Priority |
|----|-------------|----------|
| NS-1 | Create note in local DB first | P0 |
| NS-2 | Async sync note to Weave feedback API | P0 |
| NS-3 | Store weave_feedback_id after sync | P0 |
| NS-4 | Support note types (observation, bug, success, question) | P1 |
| NS-5 | List notes for a session | P0 |
| NS-6 | Search notes across all sessions | P2 |
| NS-7 | Delete note (local + Weave) | P1 |
| NS-8 | Sync existing Weave notes to local DB | P1 |

**Data Flow:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         NOTE CREATION FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  User writes note                                                            │
│        │                                                                     │
│        ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 1. Insert to session_notes table (synced_to_weave=false)            │   │
│  │    - Generate local ID                                               │   │
│  │    - Store content, session_id, call_id, note_type                   │   │
│  │    - Return immediately to user (fast response)                      │   │
│  └────────────────────────────────────┬────────────────────────────────┘   │
│                                       │                                      │
│                                       ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 2. Background task: Sync to Weave                                   │   │
│  │    - Get call_id for session (first call or specified)              │   │
│  │    - POST to /feedback/create                                        │   │
│  │    - Update session_notes.weave_feedback_id                          │   │
│  │    - Set synced_to_weave=true                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 Batch-Scoped Review Progress

**File:** `backend/services/batch_review.py`

Review progress should be tied to batches for meaningful tracking.

**Requirements:**

| ID | Requirement | Priority |
|----|-------------|----------|
| BR-1 | Calculate review progress per batch | P0 |
| BR-2 | Set review target per batch (not global) | P1 |
| BR-3 | Track reviews by date within batch | P2 |
| BR-4 | Support "Mark All as Reviewed" for batch | P1 |
| BR-5 | Calculate "remaining in batch" | P0 |

**API Response:**

```python
class BatchReviewProgress(BaseModel):
    batch_id: str
    batch_name: str
    
    # Counts
    total_sessions: int
    reviewed_sessions: int
    unreviewed_sessions: int
    
    # Progress
    progress_percent: float
    
    # Targets
    review_target: Optional[int] = None  # User-set target
    remaining_to_target: Optional[int] = None
    
    # Activity
    recent_reviews_24h: int
    last_review_at: Optional[str] = None
```

### 3.5 Enhanced Session Detail

When fetching a session's detail, include rich metadata:

**Requirements:**

| ID | Requirement | Priority |
|----|-------------|----------|
| SD-1 | Return all session metrics from local DB | P0 |
| SD-2 | Fetch conversation from Weave (live) | P0 |
| SD-3 | Include local notes | P0 |
| SD-4 | Include batch context (batch name, query text if from batch) | P1 |
| SD-5 | Include per-call token usage if available | P2 |
| SD-6 | Direct Weave URL for session | P0 |

**Response Model:**

```python
class SessionDetail(BaseModel):
    # Identity
    id: str
    weave_session_id: str
    weave_url: str
    
    # Batch Context
    batch_id: Optional[str] = None
    batch_name: Optional[str] = None
    query_text: Optional[str] = None  # If from synthetic batch
    
    # Metrics
    turn_count: int
    call_count: int
    total_latency_ms: float
    total_tokens: int
    estimated_cost_usd: float
    primary_model: Optional[str] = None
    
    # Status
    has_error: bool
    error_summary: Optional[str] = None
    is_reviewed: bool
    reviewed_at: Optional[str] = None
    
    # Timestamps
    started_at: str
    ended_at: Optional[str] = None
    
    # Conversation (from Weave)
    conversation: List[ConversationMessage]
    
    # Notes (from local DB)
    notes: List[SessionNote]
```

---

## 4. API Changes

### 4.1 Updated Endpoints

| Endpoint | Change | Notes |
|----------|--------|-------|
| `GET /api/threads` | Replace with local DB query | Rename to `/api/sessions` |
| `GET /api/threads/{id}` | Merge local + Weave data | Rename to `/api/sessions/{id}` |
| `POST /api/threads/{id}/note` | Write to local + async Weave | - |
| `GET /api/annotation-progress` | Support batch_id parameter | - |
| `POST /api/sessions/sync` | NEW: Trigger session sync | - |

### 4.2 New Endpoints

```python
# Session List with Rich Filtering
@router.get("/sessions")
async def list_sessions(
    # Pagination
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    
    # Sorting
    sort_by: str = Query("started_at", description="Sort field"),
    direction: str = Query("desc", description="asc or desc"),
    
    # Batch Filter
    batch_id: Optional[str] = Query(None),
    exclude_batches: bool = Query(False, description="Only organic sessions"),
    
    # Turn Count
    min_turns: Optional[int] = Query(None, ge=1),
    max_turns: Optional[int] = Query(None, ge=1),
    
    # Review Status
    is_reviewed: Optional[bool] = Query(None),
    
    # Error Status
    has_error: Optional[bool] = Query(None),
    
    # Token/Cost (optional, P2)
    min_tokens: Optional[int] = Query(None),
    max_tokens: Optional[int] = Query(None),
    
    # Date Range
    started_after: Optional[str] = Query(None),
    started_before: Optional[str] = Query(None),
    
    # Sampling
    random_sample: Optional[int] = Query(None, ge=1, le=100),
) -> SessionListResponse:
    pass

# Get Sync Status (for UI indicator)
@router.get("/sessions/sync-status")
async def get_sync_status() -> SyncStatus:
    """
    Returns current sync status for the UI to display.
    Called on initial load and periodically by frontend.
    """
    pass

# Trigger Session Sync (non-blocking)
@router.post("/sessions/sync")
async def trigger_sync(
    full_sync: bool = Query(False),
    batch_id: Optional[str] = Query(None),
) -> SyncTriggerResponse:
    """
    Triggers a background sync. Returns immediately.
    
    Response:
        {"sync_id": "...", "status": "started", "message": "Sync started in background"}
    
    The sync runs in the background. Frontend polls /sync-status for progress.
    """
    pass

# Batch Review Progress
@router.get("/batches/{batch_id}/review-progress")
async def get_batch_review_progress(batch_id: str) -> BatchReviewProgress:
    pass

# Notes CRUD
@router.get("/sessions/{session_id}/notes")
async def list_session_notes(session_id: str) -> List[SessionNote]:
    pass

@router.post("/sessions/{session_id}/notes")
async def create_session_note(
    session_id: str, 
    request: CreateNoteRequest
) -> SessionNote:
    pass

@router.delete("/sessions/{session_id}/notes/{note_id}")
async def delete_session_note(session_id: str, note_id: str) -> None:
    pass
```

---

## 5. Frontend Changes

### 5.1 Filter UI Enhancements

Replace the hardcoded "5+ turns" button with a flexible filter system:

```tsx
// New FilterPanel component
interface SessionFilters {
  batchId: string | null;
  minTurns: number | null;
  maxTurns: number | null;
  isReviewed: boolean | null;
  hasError: boolean | null;
  startedAfter: string | null;
  startedBefore: string | null;
}

function FilterPanel({ filters, onChange }: { filters: SessionFilters; onChange: (f: SessionFilters) => void }) {
  return (
    <div className="space-y-3">
      {/* Turn Count Range */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-ink-500 w-16">Turns:</label>
        <input
          type="number"
          placeholder="Min"
          value={filters.minTurns || ""}
          onChange={(e) => onChange({ ...filters, minTurns: e.target.value ? parseInt(e.target.value) : null })}
          className="w-16 text-xs"
        />
        <span className="text-ink-500">-</span>
        <input
          type="number"
          placeholder="Max"
          value={filters.maxTurns || ""}
          onChange={(e) => onChange({ ...filters, maxTurns: e.target.value ? parseInt(e.target.value) : null })}
          className="w-16 text-xs"
        />
      </div>
      
      {/* Quick Filters as Pills */}
      <div className="flex flex-wrap gap-1">
        <FilterPill 
          active={filters.minTurns === 3} 
          onClick={() => onChange({ ...filters, minTurns: 3, maxTurns: null })}
        >
          3+ turns
        </FilterPill>
        <FilterPill 
          active={filters.minTurns === 5} 
          onClick={() => onChange({ ...filters, minTurns: 5, maxTurns: null })}
        >
          5+ turns
        </FilterPill>
        <FilterPill 
          active={filters.minTurns === 10} 
          onClick={() => onChange({ ...filters, minTurns: 10, maxTurns: null })}
        >
          10+ turns
        </FilterPill>
        <FilterPill 
          active={filters.hasError === true} 
          onClick={() => onChange({ ...filters, hasError: !filters.hasError })}
        >
          Has Errors
        </FilterPill>
      </div>
      
      {/* Review Status */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-ink-500">Review:</label>
        <select 
          value={filters.isReviewed === null ? "" : filters.isReviewed.toString()}
          onChange={(e) => onChange({ ...filters, isReviewed: e.target.value === "" ? null : e.target.value === "true" })}
          className="text-xs"
        >
          <option value="">All</option>
          <option value="false">Not Reviewed</option>
          <option value="true">Reviewed</option>
        </select>
      </div>
    </div>
  );
}
```

### 5.2 Session Metadata Display

Show token/cost/latency metadata in session cards:

```tsx
function SessionCard({ session }: { session: Session }) {
  return (
    <div className="trace-card p-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {session.is_reviewed ? <CheckSquare className="w-3 h-3 text-accent-teal" /> : <Square className="w-3 h-3 text-ink-600" />}
          <span className="font-mono text-sm text-sand-200 truncate">{session.id}</span>
        </div>
        {session.has_error && <AlertTriangle className="w-3 h-3 text-red-400" />}
      </div>
      
      {/* Metrics Row */}
      <div className="flex items-center gap-3 mt-2 text-xs text-ink-500">
        <Badge variant="teal">{session.turn_count} turns</Badge>
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {session.total_latency_ms}ms
        </span>
        {session.total_tokens > 0 && (
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3" />
            {formatTokens(session.total_tokens)}
          </span>
        )}
        {session.estimated_cost_usd > 0 && (
          <span className="text-accent-gold">
            ${session.estimated_cost_usd.toFixed(4)}
          </span>
        )}
      </div>
      
      {/* Batch Context */}
      {session.batch_id && (
        <div className="mt-2 text-xs text-accent-coral">
          From: {session.batch_name}
        </div>
      )}
      
      {/* Timestamp */}
      <div className="mt-1 text-xs text-ink-600">
        {formatRelativeTime(session.started_at)}
      </div>
    </div>
  );
}
```

### 5.3 Batch Review Progress

Show batch-scoped progress when filtering by batch:

```tsx
function BatchReviewProgress({ batchId }: { batchId: string }) {
  const { batchReviewProgress } = useApp();
  
  if (!batchReviewProgress) return null;
  
  return (
    <Panel>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-accent-coral" />
          <h3 className="text-sm font-semibold">
            Reviewing: {batchReviewProgress.batch_name}
          </h3>
        </div>
        <span className="text-xs text-ink-400">
          {batchReviewProgress.reviewed_sessions} / {batchReviewProgress.total_sessions}
        </span>
      </div>
      
      <ProgressBar value={batchReviewProgress.progress_percent} />
      
      <div className="flex items-center justify-between mt-2 text-xs text-ink-500">
        <span>{batchReviewProgress.unreviewed_sessions} remaining</span>
        {batchReviewProgress.last_review_at && (
          <span>Last reviewed: {formatRelativeTime(batchReviewProgress.last_review_at)}</span>
        )}
      </div>
    </Panel>
  );
}
```

---

## 6. Implementation Plan

### Phase 1: Database Schema & Migration (Day 1-2) ✅ COMPLETED

**Status:** ✅ Completed on implementation day 1

**What was done:**
1. ✅ Added `sessions` table - local cache of Weave sessions with rich metadata
2. ✅ Added `session_notes` table - local notes with Weave sync capability  
3. ✅ Added `sync_status` table - tracks background sync state
4. ✅ Added 15 indexes for common query patterns
5. ✅ Initialized `sync_status` with default row (status='idle')
6. ✅ Updated `get_db_stats()` to include new tables
7. ✅ Updated module docstring to reflect new tables

**Migration Strategy (reviewed_threads):**
- Kept `reviewed_threads` table for backwards compatibility
- New sessions will use `sessions.is_reviewed` column
- Migration will happen during sync: when a session is synced, check if its ID exists in `reviewed_threads` and copy the review status
- This lazy migration avoids disrupting existing workflows

**Files Modified:**
- `backend/database.py` - Added new tables, indexes, and documentation

**Verification:**
```
Sessions-related indexes created:
  ✓ idx_session_notes_session
  ✓ idx_session_notes_type
  ✓ idx_session_notes_unsynced
  ✓ idx_sessions_batch
  ✓ idx_sessions_batch_reviewed
  ✓ idx_sessions_cost
  ✓ idx_sessions_ended
  ✓ idx_sessions_errors
  ✓ idx_sessions_reviewed
  ✓ idx_sessions_reviewed_at
  ✓ idx_sessions_root_trace
  ✓ idx_sessions_started
  ✓ idx_sessions_tokens
  ✓ idx_sessions_turns
  ✓ idx_sessions_weave_id
```

**Learnings:**
- SQLite `CREATE INDEX IF NOT EXISTS` is safe to run on existing databases
- Default row insertion uses `INSERT OR IGNORE` to be idempotent
- Foreign keys use `ON DELETE SET NULL` for batch/query so deleting batches doesn't orphan sessions

### Phase 2: Background Sync Service (Day 2-3) ✅ COMPLETED

**Status:** ✅ Completed

**What was done:**

1. ✅ Created `SessionSyncService` (`backend/services/session_sync.py`) with:
   - Full, incremental, and batch-specific sync modes
   - Async background execution (never blocks UI)
   - Metrics extraction: tokens, cost, latency, errors, primary model
   - Batch linkage via trace_id/thread_id matching
   - Model cost estimation (~15 models with pricing)
   - Sync status tracking in `sync_status` table
   - Migration of review status from `reviewed_threads`

2. ✅ Integrated with BatchExecutor (`backend/services/batch_executor.py`):
   ```python
   # Auto-sync sessions for this batch (non-blocking)
   if final_status == "completed" and success_count > 0:
       from services.session_sync import trigger_session_sync
       trigger_session_sync(batch_id=self.batch_id)
   ```

3. ✅ Added startup hook (`backend/main.py`):
   ```python
   @asynccontextmanager
   async def lifespan(app: FastAPI):
       # Trigger initial session sync in background
       from services.session_sync import startup_sync
       asyncio.create_task(startup_sync())
       yield
   ```

4. ✅ Key sync methods:
   - `sync_incremental()` - Only new sessions since last sync
   - `sync_full()` - All sessions from Weave
   - `sync_batch_sessions(batch_id)` - Only batch's sessions
   - `trigger_background_sync()` - Fire-and-forget

**Files Created/Modified:**
- `backend/services/session_sync.py` - **NEW** (550+ lines)
- `backend/services/batch_executor.py` - Added auto-sync trigger
- `backend/main.py` - Added lifespan with startup sync

### Phase 3: Session Repository (Day 3-4) ✅ COMPLETED

**Status:** ✅ Completed

**What was done:**

1. ✅ Created `SessionRepository` (`backend/services/session_repository.py`) with:
   - All 16 filter options (batch, turns, tokens, cost, latency, dates, model, notes)
   - Efficient SQL queries using indexes
   - Random sampling for review workflows
   - Note search across sessions
   - Session stats aggregation
   - Filter dropdown helpers (distinct models, batches)

2. ✅ `SessionFilters` dataclass with comprehensive options:
   ```python
   @dataclass
   class SessionFilters:
       batch_id: Optional[str] = None
       exclude_batches: bool = False
       min_turns: Optional[int] = None
       max_turns: Optional[int] = None
       is_reviewed: Optional[bool] = None
       has_error: Optional[bool] = None
       min_tokens: Optional[int] = None
       max_tokens: Optional[int] = None
       min_cost: Optional[float] = None      # NEW
       max_cost: Optional[float] = None      # NEW
       min_latency_ms: Optional[float] = None # NEW
       max_latency_ms: Optional[float] = None # NEW
       started_after: Optional[str] = None
       started_before: Optional[str] = None
       primary_model: Optional[str] = None   # NEW
       note_search: Optional[str] = None     # NEW
   ```

3. ✅ Repository methods (15 total):
   - `list_sessions()` - Paginated list with all filters
   - `get_session_by_id()` - Full session with batch/query context
   - `get_session_count()` - Count matching filters
   - `get_session_stats()` - Aggregate statistics
   - `random_sample()` - Random N sessions for review
   - `search_by_notes()` - Find sessions by note content
   - `mark_reviewed()` / `unmark_reviewed()` - Review status
   - `get_next_unreviewed()` - For review workflow
   - `list_notes()` / `create_note()` / `delete_note()` - Note CRUD
   - `get_batch_review_progress()` - Batch-scoped progress
   - `get_distinct_models()` / `get_batch_options()` - Filter dropdowns

4. ✅ Refactored `routers/sessions.py` to use repository pattern

**Files Created/Modified:**
- `backend/services/session_repository.py` - **NEW** (480+ lines)
- `backend/routers/sessions.py` - Refactored to use repository

### Phase 4: Update API Endpoints (Day 4-5) ✅ COMPLETED

**Status:** ✅ Completed (merged with Phase 2 & 3)

**What was done:**

1. ✅ Created `/api/sessions` endpoints (16 routes total):
   - `GET /api/sessions` - List with rich filtering (LOCAL DB)
   - `GET /api/sessions/{id}` - Detail with conversation from Weave
   - `GET /api/sessions/sync-status` - Sync status for UI indicator
   - `POST /api/sessions/sync` - Non-blocking sync trigger
   - `GET /api/sessions/stats/summary` - Aggregate statistics
   - `GET /api/sessions/options/models` - Filter dropdown
   - `GET /api/sessions/options/batches` - Filter dropdown
   - `POST /api/sessions/{id}/mark-reviewed` - Mark reviewed
   - `DELETE /api/sessions/{id}/mark-reviewed` - Unmark reviewed
   - `GET /api/sessions/{id}/next-unreviewed` - Review workflow
   - `GET /api/sessions/{id}/notes` - List notes
   - `POST /api/sessions/{id}/notes` - Create note
   - `DELETE /api/sessions/{id}/notes/{note_id}` - Delete note
   - `GET /api/sessions/batches/{batch_id}/review-progress` - Batch progress

2. ✅ Added new Pydantic models (`backend/models.py`):
   - `SessionFilters` - API filter model
   - `SessionSummary` / `SessionDetail` - Response models
   - `SyncStatusResponse` / `SyncTriggerResponse` - Sync API
   - `BatchReviewProgress` - Batch-scoped review metrics
   - `SessionNote` / `CreateNoteRequest` - Note models

**Files Modified:**
- `backend/models.py` - Added ~150 lines of new models
- `backend/routers/__init__.py` - Export sessions_router
- `backend/main.py` - Register sessions_router

### Phase 5: Frontend Updates (Day 5-6) ✅ COMPLETED

**Status:** ✅ Completed

**What was done:**

1. ✅ Added new TypeScript types (`frontend/src/app/types/index.ts`):
   - `Session`, `SessionDetail`, `SessionNote` - Session data models
   - `SessionListResponse` - Paginated response type
   - `SyncStatus` - Sync state for UI indicator
   - `SessionStats`, `BatchReviewProgress` - Aggregate types
   - `SessionFilters` - Filter options interface

2. ✅ Added API functions (`frontend/src/app/lib/api.ts`):
   - `fetchSessions()` - List sessions with all filter params
   - `fetchSessionDetail()` - Get single session
   - `fetchSyncStatus()` / `triggerSync()` - Sync operations
   - `markSessionReviewed()` / `unmarkSessionReviewed()` - Review status
   - `createSessionNote()` / `deleteSessionNote()` - Note CRUD
   - `fetchBatchReviewProgress()` - Batch-specific progress
   - `fetchModelOptions()` / `fetchBatchOptions()` - Filter dropdowns

3. ✅ Updated AppContext (`frontend/src/app/context/AppContext.tsx`):
   - New state: `sessions`, `selectedSession`, `syncStatus`, `batchReviewProgress`
   - New filters: `filterMaxTurns`, `filterHasError`, `filterModel`
   - New actions: `fetchSessions`, `fetchSessionDetail`, `triggerSync`
   - Sync status polling when sync in progress
   - Auto-refresh sessions when sync completes

4. ✅ Updated SessionsTab (`frontend/src/app/components/tabs/SessionsTab.tsx`):
   - **SyncStatusIndicator** component with:
     - Green checkmark when synced
     - Blue pulse animation when syncing
     - Red alert on sync error
     - "Sync Now" button for manual refresh
   - **SessionCard** component with rich metrics:
     - Turn count, latency, tokens, cost
     - Model name, batch context
     - Error indicator, review status
   - **FilterPill** component for toggle filters
   - Enhanced filter options: 3+/5+/10+ turns, reviewed/not reviewed, has errors
   - Batch review progress bar when filtering by batch
   - Full session detail view with:
     - All metrics displayed (tokens, cost, latency, model)
     - Error summary display
     - Existing notes list
     - Query text context for synthetic sessions
     - Direct Weave link

**Files Modified:**
- `frontend/src/app/types/index.ts` - Added ~100 lines of session types
- `frontend/src/app/lib/api.ts` - Added ~100 lines of session API functions
- `frontend/src/app/context/AppContext.tsx` - Added ~150 lines of session state/actions
- `frontend/src/app/components/tabs/SessionsTab.tsx` - Complete rewrite (~500 lines)

**UI Components Added:**
- `SyncStatusIndicator` - Shows sync status with visual indicators
- `SessionCard` - Rich session card with metrics display
- `FilterPill` - Reusable filter toggle button

### Phase 6: Testing & Migration (Day 6-7)

1. Test background sync doesn't block UI
2. Test auto-sync after batch execution
3. Test all filter combinations
4. Verify batch-session linkage
5. Test note sync to Weave
6. Performance testing with large datasets

---

## 7. Testing Checklist

### Background Sync Tests (P0)

- [ ] Clicking Sessions tab does NOT trigger Weave API call
- [ ] Sessions tab loads instantly from local DB (< 100ms)
- [ ] Background sync runs after batch execution completes
- [ ] Background sync runs on app startup
- [ ] Manual "Sync Now" triggers non-blocking sync
- [ ] Sync status indicator updates during sync
- [ ] Sync status shows "synced" after completion
- [ ] Sync errors don't crash the app
- [ ] UI remains responsive during background sync

### Functional Tests

- [ ] Sessions sync from Weave correctly
- [ ] Batch filter shows only batch sessions
- [ ] Turn count filters work (min/max)
- [ ] Review status filter works
- [ ] Error filter works
- [ ] Random sampling returns unique sessions
- [ ] Notes save to local DB
- [ ] Notes sync to Weave async
- [ ] Batch review progress updates correctly
- [ ] Session detail shows all metadata

### Edge Cases

- [ ] Empty batch (no sessions)
- [ ] Session with no turns (empty conversation)
- [ ] Session with errors
- [ ] Session from organic run (no batch)
- [ ] Very long session (100+ turns)
- [ ] Note with special characters
- [ ] Concurrent note creation
- [ ] Sync triggered while another sync is running
- [ ] Weave API timeout during sync (shouldn't crash)

### Performance

- [ ] **Sessions tab load < 100ms** (local DB only)
- [ ] List 500 sessions < 200ms
- [ ] Filter by batch_id uses index
- [ ] Sync 1000 sessions < 10s (background)
- [ ] Note creation immediate (< 100ms)
- [ ] Sync doesn't block API requests

---

## 8. Migration Path

### From Current to New Architecture

1. **Deploy new tables** alongside existing `reviewed_threads`
2. **Run initial sync** to populate `sessions` table
3. **Migrate review status** from `reviewed_threads` to `sessions.is_reviewed`
4. **Update frontend** to use new API
5. **Deprecate** old `/api/threads` endpoints (keep for backwards compat)
6. **Remove** `reviewed_threads` table after validation period

### Backwards Compatibility

During migration, support both:
- Old: `GET /api/threads` → returns from Weave API (legacy)
- New: `GET /api/sessions` → returns from local DB (recommended)

---

## 9. Future Considerations

### Beyond This Document

Items not in scope but to consider for future:

1. **Multi-user support**: Track who reviewed/noted each session
2. **Session groups**: Group related sessions (e.g., by user persona)
3. **Comparative view**: Compare sessions across batches
4. **Export**: Export session data with notes for reporting
5. **Real-time sync**: WebSocket-based live updates when new sessions appear
6. **Token cost configuration**: Allow users to set token prices for different models

---

## 10. Implementation Notes

### Phase 5b: Range Filter Sliders (Completed Dec 9, 2025)

Added dual-range sliders for filtering sessions by numeric metrics.

**Backend Changes:**

1. **SessionRepository** (`services/session_repository.py`):
   - Added `FilterRanges` dataclass to hold min/max for turns, tokens, cost, latency
   - Added `get_filter_ranges()` method to query actual data bounds from the DB
   - Added `min_latency_ms` and `max_latency_ms` to `SessionFilters` dataclass

2. **Sessions Router** (`routers/sessions.py`):
   - Added `/api/sessions/options/filter-ranges` endpoint
   - Added `min_latency` and `max_latency` query params to `list_sessions`

**Frontend Changes:**

1. **DualRangeSlider Component** (`components/ui/DualRangeSlider.tsx`):
   - New reusable dual-thumb range slider component
   - Supports custom formatting, units, and step increments
   - Coral/gold gradient active track with styled thumbs

2. **Types** (`types/index.ts`):
   - Added `FilterRange` and `FilterRanges` interfaces
   - Added `min_latency` and `max_latency` to `SessionFilters`

3. **API** (`lib/api.ts`):
   - Added `fetchFilterRanges()` function
   - Updated `fetchSessions()` to include latency params

4. **AppContext** (`context/AppContext.tsx`):
   - Added state for all range filters (tokens, cost, latency)
   - Added `filterRanges` state and `fetchFilterRanges` action
   - Filters are fetched when Sessions tab is opened

5. **SessionsTab** (`components/tabs/SessionsTab.tsx`):
   - Added dropdown selector for range filter type
   - Shows DualRangeSlider when a range filter is selected
   - Displays active range filters as colored badges
   - Range bounds are loaded from backend data

**User Experience:**

- Select "Filter by range..." dropdown to choose metric
- Dual-thumb slider appears with actual min/max from data
- Slide from both ends to narrow the range
- Active filters shown as badges below the controls
- "Clear all filters" resets everything

**Key Design Decisions:**

1. **Full data bounds**: Filter ranges are computed from ALL sessions, not just filtered ones. This lets users understand the full data range.

2. **Lazy loading**: Ranges are fetched on Sessions tab open, not on every filter change.

3. **Null means "no filter"**: When min/max match the data bounds, they're stored as null (no filter applied).

### Phase 5c: Additive Range Filters (Completed Dec 9, 2025)

Improved the filter UI to support **additive/combinable filters** instead of single-select.

**Changes:**

1. **"Add Range Filter" button** - Click to add a new range filter from available options
2. **Stacked filter cards** - Each active filter shows as its own card with:
   - Color-coded label (teal for turns/tokens, gold for cost, coral for latency)
   - Dual-range slider
   - X button to remove that filter
3. **Combinable filters** - Can now filter by multiple criteria simultaneously:
   - Example: "Latency 17-21s AND Cost $0.005-$0.010 AND Turns 2-5"
4. **Sort controls improved** - Sort button now shows "↓ Desc" or "↑ Asc" label for clarity
5. **Click-outside to close** - Add filter dropdown closes when clicking elsewhere

**UX Flow:**

1. Click "Add Range Filter" → dropdown shows available filter types
2. Select a filter type (e.g., Latency) → filter card appears with slider
3. Adjust the range using dual-thumb slider
4. Click "Add Range Filter" again to add more filters
5. Each filter has its own X to remove individually
6. "Clear all filters" removes everything
