# AI Suggestion Service

## Overview

> **Note**: We initially explored integrating FAILS (Failure Analysis and Insight Learning System) but discovered it's designed for **evaluation traces with scoring functions** - not raw chat traces. FAILS requires proper evaluation data and reward signals as prerequisites.
>
> Instead, we're building our own lightweight LLM-powered suggestion service that uses agent context (via `AGENT_INFO.md`) to suggest quality issues during human review.

The AI Suggestion Service analyzes conversation traces and suggests notes to help humans review faster. It understands the agent's purpose, capabilities, and limitations from `AGENT_INFO.md` and uses that context to identify potential quality issues.

**Mental Model:**
```
Batch Executes → Background Analysis → Suggestions Ready → Human Reviews with AI Assistance
```

The goal: **Speed up human annotation by pre-generating quality observations** that humans can accept, edit, or skip.

---

## How It Works

### Context Sources

The AI has access to three sources of context:

#### 1. Agent Context (AGENT_INFO.md)
The service reads the agent's documentation to understand:
- **Purpose & Scope**: What the agent is supposed to do
- **Capabilities**: What tools and actions are available  
- **Limitations**: What the agent cannot do
- **Success Criteria**: How to judge good vs bad responses
- **Domain Knowledge**: Pricing, policies, etc.

#### 2. Existing Failure Modes (Taxonomy)
The service pulls existing failure mode categories:
- **Category names**: e.g., "Tool Usage Error", "Policy Violation"
- **Definitions**: What each category means
- **Example notes**: Real notes humans wrote for each category

This helps the AI:
- Suggest consistent categories that match the established taxonomy
- Write notes in a similar style/format to existing ones
- Avoid creating redundant or overlapping categories

#### 3. Recent Notes (Few-shot Examples)
Recent human-written notes serve as examples:
- Shows the level of detail expected
- Demonstrates preferred writing style
- Provides concrete examples of good observations

### Trace Analysis

For each conversation trace, the service analyzes:
- Did the agent use the right tools?
- Did the response align with the agent's purpose?
- Were limitations respected (no hallucinated promises)?
- Was the tone appropriate for the customer persona?
- Did the agent follow documented policies?

### Suggested Notes

The output is a **suggested note** for each trace:
```
"The agent provided pricing information without using get_product_info tool,
 potentially hallucinating the Business plan price."
```

If an existing failure mode matches, the AI suggests that category. Otherwise, it proposes a new one.

---

## Architecture

### LLM Prompt Structure

```
SYSTEM:
You are analyzing traces from a {agent_name} to identify quality issues.

=== AGENT CONTEXT ===
{contents of AGENT_INFO.md}

=== EXISTING FAILURE MODES ===
These are the established failure categories. Use these when applicable:

{for each failure_mode in taxonomy}
- {failure_mode.name}: {failure_mode.definition}
  Example notes:
  • "{note_1.text}"
  • "{note_2.text}"
{end for}

=== RECENT NOTES (for style reference) ===
{recent_notes - last 10 human-written notes}

=== TRACE TO ANALYZE ===
{trace_data in execution order}

=== TASK ===
Analyze this trace for quality issues. Consider:
1. Did the agent use appropriate tools?
2. Is the information accurate per the agent's knowledge base?
3. Was the tone appropriate?
4. Were any limitations violated?
5. Did the agent follow documented policies?

If there's an issue:
- Use an existing failure mode category if one fits
- Write a note in similar style to the examples
- If no existing category fits, suggest a new one

If the response looks good, respond with "LGTM".

=== OUTPUT FORMAT ===
{
  "has_issue": true/false,
  "suggested_note": "Description of issue..." | null,
  "failure_mode_id": "existing_mode_id" | null,  // Use existing if matches
  "suggested_category": "New Category Name" | null,  // Only if no existing fits
  "confidence": 0.0-1.0
}
```

### Service Components

