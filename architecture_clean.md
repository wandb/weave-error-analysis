# Clean Architecture: Weave-Native Trace Review

## The Insight

Instead of reinventing Weave's trace viewer, we leverage it directly:

1. **Set `batch_id` as a Weave attribute** when executing synthetic queries
2. **Generate deep links** with pre-applied filters to Weave's trace UI
3. **Remove the Threads tab** - users review traces in Weave's native UI
4. **Sync feedback** from Weave for taxonomy building
5. **Focus on Taxonomy** - our core value proposition

This eliminates massive complexity:
- No session sync service
- No conversation extraction/parsing
- No trace viewer UI maintenance
- No framework-specific extractors

---

## Current User Flow (Implemented)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ERROR ANALYSIS APP                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────┐    ┌───────────┐    ┌────────────┐    ┌───────────┐  │
│  │  Agents  │───▶│ Synthetic │───▶│  Execute   │───▶│ Taxonomy  │  │
│  │   Tab    │    │    Tab    │    │   Batch    │    │    Tab    │  │
│  │  (Step 1)│    │  (Step 2) │    │            │    │  (Step 3) │  │
│  └──────────┘    └───────────┘    └─────┬──────┘    └───────────┘  │
│                                         │                           │
│                                         ▼                           │
│                              ┌──────────────────┐                   │
│                              │  "Review in      │                   │
│                              │   Weave" button  │                   │
│                              └────────┬─────────┘                   │
│                                       │                             │
└───────────────────────────────────────┼─────────────────────────────┘
                                        │
                                        ▼
                    ┌───────────────────────────────────┐
                    │         WEAVE UI                  │
                    │  (Pre-filtered to batch_id)       │
                    │                                   │
                    │  • View traces                    │
                    │  • Add feedback/annotations       │
                    │  • Mark as reviewed               │
                    │                                   │
                    └───────────────────────────────────┘
                                        │
                                        ▼
                    ┌───────────────────────────────────┐
                    │      SYNC FEEDBACK BACK           │
                    │  (Periodic or on-demand)          │
                    │                                   │
                    │  Taxonomy tab uses feedback       │
                    │  to build failure categories      │
                    └───────────────────────────────────┘
```

---

## How Batch Attribution Works

### The Key Mechanism

Our **backend** sets Weave attributes before calling the user's agent:

```python
# backend/services/agent_client.py

class AgentClient:
    @weave.op(name="agent_query")
    async def _do_http_request(self, request_body: dict, ...) -> QueryResponse:
        """HTTP call decorated with @weave.op so it gets traced."""
        async with httpx.AsyncClient() as client:
            response = await client.post(self.endpoint_url, json=request_body)
            # ... handle response ...
    
    async def query(self, query: str, batch_id: str | None = None, ...) -> QueryResponse:
        # Build attributes - only batch_id needed for filtering
        attrs = {}
        if batch_id:
            attrs["batch_id"] = batch_id
        
        # Execute with weave.attributes() - logs trace to user's project
        if attrs:
            with weave.attributes(attrs):
                return await self._do_http_request(request_body, ...)
        else:
            return await self._do_http_request(request_body, ...)
```

**Key insight**: The `@weave.op` decorator makes `_do_http_request` a traced function. When called inside `weave.attributes({'batch_id': ...})`, the trace gets those attributes. The user's agent doesn't need to do anything special.

### Agent Contract (Minimal)

The agent just needs a simple `/query` endpoint:

```python
# agent/agent_server.py

class QueryRequest(BaseModel):
    query: str
    # Optional: batch_id is passed by backend but can be ignored
    # Backend handles attribution via weave.attributes()
    batch_id: str | None = None

@app.post("/query")
async def query(request: QueryRequest):
    # Just process the query - no need to set weave.attributes()
    response = await process_query(request.query)
    return QueryResponse(response=response)
