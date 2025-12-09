# Taxonomy Tab - Improvement Plan

## Executive Summary

The Taxonomy tab is meant to be the heart of error analysis—the place where raw observations become actionable insights. Currently, it's disconnected from the core workflow and missing critical features that would make it genuinely useful.

This document outlines improvements needed to transform the Taxonomy tab from a glorified note bucket into a proper error analysis workbench.

---

## Part 1: What Error Analysis Actually Requires

Before diving into fixes, let's ground ourselves in what effective error analysis looks like:

### The Error Analysis Process

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      THE ERROR ANALYSIS WORKFLOW                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   1. CREATE DATASET                                                          │
│      └── Gather representative traces (organic or synthetic)                 │
│                                                                              │
│   2. OPEN CODING (Journaling)                                               │
│      └── Human reviews traces, writes open-ended notes                       │
│      └── Focus on FIRST failure in each trace                               │
│      └── Domain expert performs this step                                    │
│                                                                              │
│   3. AXIAL CODING (Categorization)                                          │
│      └── Group similar notes into failure categories                         │
│      └── LLM can assist but human validates                                  │
│      └── Count failures per category                                         │
│                                                                              │
│   4. ITERATE UNTIL SATURATED                                                 │
│      └── Keep reviewing until no new failure modes emerge                    │
│      └── Aim for ~100 traces minimum                                         │
│      └── Revisit frequently as agent evolves                                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Insights from the Mental Model

1. **"Bottom-up" beats "top-down"**: Start with actual observations, let categories emerge naturally. Don't force generic metrics like "hallucination" or "toxicity."

2. **Focus on the FIRST failure**: Upstream errors cause downstream issues. When reviewing, identify the root cause.

3. **Saturation is the goal**: Keep going until new traces stop revealing new failure patterns. This is your signal that you've mapped the failure space.

4. **Three issues = 60% of problems**: The Pareto principle applies. Find and fix the top 3-5 failure modes for maximum impact.

5. **Iteration is essential**: As you fix the agent, re-run error analysis. Track what's resolved vs. what persists.

---

## Part 2: Current State Analysis

### What Works

- [x] Failure mode CRUD (create, read, update, delete)
- [x] Note syncing from Weave feedback
- [x] AI-powered categorization suggestions
- [x] Saturation tracking metric
- [x] AI Review (FAILS) integration for batch analysis
- [x] Copy taxonomy to clipboard

### What's Broken or Missing

#### 2.1 The Core Workflow is Disconnected

**Problem**: The Taxonomy tab operates in isolation.

- **Sessions → Taxonomy Gap**: When you add a note in the Sessions tab, it goes to `session_notes` table. These notes never appear in Taxonomy. The Taxonomy tab only pulls from Weave feedback (`notes` table).

- **AI Review → Taxonomy Gap**: The FAILS pipeline discovers failure categories, but they live in `auto_reviews` table. There's no way to import these as manual taxonomy entries.

- **Synthetic → Review Gap**: After running synthetic batches, there's no streamlined path to review results in Taxonomy context.

```
Current (Broken):
Sessions Notes ─┐
                ├─→ Two separate databases, no connection
Weave Feedback ─┘

AI Review Categories ───→ Displayed but not actionable
Manual Taxonomy      ───→ Separate system entirely

What it should be:
Sessions Notes ────┐
                   ├─→ Unified Notes Pool ───→ Failure Taxonomy
Weave Feedback ────┘                              ↑
                                                  │
AI Review Categories ─────────────────────────────┘
                     (can import as starting point)
```

#### 2.2 Open Coding (Journaling) is Unsupported

**Problem**: There's no proper interface for the "open coding" phase.

- Notes appear as text snippets without trace context
- Can't see the actual conversation that triggered the note
- No way to review a trace and add notes inline from Taxonomy
- No "review queue" to work through systematically

**What's needed**: A "Review Mode" where you see a trace, add notes, and move to the next trace—all within the Taxonomy context.

#### 2.3 Axial Coding (Categorization) is Clunky

