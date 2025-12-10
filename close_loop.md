# Closing the Loop: Taxonomy-Driven Synthetic Data Generation

## Executive Summary

This document outlines the plan to "close the loop" on the error analysis workflow by using **discovered failure modes** to **drive synthetic data generation**. This creates a virtuous cycle:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          THE CLOSED LOOP                                    │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────────┐                                                      │
│   │  Failure Modes   │◄────────────────────────────────────┐               │
│   │   (Taxonomy)     │                                      │               │
│   └────────┬─────────┘                                      │               │
│            │                                                │               │
│            │ INFORM                                         │ DISCOVER      │
│            ▼                                                │               │
│   ┌──────────────────┐      ┌──────────────────┐           │               │
│   │ Targeted Query   │─────►│   Agent Under    │           │               │
│   │   Generation     │      │     Test         │           │               │
│   └──────────────────┘      └────────┬─────────┘           │               │
│                                      │                      │               │
│                                      │ EXECUTE              │               │
│                                      ▼                      │               │
│                             ┌──────────────────┐           │               │
│                             │     Traces       │───────────┘               │
│                             │  (in Weave)      │                            │
│                             └──────────────────┘                            │
│                                      │                                      │
│                                      │ REVIEW                               │
│                                      ▼                                      │
│                             ┌──────────────────┐                            │
│                             │ Manual / Auto    │                            │
│                             │    Review        │                            │
│                             └──────────────────┘                            │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

**Key Insight**: Once you've discovered failure modes through initial synthetic testing, you can use those failure modes to generate *targeted* queries that:

1. **Validate fixes**: Test whether a fixed agent still fails in the same way
2. **Find edge cases**: Generate variations that might trigger similar failures
3. **Stress test**: Create adversarial versions of known failure patterns
4. **Measure regression**: Track failure rate changes across agent versions

---

## Part 1: Current State Analysis

### What Exists Today

1. **Dimension-Based Generation** (`services/synthetic.py`)
   - Generates queries from predefined dimensions (persona, scenario, complexity)
   - Supports cross-product and LLM-guided strategies
   - Has `focus_areas` parameter (unused for taxonomy)

2. **Failure Mode Taxonomy** (`services/taxonomy.py`)
   - Failure modes with name, description, severity, suggested_fix
   - Status tracking: active, investigating, resolved, wont_fix
   - Saturation tracking for discovery progress

3. **Auto Review** (`services/auto_reviewer.py`)
   - FAILS pipeline integration for batch review
   - Produces `FailureCategory` objects with definitions and trace examples
   - Stored in `auto_reviews` table

4. **Phase 6 Placeholder** (from `PLAN.md`)
   ```python
   def generate_targeted_queries(self, failure_modes: List[FailureMode]) -> List[str]:
       """Generate queries specifically targeting known failure modes."""
       # Use LLM to create queries that would trigger these failures
       pass
   ```

### What's Missing

1. **No connection between taxonomy and synthetic generation**
   - Failure modes live in `failure_modes` table
   - Synthetic generation only uses AGENT_INFO dimensions
   - No way to say "generate queries that target these failure modes"

2. **No failure-specific prompting**
   - Query generation prompts don't reference known failures
   - Can't ask LLM to "create a query that would trigger Policy Hallucination"

3. **No regression testing workflow**
   - After fixing a failure mode, no way to re-test it specifically
   - "Resolved" status is manually set, not validated

4. **No comparison between targeted and exploratory batches**
   - Can't distinguish "hunting for new failures" from "validating fixes"

---

## Part 2: Proposed Solution

### 2.1 Taxonomy-Informed Generation Mode

Add a new generation mode that uses failure modes as the primary dimensions:

