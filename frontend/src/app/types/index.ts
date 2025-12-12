// ============================================================================
// Core Domain Types
// ============================================================================

export interface Thread {
  thread_id: string;
  turn_count: number;
  start_time: string | null;
  last_updated: string | null;
  is_reviewed?: boolean;
}

export interface ThreadMetrics {
  total_latency_ms: number;
  turn_count: number;
  has_error: boolean;
}

export interface ConversationMessage {
  type: "user" | "assistant" | "tool_call" | "system";
  content?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  call_id: string;
  timestamp: string;
}

export interface ThreadDetail {
  thread_id: string;
  calls: Array<{
    id: string;
    op_name: string;
    started_at: string;
    ended_at: string;
    inputs: Record<string, unknown>;
    output: unknown;
  }>;
  conversation: ConversationMessage[];
  feedback: Record<string, Array<{ type: string; payload: unknown }>>;
  total_calls: number;
  metrics?: ThreadMetrics;
  is_reviewed?: boolean;
}

export interface AnnotationProgress {
  reviewed_count: number;
  target: number;
  progress_percent: number;
  recent_reviews_24h: number;
  remaining: number;
}

// ============================================================================
// Session Types (Phase 5 - Local-First Sessions)
// ============================================================================

export interface Session {
  id: string;
  weave_session_id: string | null;
  weave_url: string | null;
  batch_id: string | null;
  batch_name: string | null;
  turn_count: number;
  call_count: number;
  total_latency_ms: number;
  total_tokens: number;
  estimated_cost_usd: number;
  primary_model: string | null;
  has_error: boolean;
  is_reviewed: boolean;
  started_at: string | null;
  ended_at: string | null;
}

export interface SessionNote {
  id: string;
  session_id: string;
  call_id: string | null;
  content: string;
  note_type: string;
  weave_feedback_id: string | null;
  synced_to_weave: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface SessionDetail extends Session {
  query_text: string | null;
  total_input_tokens: number;
  total_output_tokens: number;
  error_summary: string | null;
  reviewed_at: string | null;
  conversation: ConversationMessage[];
  notes: SessionNote[];
}

export interface SessionListResponse {
  sessions: Session[];
  total_count: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface SyncStatus {
  status: "idle" | "syncing" | "error";
  last_sync_completed_at: string | null;
  last_sync_type: string | null;
  sessions_added: number;
  sessions_updated: number;
  is_syncing: boolean;
  current_sync_progress: number;
  error_message: string | null;
}

export interface SessionStats {
  total_sessions: number;
  reviewed_sessions: number;
  unreviewed_sessions: number;
  error_sessions: number;
  total_tokens: number;
  total_cost_usd: number;
  avg_turns: number;
  avg_latency_ms: number;
}

export interface FilterRange {
  min: number;
  max: number;
}

export interface FilterRanges {
  turns: FilterRange;
  tokens: FilterRange;
  cost: FilterRange;
  latency: FilterRange;
  total_sessions: number;
}

export interface BatchReviewProgress {
  batch_id: string;
  batch_name: string | null;
  total_sessions: number;
  reviewed_sessions: number;
  unreviewed_sessions: number;
  progress_percent: number;
  recent_reviews_24h: number;
  last_review_at: string | null;
}

export interface SessionFilters {
  batch_id?: string | null;
  exclude_batches?: boolean;
  min_turns?: number | null;
  max_turns?: number | null;
  is_reviewed?: boolean | null;
  has_error?: boolean | null;
  min_tokens?: number | null;
  max_tokens?: number | null;
  min_cost?: number | null;
  max_cost?: number | null;
  min_latency?: number | null;
  max_latency?: number | null;
  started_after?: string | null;
  started_before?: string | null;
  primary_model?: string | null;
  note_search?: string | null;
  random_sample?: number | null;
}

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
  version: string;
  agent_type: string | null;
  framework: string | null;
  endpoint_url: string;
  connection_status: string;
  last_connection_test: string | null;
  created_at: string;
  updated_at: string;
  purpose: string | null;
  capabilities: string[];
  testing_dimensions_count: number;
}

export interface AgentDetail extends Agent {
  agent_info_raw: string;
  agent_info_parsed: Record<string, unknown> | null;
  limitations: string[];
  success_criteria: string[];
  tools: Array<{ name: string; purpose: string; inputs: string; outputs: string }>;
  testing_dimensions: Array<{
    name: string;
    values: string[];
    descriptions: Record<string, string> | null;
  }>;
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
  
  // Thread/Session stats
  total_threads: number;
  reviewed_threads: number;
  unreviewed_threads: number;
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
  // Session metrics (populated for executed queries)
  session_id?: string;  // The Weave session/thread ID
  call_count?: number;  // Total calls (tool calls, LLM calls, etc.)
  turn_count?: number;  // Number of conversation turns
  total_latency_ms?: number;  // Total execution time
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

export type TraceSourceType = "synthetic_batch" | "sessions";

export interface TraceSourceSyntheticBatch {
  type: "synthetic_batch";
  batchId: string;
}

export interface TraceSourceSessions {
  type: "sessions";
  sessionIds: string[];
  batchId?: string;  // Optional: filter sessions by batch
}

export type TraceSource = TraceSourceSyntheticBatch | TraceSourceSessions;

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

export type TabType = "threads" | "taxonomy" | "agents" | "synthetic" | "settings";

// ============================================================================
// AI Suggestion Types (Sprint 2 - Suggestion Service UI)
// ============================================================================

export interface TraceSuggestion {
  id: string;
  trace_id: string;
  batch_id: string | null;
  session_id: string | null;
  
  has_issue: boolean;
  suggested_note: string | null;
  confidence: number;
  thinking: string | null;
  
  // Category - either existing failure mode or new suggestion
  failure_mode_id: string | null;
  failure_mode_name: string | null;
  suggested_category: string | null;
  
  status: 'pending' | 'accepted' | 'edited' | 'rejected' | 'skipped';
  created_at: string;
}

export interface SuggestionAnalysisResponse {
  batch_id: string | null;
  session_id: string | null;
  total_traces: number;
  issues_found: number;
  suggestions: TraceSuggestion[];
}

export interface SuggestionStats {
  total: number;
  issues_found: number;
  pending: number;
  accepted: number;
  edited: number;
  rejected: number;
  skipped: number;
  error: number;
  accept_rate: number;  // (accepted + edited) / reviewed_total
  reviewed_total: number;
}

export interface AcceptSuggestionResult {
  note_id: string;
  content: string;
  failure_mode_id: string | null;
  session_id: string | null;
  created_at: string;
}

// ============================================================================
// Workflow Progress Types
// ============================================================================

export interface WorkflowProgress {
  hasAgents: boolean;
  hasBatches: boolean;
  hasReviewedSessions: boolean;
  hasFailureModes: boolean;
}

// ============================================================================
// Prompt Management Types (Phase 3)
// ============================================================================

export interface PromptConfig {
  id: string;
  name: string;
  description: string;
  feature: 'suggestions' | 'synthetic' | 'taxonomy';
  system_prompt: string | null;
  user_prompt_template: string;
  available_variables: string[];
  version: string | null;  // Version label (v0, v1, v2...)
  digest: string | null;   // Full Weave hash
  is_default: boolean;
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