```python
class SuggestionService:
    """Analyzes traces using agent context, taxonomy, and notes to suggest quality observations."""
    
    def __init__(self, agent_info_path: str, model: str = "gpt-4.1-mini"):
        self.agent_context = load_agent_info(agent_info_path)
        self.model = model
    
    def _get_context(self) -> AnalysisContext:
        """Gather all context for the LLM."""
        return AnalysisContext(
            agent_info=self.agent_context,
            failure_modes=get_failure_modes_with_notes(),  # From taxonomy
            recent_notes=get_recent_notes(limit=10),       # For style reference
        )
    
    async def analyze_trace(self, trace: Trace, context: AnalysisContext) -> Suggestion:
        """Analyze a single trace and return a suggestion."""
        prompt = build_analysis_prompt(context, trace)
        response = await llm_call(prompt, self.model)
        return parse_suggestion(response)
    
    async def analyze_batch(self, batch_id: str) -> List[Suggestion]:
        """Analyze all traces in a batch."""
        context = self._get_context()  # Load once, reuse for all traces
        traces = get_batch_traces(batch_id)
        return await asyncio.gather(*[
            self.analyze_trace(t, context) for t in traces
        ])


@dataclass
class AnalysisContext:
    """All context needed for trace analysis."""
    agent_info: str                    # AGENT_INFO.md contents
    failure_modes: List[FailureMode]   # Existing taxonomy with example notes
    recent_notes: List[Note]           # Recent human-written notes for style
```

---

## Database Schema

```sql
-- AI suggestions for traces
CREATE TABLE trace_suggestions (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    batch_id TEXT,
    session_id TEXT,
    
    -- Analysis result
    has_issue BOOLEAN NOT NULL,
    suggested_note TEXT,           -- The suggested note text
    confidence REAL,               -- 0.0 to 1.0
    thinking TEXT,                 -- LLM reasoning (for debugging)
    
    -- Category suggestion (one of these will be set)
    failure_mode_id TEXT,          -- Links to existing failure mode if matched
    suggested_category TEXT,       -- New category name if no existing match
    
    -- User action
    status TEXT DEFAULT 'pending', -- pending | accepted | edited | rejected | skipped
    user_note_id TEXT,             -- Links to actual note if accepted
    
    created_at TEXT DEFAULT (datetime('now')),
    reviewed_at TEXT,
    
    FOREIGN KEY (batch_id) REFERENCES synthetic_batches(id),
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (failure_mode_id) REFERENCES failure_modes(id)
);

CREATE INDEX idx_suggestions_batch ON trace_suggestions(batch_id);
CREATE INDEX idx_suggestions_session ON trace_suggestions(session_id);
CREATE INDEX idx_suggestions_status ON trace_suggestions(status);
CREATE INDEX idx_suggestions_failure_mode ON trace_suggestions(failure_mode_id);
```

---

## UX Flow

### 1. Background Processing

After batch execution completes:
```
┌─────────────────────────────────────────────────────────────────┐
│  Batch #28J22V executed (5 queries)                             │
│                                                                 │
│  🔄 Analyzing traces...                                         │
│  ████████████░░░░ 3/5 complete                                  │
└─────────────────────────────────────────────────────────────────┘
```

When complete:
```
┌─────────────────────────────────────────────────────────────────┐
│  Batch #28J22V                                     ✓ Executed   │
│  5 queries • 3 issues found • 🤖 Suggestions ready              │
│                                                                 │
│  [Review Sessions]                                              │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Inline Suggestions During Review

When reviewing a session in the Threads tab:
```
┌─────────────────────────────────────────────────────────────────┐
│  Session: john@example.com                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User: "How much does the Business plan cost?"                  │
│                                                                 │
│  Agent: "The Business plan is $19 per user per month,           │
│          with a minimum of 5 users."                            │
│                                                                 │
│  Tools used: (none)                                             │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 💡 Suggested Issue (85% confidence)                      │   │
│  │                                                          │   │
│  │ "Agent provided pricing without using get_product_info   │   │
│  │  tool. Response is accurate but violates the policy      │   │
│  │  of always using tools for pricing information."         │   │
│  │                                                          │   │
│  │ Category: tool_usage                                     │   │
│  │                                                          │   │
│  │ [✓ Accept as Note] [✏️ Edit] [Skip]                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Your Notes:                                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ + Add a note...                                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Bulk Actions

