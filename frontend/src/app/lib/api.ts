import type {
  FeedbackSummary,
  Agent,
  AgentDetail,
  AgentStats,
  ConnectionTestResult,
  Taxonomy,
  AISuggestion,
  Dimension,
  SyntheticBatch,
  BatchDetail,
  SettingsGroup,
  ConfigStatus,
  TestConnectionResult,
  SessionDetail,
  SessionListResponse,
  SyncStatus,
  BatchReviewProgress,
  SessionFilters,
  FilterRanges,
  FailureMode,
  FailureModeStatus,
  TraceSuggestion,
  SuggestionAnalysisResponse,
  SuggestionStats,
  AcceptSuggestionResult,
} from "../types";
import { createLogger } from "./logger";

const API_BASE = "/api";
const logger = createLogger("API");

// =============================================================================
// API Error Handling
// =============================================================================

/**
 * Custom error class for API errors with status code context
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly endpoint?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Wrapper for fetch that consistently handles errors.
 * Throws ApiError for non-ok responses instead of silently returning.
 */
async function apiCall<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ detail: "Request failed" }));
    const message = errorBody.detail || errorBody.message || `HTTP ${response.status}`;
    throw new ApiError(response.status, message, url);
  }
  
  return response.json();
}

/**
 * Get the direct backend URL for SSE streaming endpoints.
 * SSE requires direct backend access to avoid Next.js proxy buffering.
 * 
 * In production, this should be configured via environment variables.
 */
export function getBackendUrl(): string {
  // Check for environment variable first (for deployment flexibility)
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_BACKEND_URL) {
    return process.env.NEXT_PUBLIC_BACKEND_URL;
  }
  // Default: construct from window location
  if (typeof window !== 'undefined') {
    const port = process.env.NEXT_PUBLIC_BACKEND_PORT || '8000';
    return `http://${window.location.hostname}:${port}`;
  }
  return 'http://localhost:8000';
}

// ============================================================================
// Feedback API (used by header stats)
// ============================================================================

export async function fetchFeedbackSummary(): Promise<FeedbackSummary> {
  return apiCall(`${API_BASE}/feedback-summary`);
}

// Note: fetchAnnotationProgress was removed - use session stats or batch review progress instead

// ============================================================================
// Agent API
// ============================================================================

export async function fetchAgents(): Promise<Agent[]> {
  return apiCall(`${API_BASE}/agents`);
}

export async function fetchAgentDetail(agentId: string): Promise<AgentDetail> {
  return apiCall(`${API_BASE}/agents/${agentId}`);
}

export async function testAgentConnection(agentId: string): Promise<ConnectionTestResult> {
  return apiCall(`${API_BASE}/agents/${agentId}/test-connection`, { method: "POST" });
}

export async function createAgent(
  name: string,
  endpointUrl: string,
  agentInfoContent: string
): Promise<Agent> {
  return apiCall(`${API_BASE}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      endpoint_url: endpointUrl,
      agent_info_content: agentInfoContent,
    }),
  });
}

export async function updateAgent(
  agentId: string,
  updates: { name?: string; endpoint_url?: string; agent_info_content?: string }
): Promise<Agent> {
  return apiCall(`${API_BASE}/agents/${agentId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

export async function deleteAgent(agentId: string): Promise<void> {
  await apiCall(`${API_BASE}/agents/${agentId}`, { method: "DELETE" });
}

export async function getAgentInfoTemplate(name: string = "My Agent"): Promise<string> {
  const data = await apiCall<{ template: string }>(`${API_BASE}/agents/template?name=${encodeURIComponent(name)}`);
  return data.template;
}

export async function fetchAgentStats(agentId: string): Promise<AgentStats> {
  return apiCall(`${API_BASE}/agents/${agentId}/stats`);
}

// ============================================================================
// Example Agent API
// ============================================================================

export interface ExampleAgentStatus {
  running: boolean;
  port?: number;
  pid?: number;
  exit_code?: number;
  requires_api_key: boolean;
}

export interface ExampleAgentStartResult {
  status: "started" | "already_running";
  port: number;
  pid?: number;
}

export async function getExampleAgentStatus(): Promise<ExampleAgentStatus> {
  return apiCall(`${API_BASE}/agents/example/status`);
}

export async function startExampleAgent(port: number = 9000): Promise<ExampleAgentStartResult> {
  return apiCall(`${API_BASE}/agents/example/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ port }),
  });
}

export async function stopExampleAgent(): Promise<{ status: string }> {
  return apiCall(`${API_BASE}/agents/example/stop`, { method: "POST" });
}

// ============================================================================
// Database Management API
// ============================================================================

export interface DatabaseResetResult {
  status: string;
  keep_settings: boolean;
  keep_agents: boolean;
  tables_cleared: string[];
}

export async function resetDatabase(
  keepSettings: boolean = true,
  keepAgents: boolean = true
): Promise<DatabaseResetResult> {
  return apiCall(`${API_BASE}/settings/database/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      keep_settings: keepSettings,
      keep_agents: keepAgents,
    }),
  });
}

