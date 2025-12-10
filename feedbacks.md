# Principal Engineer Feedback - Implementation Plan

This document captures feedback from the PE review and outlines the implementation plan to address each point.

---

## Executive Summary

The PE identified five key areas for improvement:

1. **Landing Page**: Add a workflow-oriented landing page with tiles showing the user journey
2. **Merge Runs into Data Tab**: Consolidate Runs functionality into the Data tab (rename to "Synthetic")  
3. **Sessions Tab Improvements**: Add batch filter + rename to "Threads"
4. **Agents Tab Enhancement**: Show agent status snapshot + make agent selection a dropdown
5. **Saturation Metric UX**: Improve how saturation is visualized (from taxonomy.md)

---

## Feedback 1: Workflow Landing Page

> ✅ **COMPLETED** - Landing page with 4 workflow step cards, "Start" button → Agents tab, logo click returns to landing page.

### Problem Statement

New users don't have a clear understanding of the intended workflow. The app currently jumps directly into tabs without guidance on the expected flow:

```
Add Agent → Generate Data → Execute → View Sessions → Generate Failure Modes
```

### Proposed Solution

Create a simple landing page with tiles showing workflow steps. This page appears when:
- No agents are registered (first-time user)
- User clicks on the logo/home
- Optional: Can be dismissed/hidden

### UI Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Error Analysis Workflow                             │
│                                                                              │
│   Welcome! Follow these steps to analyze your agent's failure modes.        │
│                                                                              │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐ │
│   │      1       │   │      2       │   │      3       │   │      4       │ │
│   │   ┌─────┐    │   │   ┌─────┐    │   │   ┌─────┐    │   │   ┌─────┐    │ │
│   │   │ 🤖 │    │──▶│   │ ⚡ │    │──▶│   │ 💬 │    │──▶│   │ 📊 │    │ │
│   │   └─────┘    │   │   └─────┘    │   │   └─────┘    │   │   └─────┘    │ │
│   │              │   │              │   │              │   │              │ │
│   │ Connect      │   │  Generate    │   │   Review     │   │  Categorize  │ │
│   │ Agent        │   │  Test Data   │   │   Threads    │   │  Failures    │ │
│   │              │   │              │   │              │   │              │ │
│   │ Register     │   │ Create       │   │ Review agent │   │ Build your   │ │
│   │ your agent   │   │ synthetic    │   │ responses,   │   │ failure mode │ │
│   │ with AG-UI   │   │ queries and  │   │ add notes,   │   │ taxonomy     │ │
│   │ endpoint     │   │ execute them │   │ mark issues  │   │ & track      │ │
│   │              │   │              │   │              │   │ saturation   │ │
│   │   [START]    │   │              │   │              │   │              │ │
│   └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘ │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Your Progress: No agents registered                                │   │
│   │  ○───○───○───○                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│                           [ Skip to Agents Tab ]                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Implementation Details

**Frontend Changes:**

1. **New Component**: `LandingPage.tsx`
   - Path: `frontend/src/app/components/LandingPage.tsx`
   - Workflow tiles with icons and descriptions
   - Progress indicator showing completed steps
   - CTA buttons for each step
   - "Skip" or "Don't show again" option

2. **AppContext Changes:**
   - Add `showLandingPage` state (derived from: no agents OR user preference)
   - Add `hasSeenLanding` localStorage key for returning users
   - Calculate workflow progress based on:
     - Step 1: `agents.length > 0`
     - Step 2: `syntheticBatches.length > 0`
     - Step 3: `sessions.some(s => s.is_reviewed)`
     - Step 4: `taxonomy?.failure_modes.length > 0`

3. **page.tsx Changes:**
   - Conditionally render `LandingPage` vs `AppLayout`
   - Landing page shown when `showLandingPage === true`

**Files to Modify:**
- `frontend/src/app/page.tsx`
- `frontend/src/app/context/AppContext.tsx`

**Files to Create:**
- `frontend/src/app/components/LandingPage.tsx`

**Priority:** P1 (High) - Improves onboarding UX significantly

---

## Feedback 2: Merge Runs Tab into Data Tab

> ✅ **COMPLETED** - Runs tab merged into Synthetic tab with Run/Re-run/View in Sessions buttons on batch cards.

### Problem Statement

The Runs tab currently:
- Shows pending/completed batches
- Has a "Run" button to execute batches
- Shows execution progress
- Displays run results with query/response pairs