For efficiency, allow batch operations:
```
┌─────────────────────────────────────────────────────────────────┐
│  Batch #28J22V: 3 suggestions pending                           │
│                                                                 │
│  ☑ tool_usage (2 traces) - "Agent didn't use get_product_info" │
│  ☑ policy (1 trace) - "Promised refund outside policy"         │
│                                                                 │
│  [Accept All Selected] [Review Individually]                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### Backend

```python
# Trigger analysis for a batch
@router.post("/synthetic/batches/{batch_id}/analyze")
async def analyze_batch(batch_id: str) -> AnalysisResponse:
    """Run AI suggestion service on all traces in a batch."""
    pass

# Get suggestions for a session/trace
@router.get("/sessions/{session_id}/suggestions")
async def get_session_suggestions(session_id: str) -> List[Suggestion]:
    """Get AI suggestions for a specific session."""
    pass

# Act on a suggestion
@router.post("/suggestions/{suggestion_id}/accept")
async def accept_suggestion(suggestion_id: str, edited_text: Optional[str] = None) -> Note:
    """Accept a suggestion, optionally with edits. Creates a note."""
    pass

@router.post("/suggestions/{suggestion_id}/skip")
async def skip_suggestion(suggestion_id: str) -> None:
    """Skip a suggestion (mark as reviewed but not accepted)."""
    pass

# Bulk actions
@router.post("/suggestions/bulk-accept")
async def bulk_accept_suggestions(suggestion_ids: List[str]) -> List[Note]:
    """Accept multiple suggestions at once."""
    pass
```

### Frontend Types

```typescript
interface Suggestion {
  id: string;
  trace_id: string;
  batch_id?: string;
  session_id?: string;
  
  has_issue: boolean;
  suggested_note: string | null;
  confidence: number;
  
  // Category - either existing failure mode or new suggestion
  failure_mode_id: string | null;      // Links to existing taxonomy
  failure_mode_name?: string;           // Populated from join
  suggested_category: string | null;    // New category if no match
  
  status: 'pending' | 'accepted' | 'edited' | 'rejected' | 'skipped';
  created_at: string;
}

interface AnalysisResponse {
  batch_id: string;
  total_traces: number;
  issues_found: number;
  suggestions: Suggestion[];
}
```

---

## Category Assignment

### Priority: Use Existing Taxonomy

The AI first tries to match issues to **existing failure modes** from the taxonomy. This ensures:
- Consistency with human-curated categories
- Notes get properly clustered
- No duplicate/overlapping categories created

### Fallback: Suggest New Category

If no existing failure mode fits, the AI suggests a new category name. Common patterns:

| Category Pattern | Description | Example |
|------------------|-------------|---------|
| Tool Usage Error | Agent didn't use appropriate tools | Gave pricing without calling get_product_info |
| Accuracy Issue | Information may be incorrect | Stated wrong price or feature |
| Tone Mismatch | Response tone inappropriate | Too casual, not empathetic enough |
| Policy Violation | Policy not followed correctly | Promised refund outside policy terms |
| Scope Exceeded | Outside agent's capabilities | Made promises about unreleased features |

These patterns help bootstrap the taxonomy when starting fresh. Over time, as humans accept/edit suggestions, the taxonomy grows and fewer "new category" suggestions are needed.

---

## Configuration

```python
class SuggestionConfig:
    model: str = "gpt-4.1-mini"  # Cheap, fast model for suggestions
    max_concurrent: int = 10     # Parallel LLM calls
    min_confidence: float = 0.6  # Only show suggestions above this threshold
    auto_run: bool = True        # Auto-run after batch execution