**Problem**: Categorizing notes is tedious and one-at-a-time.

Current flow:
1. Click an uncategorized note
2. Read the note text (no trace context)
3. Click "Get AI Suggestion"
4. Wait for API call
5. Click "Apply Suggestion" or manually select
6. Repeat 100+ times

**What's needed**:
- Batch categorization with review (categorize all, then human validates)
- Drag-and-drop notes to categories
- Side-by-side trace view while categorizing
- Keyboard shortcuts for fast triage

#### 2.4 Failure Mode Management is Limited

**Problem**: Once created, failure modes are hard to refine.

- Can't edit failure mode name/description from list view
- Merge endpoint exists (`/api/taxonomy/failure-modes/merge`) but no UI
- No split functionality (break one mode into two)
- No way to see which notes belong to which mode at a glance
- "Suggest Improvements" endpoint exists but not exposed in UI

#### 2.5 AI Review Results are Orphaned

**Problem**: The FAILS integration produces great insights, but they're trapped.

- AI Review categories are displayed but can't be acted on
- No way to "import" AI categories as failure modes
- No way to assign notes to AI-discovered categories
- No comparison between AI-found categories and manual taxonomy

#### 2.6 Saturation Tracking is Decorative

**Problem**: Saturation score exists but doesn't drive behavior.

- No visualization of discovery over time (burndown chart)
- No recommendation for how many more traces to review
- No connection to sampling strategy
- Status just says "discovering" / "approaching" / "saturated" without guidance

#### 2.7 Missing Iteration Support

**Problem**: Can't track improvement across agent versions/batches.

- No version-to-version comparison
- No way to mark a failure mode as "resolved" vs "active"
- No trend tracking (is this failure mode getting better or worse?)
- No targeted query generation for known failure modes

---

## Part 3: Proposed Improvements

### 3.1 Unify the Note Pipeline

**Priority: P0 (Blocker)**

All notes should flow into a single taxonomy pipeline:

```python
# Backend Changes

# Option A: Migrate session_notes to notes table
# When a note is created in Sessions, also insert into notes table

# Option B: Create a unified view
# Query that unions session_notes and notes tables

# Recommended: Option A with sync
# When session note is created:
# 1. Insert into session_notes (for session UI)
# 2. Insert into notes (for taxonomy) with session_id reference
```

**Frontend Changes**:
- Notes in Taxonomy should link back to their source session
- "View Trace" button on each note that opens the session
- When clicking a note, show the conversation context inline

**Database Schema Addition**:
```sql
-- Add session reference to notes table
ALTER TABLE notes ADD COLUMN session_id TEXT REFERENCES sessions(id);

-- Or use a more explicit link
CREATE TABLE note_sources (
    note_id TEXT PRIMARY KEY REFERENCES notes(id),
    source_type TEXT NOT NULL,  -- 'session', 'weave_feedback', 'ai_review'
    session_id TEXT REFERENCES sessions(id),
    weave_feedback_id TEXT,
    auto_review_id TEXT REFERENCES auto_reviews(id)
);
```

### 3.2 Add Review Mode

**Priority: P0 (Blocker)**