This is redundant because the Data tab already:
- Shows generated batches
- Has batch preview functionality
- Has a "View in Runs" link

The PE suggests merging these because **Runs is essentially just a "Run button" and results viewer**.

### Proposed Solution

1. **Eliminate the Runs tab entirely**
2. **In the Data tab's "Generated Batches" panel:**
   - Add a "Run" button directly on each pending batch
   - Show execution progress inline when running
3. **In "Batch Data Preview":**
   - Show query text for pending batches (existing)
   - Show query + response for executed batches (merged from Runs)
4. **Rename "Data" tab to "Synthetic"** (clearer purpose)

### UI Design - Merged Data Tab

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SYNTHETIC (renamed from "Data")                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  [Agent Dropdown] [#] 20 queries [Strategy ▼] [Dimensions ▼] [GENERATE]     │
│                                                                              │
├────────────────────────────┬────────────────────────────────────────────────┤
│  Testing Dimensions        │  Generated Batches                             │
│  ─────────────────────────│  ───────────────────────────────────────────   │
│  personas (4 values)       │  ┌────────────────────────────────────────┐   │
│  complexity (3 values)     │  │ Batch 12/10 #A7F2  │ 20 queries │ ready│   │
│  scenarios (5 values)      │  │ [▶ RUN] [Delete]                       │   │
│                            │  └────────────────────────────────────────┘   │
│                            │                                                │
│                            │  ┌────────────────────────────────────────┐   │
│                            │  │ Batch 12/9 #B3E1   │ 15 queries │ done │   │
│                            │  │ ✓ 14 success ✗ 1 fail                  │   │
│                            │  │ [View in Threads] [Re-run] [Delete]    │   │
│                            │  └────────────────────────────────────────┘   │
│                            │                                                │
│                            │  ═══════════════════════════════════════════  │
│                            │  🔄 Executing Batch 12/10...                   │
│                            │  ▓▓▓▓▓▓▓▓░░░░░░░ 50% (10/20)                  │
│                            │  ═══════════════════════════════════════════  │
├────────────────────────────┴────────────────────────────────────────────────┤
│                                                                              │
│  Batch Preview                                                               │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ #1  │ frustrated_customer, refund, complex │ ✓ success              │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ Q: "I've been waiting 3 days for my refund and no one..."          │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ A: "I understand your frustration. Let me look into this..."       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ #2  │ power_user, feature, simple │ ✗ error                        │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ Q: "How do I enable keyboard shortcuts?"                            │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ ⚠️ Error: Agent timeout after 60s                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Implementation Details

**Frontend Changes:**

1. **Merge `RunsTab.tsx` into `SyntheticTab.tsx`:**
   - Move execution logic (SSE streaming, progress bar)
   - Move batch run controls (Run button, Re-run, Stop)
   - Move `QueryResultRow` component for showing responses

2. **Update batch card to include run controls:**
   - Pending batches: Show "Run" button
   - Running batches: Show progress indicator
   - Completed batches: Show success/fail counts, "View in Threads" link

3. **Update "Batch Data Preview" panel:**
   - For pending batches: Show query text only (editable)
   - For completed batches: Show query + response + status (read-only)
   - Use `QueryResultRow` from Runs tab for executed queries

4. **Remove Runs tab from navigation:**
   - Update `page.tsx` to remove Runs from tabs array
   - Update `TabType` in types

5. **Rename tab: "Data" → "Synthetic"**

**Files to Modify:**
- `frontend/src/app/components/tabs/SyntheticTab.tsx` (major changes)
- `frontend/src/app/page.tsx` (remove Runs tab)
- `frontend/src/app/types/index.ts` (remove "runs" from TabType)
- `frontend/src/app/context/AppContext.tsx` (cleanup)

**Files to Delete:**
- `frontend/src/app/components/tabs/RunsTab.tsx`

**Backend Changes:** None required - all endpoints remain the same.

**Priority:** P1 (High) - Simplifies UX and reduces confusion

---

## Feedback 3: Sessions Tab Improvements

### Problem 3.1: No Batch Filter in Sessions Tab

Currently, the batch filter only appears when navigating from "Run results → View in Sessions". It should be a first-class filter in the Sessions tab itself.

### Problem 3.2: "Sessions" is a Confusing Name

The term "Sessions" doesn't clearly communicate what users are reviewing. "Threads" better aligns with the concept of conversation threads/traces.

### Proposed Solution

1. **Rename "Sessions" → "Threads"** throughout the app
2. **Add batch filter dropdown to Threads tab** alongside other filters

### UI Design - Batch Filter

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Threads                                         Synced 2 min ago [Sync]    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  [🔍 Search threads...]                                                      │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Batch: [All Batches ▼]                                             │   │
│  │         ├── All Batches                                             │   │
│  │         ├── Organic (no batch)                                      │   │
│  │         ├── ──────────────────                                      │   │
│  │         ├── Batch 12/10 #A7F2 (20 threads)                          │   │
│  │         ├── Batch 12/9 #B3E1 (15 threads)                           │   │
│  │         └── Batch 12/8 #C4D2 (25 threads)                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  Sort: [Time ▼] [↓ Desc]   [Add Range Filter]                               │
│                                                                              │
│  [Not Reviewed] [Reviewed] [Has Errors]                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Implementation Details

**Frontend Changes:**

1. **Rename throughout codebase:**
   - `SessionsTab.tsx` → `ThreadsTab.tsx`
   - Update all references in `page.tsx`, `AppContext.tsx`, types
   - Update UI labels: "Sessions" → "Threads"
   - Keep backend endpoints as `/api/sessions` (less breaking)

2. **Add batch filter dropdown:**
   - New component or inline dropdown in ThreadsTab
   - Fetch available batches: `GET /api/sessions/options/batches`
   - Options: "All", "Organic only", divider, then list of batches
   - When selected, set `filterBatchId` in context

3. **Show batch name in thread cards** (already done, verify)

**Backend Changes:**

1. **Add batches to filter options endpoint:**
   - Endpoint already exists: `GET /api/sessions/options/batches`
   - Returns `{ batches: [{ id, name, thread_count }] }`

**Files to Modify:**
- `frontend/src/app/components/tabs/SessionsTab.tsx` → rename + add dropdown
- `frontend/src/app/components/tabs/index.ts` (update export)
- `frontend/src/app/page.tsx` (update tab name)
- `frontend/src/app/types/index.ts` (rename type)
- `frontend/src/app/context/AppContext.tsx` (minor naming updates)

**Priority:** P1 (High) - Core usability improvement

---

## Feedback 4: Agents Tab Enhancement

### Problem 4.1: No Agent Status Snapshot

When viewing an agent, users can't quickly see:
- How many batches exist for this agent
- How many queries/samples have been generated
- How many threads have been reviewed
- How many failure modes have been identified

### Problem 4.2: Agent List Should Be Dropdown

When there are many agents, the current list-based selection takes up too much space. A dropdown is more efficient.

### Proposed Solution

1. **Add agent stats panel** showing key metrics
2. **Replace agent list with dropdown** in header area
3. **Keep agent detail view** for full info/playground

### UI Design - Agent Stats

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agents                                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ [TaskFlow Support Agent ▼]          ○ Connected                       │  │
│  │                                                                        │  │
│  │ [+ Register New Agent]                                                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         AGENT STATUS SNAPSHOT                          │  │
│  │                                                                        │  │
│  │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐              │  │
│  │   │    5     │  │   120    │  │   87     │  │    8     │              │  │
│  │   │ Batches  │  │ Queries  │  │ Reviewed │  │ Failures │              │  │
│  │   │          │  │ Generated│  │ /120     │  │  Found   │              │  │
│  │   └──────────┘  └──────────┘  └──────────┘  └──────────┘              │  │
│  │                                                                        │  │
│  │   Review Progress: ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░ 72%                        │  │
│  │   Saturation:      ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░ 45% (discovering)          │  │
│  │                                                                        │  │
│  │   Latest Batch: Batch 12/10 #A7F2 (completed 2h ago)                  │  │
│  │   Top Failure: "Policy Hallucination" (35% of failures)               │  │
│  │                                                                        │  │
│  │   [View Synthetic Data] [View Threads] [View Taxonomy]                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         AGENT DETAILS                                  │  │
│  │  ... existing agent detail view ...                                    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Implementation Details

**Backend Changes:**

1. **New endpoint: `GET /api/agents/{id}/stats`**
   ```python
   class AgentStats(BaseModel):
       agent_id: str
       agent_name: str
       
       # Batch stats
       total_batches: int
       pending_batches: int
       completed_batches: int
       
       # Query stats
       total_queries: int
       executed_queries: int
       success_queries: int
       failed_queries: int
       
       # Thread stats
       total_threads: int
       reviewed_threads: int
       unreviewed_threads: int
       review_progress_percent: float
       
       # Failure mode stats
       total_failure_modes: int
       total_categorized_notes: int
       saturation_score: float
       saturation_status: str  # "discovering", "approaching", "saturated"
       top_failure_mode: Optional[str]
       top_failure_mode_percent: Optional[float]
       
       # Activity
       latest_batch_name: Optional[str]
       latest_batch_completed_at: Optional[str]
   ```

2. **Implementation in `routers/agents.py`:**
   - Query `synthetic_batches` for batch counts
   - Query `synthetic_queries` for query counts  
   - Query `sessions` for thread counts
   - Query `failure_modes` and calculate saturation

**Frontend Changes:**

1. **Convert agent list to dropdown:**
   - Replace list panel with dropdown selector at top
   - Show connection status indicator inline
   - "Register New Agent" button below dropdown

2. **Add `AgentStatusSnapshot` component:**
   - 4 stat cards: Batches, Queries, Reviewed, Failures
   - Two progress bars: Review progress, Saturation
   - Latest activity info
   - Quick links to other tabs with context

3. **Fetch stats when agent is selected:**
   - New API call: `fetchAgentStats(agentId)`
   - Add `agentStats` to context state

**Files to Create:**
- `frontend/src/app/components/AgentStatusSnapshot.tsx`

**Files to Modify:**
- `backend/routers/agents.py` (add stats endpoint)
- `backend/models.py` (add AgentStats model)
- `frontend/src/app/components/tabs/AgentsTab.tsx` (major refactor)
- `frontend/src/app/lib/api.ts` (add fetchAgentStats)
- `frontend/src/app/context/AppContext.tsx` (add agentStats state)

**Priority:** P2 (Medium) - Valuable but not blocking core workflow

---

## Feedback 5: Saturation Metric UX Improvements

### Problem Statement

The current saturation display is:
- A single percentage number in the hero stats bar
- A badge showing "Discovering", "Approaching", or "Saturated"
- No visualization of discovery over time
- No actionable guidance

From `taxonomy.md`, we need:

1. **Discovery chart** showing failure mode discovery over time
2. **Sampling recommendations** based on saturation status
3. **Better visual representation**

### Proposed Solution

Implement the saturation improvements from `taxonomy.md` Section 3.6:

### UI Design - Improved Saturation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SATURATION TRACKING                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│    Failure Mode Discovery                                                    │
│                                                                              │
│      │                                    ────── Saturated                  │
│    8 │                          ●───●───●───●                               │
│      │                     ●────┘                                           │
│    6 │                ●────┘                                                │
│      │           ●────┘                                                     │
│    4 │      ●────┘                                                          │
│      │ ●────┘                                                               │
│    2 │                                                                      │
│      │                                                                      │
│    0 └─────────────────────────────────────────                             │
│      0    20    40    60    80   100   120                                  │
│                  Threads Reviewed                                            │
│                                                                              │
│   ─────────────────────────────────────────────────────────────────────     │
│                                                                              │
│   Current: 85 threads reviewed, 8 failure modes found                       │
│   Status:  Approaching saturation (no new modes in last 15 threads)         │
│                                                                              │
│   💡 Recommendation: Review ~15 more threads to confirm saturation.         │
│      Focus on underrepresented dimension combinations.                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Implementation Details

**Backend Changes:**

1. **Track discovery history:**
   - Add `saturation_snapshots` table:
     ```sql
     CREATE TABLE saturation_snapshots (
         id TEXT PRIMARY KEY,
         snapshot_date TEXT NOT NULL,
         threads_reviewed INTEGER NOT NULL,
         failure_modes_count INTEGER NOT NULL,
         saturation_score REAL NOT NULL
     );
     ```
   - Record snapshot after each categorization/review

2. **Update saturation calculation:**
   - Return discovery history for chart
   - Add recommendation text based on status

3. **New endpoint: `GET /api/taxonomy/saturation-history`**
   ```python
   class SaturationHistory(BaseModel):
       snapshots: List[SaturationSnapshot]  # (threads_reviewed, modes_count)
       current_threads: int
       current_modes: int
       last_discovery_at_threads: int
       recommendation: str
       status: str
   ```

**Frontend Changes:**

1. **Add saturation chart component:**
   - Simple line chart (can use CSS or a lightweight lib)
   - X-axis: threads reviewed
   - Y-axis: failure modes discovered
   - Reference line showing saturation threshold

2. **Add recommendation panel:**
   - Dynamic text based on saturation status
   - "Discovering": Focus on reviewing more traces
   - "Approaching": Sample from underrepresented dimensions
   - "Saturated": Taxonomy is stable, focus on fixing issues

3. **Integrate into TaxonomyTab:**
   - Expandable section below hero stats bar
   - Or separate panel in sidebar

**Files to Modify:**
- `backend/database.py` (add saturation_snapshots table)
- `backend/routers/taxonomy.py` (add history endpoint)
- `backend/services/taxonomy.py` (record snapshots)
- `frontend/src/app/components/tabs/TaxonomyTab.tsx`

**Files to Create:**
- `frontend/src/app/components/SaturationChart.tsx`

**Priority:** P2 (Medium) - Improves actionability of saturation metric

---

## Implementation Roadmap

### Phase 1: Quick Wins (1-2 days)
1. **Rename Sessions → Threads** (purely UI/naming change)
2. **Add batch filter dropdown to Threads tab** (backend ready)
3. **Rename Data → Synthetic tab** (trivial)

### Phase 2: Core Consolidation (2-3 days)
4. **Merge Runs into Synthetic tab** (medium complexity)
   - Move execution logic
   - Merge batch preview with run results
   - Delete RunsTab

### Phase 3: Landing & Stats (2-3 days)
5. **Add Landing Page** (new component)
6. **Add Agent Stats endpoint + UI** (backend + frontend)
7. **Convert agent list to dropdown** (UI refactor)

### Phase 4: Saturation UX (1-2 days)
8. **Add saturation history tracking** (backend)
9. **Add discovery chart** (frontend)
10. **Add recommendations** (backend + frontend)

### Total Estimated Time: 6-10 days

---

## Summary Table

| Feedback | Change | Priority | Effort | Impact |
|----------|--------|----------|--------|--------|
| 1. Landing Page | New component showing workflow | P1 | Medium | High (onboarding) |
| 2. Merge Runs→Synthetic | Delete Runs tab, merge into Synthetic | P1 | Medium | High (UX clarity) |
| 3.1 Batch filter in Threads | Add dropdown filter | P1 | Low | High (usability) |
| 3.2 Rename Sessions→Threads | Global rename | P1 | Low | Medium (clarity) |
| 4.1 Agent stats snapshot | New endpoint + UI | P2 | Medium | Medium (visibility) |
| 4.2 Agent dropdown | UI refactor | P2 | Low | Low (space efficiency) |
| 5. Saturation UX | Chart + recommendations | P2 | Medium | Medium (actionability) |

---

## Appendix A: Tab Structure Before vs After

### Before
```
[Agents] [Data] [Runs] [Sessions] [Taxonomy] [Settings]
```

### After
```
[Agents] [Synthetic] [Threads] [Taxonomy] [Settings]
```

Changes:
- **Removed**: Runs (merged into Synthetic)
- **Renamed**: Data → Synthetic, Sessions → Threads

---

## Appendix B: Files Changed Summary

### Files to Create
- `frontend/src/app/components/LandingPage.tsx`
- `frontend/src/app/components/AgentStatusSnapshot.tsx`
- `frontend/src/app/components/SaturationChart.tsx`

### Files to Delete
- `frontend/src/app/components/tabs/RunsTab.tsx`

### Files with Major Changes
- `frontend/src/app/components/tabs/SyntheticTab.tsx` (merge Runs)
- `frontend/src/app/components/tabs/SessionsTab.tsx` (rename + batch filter)
- `frontend/src/app/components/tabs/AgentsTab.tsx` (stats + dropdown)
- `frontend/src/app/page.tsx` (landing page + tab changes)

### Files with Minor Changes
- `frontend/src/app/types/index.ts`
- `frontend/src/app/context/AppContext.tsx`
- `frontend/src/app/lib/api.ts`
- `frontend/src/app/components/tabs/index.ts`
- `backend/routers/agents.py` (stats endpoint)
- `backend/database.py` (saturation history table)