```python
# services/synthetic.py

class GenerationMode(Enum):
    EXPLORATORY = "exploratory"      # Use AGENT_INFO dimensions (existing)
    TARGETED = "targeted"            # Use failure modes as dimensions
    MIXED = "mixed"                  # Both exploratory and targeted

class TargetedQueryGenerator:
    """
    Generates synthetic queries targeting known failure modes.
    
    The generation process:
    1. Load failure modes from taxonomy
    2. For each failure mode, generate queries designed to trigger it
    3. Optionally include variations (edge cases, adversarial)
    """
    
    def __init__(
        self,
        agent_info: AgentInfo,
        failure_modes: List[FailureMode],
        llm_client=None
    ):
        self.agent_info = agent_info
        self.failure_modes = failure_modes
        self.llm_client = llm_client
    
    async def generate_targeted_queries(
        self,
        mode: FailureMode,
        count: int = 5,
        variation_types: List[str] = ["standard", "edge_case", "adversarial"]
    ) -> List[SyntheticQuery]:
        """
        Generate queries designed to trigger a specific failure mode.
        
        Args:
            mode: The failure mode to target
            count: Number of queries per variation type
            variation_types: Types of variations to generate
                - standard: Direct reproduction of the failure pattern
                - edge_case: Boundary conditions that might trigger similar failures
                - adversarial: Attempts to bypass fixes
        
        Returns:
            List of SyntheticQuery objects with failure_mode_id tagged
        """
        prompt = self._build_targeted_prompt(mode, variation_types)
        # ... LLM call to generate queries
        pass
    
    def _build_targeted_prompt(
        self,
        mode: FailureMode,
        variation_types: List[str]
    ) -> str:
        """Build LLM prompt for targeted query generation."""
        # Include agent context
        agent_context = f"""
Agent: {self.agent_info.name}
Purpose: {self.agent_info.purpose}
Capabilities: {', '.join(self.agent_info.capabilities[:5])}
"""
        
        # Include failure mode details
        failure_context = f"""
Target Failure Mode: {mode.name}
Description: {mode.description}
Severity: {mode.severity}
Suggested Fix: {mode.suggested_fix or 'None provided'}
Times Seen: {mode.times_seen}
"""
        
        # Include example notes if available
        example_notes = self._get_example_notes(mode.id)
        note_context = ""
        if example_notes:
            note_context = "\nExample observations that triggered this failure:\n"
            for note in example_notes[:3]:
                note_context += f"- {note[:200]}...\n"
        
        return f"""You are generating test queries to validate whether an AI agent fails in a specific way.

{agent_context}

{failure_context}
{note_context}

Generate {len(variation_types)} groups of queries that would likely trigger this failure mode:

1. **Standard**: Queries that directly reproduce the conditions described in the failure
2. **Edge Case**: Boundary conditions or unusual scenarios related to this failure
3. **Adversarial**: Queries that attempt to bypass potential fixes for this failure

For each query, think about:
- What user intent would expose this failure?
- What context or prior conversation would make this harder?
- What phrasing might slip past basic guards?

Return as JSON array with structure:
[
    {{
        "variation_type": "standard|edge_case|adversarial",
        "query_text": "The user's message",
        "expected_failure": "How the agent might fail",
        "rationale": "Why this query targets the failure mode"
    }}
]"""
```

### 2.2 Database Schema Additions

```sql
-- Add failure mode targeting to synthetic queries
ALTER TABLE synthetic_queries ADD COLUMN target_failure_mode_id TEXT;
ALTER TABLE synthetic_queries ADD COLUMN variation_type TEXT;  -- standard, edge_case, adversarial
ALTER TABLE synthetic_queries ADD COLUMN expected_failure TEXT;

-- Index for failure mode targeting
CREATE INDEX idx_synthetic_queries_failure_mode 
ON synthetic_queries(target_failure_mode_id);

-- Add generation mode to batches
ALTER TABLE synthetic_batches ADD COLUMN generation_mode TEXT DEFAULT 'exploratory';
-- 'exploratory' (dimension-based), 'targeted' (failure-based), 'mixed'

-- Track which failure modes a batch targets
CREATE TABLE batch_failure_targets (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    failure_mode_id TEXT NOT NULL,
    queries_generated INTEGER DEFAULT 0,
    queries_failed INTEGER DEFAULT 0,  -- How many actually reproduced the failure
    created_at TEXT NOT NULL,
    FOREIGN KEY (batch_id) REFERENCES synthetic_batches(id) ON DELETE CASCADE,
    FOREIGN KEY (failure_mode_id) REFERENCES failure_modes(id) ON DELETE CASCADE
);

-- Index for batch-to-failure lookup
CREATE INDEX idx_batch_failure_targets_batch ON batch_failure_targets(batch_id);
CREATE INDEX idx_batch_failure_targets_mode ON batch_failure_targets(failure_mode_id);
```