Create a dedicated "Review Mode" for open coding:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         REVIEW MODE                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────┐  ┌─────────────────────────────────────────┐  │
│  │  Review Queue             │  │  Current Trace                         │  │
│  │                           │  │                                         │  │
│  │  ▶ 1/47 unreviewed       │  │  User: How do I get a refund?           │  │
│  │                           │  │                                         │  │
│  │  [◀ Prev] [Next ▶]       │  │  Agent: I can help with that...         │  │
│  │  [Skip] [Mark Reviewed]   │  │  [Tool: check_subscription_status]      │  │
│  │                           │  │                                         │  │
│  │  ─────────────────────── │  │  Agent: Your subscription...             │  │
│  │                           │  │                                         │  │
│  │  Filters:                 │  │  ─────────────────────────────────────  │  │
│  │  ☑ Has errors            │  │                                         │  │
│  │  ☐ From batch only       │  │  [ Add Note ]                           │  │
│  │  ☐ Random sample         │  │                                         │  │
│  │                           │  │  ┌─────────────────────────────────┐    │  │
│  │  Progress:                │  │  │ The agent didn't verify the     │    │  │
│  │  ▓▓▓▓▓▓░░░░░░ 23/47      │  │  │ user's identity before giving   │    │  │
│  │                           │  │  │ account information...           │    │  │
│  │                           │  │  └─────────────────────────────────┘    │  │
│  │                           │  │                                         │  │
│  │                           │  │  [ Save & Next → ]                      │  │
│  └──────────────────────────┘  └─────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Features**:
- Queue of unreviewed sessions (filterable by batch, errors, random sample)
- Full conversation view with tool calls expanded
- Inline note-taking with keyboard shortcuts (Cmd+Enter to save & next)
- Progress tracking
- Ability to mark as "no issues found" (still counts as reviewed)

### 3.3 Improve Categorization UX

**Priority: P1 (High)**

#### 3.3.1 Batch Categorization Flow

Instead of one-at-a-time:

1. **Pre-categorize all uncategorized notes with AI**
   - Run AI suggestion on all notes in batch
   - Store suggested categories without applying
   
2. **Human reviews suggestions in grid view**
   - Show all notes with their AI-suggested category
   - Human confirms, changes, or flags for manual review
   - Keyboard shortcuts: Enter = confirm, Tab = next, Esc = skip

3. **Apply confirmed categorizations**
   - Bulk update in single transaction

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    BATCH CATEGORIZATION REVIEW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  AI has suggested categories for 23 notes. Review and confirm:               │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Note                              │ Suggested          │ Confidence  │  │
│  ├───────────────────────────────────┼───────────────────┼─────────────┤  │
│  │ Agent gave wrong refund policy... │ Policy Hallucin... │ 89%   [✓]  │  │
│  │ Didn't check user identity...     │ Security Bypass    │ 76%   [✓]  │  │
│  │ Tool call failed silently...      │ NEW: Silent Err... │ 92%   [✓]  │  │
│  │ Response was too long and...      │ Verbosity Issue    │ 45%   [?]  │  │
│  └───────────────────────────────────┴───────────────────┴─────────────┘  │
│                                                                              │
│  [?] = Low confidence, needs manual review                                   │
│                                                                              │
│  [ Apply 20 Confirmed ] [ Review 3 Uncertain ] [ Cancel ]                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 3.3.2 Drag-and-Drop Categories

Allow dragging notes between the "Uncategorized" panel and failure mode cards.

#### 3.3.3 Context Panel

When a note is selected, show the trace context in a side panel:

```
┌────────────────────────────────────────────────────────────┐
│ Note Context                                         [×]   │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ Note: "Agent gave wrong refund policy for annual plan"     │
│                                                            │
│ ─────────────────────────────────────────────────────────  │
│                                                            │
│ Trace ID: 7c8f2a4b...                                     │
│ Session: Batch 12/3/2025, Query #14                       │
│                                                            │
│ ─────────────────────────────────────────────────────────  │
│                                                            │
│ User: I want a refund for my annual subscription           │
│                                                            │
│ Agent: Of course! Our refund policy allows refunds         │
│ within 14 days of purchase for any reason.                 │
│                                                            │
│ ⚠️ ISSUE: Annual plans have 60-day prorated refund,       │
│    not 14-day full refund                                  │
│                                                            │
│ ─────────────────────────────────────────────────────────  │
│                                                            │
│ [ View Full Session ] [ Add Another Note ]                 │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 3.4 AI Review Integration

**Priority: P1 (High)**

Bridge the gap between FAILS-discovered categories and manual taxonomy:

#### 3.4.1 Import AI Categories as Failure Modes

After running AI Review, show an "Import to Taxonomy" action:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    IMPORT AI CATEGORIES                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  AI Review found 5 failure categories. Import as failure modes?              │
│                                                                              │
│  ☑ Policy Hallucination (12 traces)                                         │
│     → Matches existing: "Incorrect Information" (merge?)                     │
│                                                                              │
│  ☑ Security Bypass (8 traces)                                               │
│     → NEW - will create new failure mode                                     │
│                                                                              │
│  ☐ Verbosity Issue (3 traces)                                               │
│     → Skip (too minor)                                                       │
│                                                                              │
│  ☑ Tool Call Failures (5 traces)                                            │
│     → NEW - will create new failure mode                                     │
│                                                                              │
│  ☑ Tone Issues (2 traces)                                                   │
│     → Matches existing: "Tone & Professionalism"                             │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  [ Import 4 Selected ] [ Cancel ]                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Backend Changes**:
```python
# POST /api/taxonomy/import-from-review
@router.post("/import-from-review")
async def import_from_review(request: ImportFromReviewRequest):
    """
    Import failure categories from an AI Review into the manual taxonomy.
    
    Options:
    - Create new failure mode from AI category
    - Merge AI category into existing failure mode
    - Create notes from AI classifications
    """
    pass
