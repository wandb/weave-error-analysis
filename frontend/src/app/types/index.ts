// ============================================================================
// Core Domain Types
// ============================================================================

export interface FeedbackSummary {
  thumbs_up: number;
  thumbs_down: number;
  notes: Array<{
    note: string;
    call_id: string;
    weave_ref: string;
    weave_url: string;
    created_at: string;
  }>;
  total_notes: number;
}

// ============================================================================
// Agent Types
// ============================================================================

export interface Agent {
  id: string;
  name: string;
  endpoint_url: string;
  weave_project: string | null;
  agent_context: string;
  connection_status: string;
  last_connection_test: string | null;
  is_example: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Represents a testing dimension for synthetic data generation.
 * Each dimension has named values that can be combined into tuples.
 */
export interface TestingDimension {
  name: string;
  values: string[];
  descriptions: Record<string, string> | null;
}

export interface AgentDetail extends Agent {
  // AgentDetail has the same fields as Agent
}

export interface AgentStats {
  agent_id: string;
  agent_name: string;
  
  // Batch stats
  total_batches: number;
  pending_batches: number;
  completed_batches: number;
  
  // Query stats
  total_queries: number;
  executed_queries: number;
  success_queries: number;
  failed_queries: number;
  
  // Trace review stats (from Weave feedback, not local sessions)
  total_traces: number;
  reviewed_traces: number;
  unreviewed_traces: number;
  review_progress_percent: number;
  
  // Failure mode stats
  total_failure_modes: number;
  total_categorized_notes: number;
  saturation_score: number;
  saturation_status: "discovering" | "approaching" | "saturated";
  top_failure_mode: string | null;
  top_failure_mode_percent: number | null;
  
  // Activity
  latest_batch_name: string | null;
  latest_batch_completed_at: string | null;
}

export interface ConnectionTestResult {
  success: boolean;
  status_code: number | null;
  response_time_ms: number | null;
  error: string | null;
}

// ============================================================================
// Taxonomy Types
// ============================================================================

export type FailureModeStatus = "active" | "investigating" | "resolved" | "wont_fix";

export interface FailureMode {
  id: string;
  name: string;
  description: string;
  severity: string;
  suggested_fix: string | null;
  created_at: string;
  last_seen_at: string;
  times_seen: number;
  note_ids: string[];
  status: FailureModeStatus;
  status_changed_at: string | null;
}

export interface TaxonomyNote {
  id: string;
  content: string;
  trace_id: string;
  weave_ref: string;
  weave_url: string;
  failure_mode_id: string | null;
  assignment_method: string | null;
  created_at: string;
  assigned_at: string | null;
  session_id: string | null;
  source_type: string | null;
}

export interface SaturationStats {
  status: string;
  message: string;
  saturation_score: number;
  total_failure_modes: number;
  total_notes: number;
  window_new_modes: number;
  window_matched: number;
  recent_events: Array<{
    timestamp: string;
    notes: number;
    new_modes: number;
    matched: number;
  }>;
}

export interface Taxonomy {
  failure_modes: FailureMode[];
  uncategorized_notes: TaxonomyNote[];
  notes?: TaxonomyNote[];
  saturation: SaturationStats;
  stats: {
    total_failure_modes: number;
    total_uncategorized: number;
    total_categorized: number;
  };
}

export interface AISuggestion {
  match_type: "existing" | "new";
  existing_mode_id: string | null;
  confidence: number;
  reasoning: string;
  new_category?: {
    name: string;
    description: string;
    severity: string;
    suggested_fix: string;
  };
}

// ============================================================================
// Synthetic Data Types
// ============================================================================

export interface Dimension {
  id: string;
  name: string;
  values: string[];
}

export interface SyntheticBatch {
  id: string;
  name: string;
  status: string;
  query_count: number;
  created_at: string;
  // Enhanced stats for batch selector
  executed_count?: number;
  success_count?: number;
  failure_count?: number;
  pending_count?: number;
}

export interface SyntheticQuery {
  id: string;
  tuple_values: Record<string, string>;
  query_text: string;
  execution_status?: string;
  response_text?: string;
  trace_id?: string;
  error_message?: string;
}

export interface BatchDetail {
  id: string;
  name: string;
  status?: string;
  queries: SyntheticQuery[];
}

export interface GenerationProgress {
  total: number;
  completed: number;
  percent: number;
  currentQuery?: string;
}

export interface ExecutionProgress {
  batch_id: string;
  status: string;
  total_queries: number;
  completed_queries: number;
  success_count: number;
  failure_count: number;
  progress_percent: number;
  current_query_id?: string;
  current_query_text?: string;
  estimated_remaining_seconds?: number;
  start_time?: number;
  last_response?: string;
}

// ============================================================================
// Playground Types
// ============================================================================

export interface ToolCall {
  call_id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  tool_result: unknown;
  status: "running" | "complete";
}

export interface PlaygroundEvent {
  type: string;
  content?: string;
  timestamp: string;
}

// ============================================================================
// Trace Source Types
// ============================================================================

export type TraceSourceType = "synthetic_batch";

export interface TraceSourceSyntheticBatch {
  type: "synthetic_batch";
  batchId: string;
}

export type TraceSource = TraceSourceSyntheticBatch;

// ============================================================================
// Settings Types
// ============================================================================

export interface SettingValue {
  key: string;
  value: string;
  is_secret: boolean;
  description?: string;
  updated_at?: string;
}

export interface SettingsGroup {
  name: string;
  description: string;
  settings: SettingValue[];
}

export interface ConfigStatus {
  llm: {
    configured: boolean;
    model: string;
    provider: string;
    message: string;
  };
  weave: {
    configured: boolean;
    entity: string;
    project: string;
    project_id: string | null;
    message: string;
  };
}

export interface TestConnectionResult {
  success: boolean;
  model?: string;
  entity?: string;
  project?: string;
  project_id?: string;
  response?: string;
  error?: string;
  message: string;
}

// ============================================================================
// Tab Types
// ============================================================================

export type TabType = "taxonomy" | "agents" | "synthetic" | "settings";

// ============================================================================
// Workflow Progress Types
// ============================================================================

export interface WorkflowProgress {
  hasAgents: boolean;
  hasBatches: boolean;
  hasFailureModes: boolean;
}

// ============================================================================
// Prompt Management Types (Phase 3)
// ============================================================================

export interface PromptConfig {
  id: string;
  name: string;
  description: string;
  feature: 'synthetic' | 'taxonomy';
  system_prompt: string | null;
  user_prompt_template: string;
  available_variables: string[];
  version: string | null;  // Version label (v0, v1, v2...)
  digest: string | null;   // Full Weave hash
  is_default: boolean;
  
  // LLM Configuration (per-prompt overrides)
  llm_model: string | null;       // Model override, null = use global
  llm_temperature: number | null; // Temperature override, null = use global default
}

export interface PromptVersion {
  version: string;         // Version label (v0, v1, v2...)
  digest: string;          // Full Weave hash
  created_at: string;
  system_prompt: string | null;
  user_prompt_template: string;
  is_current: boolean;
}

export interface PromptsListResponse {
  prompts: PromptConfig[];
  weave_enabled: boolean;
  weave_project_url: string | null;
}

export interface PromptVersionsResponse {
  versions: PromptVersion[];
  weave_versions_url: string | null;
  current_version: string | null;
}