### 2.3 API Endpoints

```python
# routers/synthetic.py

class GenerateTargetedBatchRequest(BaseModel):
    agent_id: str
    failure_mode_ids: List[str]  # Which failure modes to target
    queries_per_mode: int = 5
    variation_types: List[str] = ["standard", "edge_case", "adversarial"]
    name: Optional[str] = None

@router.post("/api/synthetic/batches/targeted")
async def generate_targeted_batch(request: GenerateTargetedBatchRequest):
    """
    Generate a batch of queries targeting specific failure modes.
    
    This is used to:
    1. Validate that fixes actually work
    2. Find edge cases around known failures
    3. Stress test the agent with adversarial variations
    """
    # Get agent info
    agent = await get_agent(request.agent_id)
    agent_info = parse_agent_info(agent.agent_info_raw)
    
    # Get targeted failure modes
    failure_modes = []
    for mode_id in request.failure_mode_ids:
        mode = taxonomy_service.get_failure_mode(mode_id)
        if mode:
            failure_modes.append(mode)
    
    if not failure_modes:
        raise HTTPException(400, "No valid failure modes found")
    
    # Generate targeted queries
    generator = TargetedQueryGenerator(agent_info, failure_modes)
    
    all_queries = []
    batch_failure_targets = []
    
    for mode in failure_modes:
        queries = await generator.generate_targeted_queries(
            mode=mode,
            count=request.queries_per_mode,
            variation_types=request.variation_types
        )
        all_queries.extend(queries)
        batch_failure_targets.append({
            "failure_mode_id": mode.id,
            "queries_generated": len(queries)
        })
    
    # Create batch with generation_mode='targeted'
    batch = create_batch(
        agent_id=request.agent_id,
        queries=all_queries,
        generation_mode="targeted",
        failure_targets=batch_failure_targets,
        name=request.name or f"Targeted: {', '.join(m.name for m in failure_modes[:3])}"
    )
    
    return batch


@router.get("/api/taxonomy/failure-modes/{mode_id}/targeted-batches")
async def get_targeted_batches_for_mode(mode_id: str):
    """
    Get all synthetic batches that targeted a specific failure mode.
    
    Returns batch history with reproduction rates (did the failure occur?).
    """
    # Query batch_failure_targets for this mode
    pass


@router.post("/api/synthetic/batches/{batch_id}/analyze-reproductions")
async def analyze_failure_reproductions(batch_id: str):
    """
    Analyze a targeted batch to see which failures were reproduced.
    
    Uses AI to classify each response as:
    - reproduced: Same failure pattern occurred
    - mitigated: Failure didn't occur (fix worked)
    - different_failure: A different failure occurred
    - success: No failure detected
    """
    pass
```

### 2.4 Frontend UI Changes

#### A. Taxonomy Tab: "Generate Targeted Queries" Button

Add a button on each failure mode card to generate targeted queries:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  FAILURE MODES                                                 [+ Add New]  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 🔴 Policy Hallucination                              35% of failures  │   │
│  │                                                                       │   │
│  │ Agent invents refund/pricing policies not in TASKFLOW_INFO           │   │
│  │                                                                       │   │
│  │ Status: Active   Severity: High   Seen: 12 times                     │   │
│  │                                                                       │   │
│  │ [⚡ Generate Targeted Queries] [📝 View Notes] [Edit] [Mark Resolved]│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 🟡 Missing Identity Check                           20% of failures  │   │
│  │                                                                       │   │
│  │ Agent performs actions without verifying user email first            │   │
│  │                                                                       │   │
│  │ Status: Investigating   Severity: Medium   Seen: 7 times             │   │
│  │                                                                       │   │
│  │ [⚡ Generate Targeted Queries] [📝 View Notes] [Edit] [Mark Resolved]│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### B. Targeted Query Generation Modal

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Generate Targeted Queries                                             [×]  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Target: Policy Hallucination (High Severity)                               │
│                                                                              │
│  Generate queries designed to trigger this failure mode for testing.        │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  Queries per variation type:  [5 ▼]                                         │
│                                                                              │
│  Variation types:                                                            │
│  [✓] Standard    - Direct reproduction of failure pattern                   │
│  [✓] Edge Case   - Boundary conditions and unusual scenarios                │
│  [✓] Adversarial - Attempts to bypass fixes                                 │
│                                                                              │
│  Total queries to generate: 15                                               │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  Additional failure modes to include:                                        │
│  [ ] Missing Identity Check                                                  │
│  [ ] Tool Call Error Handling                                               │
│  [ ] Response Too Verbose                                                   │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│                            [Cancel]  [Generate & Run]  [Generate Only]      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### C. Batch Results: Reproduction Analysis