```

#### 3.4.2 Compare AI vs Manual Taxonomy

Show alignment between AI-discovered categories and manual taxonomy:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TAXONOMY COMPARISON                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  AI Categories (Latest Review)    │  Manual Taxonomy                        │
│  ─────────────────────────────────│─────────────────────────────────────────│
│  Policy Hallucination (35%)       │  Incorrect Information (28%)     ≈     │
│  Security Bypass (20%)            │  [No match]                      ✗     │
│  Tool Call Failures (15%)         │  Tool Errors (12%)               ≈     │
│  Verbosity Issue (10%)            │  [No match]                      ✗     │
│  [Not in AI review]               │  Tone Issues (8%)                +     │
│                                                                              │
│  Legend: ≈ Similar  ✗ Gap  + Only in Manual                                │
│                                                                              │
│  Insight: AI found "Security Bypass" which isn't in your manual taxonomy.   │
│  Consider adding it.                                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.5 Failure Mode Management Improvements

**Priority: P2 (Medium)**

#### 3.5.1 Inline Editing

Click to edit failure mode name, description, severity without opening a modal.

#### 3.5.2 Merge UI

Expose the merge functionality:

```
┌───────────────────────────────────────────┐
│  Merge Failure Modes                      │
├───────────────────────────────────────────┤
│                                           │
│  Merge: "Incorrect Pricing Info"          │
│  Into:  "Policy Hallucination"            │
│                                           │
│  New Name: [Policy Hallucination      ]   │
│  New Desc: [Agent provides incorrect   ]  │
│            [policy or pricing inform...]  │
│                                           │
│  8 notes will be moved to merged mode.    │
│                                           │
│  [ Merge ] [ Cancel ]                     │
│                                           │
└───────────────────────────────────────────┘
```

#### 3.5.3 Split UI

Allow splitting a failure mode that's too broad:

```
┌───────────────────────────────────────────────────────────────────┐
│  Split Failure Mode: "Agent Errors"                               │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  This mode has 45 notes. Split into more specific categories:     │
│                                                                   │
│  New Mode 1: [Tool Call Failures        ]                        │
│  Notes:      ☑ Tool call returned error...                       │
│              ☑ Agent didn't retry failed...                      │
│              ☑ ...                                                │
│                                                                   │
│  New Mode 2: [Logic Errors              ]                        │
│  Notes:      ☑ Agent contradicted itself...                      │
│              ☑ Response was inconsistent...                      │
│              ☑ ...                                                │
│                                                                   │
│  Keep in original (15 notes):                                     │
│              ☑ Generic error handling...                          │
│                                                                   │
│  [ Split ] [ Cancel ]                                             │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

#### 3.5.4 Failure Mode Status

Add status to track lifecycle:

```python
class FailureModeStatus(str, Enum):
    ACTIVE = "active"           # Currently occurring
    INVESTIGATING = "investigating"  # Being worked on
    RESOLVED = "resolved"       # Fixed in latest version
    WONT_FIX = "wont_fix"      # Accepted limitation
```