// ============================================================================
// Taxonomy API
// ============================================================================

export async function fetchTaxonomy(): Promise<Taxonomy> {
  return apiCall(`${API_BASE}/taxonomy`);
}

export async function syncNotesFromWeave(): Promise<{ synced: number }> {
  return apiCall(`${API_BASE}/taxonomy/notes/sync`, { method: "POST" });
}

export async function autoCategorize(): Promise<{ categorized: number }> {
  return apiCall(`${API_BASE}/taxonomy/auto-categorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

// Saturation History API
export interface SaturationSnapshot {
  threads_reviewed: number;
  failure_modes_count: number;
  categorized_notes: number;
  saturation_score: number;
  snapshot_date: string;
}

export interface SaturationHistory {
  snapshots: SaturationSnapshot[];
  current_threads: number;
  current_modes: number;
  current_notes: number;
  last_discovery_at_threads: number;
  threads_since_last_discovery: number;
  saturation_score: number;
  saturation_status: "no_data" | "discovering" | "approaching_saturation" | "saturated";
  recommendation: string;
  recommendation_type: "info" | "action" | "success";
  recent_discoveries: number;
}

export async function fetchSaturationHistory(): Promise<SaturationHistory> {
  return apiCall(`${API_BASE}/taxonomy/saturation-history`);
}

// Batch Saturation API (new batch-centric charts)
export interface BatchSaturationData {
  batch_id: string;
  batch_name: string;
  batch_order: number;
  total_sessions: number;
  reviewed_sessions: number;
  new_modes_discovered: number;
  existing_modes_matched: number;
  cumulative_modes: number;
}

export interface BatchSaturationResponse {
  batches: BatchSaturationData[];
  summary: {
    total_batches: number;
    total_sessions: number;
    total_reviewed: number;
    total_modes: number;
    saturation_status: "discovering" | "stabilizing" | "saturated";
  };
}

export async function fetchBatchSaturation(): Promise<BatchSaturationResponse> {
  return apiCall(`${API_BASE}/taxonomy/saturation-by-batch`);
}

export async function suggestCategoryForNote(noteId: string): Promise<AISuggestion> {
  return apiCall(`${API_BASE}/taxonomy/notes/${noteId}/suggest`, { method: "POST" });
}

export async function assignNoteToMode(
  noteId: string,
  modeId: string,
  method: string = "manual"
): Promise<void> {
  await apiCall(`${API_BASE}/taxonomy/notes/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note_id: noteId, failure_mode_id: modeId, method }),
  });
}