After running a targeted batch, show reproduction analysis:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Targeted Batch Results: Policy Hallucination                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    REPRODUCTION ANALYSIS                             │   │
│  │                                                                       │   │
│  │   Reproduced ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░ 40% (6/15)                       │   │
│  │   Mitigated  ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░ 53% (8/15)                       │   │
│  │   Different  ░░░░░░░░░░░░░░░░░░░░░  7% (1/15)                        │   │
│  │                                                                       │   │
│  │   ──────────────────────────────────────────────────────────────     │   │
│  │                                                                       │   │
│  │   By Variation Type:                                                  │   │
│  │   Standard:    2/5 reproduced (60% mitigated ✓)                      │   │
│  │   Edge Case:   3/5 reproduced (40% mitigated)                        │   │
│  │   Adversarial: 1/5 reproduced (80% mitigated ✓)                      │   │
│  │                                                                       │   │
│  │   💡 Insight: Edge cases still triggering the failure more often     │   │
│  │      than standard cases. Consider strengthening boundary handling.  │   │
│  │                                                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  Query Results:                                                              │
│                                                                              │
│  ┌───┬──────────────────────────────────────┬────────────┬──────────────┐  │
│  │ # │ Query                                 │ Variation  │ Result       │  │
│  ├───┼──────────────────────────────────────┼────────────┼──────────────┤  │
│  │ 1 │ "What's the refund policy for..."    │ Standard   │ ✓ Mitigated  │  │
│  │ 2 │ "I'm on annual, can I get money..."  │ Standard   │ 🔴 Reproduced│  │
│  │ 3 │ "If I upgrade mid-month..."          │ Edge Case  │ 🔴 Reproduced│  │
│  │ 4 │ "My friend said you have..."         │ Adversarial│ ✓ Mitigated  │  │
│  └───┴──────────────────────────────────────┴────────────┴──────────────┘  │
│                                                                              │
│  [View All Responses] [Export Results] [Run Again] [Mark Issues Resolved]   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### D. Synthetic Tab: Generation Mode Toggle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SYNTHETIC DATA GENERATION                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Mode: [◉ Exploratory] [○ Targeted] [○ Mixed]                               │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  [If Exploratory selected - current UI]                                      │
│  Agent: [TaskFlow Support Agent ▼]                                           │
│  Count: [20] queries   Strategy: [LLM-Guided ▼]                              │
│  Dimensions: [persona, scenario, complexity]                                 │
│                                                                              │
│  [If Targeted selected]                                                      │
│  Agent: [TaskFlow Support Agent ▼]                                           │
│  Select failure modes to target:                                             │
│  [✓] Policy Hallucination (35%, Active)                                     │
│  [✓] Missing Identity Check (20%, Investigating)                            │
│  [ ] Tool Call Error Handling (15%, Resolved)                               │
│  [ ] Response Too Verbose (10%, Active)                                     │
│                                                                              │
│  Queries per mode: [5]   Variations: [✓ Standard] [✓ Edge] [✓ Adversarial] │
│  Total: 30 queries targeting 2 failure modes                                │
│                                                                              │
│  [If Mixed selected]                                                         │
│  Exploratory: [10] queries + Targeted: [20] queries                         │
│  [Configure Exploratory...] [Configure Targeted...]                          │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│                                              [Generate Batch]                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 3: Reproduction Analysis with LLM

After running a targeted batch, use LLM to classify whether each response reproduced the target failure:

