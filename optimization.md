# Weave Error Analysis - Optimization Issues

A technical review of bad code paths, duplicate logic, database inefficiencies, and architecture issues for the **Agents**, **Data (Synthetic)**, and **Runs** tabs.

---

## 1. Database Issues

### 1.1 ~~Duplicate `now_iso()` Function Definition~~ ✅ FIXED

**Files:** `database.py`, `routers/synthetic.py`

~~Both defined identical `now_iso()` functions.~~

**Fixed:** Removed duplicate from `synthetic.py`, now imports from `database.py`.

---

### 1.2 ~~Multiple `get_db()` Calls Per Operation~~ ✅ FIXED

**Files:** `routers/agents.py`

~~In `test_agent_connection()`, the function opened a new `get_db()` context three separate times for error handling paths.~~

**Fixed:** Created `_update_agent_connection_status()` helper function that consolidates all status updates into a single reusable function.

---

### 1.3 ~~Inefficient Query Count Updates~~ ✅ FIXED

**File:** `routers/synthetic.py`

~~When deleting a query, we ran a subquery to recount ALL queries in the batch.~~

**Fixed:** Single query delete now uses `query_count = query_count - 1` instead of recounting.

---

### 1.4 ~~Missing Composite Indexes~~ ✅ FIXED

**File:** `database.py`

~~Missing indexes for common query patterns.~~

**Fixed:** Added composite indexes:
- `idx_batches_agent_status` on `synthetic_batches(agent_id, status)`
- `idx_queries_batch_status` on `synthetic_queries(batch_id, execution_status)`

---

### 1.5 N+1 Query Pattern in `list_agents()`

**File:** `routers/agents.py:178-195`

Each row's `agent_info_parsed` is JSON-parsed inline. For large agent lists, this is wasteful:

```python
for row in rows:
    parsed = json.loads(row["agent_info_parsed"]) if row["agent_info_parsed"] else {}
    agents.append(AgentResponse(
        ...
        capabilities=parsed.get("capabilities", []),
        testing_dimensions_count=len(parsed.get("testing_dimensions", []))
    ))
```

**Fix:** Parse once when storing or use computed columns.

---

## 2. Backend Logic Issues

### 2.1 ~~Redundant Agent Fetch in `execute_synthetic_batch()`~~ ✅ FIXED

**Files:** `routers/synthetic.py`, `services/batch_executor.py`

~~Router fetched batch data, then `execute_batch()` internally called `_get_batch_info()` to fetch the same data again.~~

**Fixed:** `BatchExecutor` now accepts optional `batch_info` parameter. Router passes pre-fetched data to avoid redundant DB query.

---

### 2.2 ~~Sequential Query Execution in BatchExecutor~~ ✅ FIXED

**File:** `services/batch_executor.py`

~~Queries were executed sequentially despite `max_concurrent` parameter being defined.~~

**Fixed:** Implemented concurrent execution with `asyncio.Semaphore`:
- Uses `asyncio.Queue` to collect results as queries complete
- Respects `max_concurrent` limit (default: 5)
- Falls back to sequential execution when `max_concurrent=1`
- `ExecuteBatchRequest` now exposes `max_concurrent` parameter

---

### 2.3 Duplicate Dimension Import Logic

**Files:** `routers/synthetic.py:266-361` vs `routers/agents.py:136-147`

Two places import/save dimensions with nearly identical logic:

- `import_dimensions_from_agent()` in synthetic.py
- `create_agent()` dimension insertion in agents.py

```python
# Both do the same INSERT pattern
cursor.execute("""
    INSERT INTO agent_dimensions (id, agent_id, name, dimension_values, descriptions, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
""", (...))
```

**Fix:** Extract dimension operations into a service function in `services/agent_info.py`.

---

### 2.4 Unsafe Exception Swallowing

**Files:** `routers/synthetic.py:137-138`, `routers/synthetic.py:299-300`

Empty `except` blocks hide real errors:

```python
try:
    parsed = parse_agent_info(agent_row["agent_info_raw"])
except:
    pass  # Silent failure - no logging
```

**Fix:** Log exceptions or handle specific exception types.

---

### 2.5 Blocking Sync Calls in Async Context

**File:** `services/batch_executor.py:310-323`

`_get_batch_info()` and `_get_pending_queries()` are synchronous database calls inside an async executor:

```python
def _get_batch_info(self) -> Optional[Dict[str, Any]]:  # sync method
    with get_db() as conn:  # blocking
        cursor.execute(...)
```

These block the event loop during batch execution.

**Fix:** Use `asyncio.to_thread()` or implement async DB access.

---

## 3. Frontend Issues

### 3.1 ~~Hardcoded Backend URLs in Components~~ ✅ FIXED

**Files:** `SyntheticTab.tsx`, `RunsTab.tsx`, `lib/api.ts`

~~Both tabs hardcode backend URL construction.~~

**Fixed:** Created centralized `getBackendUrl()` in `lib/api.ts` that:
- Checks `NEXT_PUBLIC_BACKEND_URL` env var for full URL override
- Falls back to `NEXT_PUBLIC_BACKEND_PORT` for port configuration
- Defaults to `http://localhost:8000` for local development

Both components now import and use this utility.

---

### 3.2 ~~Redundant Agent Fetches on Tab Switch~~ ✅ FIXED

**File:** `AppContext.tsx`

~~Every switch to agents/synthetic/runs tabs triggered a full agent refetch.~~

**Fixed:** Added conditional check `agents.length === 0` to only fetch agents if not already loaded.

---

### 3.3 ~~Agent Selection Not Persisted Across Tabs~~ ✅ FIXED

**File:** `AppContext.tsx`

~~When switching from Agents → Synthetic → Runs, dimensions and batches weren't automatically loaded.~~

**Fixed:** 
- Added `selectAgentWithData()` function that loads dimensions and batches in parallel
- Added useEffect that automatically loads agent data when switching to synthetic/runs tabs if selected agent exists but data isn't loaded
- `fetchAgentDetailData` now uses `Promise.all` to load dimensions and batches in parallel

---

### 3.4 SSE Parsing Vulnerability

**Files:** `SyntheticTab.tsx:162-209`, `RunsTab.tsx:106-145`

Both parse SSE events without proper line boundary handling:

```typescript
buffer += decoder.decode(value, { stream: true });
const lines = buffer.split("\n");
buffer = lines.pop() || "";  // May lose data if last line is complete
```

If a complete SSE message ends exactly at chunk boundary, `lines.pop()` removes it.

**Fix:**
```typescript
buffer = lines[lines.length - 1].endsWith('\n') ? '' : lines.pop() || '';
```

---

### 3.5 ~~Uncontrolled Component Re-renders~~ ✅ FIXED

**Files:** `SyntheticTab.tsx`, `RunsTab.tsx`

~~Every SSE event triggered state updates causing full component re-renders.~~

**Fixed:**
- `SyntheticTab`: Uses `streamingQueriesRef` to accumulate queries, batches UI updates every 10 queries
- `RunsTab`: Uses `lastFetchedCountRef` to batch `fetchBatchDetail` calls every 5 completed queries
- Dramatically reduces re-renders during streaming operations

---

### 3.6 ~~Memory Leak in Abort Controller~~ ✅ FIXED

**Files:** `SyntheticTab.tsx`, `RunsTab.tsx`

~~AbortController was created but never cleaned up on unmount.~~

**Fixed:** Added cleanup effect in both components:
```typescript
useEffect(() => {
  return () => {
    abortControllerRef.current?.abort();
  };
}, []);
```

---

## 4. API Contract Issues

### 4.1 ~~Inconsistent Error Response Format~~ ✅ FIXED

**Files:** `routers/synthetic.py`, `routers/traces.py`, `routers/taxonomy.py`, `services/batch_executor.py`, `services/taxonomy.py`

~~Some endpoints returned `{"error": "message"}`, others threw `HTTPException`.~~

**Fixed:** Standardized all error handling:
- Routers always raise `HTTPException` with proper status codes
- Services raise `ValueError` for not-found errors, `RuntimeError` for processing errors
- Routers catch service exceptions and convert to appropriate HTTP responses

---

### 4.2 Missing Request Validation

**File:** `routers/synthetic.py:889-897`

`execute_synthetic_batch()` doesn't validate batch status before execution:

```python
async def execute_synthetic_batch(batch_id: str, request: ExecuteBatchRequest = None):
    # Missing: Check if batch is already running
    # Missing: Check if batch has any pending queries
```

**Fix:** Add status validation:
```python
if row["status"] == "running":
    raise HTTPException(status_code=409, detail="Batch is already running")
if row["status"] == "completed" and not has_pending_queries:
    raise HTTPException(status_code=400, detail="No pending queries to execute")
```