export async function createFailureMode(
  name: string,
  description: string,
  severity: string,
  suggestedFix?: string
): Promise<{ id: string }> {
  return apiCall(`${API_BASE}/taxonomy/failure-modes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      description,
      severity,
      suggested_fix: suggestedFix,
    }),
  });
}

export async function deleteFailureMode(modeId: string): Promise<void> {
  await apiCall(`${API_BASE}/taxonomy/failure-modes/${modeId}`, { method: "DELETE" });
}

export async function updateFailureMode(
  modeId: string,
  updates: {
    name?: string;
    description?: string;
    severity?: string;
    suggested_fix?: string;
    status?: FailureModeStatus;
  }
): Promise<FailureMode> {
  return apiCall(`${API_BASE}/taxonomy/failure-modes/${modeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

export async function updateFailureModeStatus(
  modeId: string,
  status: FailureModeStatus
): Promise<FailureMode> {
  return apiCall(`${API_BASE}/taxonomy/failure-modes/${modeId}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export async function mergeFailureModes(
  sourceId: string,
  targetId: string,
  newName?: string,
  newDescription?: string
): Promise<FailureMode> {
  return apiCall(`${API_BASE}/taxonomy/failure-modes/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_id: sourceId,
      target_id: targetId,
      new_name: newName,
      new_description: newDescription,
    }),
  });
}

// Batch Categorization API
export interface BatchSuggestion {
  note_id: string;
  note_content: string;
  session_id: string | null;
  source_type: string | null;
  suggestion: AISuggestion;
}

export interface BatchSuggestResult {
  total_notes: number;
  suggestions: BatchSuggestion[];
  errors: Array<{ note_id: string; error: string }>;
}

export interface BatchApplyAssignment {
  note_id: string;
  action: "existing" | "new" | "skip";
  failure_mode_id?: string;
  new_category?: {
    name: string;
    description: string;
    severity: string;
    suggested_fix?: string;
  };
}

export interface BatchApplyResult {
  applied: number;
  new_modes_created: number;
  existing_modes_matched: number;
  skipped: number;
  errors: Array<{ note_id?: string; error: string }>;
}

export async function batchSuggestCategories(noteIds?: string[]): Promise<BatchSuggestResult> {
  return apiCall(`${API_BASE}/taxonomy/batch-suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note_ids: noteIds || null }),
  });
}

export async function batchApplyCategories(
  assignments: BatchApplyAssignment[]
): Promise<BatchApplyResult> {
  return apiCall(`${API_BASE}/taxonomy/batch-apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignments }),
  });
}

// ============================================================================
// Synthetic Data API
// ============================================================================

export async function fetchDimensions(agentId: string): Promise<Dimension[]> {
  return apiCall(`${API_BASE}/agents/${agentId}/dimensions`);
}

export async function importDimensions(
  agentId: string
): Promise<{ imported: number; dimensions: Dimension[] }> {
  return apiCall(`${API_BASE}/agents/${agentId}/dimensions/import-from-agent`, {
    method: "POST",
  });
}

export async function saveDimension(
  agentId: string,
  name: string,
  values: string[]
): Promise<void> {
  await apiCall(`${API_BASE}/agents/${agentId}/dimensions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, values }),
  });
}

export async function deleteDimension(agentId: string, dimName: string): Promise<void> {
  await apiCall(`${API_BASE}/agents/${agentId}/dimensions/${dimName}`, {
    method: "DELETE",
  });
}

export async function fetchBatches(agentId: string): Promise<SyntheticBatch[]> {
  return apiCall(`${API_BASE}/synthetic/batches?agent_id=${agentId}`);
}

export async function fetchBatchDetail(batchId: string): Promise<BatchDetail> {
  return apiCall(`${API_BASE}/synthetic/batches/${batchId}`);
}

export async function deleteBatch(batchId: string): Promise<void> {
  await apiCall(`${API_BASE}/synthetic/batches/${batchId}`, { method: "DELETE" });
}

export async function resetBatch(batchId: string, onlyFailed: boolean = false): Promise<void> {
  await apiCall(`${API_BASE}/synthetic/batches/${batchId}/reset?only_failed=${onlyFailed}`, {
    method: "POST",
  });
}

export async function updateQuery(queryId: string, queryText: string): Promise<void> {
  await apiCall(`${API_BASE}/synthetic/queries/${queryId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query_text: queryText }),
  });
}