```python
# services/reproduction_analyzer.py

class ReproductionResult(Enum):
    REPRODUCED = "reproduced"        # Same failure pattern occurred
    MITIGATED = "mitigated"          # Failure didn't occur (fix worked)
    DIFFERENT_FAILURE = "different"  # A different failure occurred
    SUCCESS = "success"              # No failure detected (agent did well)

class ReproductionAnalyzer:
    """
    Analyzes targeted batch results to determine failure reproduction rates.
    """
    
    async def analyze_query_result(
        self,
        query: SyntheticQuery,
        failure_mode: FailureMode,
        agent_info: AgentInfo
    ) -> ReproductionResult:
        """
        Analyze a single query result to determine if the target failure was reproduced.
        """
        prompt = f"""You are analyzing whether an AI agent reproduced a specific failure mode.

Agent: {agent_info.name}
Purpose: {agent_info.purpose}

Target Failure Mode: {failure_mode.name}
Failure Description: {failure_mode.description}

User Query: {query.query_text}

Agent Response: {query.response_text}

Expected Failure (if reproduced): {query.expected_failure}

Classify the agent's response:
1. REPRODUCED - The response exhibits the exact failure pattern described
2. MITIGATED - The failure was avoided; the response is correct
3. DIFFERENT_FAILURE - A different type of failure occurred
4. SUCCESS - The response is correct and no failure occurred

Respond with JSON:
{{
    "result": "reproduced|mitigated|different_failure|success",
    "confidence": 0.0-1.0,
    "reasoning": "Brief explanation",
    "observed_issue": "If a failure occurred, describe it"
}}"""

        # LLM call to classify
        response = await llm_completion(prompt)
        return parse_result(response)
    
    async def analyze_batch(
        self,
        batch_id: str
    ) -> BatchReproductionAnalysis:
        """
        Analyze all queries in a targeted batch.
        
        Returns aggregated reproduction rates and insights.
        """
        batch = get_batch(batch_id)
        queries = get_batch_queries(batch_id)
        
        results = {
            "reproduced": [],
            "mitigated": [],
            "different_failure": [],
            "success": []
        }
        
        for query in queries:
            failure_mode = get_failure_mode(query.target_failure_mode_id)
            result = await self.analyze_query_result(query, failure_mode)
            results[result.value].append(query.id)
        
        return BatchReproductionAnalysis(
            batch_id=batch_id,
            total_queries=len(queries),
            reproduced_count=len(results["reproduced"]),
            mitigated_count=len(results["mitigated"]),
            different_failure_count=len(results["different_failure"]),
            success_count=len(results["success"]),
            reproduction_rate=len(results["reproduced"]) / len(queries),
            mitigation_rate=len(results["mitigated"]) / len(queries),
            insights=self._generate_insights(results, batch)
        )
    
    def _generate_insights(
        self,
        results: Dict[str, List[str]],
        batch: SyntheticBatch
    ) -> List[str]:
        """Generate actionable insights from reproduction analysis."""
        insights = []
        
        # Calculate rates by variation type
        variation_stats = self._calculate_variation_stats(results, batch)
        
        # Identify problematic variation types
        for var_type, stats in variation_stats.items():
            if stats["reproduction_rate"] > 0.5:
                insights.append(
                    f"{var_type.title()} variations still triggering failure {stats['reproduction_rate']*100:.0f}% of the time"
                )
            elif stats["reproduction_rate"] < 0.2:
                insights.append(
                    f"✓ {var_type.title()} variations well mitigated ({stats['mitigation_rate']*100:.0f}% success)"
                )
        
        # Overall recommendation
        overall_repro_rate = len(results["reproduced"]) / sum(len(v) for v in results.values())
        if overall_repro_rate < 0.2:
            insights.append("💡 Consider marking this failure mode as 'Resolved'")
        elif overall_repro_rate > 0.6:
            insights.append("⚠️ Fix not effective - failure still occurs frequently")
        
        return insights
```

---

## Part 4: Integration with Improvement Loop

### 4.1 Workflow Integration