### 3.6 Actionable Saturation Tracking

**Priority: P2 (Medium)**

#### 3.6.1 Discovery Chart

Show failure mode discovery over time:

```
                    Failure Mode Discovery
     │                                    ────── Saturated
   8 │                          ●───●───●───●
     │                     ●────┘
   6 │                ●────┘
     │           ●────┘
   4 │      ●────┘
     │ ●────┘
   2 │                                         
     │                                         
   0 └─────────────────────────────────────────
     0    20    40    60    80   100   120
                 Traces Reviewed

   Current: 85 traces reviewed, 8 failure modes found
   Recommendation: Review ~15 more traces to confirm saturation
```

#### 3.6.2 Sampling Recommendations

Based on saturation status, recommend what to review next:

- **Discovering**: "Focus on reviewing more traces. Prioritize errors."
- **Approaching**: "Sample from underrepresented dimension combinations."
- **Saturated**: "Taxonomy is stable. Focus on fixing top failure modes."

### 3.7 Iteration Support

**Priority: P3 (Future)**

#### 3.7.1 Version Tracking

Track which failure modes existed in which agent version:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FAILURE MODE HISTORY                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  "Policy Hallucination"                                                      │
│                                                                              │
│  v1.0.0  ████████████████████████████████████  35%                          │
│  v1.1.0  █████████████████░░░░░░░░░░░░░░░░░░░  18%  ↓ Improved              │
│  v1.2.0  ██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   8%  ↓ Improved              │
│  v1.3.0  ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   3%  ↓ Nearly resolved       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 3.7.2 Targeted Query Generation

Generate synthetic queries specifically targeting known failure modes:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    REGRESSION TESTING                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Generate queries targeting: "Policy Hallucination"                          │
│                                                                              │
│  Queries will focus on:                                                      │
│  • Refund policy edge cases                                                  │
│  • Pricing for annual vs monthly                                             │
│  • Business tier policy questions                                            │
│                                                                              │
│  Count: [ 20 ]                                                               │
│                                                                              │
│  [ Generate Targeted Batch ]                                                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 4: Implementation Roadmap

### Phase 1: Foundation (P0 - Must Have)

1. **Unify Note Sources** (Backend)
   - Add `session_id` column to `notes` table
   - When creating session note, also create taxonomy note
   - Add "View Trace" action to taxonomy notes

2. **Note Context Panel** (Frontend)
   - When note is selected, fetch and show trace context
   - Link to full session view

3. **Review Mode** (Frontend + Backend)
   - New route/tab within Taxonomy: "Review Mode"
   - Queue of unreviewed sessions
   - Inline note-taking with keyboard shortcuts
   - Progress tracking

### Phase 2: Categorization UX (P1 - High Priority)

1. **Batch Categorization Flow**
   - `POST /api/taxonomy/batch-suggest` - AI suggest for all uncategorized
   - Review UI with grid of suggestions
   - Bulk apply confirmed suggestions

2. **Context Panel in Categorization**
   - Side panel showing trace when categorizing
   - No more blind categorization

3. **AI Review Import**
   - `POST /api/taxonomy/import-from-review` endpoint
   - UI to map AI categories to existing modes or create new

### Phase 3: Taxonomy Management (P2 - Medium Priority)

1. **Inline Editing**
   - Click-to-edit on failure mode cards

2. **Merge UI**
   - Modal to merge two failure modes
   - Preview of note reassignment

3. **Failure Mode Status**
   - Add status field to failure_modes table
   - Filter by status in UI

4. **Taxonomy Comparison**
   - Side-by-side AI vs Manual taxonomy view
   - Gap analysis

### Phase 4: Iteration Support (P3 - Future)

1. **Version Tracking**
   - Link failure modes to agent versions
   - Historical trend charts

2. **Targeted Query Generation**
   - Generate queries from failure mode definitions
   - Regression testing workflow

---

## Part 5: Technical Specifications