---

## 5. State Management Issues

### 5.1 Batch Status Desync

**Files:** `RunsTab.tsx`, `batch_executor.py`

Batch status in frontend can desync from backend during execution:

1. Frontend shows "running" 
2. Backend fails silently
3. Frontend never updates to "failed"

The SSE stream may end without sending a final status event.

**Fix:** Add heartbeat/timeout handling:
```typescript
const timeout = setTimeout(() => {
  if (executingBatchId === batchId) {
    fetchBatches(agentId); // Force refresh
  }
}, 30000);
```

---

### 5.2 Stale Closure in Execution Callbacks

**File:** `RunsTab.tsx:131-134`

`lastCompletedCount` inside `executeBatch` is captured in closure but updated:

```typescript
let lastCompletedCount = 0;
// Inside async loop - closure captures initial value
if (data.completed_queries > lastCompletedCount) {
  lastCompletedCount = data.completed_queries;
```

This works but is fragile. A refactor could break it.

**Fix:** Use ref:
```typescript
const lastCompletedCountRef = useRef(0);
```

---

## 6. Performance Issues

### 6.1 Full Batch Refetch After Each Query

**File:** `RunsTab.tsx:131-134`

During execution, every completed query triggers a full batch detail fetch:

```typescript
if (data.completed_queries > lastCompletedCount) {
  fetchBatchDetail(batchId);  // Fetches ALL queries every time
}
```

For 100 queries, this means 100 full batch fetches.

**Fix:** Fetch only the new query result or accumulate locally.

---

### 6.2 Unbounded Query Generation

**File:** `services/synthetic.py:391-406`

`generate_queries_from_tuples()` uses semaphore but creates all tasks at once:

```python
semaphore = asyncio.Semaphore(5)
tasks = [generate_one(t) for t in tuples]  # Creates all tasks immediately
queries = await asyncio.gather(*tasks)
```

For 1000 tuples, this creates 1000 coroutine objects simultaneously.

**Fix:** Use `asyncio.as_completed()` or chunk processing.

---

## 7. Deployment Blockers

### 7.1 Hardcoded Port Numbers

- Backend assumes port 8000 
- Frontend SSE bypasses proxy to port 8000
- No environment variable configuration

**Fix:** Use environment variables:
```python
BACKEND_PORT = os.environ.get("BACKEND_PORT", "8000")
```

---

### 7.2 No CORS Configuration for SSE

SSE endpoints bypass Next.js proxy, requiring direct backend access. No CORS headers are set for this scenario.

**Fix:** Add CORS middleware for SSE endpoints:
```python
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware, allow_origins=["*"], ...)
```

---

### 7.3 SQLite Concurrent Write Limitations

WAL mode helps but SQLite still can't handle high concurrent writes. Batch execution with 10+ concurrent queries may hit lock timeouts.

**Fix:** For production, consider PostgreSQL migration or implement write queue.

---

## Summary: Priority Fixes

| Priority | Issue | Impact | Status |
|----------|-------|--------|--------|
| **P0** | ~~Hardcoded backend URLs~~ | ~~Breaks deployment~~ | ✅ Fixed |
| **P0** | CORS for SSE | Breaks SSE in production | |
| **P1** | ~~Sequential batch execution~~ | ~~10x slower than needed~~ | ✅ Fixed |
| **P1** | ~~Full batch refetch per query~~ | ~~Performance~~ | ✅ Fixed |
| **P1** | Exception swallowing | Hidden failures | |
| **P1** | ~~Inconsistent error responses~~ | ~~API contract~~ | ✅ Fixed |
| **P2** | ~~Duplicate code paths~~ | ~~Maintenance~~ | ✅ Fixed |
| **P2** | ~~Missing indexes~~ | ~~DB performance~~ | ✅ Fixed |
| **P2** | ~~Redundant agent fetches~~ | ~~UI performance~~ | ✅ Fixed |
| **P2** | ~~Agent data not loaded on tab switch~~ | ~~UX~~ | ✅ Fixed |
| **P2** | ~~Re-render storms~~ | ~~UI jank~~ | ✅ Fixed |
| **P3** | ~~Memory leaks~~ | ~~Long sessions~~ | ✅ Fixed |
| **P3** | Stale closures | Bug risk | |