```

---

## Weave Deep Link Generation

### URL Structure

```
https://wandb.ai/{entity}/{project}/weave/traces?view=traces_default&sort=<ENCODED>&filters=<ENCODED>
```

### Filter JSON Structure

```json
{
  "items": [
    {
      "id": 0,
      "field": "started_at",
      "operator": "(date): after",
      "value": "2025-12-15T06:03:25.466Z"
    },
    {
      "id": 1,
      "field": "attributes.batch_id",
      "operator": "(string): equals",
      "value": "batch_abc123"
    }
  ],
  "logicOperator": "and"
}
```

### Implementation

**File:** `backend/services/weave_url.py`

```python
def generate_batch_review_url(
    batch_id: str,
    started_after: Optional[datetime] = None
) -> str:
    """Generate Weave URL filtered to a specific batch."""
    settings = get_settings()
    entity = settings.weave_entity
    project = settings.weave_project
    
    base = f"https://wandb.ai/{entity}/{project}/weave/traces"
    
    sort = [{"field": "started_at", "sort": "desc"}]
    
    items = []
    if started_after:
        items.append({
            "id": 0,
            "field": "started_at",
            "operator": "(date): after",
            "value": started_after.isoformat() + "Z"
        })
    
    items.append({
        "id": len(items),
        "field": "attributes.batch_id",
        "operator": "(string): equals",
        "value": batch_id
    })
    
    filters = {"items": items, "logicOperator": "and"}
    
    return (
        f"{base}?view=traces_default"
        f"&sort={urllib.parse.quote(json.dumps(sort, separators=(',', ':')))}"
        f"&filters={urllib.parse.quote(json.dumps(filters, separators=(',', ':')))}"
    )
```

**Endpoint:** `GET /api/synthetic/batches/{batch_id}/weave-url`

---

## What Was Removed

### Backend Files Deleted
| File | Lines | Purpose |
|------|-------|---------|
| `services/session_sync.py` | ~1500 | Background session sync from Weave |
| `services/session_repository.py` | ~400 | Local session storage and queries |
| `services/conversation.py` | ~800 | Framework-specific conversation extraction |
| `routers/sessions.py` | ~750 | Session API endpoints |

### Frontend Files Deleted
| File | Lines | Purpose |
|------|-------|---------|
| `components/tabs/ThreadsTab.tsx` | ~1700 | Thread review UI |
| `context/SessionContext.tsx` | ~400 | Session state management |

### Total Removed: **~5500 lines**

---

## What Was Added/Modified

### New Files
| File | Purpose |
|------|---------|
| `backend/services/weave_url.py` | Deep link generation for Weave UI |
| `backend/services/feedback_sync.py` | Sync feedback from Weave for taxonomy |

### Modified Files
| File | Changes |
|------|---------|
| `backend/services/agent_client.py` | Added `@weave.op` and `weave.attributes()` for batch attribution |
| `backend/services/batch_executor.py` | Passes `batch_id` to agent client |
| `backend/routers/synthetic.py` | Added `/batches/{id}/weave-url` endpoint |
| `backend/main.py` | Removed session router and startup sync |
| `backend/models.py` | Removed Session models, kept AgentStats |
| `frontend/src/app/page.tsx` | Removed Threads tab from navigation |
| `frontend/src/app/context/AppContext.tsx` | Removed SessionProvider |
| `frontend/src/app/components/tabs/SyntheticTab/BatchesPanel.tsx` | Added "Review in Weave" button |

---

## Current Architecture

```
backend/
├── config.py
├── database.py              ⚠️ ~250 lines of dead session tables/indexes
├── errors.py
├── logger.py
├── main.py                  ⚠️ Outdated docstring
├── models.py (simplified - AgentStats, Saturation only)
├── prompts/
│   └── ... (unchanged)
├── routers/
│   ├── __init__.py
│   ├── agents.py
│   ├── feedback.py
│   ├── prompts.py
│   ├── settings.py
│   ├── suggestions.py       ⚠️ Dead session endpoints
│   ├── synthetic.py (includes weave-url endpoint)
│   └── taxonomy.py
├── services/
│   ├── __init__.py
│   ├── agent_client.py (weave.attributes for batch attribution)
│   ├── agent_info.py
│   ├── batch_executor.py (trace discovery only, no session sync)
│   ├── dataset_publisher.py
│   ├── feedback_sync.py (NEW - sync from Weave)
│   ├── llm.py
│   ├── settings.py
│   ├── suggestion.py        ⚠️ Dead session methods
│   ├── synthetic.py
│   ├── taxonomy.py
│   ├── trace_discovery.py
│   ├── weave_client.py
│   └── weave_url.py (NEW - deep link generation)
└── utils.py

