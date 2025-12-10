# FAILS Integration Plan

## Status Summary

| Sprint | Status | Key Deliverables |
|--------|--------|------------------|
| Sprint 1 | ✅ Complete | Enhanced batch selector, full-width AI Review, n_samples control |
| Sprint 2 | ✅ Complete | Debug mode, filter_failures_only, advanced options panel |
| Sprint 3 | ✅ Complete | Session traces as data source |
| Sprint 4 | ⬜ Pending | Add discovered categories to taxonomy |
| Sprint 5 | ⬜ Pending | Full Weave Evaluation integration |

---

## Overview

FAILS (Failure Analysis and Insight Learning System) is a library that automatically categorizes failure modes from traces using a 3-step LLM pipeline. The goal is to speed up human annotation by having AI discover failure categories automatically.

**Mental Model:**
```
Batch Creation → Agent Execution → Traces Logged → Sessions/Threads Grouped → FAILS Analyzes Raw Traces → Categories Discovered
```

The key insight: **FAILS should bootstrap the Failure Modes taxonomy automatically**, so humans don't have to manually categorize every failure. This dramatically speeds up the feedback loop.

---

## What FAILS Needs (Trace Data Format)

FAILS expects raw trace data in this format:

```python
{
    "id": str,           # Unique trace identifier
    "inputs": dict,      # What was given to the agent (query, context, etc.)
    "output": dict,      # What the agent produced (response, tool calls, etc.)
    "scores": dict       # Evaluation/scorer metadata (pass/fail, reason, etc.)
}
```

**Important**: FAILS works on **individual traces**, not grouped sessions. Each trace is analyzed independently, then categories are clustered across all traces.

---

## Current Integration Problems

### 1. Data Source Mismatch
Currently `auto_reviewer.py` queries `synthetic_queries` table:
```python
cursor.execute("""
    SELECT id, query_text, response_text, trace_id, ...
    FROM synthetic_queries
    WHERE batch_id = ? AND execution_status = 'success'
""")
```

**Problems:**
- Only uses synthetic query data, not real session traces
- Pulls `query_text` and `response_text` as flat strings
- Missing rich trace data (tool calls, intermediate steps, full context)

### 2. Real Traces Not Used
Our sessions/threads have **actual Weave traces** with:
- Full conversation turns
- Tool usage and results  
- Intermediate reasoning steps
- Trace hierarchy (parent/child relationships)

**None of this is being used by FAILS.**

### 3. UI Placement Issues ✅ FIXED
- ~~AI Review is a small panel in the sidebar~~ → **Now full-width section below Failure Modes**
- ~~No room for FAILS controls (n_samples, debug mode, etc.)~~ → **Advanced Options panel with all controls**
- ~~Batch selector doesn't show useful info~~ → **Enhanced dropdown with stats, checkmarks, relative time**
- Results not integrated with Failure Modes taxonomy (Sprint 4)

---

## Proposed Architecture

### Phase 1: Fix Immediate Issues

#### 1.1 Enhance Batch Selector Display
Show more info in dropdown:
```
Batch 12/10/2025 #28J22V (5 queries, ✓ executed, 3 failures)
Batch 12/9/2025 #QLQZO0 (20 queries, ✓ executed, 12 failures)
Batch 12/8/2025 #XQP17O (10 queries, ⏸ pending)
```

Backend changes needed:
- Add `total_queries`, `executed_count`, `failure_count` to batch response

#### 1.2 Move AI Review Below Failure Modes
Current layout:
```
┌────────────────────────────────────────────────────────────┐
│  Failure Modes (9 cols)              │  Sidebar (3 cols)  │
│  ┌──────────────────────────────┐    │  ┌──────────────┐  │
│  │ mode_1                       │    │  │ Actions      │  │
│  │ mode_2                       │    │  │              │  │
│  │ ...                          │    │  │ AI Review    │  │
│  └──────────────────────────────┘    │  │ (cramped!)   │  │
│                                      │  └──────────────┘  │
└────────────────────────────────────────────────────────────┘
```

New layout:
```
┌────────────────────────────────────────────────────────────┐
│  Failure Modes (9 cols)              │  Sidebar (3 cols)  │
│  ┌──────────────────────────────┐    │  ┌──────────────┐  │
│  │ mode_1                       │    │  │ Actions      │  │
│  │ mode_2                       │    │  │ Uncategorized│  │
│  │ ...                          │    │  │ Notes        │  │
│  └──────────────────────────────┘    │  └──────────────┘  │
├────────────────────────────────────────────────────────────┤
│  AI Review Results (full width - 12 cols)                  │
│  ┌────────────────────────────────────────────────────────┐│
│  │ Batch: [dropdown] ▾  │ [Run Review]  │ Controls...    ││
│  ├────────────────────────────────────────────────────────┤│
│  │ ⚡ 3 categories discovered                              ││
│  │ ├─ tool_usage_error (5 traces)                         ││
│  │ ├─ response_format_issue (3 traces)                    ││
│  │ └─ context_misunderstanding (2 traces)                 ││
│  │                                                        ││
│  │ [Add to Taxonomy] [View Report] [Dismiss]              ││
│  └────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────┘
```