The targeted generation completes Phase 6 of the PLAN.md improvement loop:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMPLETE IMPROVEMENT LOOP                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  PHASE 1: Initial Discovery                                                  │
│  ────────────────────────                                                    │
│  1. Register agent with AGENT_INFO                                           │
│  2. Generate exploratory batch (dimension-based)                             │
│  3. Run batch, collect traces                                                │
│  4. Review traces, add notes                                                 │
│  5. Build failure taxonomy                                                   │
│                                                                              │
│  PHASE 2: Fix & Validate (THE CLOSED LOOP)                                  │
│  ──────────────────────────────────────────                                  │
│  6. Developer fixes agent based on failure modes                             │
│  7. Generate TARGETED batch for fixed failure modes                          │
│  8. Run targeted batch against updated agent                                 │
│  9. Analyze reproduction rate                                                │
│      - If < 20%: Mark failure mode as "Resolved"                            │
│      - If > 50%: Fix needs more work                                        │
│  10. Repeat until reproduction rate is acceptable                            │
│                                                                              │
│  PHASE 3: Continuous Monitoring                                              │
│  ─────────────────────────────                                               │
│  11. Periodically run mixed batches (exploratory + targeted)                 │
│  12. Track regression (resolved failures coming back)                        │
│  13. Discover new failure modes as agent evolves                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Status Transitions Based on Reproduction Analysis

```python
# Automatic status suggestions based on reproduction analysis

def suggest_status_change(
    failure_mode: FailureMode,
    reproduction_analysis: BatchReproductionAnalysis
) -> Optional[str]:
    """
    Suggest a status change for a failure mode based on reproduction analysis.
    """
    repro_rate = reproduction_analysis.reproduction_rate
    
    if failure_mode.status == "active":
        if repro_rate < 0.1:
            return "resolved"  # Less than 10% reproduction → suggest resolved
        elif repro_rate < 0.3:
            return "investigating"  # Some improvement → investigating
    
    elif failure_mode.status == "investigating":
        if repro_rate < 0.1:
            return "resolved"
        elif repro_rate > 0.5:
            return "active"  # Regression → back to active
    
    elif failure_mode.status == "resolved":
        if repro_rate > 0.3:
            return "active"  # Regression detected!
    
    return None  # No change suggested
```

### 4.3 Failure Mode History Tracking

```sql
-- Track failure mode status changes and reproduction analysis over time
CREATE TABLE failure_mode_history (
    id TEXT PRIMARY KEY,
    failure_mode_id TEXT NOT NULL,
    batch_id TEXT,
    timestamp TEXT NOT NULL,
    status_before TEXT,
    status_after TEXT,
    reproduction_rate REAL,
    queries_tested INTEGER,
    notes TEXT,
    FOREIGN KEY (failure_mode_id) REFERENCES failure_modes(id) ON DELETE CASCADE,
    FOREIGN KEY (batch_id) REFERENCES synthetic_batches(id) ON DELETE SET NULL
);

-- Index for querying mode history
CREATE INDEX idx_failure_mode_history_mode ON failure_mode_history(failure_mode_id);
CREATE INDEX idx_failure_mode_history_time ON failure_mode_history(timestamp DESC);
```

---

## Part 5: Implementation Roadmap

### Phase A: Core Targeted Generation (3-4 days)

1. **Backend**
   - [ ] Add `TargetedQueryGenerator` class to `services/synthetic.py`
   - [ ] Add database schema changes (generation_mode, target columns)
   - [ ] Add `POST /api/synthetic/batches/targeted` endpoint
   - [ ] Add failure mode selection to batch creation

2. **Frontend**
   - [ ] Add "Generate Targeted Queries" button to failure mode cards
   - [ ] Add targeted generation modal
   - [ ] Add generation mode toggle to Synthetic tab

### Phase B: Reproduction Analysis (2-3 days)

1. **Backend**
   - [ ] Add `ReproductionAnalyzer` class
   - [ ] Add `POST /api/synthetic/batches/{id}/analyze-reproductions` endpoint
   - [ ] Store reproduction results in database

2. **Frontend**
   - [ ] Add reproduction analysis view to batch results
   - [ ] Show reproduction rates by variation type
   - [ ] Display insights and recommendations

### Phase C: Status Integration (1-2 days)

1. **Backend**
   - [ ] Add status suggestion based on reproduction analysis
   - [ ] Add failure mode history tracking
   - [ ] Add regression detection

2. **Frontend**
   - [ ] Show status change suggestions
   - [ ] Display failure mode history chart
   - [ ] Alert on regression detection

### Phase D: Mixed Mode & Continuous Monitoring (1-2 days)