### 5.1 New Database Tables

```sql
-- Link notes to their sources
ALTER TABLE notes ADD COLUMN session_id TEXT REFERENCES sessions(id);
ALTER TABLE notes ADD COLUMN source_type TEXT DEFAULT 'weave_feedback';
-- source_type: 'weave_feedback', 'session_note', 'ai_review'

-- Failure mode status tracking
ALTER TABLE failure_modes ADD COLUMN status TEXT DEFAULT 'active';
-- status: 'active', 'investigating', 'resolved', 'wont_fix'

ALTER TABLE failure_modes ADD COLUMN agent_version TEXT;
-- Track which version this was first/last seen in
```

### 5.2 New API Endpoints

```python
# Review Mode
GET  /api/taxonomy/review-queue
     # Get sessions needing review (filterable)
     # Query params: batch_id, has_error, sample_size, random

POST /api/taxonomy/review-session/{session_id}/note
     # Add note to session AND taxonomy in one call

# Batch Categorization
POST /api/taxonomy/batch-suggest
     # Get AI suggestions for all uncategorized notes
     # Returns: [{note_id, suggestion, confidence}]

POST /api/taxonomy/batch-apply
     # Apply multiple categorizations at once
     # Body: [{note_id, failure_mode_id}]

# AI Review Import
POST /api/taxonomy/import-from-review
     # Import AI Review categories into taxonomy
     # Body: {review_id, categories: [{ai_category, action, target_mode_id}]}
     # action: 'create_new', 'merge_into', 'skip'

# Comparison
GET  /api/taxonomy/compare-with-review/{review_id}
     # Compare manual taxonomy with AI Review results

# Failure Mode Management
PUT  /api/taxonomy/failure-modes/{mode_id}/status
     # Update status (active, investigating, resolved, wont_fix)

POST /api/taxonomy/failure-modes/{mode_id}/split
     # Split a failure mode into multiple
     # Body: {new_modes: [{name, description, note_ids}]}
```

### 5.3 Frontend Components to Create

```typescript
// New components needed:

// Review Mode
ReviewModePanel.tsx        // Main review mode UI
ReviewQueue.tsx            // Queue of sessions to review  
TraceViewer.tsx           // Full conversation view
InlineNoteEditor.tsx      // Quick note input with shortcuts

// Batch Categorization
BatchCategorizationModal.tsx  // Grid of suggestions to review
CategorySuggestionRow.tsx     // Single suggestion row

// Note Context
NoteContextPanel.tsx         // Side panel showing trace context
TracePreview.tsx             // Compact trace preview

// AI Review Integration
ImportFromReviewModal.tsx    // Import AI categories UI
TaxonomyComparisonPanel.tsx  // Side-by-side comparison

// Failure Mode Management
FailureModeEditor.tsx        // Inline editing
MergeModesModal.tsx          // Merge UI
SplitModeModal.tsx           // Split UI
StatusBadge.tsx              // Status indicator
```

---

## Part 6: Success Metrics

After implementing these improvements, we should see:

1. **Time to categorize 100 notes**: < 30 minutes (vs. hours currently)
2. **Notes with trace context viewed**: > 80% (vs. 0% currently)
3. **AI suggestions accepted**: > 70% (measure AI quality)
4. **Failure modes discovered per 100 traces**: Track saturation curve
5. **Taxonomy-to-code action time**: < 1 day (from insight to fix)

---

## Summary: What to Build First

If you can only do one thing, **build Review Mode**. Without it, the error analysis workflow is fundamentally broken—you can't do proper open coding without seeing the traces you're reviewing.

**Priority Order**:
1. Review Mode (P0) - Enables proper open coding
2. Note Context Panel (P0) - Makes categorization informed
3. Batch Categorization (P1) - 10x faster categorization
4. AI Review Import (P1) - Leverage FAILS insights
5. Everything else (P2/P3) - Nice to have

The goal is to transform Taxonomy from "a place where notes go to die" into "the command center for understanding your agent's failures."