Benefits:
- More space for controls
- Natural flow: Failure Modes → AI Review → Add to taxonomy
- Can show detailed results without cramping

### Phase 2: Pull Raw Traces from Weave

#### 2.1 Add Trace Source Options

```typescript
type TraceSource = 
  | { type: "synthetic_batch"; batchId: string }
  | { type: "sessions"; sessionIds: string[] }
  | { type: "weave_evaluation"; evalId: string; wandbEntity: string; wandbProject: string };
```

#### 2.2 For Sessions/Threads

Create a new backend function to convert session traces to FAILS format:

```python
def get_session_traces_for_fails(session_ids: List[str]) -> List[Dict]:
    """
    Convert session traces to FAILS-compatible format.
    
    Each message turn becomes a trace entry with:
    - inputs: The user message + context
    - output: The assistant response + tool calls
    - scores: Any feedback or evaluation data we have
    """
    traces = []
    
    for session_id in session_ids:
        session = get_session_detail(session_id)
        
        # Group conversation turns
        for i, turn in enumerate(session.turns):
            traces.append({
                "id": f"{session_id}_turn_{i}",
                "inputs": {
                    "user_message": turn.user_message,
                    "conversation_history": turn.history[:i],
                    "session_metadata": session.metadata
                },
                "output": {
                    "assistant_response": turn.assistant_response,
                    "tool_calls": turn.tool_calls,
                    "tool_results": turn.tool_results
                },
                "scores": {
                    "has_feedback": turn.feedback is not None,
                    "feedback_type": turn.feedback.type if turn.feedback else None,
                    "feedback_notes": turn.feedback.notes if turn.feedback else None
                }
            })
    
    return traces
```

#### 2.3 For Weave Evaluations (Full FAILS Pipeline)

Use FAILS' built-in Weave query capabilities:
```python
from fails.weave_query import query_evaluation_data, TraceDepth

eval_data = query_evaluation_data(
    eval_id=eval_id,
    wandb_entity=entity,
    wandb_project=project,
    trace_depth=TraceDepth.DIRECT_CHILDREN,
    filter_dict={"output.scores.correct": False}  # Only failures
)
```

### Phase 3: Expose FAILS Controls

#### 3.1 New Controls to Add

| Control | Description | Default |
|---------|-------------|---------|
| `n_samples` | Max traces to analyze | None (all) |
| `debug` | Verbose output, cheaper model | False |
| `max_concurrent_llm_calls` | Parallelism | 10 |
| `model` | LLM to use | openai/gpt-4.1 |
| `filter_failures_only` | Only analyze failed traces | True |

#### 3.2 UI for Controls

```
┌─ AI Review Configuration ──────────────────────────────────┐
│                                                            │
│  Data Source:  ○ Synthetic Batch  ○ Sessions  ○ Evaluation │
│                                                            │
│  Batch: [Batch 12/10/2025 #28J22V (5 queries, ✓)]  ▾      │
│                                                            │
│  ┌─ Advanced ──────────────────────────────────────────┐  │
│  │ Sample Limit: [___] (empty = all)                   │  │
│  │ Model: [openai/gpt-4.1 ▾]                           │  │
│  │ Concurrency: [10]                                   │  │
│  │ □ Debug mode (uses cheaper model)                   │  │
│  │ ☑ Filter to failures only                          │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                            │
│  [Run AI Review]                                           │
└────────────────────────────────────────────────────────────┘
```

### Phase 4: Integration with Taxonomy

#### 4.1 Auto-Add Discovered Categories

When AI Review completes, show option to add categories to taxonomy:

```
┌─ AI Review Results ────────────────────────────────────────┐
│                                                            │
│  ✓ Completed analysis of 10 traces                        │
│                                                            │
│  Discovered 3 failure categories:                         │
│                                                            │
│  ☑ tool_usage_error (5 traces)                           │
│     "Agent called tools with incorrect parameters"        │
│     [Add to Taxonomy]  [View Traces]  [Ignore]            │
│                                                            │
│  ☑ response_format_issue (3 traces)                      │
│     "Response didn't match expected format"               │
│     [Merge with: [existing_mode ▾]]  [View Traces]        │
│                                                            │
│  ☐ context_misunderstanding (2 traces)                   │
│     "Agent misinterpreted user intent"                    │
│     [Add to Taxonomy]  [View Traces]  [Ignore]            │
│                                                            │
│  [Add Selected to Taxonomy] [Export Report] [Dismiss]     │
└────────────────────────────────────────────────────────────┘
```