1. **Backend**
   - [ ] Add mixed generation mode
   - [ ] Add periodic batch scheduling (optional)
   - [ ] Add cross-batch comparison for trends

2. **Frontend**
   - [ ] Add mixed mode configuration
   - [ ] Add trend visualization
   - [ ] Add "health check" dashboard for failure modes

**Total Estimated Time: 7-11 days**

---

## Part 6: Example Prompts

### 6.1 Targeted Query Generation Prompt

```
You are generating test queries to validate whether an AI agent has fixed a specific failure mode.

Agent: TaskFlow Support Agent
Purpose: Provide customer support for TaskFlow, a productivity and task management application.
Capabilities: Answer pricing questions, Check subscription status, Process refunds

Target Failure Mode: Policy Hallucination
Description: Agent invents refund/pricing policies not in TASKFLOW_INFO
Severity: High
Suggested Fix: Always use get_product_info tool before stating any policy

Example observations that triggered this failure:
- "Agent claimed 30-day refund for monthly plans, but policy is no refunds for monthly"
- "Agent said enterprise discounts available, but no such discount exists"
- "Agent made up a 'student discount' that doesn't exist"

Generate 15 queries (5 per variation type) that would likely trigger this failure mode:

1. **Standard** (5 queries): Direct questions about refund policies, pricing, discounts
2. **Edge Case** (5 queries): Unusual scenarios involving policy interpretation
3. **Adversarial** (5 queries): Attempts to get the agent to make up policies

For each query, include:
- The user message
- Expected failure (how the agent might hallucinate a policy)
- Rationale (why this tests the failure mode)

Return as JSON array.
```

### 6.2 Reproduction Analysis Prompt

```
You are analyzing whether an AI agent reproduced a specific failure mode.

Agent: TaskFlow Support Agent
Purpose: Provide customer support for TaskFlow

Target Failure Mode: Policy Hallucination
Failure Description: Agent invents refund/pricing policies not in TASKFLOW_INFO

User Query: "I've been using TaskFlow for 6 months. If I cancel my annual plan now, can I get a prorated refund?"

Agent Response: "I understand you'd like to cancel your annual plan. Let me check our refund policy for you.

[Tool call: get_product_info]

Based on our policy, for annual plans, you can receive a prorated refund within 60 days of purchase. Since you've been using TaskFlow for 6 months, unfortunately that falls outside the 60-day window, so a prorated refund wouldn't be available.

However, you can cancel anytime and continue using TaskFlow until your current billing period ends. Would you like me to help with that instead?"

Expected Failure (if reproduced): Agent might claim refund is available or make up a different refund timeline

Classify the agent's response:
1. REPRODUCED - The response invents or misquotes policy
2. MITIGATED - The response correctly uses the tool and states accurate policy
3. DIFFERENT_FAILURE - A different type of failure occurred
4. SUCCESS - The response is correct and no failure occurred

Analysis:
```

---

## Appendix A: API Reference

### New Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/synthetic/batches/targeted` | POST | Generate targeted batch from failure modes |
| `/api/synthetic/batches/{id}/analyze-reproductions` | POST | Analyze reproduction rates |
| `/api/taxonomy/failure-modes/{id}/targeted-batches` | GET | Get batches targeting this mode |
| `/api/taxonomy/failure-modes/{id}/history` | GET | Get status change history |

### Updated Models

```python
class SyntheticQuery(BaseModel):
    # ... existing fields ...
    target_failure_mode_id: Optional[str] = None
    variation_type: Optional[str] = None  # standard, edge_case, adversarial
    expected_failure: Optional[str] = None
    reproduction_result: Optional[str] = None  # reproduced, mitigated, etc.

class SyntheticBatch(BaseModel):
    # ... existing fields ...
    generation_mode: str = "exploratory"  # exploratory, targeted, mixed
    target_failure_mode_ids: List[str] = []
    reproduction_analysis: Optional[Dict] = None
```

---

## Appendix B: Migration Path

For existing users with failure modes but no targeted generation:

1. **No schema migration needed initially** - new columns have defaults
2. **Existing failure modes work immediately** - can generate targeted queries
3. **Historical batches remain "exploratory"** - no retroactive classification
4. **Gradual adoption** - users opt-in to targeted generation as needed

