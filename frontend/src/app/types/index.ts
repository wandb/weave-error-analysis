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

export interface ConnectionTestResult {
  success: boolean;
  status_code: number | null;
  response_time_ms: number | null;
  error: string | null;
}

// ============================================================================
// Taxonomy Types
// ============================================================================

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
// Auto Review Types
// ============================================================================

export interface FailureCategory {
  name: string;
  definition: string;
  notes?: string;
  count: number;
  trace_ids: string[];
}

export interface ReviewedTrace {
  trace_id: string;
  query_id?: string;
  query_text?: string;
  response_text?: string;
  failure_category: string;
  categorization_reason: string;
  thinking?: string;
}

export interface AutoReview {
  id: string;
  batch_id: string;
  agent_id: string;
  status: "pending" | "running" | "completed" | "failed";
  model_used: string;
  failure_categories: FailureCategory[];
  classifications: ReviewedTrace[];
  report_markdown?: string;
  total_traces: number;
  created_at: string;
  completed_at?: string;
  error_message?: string;
}

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

export type TabType = "sessions" | "taxonomy" | "agents" | "synthetic" | "runs" | "settings";