#### 4.2 Merge with Existing Categories

If FAILS discovers a category similar to an existing one:
- Show suggestion to merge
- Allow renaming on merge
- Track which traces belong to which category

---

## Implementation Order

### Sprint 1: Quick Wins ✅ COMPLETED
1. ✅ Fix TypeError bug in review endpoints
2. ✅ Enhance batch selector to show: `Batch 12/10/2025 #28J22V (5 queries, ✓ executed)`
3. ✅ Move AI Review section below Failure Modes (full width)
4. ✅ Add n_samples control

**Implemented (Dec 10, 2025):**
- Backend: `BatchResponse` now includes `executed_count`, `success_count`, `failure_count`, `pending_count`
- Backend: `list_batches` endpoint uses JOIN query to aggregate query stats
- Backend: `AutoReviewRequest` extended with `n_samples`, `debug`, `filter_failures_only`
- Backend: `AutoReviewer` class updated to support all new FAILS options
- Frontend: `SyntheticBatch` type extended with optional stats fields
- Frontend: `TaxonomyTab.tsx` completely redesigned with full-width AI Review section
- Frontend: Enhanced batch dropdown showing query counts, success/failure stats, relative time
- Frontend: Advanced options panel with Sample Limit, "Failures only", and "Debug mode" controls

### Sprint 2: Better Controls ✅ COMPLETED
5. ✅ Add all FAILS controls (model, concurrency, debug)
6. ✅ Add ability to filter to failures only
7. ⬜ Show review progress with detailed steps

**Implemented (Dec 10, 2025):**
- `debug` mode uses cheaper model (`openai/gpt-4.1-mini`) automatically
- `filter_failures_only` option queries only error traces from batch
- Controls exposed in collapsible "Options" panel in the UI

### Sprint 3: Session Traces ✅ COMPLETED
8. ✅ Add data source selector (Synthetic/Sessions/Evaluation)
9. ✅ Implement session-to-FAILS trace conversion
10. ⬜ Test with real session data (manual testing)

**Implemented (Dec 10, 2025):**
- Backend: `get_session_traces_for_fails()` function to convert sessions to FAILS format
- Backend: `SessionAutoReviewer` class extending `AutoReviewer` for session-based analysis
- Backend: `POST /api/sessions/auto-review` endpoint for session-based AI review
- Frontend: `TraceSourceType` type and `runSessionAutoReview()` API function
- Frontend: Data source selector (radio buttons: "Synthetic Batch" / "Sessions")
- Frontend: Session batch selector with session stats display
- Sessions are analyzed as complete conversation traces including notes/feedback

### Sprint 4: Taxonomy Integration
11. ⬜ "Add to Taxonomy" button for discovered categories
12. ⬜ Merge suggestions for similar categories
13. ⬜ Track which traces belong to which failure modes

### Sprint 5: Full Weave Integration
14. ⬜ Add Weave Evaluation as data source
15. ⬜ Use FAILS' full `run_extract_and_classify_pipeline`
16. ⬜ Column selection UI for Weave data

---

## API Changes Needed

### Backend

```python
# ✅ DONE - Stats now included in list_batches response
@router.get("/synthetic/batches")
async def list_batches(agent_id: Optional[str] = None) -> List[BatchResponse]:
    """Returns batches with executed_count, success_count, failure_count, pending_count."""

# ✅ DONE - Enhanced auto-review endpoint
@router.post("/synthetic/batches/{batch_id}/auto-review")
async def run_auto_review(
    batch_id: str,
    request: AutoReviewRequest  # Now includes n_samples, debug, filter_failures_only
) -> AutoReviewResponse:
    pass

# ✅ DONE (Sprint 3): Review sessions directly
@router.post("/sessions/auto-review")
async def review_sessions(request: SessionAutoReviewRequest) -> SessionAutoReviewResponse:
    """Analyze session traces using FAILS pipeline."""

# ⬜ TODO (Sprint 4): Add AI categories to taxonomy
@router.post("/taxonomy/add-from-review")
async def add_categories_from_review(
    review_id: str,
    category_names: List[str]  # Which discovered categories to add
) -> TaxonomyResponse:
    pass
```