```

---

## Implementation Plan

### Sprint 1: Core Service ✅
- [x] Create `SuggestionService` class (`backend/services/suggestion.py`)
- [x] Implement AGENT_INFO.md parsing (reused existing `services/agent_info.py`)
- [x] Build analysis prompt (with agent context, taxonomy, and recent notes)
- [x] Add `trace_suggestions` table (`backend/database.py`)
- [x] Create `/analyze` endpoint (`backend/routers/suggestions.py`)

### Sprint 2: UI Integration ✅
- [x] Add suggestion display to Threads tab (per-session)
- [x] Implement Accept/Edit/Skip actions for individual suggestions
- [x] Add "Analyze" button in Threads tab batch review panel
- [x] Add progress indicator during analysis
- [x] Show success feedback when analysis finds no issues ("Looks good!")

### Sprint 3: Polish ✅
- [x] Bulk accept/reject/skip actions (modal UI in Synthetic tab)
- [x] Suggestion history endpoint (`GET /api/suggestions/history`)
- [x] Accept rate tracking for prompt tuning insights (shown in stats)
- [x] Add confidence threshold setting to Settings tab

---

## Feedback Loop

The system improves over time as humans review suggestions:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   AI Analyzes Trace                                             │
│        ↓                                                        │
│   Uses: AGENT_INFO + Existing Taxonomy + Recent Notes           │
│        ↓                                                        │
│   Suggests Note + Category                                      │
│        ↓                                                        │
│   Human Reviews                                                 │
│     ├── Accept → Note created, category confirmed               │
│     ├── Edit → Note created with corrections, AI learns style   │
│     └── Skip → Implicit feedback (AI was wrong)                 │
│        ↓                                                        │
│   Taxonomy grows, more example notes available                  │
│        ↓                                                        │
│   Next batch: AI has richer context, better suggestions         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Cold Start**: When taxonomy is empty, AI suggests new categories based on AGENT_INFO context alone. Suggestions will be more generic.

**Warm State**: After a few batches of human review, the taxonomy has categories with example notes. AI suggestions become more consistent and accurate.

---

## Success Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| **Accept Rate** | % of suggestions accepted (with or without edits) | > 60% |
| **Edit Rate** | % of accepted suggestions that were edited | < 30% |
| **Time Saved** | Reduction in review time per session | 50% faster |
| **Coverage** | % of actual issues caught by AI | > 80% |

---

## Notes

### Why Not FAILS?

FAILS (Failure Analysis and Insight Learning System) is designed for **evaluation traces**:
- Requires ground truth / expected outputs
- Needs scoring functions (pass/fail, reward signals)
- Works on formal evaluation datasets

Our use case is different:
- Raw conversation traces (production or synthetic)
- No formal evaluation data
- Goal is to speed up human review, not replace it

### Comparison

| Aspect | FAILS | Our Suggestion Service |
|--------|-------|----------------------|
| **Input** | Evaluation traces with scores | Raw conversation traces |
| **Requirements** | Scorer functions, ground truth | Just AGENT_INFO.md context |
| **Output** | Failure categories + classifications | Suggested notes per trace |
| **Goal** | Categorize failures systematically | Speed up human review |

---

## Changelog

### December 10, 2025 - Sprint 3 Polish

**Backend Changes:**

| File | Changes |
|------|---------|
| `backend/services/suggestion.py` | Added `bulk_reject_suggestions`, `bulk_skip_suggestions`, `get_suggestion_history` methods; Enhanced `get_suggestion_stats` with accept rate |
| `backend/routers/suggestions.py` | Added `/bulk-reject`, `/bulk-skip`, `/history` endpoints; Enhanced stats response with `accept_rate` and `reviewed_total` |
| `backend/services/settings.py` | Added AI Suggestions settings group: `suggestion_confidence_threshold`, `suggestion_model`, `suggestion_auto_analyze` |

**Frontend Changes:**

| File | Changes |
|------|---------|
| `frontend/src/app/lib/api.ts` | Added `bulkRejectSuggestions`, `bulkSkipSuggestions`, `fetchSuggestionHistory` functions |
| `frontend/src/app/types/index.ts` | Added `accept_rate` and `reviewed_total` to `SuggestionStats` |
| `frontend/src/app/components/tabs/ThreadsTab.tsx` | Added collapsible Bulk Suggestions Panel with select all, bulk accept/reject/skip, session linking |

**Features Implemented:**
- Bulk Suggestions Panel in Threads tab (appears when filtering by batch)
- Collapsible panel that auto-expands when suggestions are pending
- Select all / individual selection with checkboxes
- Bulk Accept, Reject, and Skip actions with loading states
- Direct "View" links to jump to specific sessions
- Suggestion history API endpoint for audit trail
- Confidence threshold configurable via Settings

---

### December 10, 2025 - Sprint 2 UI Integration

**Frontend Changes:**

| File | Changes |
|------|---------|
| `frontend/src/app/types/index.ts` | Added `TraceSuggestion`, `SuggestionAnalysisResponse`, `SuggestionStats`, `AcceptSuggestionResult` types |
| `frontend/src/app/lib/api.ts` | Added suggestion API functions: `analyzeSession`, `analyzeBatch`, `fetchSessionSuggestions`, `acceptSuggestion`, `skipSuggestion`, `rejectSuggestion`, `bulkAcceptSuggestions` |
| `frontend/src/app/components/tabs/ThreadsTab.tsx` | Added `SuggestionCard` component with Accept/Edit/Skip/Reject actions, analysis result feedback, integrated into session detail view |
| `frontend/src/app/components/tabs/SyntheticTab.tsx` | Added "Analyze" button to completed batches, auto-analysis after batch execution, suggestion count badges |

**Features Implemented:**
- AI Suggestions section in Threads tab with Analyze button
- SuggestionCard component showing suggested notes with confidence scores
- Accept, Edit, Skip, and Reject actions for suggestions
- Success/warning feedback when analysis completes
- Auto-analysis triggered after batch execution completes
- Suggestion count badge on completed batches in Synthetic tab

---

## Archived: Previous FAILS Integration Work

<details>
<summary>Click to expand archived changelog (FAILS-based implementation)</summary>

The following work was completed while we were exploring FAILS integration. This code may need to be modified or replaced as we pivot to the new suggestion service.

### December 10, 2025 - Sprint 1 & 2 Implementation

**Files Changed:**

| File | Changes |
|------|---------|
| `backend/routers/synthetic.py` | Enhanced `BatchResponse` with stats, updated `list_batches` with JOIN query |
| `backend/services/auto_reviewer.py` | Added FAILS-based auto-review (needs replacement) |
| `frontend/src/app/types/index.ts` | Extended `SyntheticBatch` with optional stats fields |
| `frontend/src/app/lib/api.ts` | Extended `AutoReviewConfig` interface |
| `frontend/src/app/components/tabs/TaxonomyTab.tsx` | AI Review section (needs removal/replacement) |

### December 10, 2025 - Sprint 3 Implementation

**Backend features built but not used:**
- `get_session_traces_for_fails()` function
- `SessionAutoReviewer` class
- `POST /api/sessions/auto-review` endpoint

### December 10, 2025 - Sprint 4 Implementation  

**Taxonomy integration features:**
- `POST /api/taxonomy/add-from-review` endpoint
- Similarity matching for category names
- `review_category_associations` table

**Note**: These may still be useful for the new suggestion service once we have categories.

</details>