export async function bulkDeleteQueries(queryIds: string[]): Promise<void> {
  await apiCall(`${API_BASE}/synthetic/queries/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query_ids: queryIds }),
  });
}

// ============================================================================
// Streaming API helpers
// ============================================================================

export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

export async function* streamSSE(
  url: string,
  options: RequestInit = {}
): AsyncGenerator<StreamEvent> {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        try {
          yield JSON.parse(data);
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }
}


// ============================================================================
// Settings API
// ============================================================================

export async function fetchSettingsGrouped(): Promise<SettingsGroup[]> {
  const data = await apiCall<{ groups: SettingsGroup[] }>(`${API_BASE}/settings/grouped`);
  return data.groups;
}

export async function fetchConfigStatus(): Promise<ConfigStatus> {
  return apiCall(`${API_BASE}/settings/status`);
}

export async function updateSetting(key: string, value: string): Promise<void> {
  logger.info("setting.update_start", { key });
  
  try {
    await apiCall(`${API_BASE}/settings/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    logger.info("setting.update_complete", { key });
  } catch (error) {
    logger.error("setting.update_failed", { key, error: error instanceof Error ? error.message : "Unknown error" });
    throw error;
  }
}

export async function bulkUpdateSettings(settings: Record<string, string>): Promise<void> {
  await apiCall(`${API_BASE}/settings/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  });
}

export async function resetSetting(key: string): Promise<void> {
  await apiCall(`${API_BASE}/settings/${key}`, { method: "DELETE" });
}

export async function testLLMConnection(): Promise<TestConnectionResult> {
  logger.info("llm.test_start");
  
  const result = await apiCall<TestConnectionResult>(`${API_BASE}/settings/test-llm`, {
    method: "POST",
  });
  
  logger.info("llm.test_complete", { 
    success: result.success, 
    model: result.model,
    latency_ms: result.latency_ms 
  });
  
  return result;
}

export async function testWeaveConnection(): Promise<TestConnectionResult> {
  return apiCall(`${API_BASE}/settings/test-weave`, { method: "POST" });
}

// ============================================================================
// Sessions API (Phase 5 - Local-First Sessions)
// ============================================================================

export interface FetchSessionsParams extends SessionFilters {
  limit?: number;
  offset?: number;
  sort_by?: string;
  direction?: string;
}

export async function fetchSessions(params: FetchSessionsParams = {}): Promise<SessionListResponse> {
  const urlParams = new URLSearchParams();
  
  // Pagination
  if (params.limit != null) urlParams.append("limit", String(params.limit));
  if (params.offset != null) urlParams.append("offset", String(params.offset));
  
  // Sorting
  if (params.sort_by) urlParams.append("sort_by", params.sort_by);
  if (params.direction) urlParams.append("direction", params.direction);
  
  // Filters
  if (params.batch_id) urlParams.append("batch_id", params.batch_id);
  if (params.exclude_batches) urlParams.append("exclude_batches", "true");
  if (params.min_turns != null) urlParams.append("min_turns", String(params.min_turns));
  if (params.max_turns != null) urlParams.append("max_turns", String(params.max_turns));
  if (params.is_reviewed != null) urlParams.append("is_reviewed", String(params.is_reviewed));
  if (params.has_error != null) urlParams.append("has_error", String(params.has_error));
  if (params.min_tokens != null) urlParams.append("min_tokens", String(params.min_tokens));
  if (params.max_tokens != null) urlParams.append("max_tokens", String(params.max_tokens));
  if (params.min_cost != null) urlParams.append("min_cost", String(params.min_cost));
  if (params.max_cost != null) urlParams.append("max_cost", String(params.max_cost));
  if (params.min_latency != null) urlParams.append("min_latency", String(params.min_latency));
  if (params.max_latency != null) urlParams.append("max_latency", String(params.max_latency));
  if (params.started_after) urlParams.append("started_after", params.started_after);
  if (params.started_before) urlParams.append("started_before", params.started_before);
  if (params.primary_model) urlParams.append("primary_model", params.primary_model);
  if (params.note_search) urlParams.append("note_search", params.note_search);
  if (params.random_sample != null) urlParams.append("random_sample", String(params.random_sample));
  if (params.id_prefix) urlParams.append("id_prefix", params.id_prefix);

  return apiCall(`${API_BASE}/sessions?${urlParams}`);
}

export async function fetchSessionDetail(sessionId: string): Promise<SessionDetail> {
  return apiCall(`${API_BASE}/sessions/${sessionId}`);
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
  return apiCall(`${API_BASE}/sessions/sync-status`);
}

export async function triggerSync(fullSync: boolean = false, batchId?: string): Promise<{ status: string; message: string }> {
  const params = new URLSearchParams();
  if (fullSync) params.append("full_sync", "true");
  if (batchId) params.append("batch_id", batchId);
  
  return apiCall(`${API_BASE}/sessions/sync?${params}`, { method: "POST" });
}

export async function fetchSessionStats(batchId?: string): Promise<SessionStats> {
  const params = new URLSearchParams();
  if (batchId) params.append("batch_id", batchId);
  
  return apiCall(`${API_BASE}/sessions/stats/summary?${params}`);
}

export async function markSessionReviewed(sessionId: string, notes?: string): Promise<void> {
  await apiCall(`${API_BASE}/sessions/${sessionId}/mark-reviewed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
}

export async function unmarkSessionReviewed(sessionId: string): Promise<void> {
  await apiCall(`${API_BASE}/sessions/${sessionId}/mark-reviewed`, { method: "DELETE" });
}

export async function fetchSessionNotes(sessionId: string): Promise<SessionDetail["notes"]> {
  return apiCall(`${API_BASE}/sessions/${sessionId}/notes`);
}

export async function createSessionNote(
  sessionId: string,
  content: string,
  noteType: string = "observation",
  callId?: string
): Promise<void> {
  await apiCall(`${API_BASE}/sessions/${sessionId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, note_type: noteType, call_id: callId }),
  });
}

export async function deleteSessionNote(sessionId: string, noteId: string): Promise<void> {
  await apiCall(`${API_BASE}/sessions/${sessionId}/notes/${noteId}`, { method: "DELETE" });
}

export async function fetchBatchReviewProgress(batchId: string): Promise<BatchReviewProgress> {
  return apiCall(`${API_BASE}/sessions/batches/${batchId}/review-progress`);
}

export async function fetchModelOptions(): Promise<{ models: string[] }> {
  return apiCall(`${API_BASE}/sessions/options/models`);
}

export async function fetchBatchOptions(): Promise<{ batches: { id: string; name: string }[] }> {
  return apiCall(`${API_BASE}/sessions/options/batches`);
}

export async function fetchFilterRanges(): Promise<FilterRanges> {
  return apiCall(`${API_BASE}/sessions/options/filter-ranges`);
}

// ============================================================================
// AI Suggestions API (Sprint 2 - Suggestion Service)
// ============================================================================

export async function analyzeSession(
  sessionId: string,
  model?: string
): Promise<SuggestionAnalysisResponse> {
  return apiCall(`${API_BASE}/suggestions/sessions/${sessionId}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
}

export async function analyzeBatch(
  batchId: string,
  maxConcurrent: number = 10,
  model?: string
): Promise<SuggestionAnalysisResponse> {
  return apiCall(`${API_BASE}/suggestions/batches/${batchId}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ max_concurrent: maxConcurrent, model }),
  });
}

export async function fetchSessionSuggestions(sessionId: string): Promise<TraceSuggestion[]> {
  return apiCall(`${API_BASE}/suggestions/sessions/${sessionId}`);
}

export async function fetchBatchSuggestions(batchId: string): Promise<TraceSuggestion[]> {
  return apiCall(`${API_BASE}/suggestions/batches/${batchId}`);
}

export async function fetchPendingSuggestions(
  batchId?: string,
  minConfidence: number = 0.6
): Promise<TraceSuggestion[]> {
  const params = new URLSearchParams();
  if (batchId) params.append("batch_id", batchId);
  params.append("min_confidence", String(minConfidence));
  
  return apiCall(`${API_BASE}/suggestions/pending?${params}`);
}

export async function fetchSuggestionStats(batchId?: string): Promise<SuggestionStats> {
  const params = batchId ? `?batch_id=${batchId}` : "";
  return apiCall(`${API_BASE}/suggestions/stats${params}`);
}

export async function acceptSuggestion(
  suggestionId: string,
  editedText?: string,
  failureModeId?: string
): Promise<AcceptSuggestionResult> {
  return apiCall(`${API_BASE}/suggestions/${suggestionId}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      edited_text: editedText,
      failure_mode_id: failureModeId 
    }),
  });
}