frontend/
├── src/app/
│   ├── components/
│   │   ├── ConversationMessage.tsx  ⚠️ ORPHANED - delete
│   │   ├── LandingPage.tsx          ⚠️ Outdated workflow text
│   │   ├── tabs/
│   │   │   ├── AgentsTab.tsx
│   │   │   ├── SettingsTab.tsx
│   │   │   ├── SyntheticTab/
│   │   │   │   ├── BatchesPanel.tsx (includes "Review in Weave")
│   │   │   │   ├── DimensionsPanel.tsx
│   │   │   │   ├── QueryPreviewCard.tsx
│   │   │   │   └── index.ts
│   │   │   ├── SyntheticTab.tsx
│   │   │   ├── TaxonomyTab.tsx
│   │   │   └── index.ts
│   │   └── ui/
│   ├── context/
│   │   ├── AgentContext.tsx
│   │   ├── AppContext.tsx (simplified - no SessionProvider)
│   │   ├── SyntheticContext.tsx
│   │   ├── TaxonomyContext.tsx
│   │   └── index.ts
│   ├── lib/
│   │   ├── api.ts                   ⚠️ ~120 lines of dead session API
│   │   └── useKeyboardShortcuts.ts  ⚠️ Threads shortcuts still present
│   ├── constants.ts                 ⚠️ Dead session/thread constants
│   └── types/
│       └── index.ts                 ⚠️ ~240 lines of dead session types
```

---

## Remaining Remnants (Dead Code Audit)

While the major files were deleted, a code audit reveals ~870 lines of dead/outdated code still lingering. This section documents what needs cleanup before the final release.

### Frontend Remnants

#### `frontend/src/app/types/index.ts` (~240 lines)

| Lines | Type/Interface | Status |
|-------|----------------|--------|
| 5-13 | `ConversationMessage` | Only used by orphaned component |
| 19-66 | `Session`, `SessionNote`, `SessionDetail`, `SessionListResponse` | ❌ Unused |
| 68-77 | `SyncStatus` | ❌ Unused |
| 79-88 | `SessionStats` | ❌ Unused |
| 90-101 | `FilterRange`, `FilterRanges` | ❌ Unused |
| 103-112 | `BatchReviewProgress` | ❌ Unused |
| 114-133 | `SessionFilters` | ❌ Unused |
| 410-424 | `TraceSourceSessions`, `TraceSource` | ❌ Unused |
| 475 | `TabType` | Still includes `"threads"` |

#### `frontend/src/app/lib/api.ts` (~120 lines)

Lines 876-995: Entire Sessions API section is unused:
- `FetchSessionsParams`, `fetchSessions`, `fetchSessionDetail`
- `fetchSyncStatus`, `triggerSync`, `fetchSessionStats`
- `markSessionReviewed`, `unmarkSessionReviewed`
- `fetchSessionNotes`, `createSessionNote`, `deleteSessionNote`
- `fetchBatchReviewProgress`, `fetchModelOptions`, `fetchBatchOptions`, `fetchFilterRanges`

Also imports unused session types (lines 15-20).

#### `frontend/src/app/constants.ts` (~20 lines)

| Constant | Status |
|----------|--------|
| `ORGANIC_FILTER`, `ORGANIC_DISPLAY_NAME` | ❌ Session filtering |
| `THREAD_LIST_HEADER_OFFSET` | ❌ ThreadsTab layout |
| `CONVERSATION_VIEW_HEADER_OFFSET` | ❌ ThreadsTab layout |
| `SYNC_POLL_INITIAL_INTERVAL_MS`, `SYNC_POLL_MAX_INTERVAL_MS` | ❌ Session sync |

#### `frontend/src/app/components/ConversationMessage.tsx` (92 lines)

Entire file is orphaned. Was used by ThreadsTab to render messages. **Delete entire file.**

#### `frontend/src/app/lib/useKeyboardShortcuts.ts` (~30 lines)

- Still has `goToThreads` handler
- Threads tab shortcuts in docs and implementation
- `getShortcutsList()` lists Threads shortcuts

#### `frontend/src/app/components/LandingPage.tsx`

Still shows "Review Threads" as Step 3. Should say "Review in Weave" instead.

#### `frontend/src/app/page.tsx`

`TabNavigationProps` type still includes `"threads"`.

### Backend Remnants

#### `backend/database.py` (~250 lines)

| Lines | Table/Schema | Status |
|-------|--------------|--------|
| 509-579 | `sessions` table | ❌ Unused |
| 582-604 | `session_notes` table | ❌ Unused |
| 606-635 | `sync_status` table | ❌ Unused |
| 686-764 | 16 session indexes | ❌ Unused |

Docstring (lines 8-13) still describes storing sessions.

#### `backend/main.py`

- Docstring mentions "Background session sync" and "local-first session browsing"
- Line 165 mentions "refresh sessions cache"

#### `backend/routers/suggestions.py` (~60 lines)

- `AnalyzeSessionRequest` model (unused)
- `/sessions/{session_id}/analyze` endpoint (queries non-existent data)
- `/sessions/{session_id}` endpoint (non-functional)

#### `backend/services/suggestion.py` (~50 lines)

- `get_suggestions_for_session()` method queries unused tables
- Various comments reference removed session functionality

### Summary

| Area | Lines to Remove | Priority |
|------|-----------------|----------|
| Frontend Types | ~240 | High |
| Frontend API | ~120 | High |
| Frontend Constants | ~20 | Medium |
| ConversationMessage.tsx | 92 (delete) | Medium |
| useKeyboardShortcuts.ts | ~30 | Medium |
| LandingPage.tsx | ~10 | Low |
| Backend database.py | ~250 | High |
| Backend suggestions router | ~60 | Medium |
| Backend suggestion service | ~50 | Medium |
| **Total** | **~870** | |

---

## Migration Status

### Phase 1: Add New Features ✅ COMPLETE
- [x] Create `services/weave_url.py` with URL generation
- [x] Update `batch_executor.py` to pass `batch_id` to agent
- [x] Update agent client with `@weave.op` and `weave.attributes()`
- [x] Add `/batches/{id}/weave-url` endpoint
- [x] Update BatchesPanel with "Review in Weave" button
- [x] Create `services/feedback_sync.py` for pulling Weave feedback

### Phase 2: Remove Old Features ⚠️ PARTIAL
- [x] Remove `ThreadsTab.tsx` from frontend
- [x] Remove `SessionContext.tsx`
- [x] Update `AppContext.tsx` to remove session provider
- [x] Remove `routers/sessions.py`
- [x] Remove `services/session_sync.py`
- [x] Remove `services/session_repository.py`
- [x] Remove `services/conversation.py`
- [x] Clean up unused Session models in `models.py`
- [x] Update page.tsx to remove Threads tab from navigation
- [ ] **Clean up remaining remnants** (see Phase 2.5 below)

### Phase 2.5: Dead Code Cleanup 🧹 TODO
- [ ] Remove unused types from `frontend/src/app/types/index.ts`
- [ ] Remove Sessions API section from `frontend/src/app/lib/api.ts`
- [ ] Remove session constants from `frontend/src/app/constants.ts`
- [ ] Delete orphaned `frontend/src/app/components/ConversationMessage.tsx`
- [ ] Clean threads shortcuts from `frontend/src/app/lib/useKeyboardShortcuts.ts`
- [ ] Update workflow in `frontend/src/app/components/LandingPage.tsx`
- [ ] Remove session tables/indexes from `backend/database.py`
- [ ] Remove session endpoints from `backend/routers/suggestions.py`
- [ ] Clean session methods from `backend/services/suggestion.py`
- [ ] Update outdated docstrings in `backend/main.py`

### Phase 3: Focus on Taxonomy (Future)
- [ ] Enhance feedback sync to pull annotations from Weave
- [ ] Use feedback data to inform taxonomy suggestions
- [ ] Build category assignment workflow based on Weave feedback

---

## Benefits Achieved

### Removed Complexity
| Component | Lines Removed | Maintenance Burden Eliminated |
|-----------|--------------|-------------------------------|
| `session_sync.py` | ~1500 | Background sync, error handling, retries |
| `session_repository.py` | ~400 | SQL queries, pagination, caching |
| `conversation.py` | ~800 | Framework-specific extractors |
| `routers/sessions.py` | ~750 | API endpoints, validation |
| `ThreadsTab.tsx` | ~1700 | Complex UI, state management |
| `SessionContext.tsx` | ~400 | React context, caching |
| **Total** | **~5500** | **Significant** |

### Gained Benefits

1. **Weave's native trace viewer** - Better than anything we could build
2. **Built-in feedback system** - Thumbs up/down, notes, etc.
3. **Team collaboration** - Share filtered views with teammates
4. **No parsing headaches** - Weave handles all framework formats
5. **Real-time updates** - See traces as they come in
6. **Focus on core value** - Taxonomy and failure mode discovery

---

## Summary

**Old approach:** Build a Weave clone inside our app
**New approach:** Use Weave for what it's good at, focus on taxonomy

The `batch_id` attribute + deep links pattern gives us:
- Zero-effort trace viewing
- Native Weave feedback
- Pre-filtered views per batch
- Massive code reduction (~5500 lines removed, ~870 more to clean)
- More time to build the actual value: taxonomy-driven error analysis

**App now has 3 tabs:** Agents → Synthetic → Taxonomy

---

## Next Steps

1. **Complete Phase 2.5** - Remove the ~870 lines of dead code documented above
2. **Test the cleanup** - Ensure nothing breaks after removal
3. **Phase 3** - Enhance feedback sync and taxonomy suggestions