### Frontend Types

```typescript
// ✅ DONE - AutoReviewConfig in lib/api.ts
interface AutoReviewConfig {
  model?: string;
  max_concurrent_llm_calls?: number;
  n_samples?: number;      // ✅ Added
  debug?: boolean;          // ✅ Added
  filter_failures_only?: boolean;  // ✅ Added
}

// ✅ DONE - SyntheticBatch in types/index.ts (stats now optional fields)
interface SyntheticBatch {
  id: string;
  name: string;
  status: string;
  query_count: number;
  created_at: string;
  executed_count?: number;   // ✅ Added
  success_count?: number;    // ✅ Added
  failure_count?: number;    // ✅ Added
  pending_count?: number;    // ✅ Added
}

// ✅ DONE (Sprint 3) - TraceSource in types/index.ts
type TraceSourceType = "synthetic_batch" | "sessions";

// Session auto-review in api.ts
interface SessionAutoReviewConfig {
  session_ids: string[];
  model?: string;
  n_samples?: number;
  debug?: boolean;
  filter_failures_only?: boolean;
}

function runSessionAutoReview(config: SessionAutoReviewConfig): Promise<AutoReview>;
```

---

## Success Metrics

1. **Time to First Category**: How long from sync to having categorized failure modes
   - Current: Manual annotation (minutes per failure)
   - Target: Auto-discovery (seconds for batch)

2. **Coverage**: % of failures that get categorized
   - Current: Only what humans manually tag
   - Target: 100% of traces analyzed, categories suggested

3. **Accuracy**: How often AI categories match human judgment
   - Measure via "Accept/Reject" rate on suggestions

---

## Notes

### FAILS 3-Step Pipeline

1. **Draft Categorization (Open Coding)**: Each trace analyzed individually, 1-3 candidate categories proposed
2. **Clustering & Review**: All candidates clustered into max 7 canonical categories
3. **Final Classification**: Each trace assigned to exactly one category

### Why Raw Traces Matter

FAILS prompts include:
- `<row_input>` - Full input context
- `<row_output>` - Complete output including tool calls
- `<evaluation_evaluation_or_scorer_data>` - Why it failed

If we only send `query_text` and `response_text`, we lose:
- Tool usage patterns
- Intermediate reasoning
- Error messages
- Context that led to failure

The richer the trace data, the better the categorization.

---

## Changelog

### December 10, 2025 - Sprint 1 & 2 Implementation

**Files Changed:**

| File | Changes |
|------|---------|
| `backend/routers/synthetic.py` | Enhanced `BatchResponse` with stats, updated `list_batches` with JOIN query, extended `AutoReviewRequest` with FAILS options |
| `backend/services/auto_reviewer.py` | Added `n_samples`, `debug`, `filter_failures_only` params; updated `_get_batch_traces()` to support filtering; added random sampling |
| `frontend/src/app/types/index.ts` | Extended `SyntheticBatch` with optional stats fields |
| `frontend/src/app/lib/api.ts` | Extended `AutoReviewConfig` interface, updated `runAutoReview()` function |
| `frontend/src/app/components/tabs/TaxonomyTab.tsx` | Full redesign: moved AI Review to full-width section, added enhanced batch dropdown, added collapsible Options panel |

**Screenshots:**
- Enhanced batch dropdown with stats, checkmarks, and relative time
- Full-width AI Review section with batch selector, Run button, and Options
- Advanced Options panel with Sample Limit, Failures only, Debug mode controls

### December 10, 2025 - Sprint 3 Implementation

**Files Changed:**

| File | Changes |
|------|---------|
| `backend/services/auto_reviewer.py` | Added `get_session_traces_for_fails()` function, `SessionAutoReviewer` class, `run_session_auto_review()` function |
| `backend/routers/sessions.py` | Added `SessionAutoReviewRequest/Response` models, `POST /sessions/auto-review` endpoint |
| `frontend/src/app/types/index.ts` | Added `TraceSourceType`, `TraceSourceSyntheticBatch`, `TraceSourceSessions` types |
| `frontend/src/app/lib/api.ts` | Added `SessionAutoReviewConfig` interface, `runSessionAutoReview()` function |
| `frontend/src/app/components/tabs/TaxonomyTab.tsx` | Added data source selector (radio buttons), session batch selector, session stats display |

**Key Features:**
- Data source selector allows choosing between "Synthetic Batch" and "Sessions" as input
- Sessions are converted to FAILS-compatible trace format including conversation context and feedback notes
- Session selector shows batch-grouped sessions with stats (total, reviewed, errors)
- Same advanced options (n_samples, debug, failures_only) work for both sources