export async function skipSuggestion(suggestionId: string): Promise<void> {
  await apiCall(`${API_BASE}/suggestions/${suggestionId}/skip`, { method: "POST" });
}

export async function rejectSuggestion(suggestionId: string): Promise<void> {
  await apiCall(`${API_BASE}/suggestions/${suggestionId}/reject`, { method: "POST" });
}

export async function bulkAcceptSuggestions(suggestionIds: string[]): Promise<{
  accepted: number;
  failed: number;
  notes_created: AcceptSuggestionResult[];
}> {
  return apiCall(`${API_BASE}/suggestions/bulk-accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ suggestion_ids: suggestionIds }),
  });
}

export async function bulkRejectSuggestions(suggestionIds: string[]): Promise<{
  rejected: number;
  failed: number;
}> {
  return apiCall(`${API_BASE}/suggestions/bulk-reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ suggestion_ids: suggestionIds }),
  });
}

export async function bulkSkipSuggestions(suggestionIds: string[]): Promise<{
  skipped: number;
  failed: number;
}> {
  return apiCall(`${API_BASE}/suggestions/bulk-skip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ suggestion_ids: suggestionIds }),
  });
}

export interface SuggestionHistoryResponse {
  suggestions: TraceSuggestion[];
  total_count: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export async function fetchSuggestionHistory(
  batchId?: string,
  status?: string,
  limit: number = 50,
  offset: number = 0
): Promise<SuggestionHistoryResponse> {
  const params = new URLSearchParams();
  if (batchId) params.append("batch_id", batchId);
  if (status) params.append("status", status);
  params.append("limit", String(limit));
  params.append("offset", String(offset));
  
  return apiCall(`${API_BASE}/suggestions/history?${params}`);
}

// ============================================================================
// Prompts API (Phase 3 - Prompt Management)
// ============================================================================

import type {
  PromptConfig,
  PromptsListResponse,
  PromptVersionsResponse,
} from "../types";

export async function fetchPrompts(): Promise<PromptsListResponse> {
  return apiCall(`${API_BASE}/prompts`);
}

export async function fetchPromptsByFeature(feature: string): Promise<{ prompts: PromptConfig[] }> {
  return apiCall(`${API_BASE}/prompts/by-feature/${feature}`);
}

export async function fetchPrompt(promptId: string): Promise<PromptConfig> {
  return apiCall(`${API_BASE}/prompts/${promptId}`);
}

export async function updatePrompt(
  promptId: string,
  systemPrompt?: string | null,
  userPromptTemplate?: string,
  llmModel?: string | null,
  llmTemperature?: number | null
): Promise<PromptConfig> {
  // Build request body, only including defined fields
  const body: Record<string, unknown> = {};
  if (systemPrompt !== undefined) body.system_prompt = systemPrompt;
  if (userPromptTemplate !== undefined) body.user_prompt_template = userPromptTemplate;
  if (llmModel !== undefined) body.llm_model = llmModel;
  if (llmTemperature !== undefined) body.llm_temperature = llmTemperature;
  
  return apiCall(`${API_BASE}/prompts/${promptId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function resetPrompt(promptId: string): Promise<PromptConfig> {
  return apiCall(`${API_BASE}/prompts/${promptId}/reset`, { method: "POST" });
}

export async function fetchPromptVersions(promptId: string): Promise<PromptVersionsResponse> {
  return apiCall(`${API_BASE}/prompts/${promptId}/versions`);
}

export async function setPromptVersion(promptId: string, version: string): Promise<PromptConfig> {
  return apiCall(`${API_BASE}/prompts/${promptId}/set-version`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version }),
  });
}

