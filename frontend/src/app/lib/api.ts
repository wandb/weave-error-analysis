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
  const response = await fetch(`${API_BASE}/feedback-summary`);
  return response.json();
}

// Note: fetchAnnotationProgress was removed - use session stats or batch review progress instead

// ============================================================================
// Agent API
// ============================================================================

export async function fetchAgents(): Promise<Agent[]> {
  const response = await fetch(`${API_BASE}/agents`);
  return response.json();
}

export async function fetchAgentDetail(agentId: string): Promise<AgentDetail> {
  const response = await fetch(`${API_BASE}/agents/${agentId}`);
  return response.json();
}

export async function testAgentConnection(agentId: string): Promise<ConnectionTestResult> {
  const response = await fetch(`${API_BASE}/agents/${agentId}/test-connection`, {
    method: "POST",
  });
  return response.json();
}

export async function createAgent(
  name: string,
  endpointUrl: string,
  agentInfoContent: string
): Promise<Agent> {
  const response = await fetch(`${API_BASE}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      endpoint_url: endpointUrl,
      agent_info_content: agentInfoContent,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to create agent");
  }

  return response.json();
}

export async function updateAgent(
  agentId: string,
  updates: { name?: string; endpoint_url?: string; agent_info_content?: string }
): Promise<Agent> {
  const response = await fetch(`${API_BASE}/agents/${agentId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to update agent");
  }

  return response.json();
}

export async function deleteAgent(agentId: string): Promise<void> {
  await fetch(`${API_BASE}/agents/${agentId}`, { method: "DELETE" });
}

export async function getAgentInfoTemplate(name: string = "My Agent"): Promise<string> {
  const response = await fetch(`${API_BASE}/agents/template?name=${encodeURIComponent(name)}`);
  const data = await response.json();
  return data.template;
}

export async function fetchAgentStats(agentId: string): Promise<AgentStats> {
  const response = await fetch(`${API_BASE}/agents/${agentId}/stats`);
  if (!response.ok) {
    throw new Error("Failed to fetch agent stats");
  }
  return response.json();
}

// ============================================================================
// Taxonomy API
// ============================================================================

export async function fetchTaxonomy(): Promise<Taxonomy> {
  const response = await fetch(`${API_BASE}/taxonomy`);
  return response.json();
}

export async function syncNotesFromWeave(): Promise<{ synced: number }> {
  const response = await fetch(`${API_BASE}/taxonomy/notes/sync`, { method: "POST" });
  return response.json();
}

export async function autoCategorize(): Promise<{ categorized: number }> {
  const response = await fetch(`${API_BASE}/taxonomy/auto-categorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return response.json();
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
  const response = await fetch(`${API_BASE}/taxonomy/saturation-history`);
  return response.json();
}

export async function suggestCategoryForNote(noteId: string): Promise<AISuggestion> {
  const response = await fetch(`${API_BASE}/taxonomy/notes/${noteId}/suggest`, {
    method: "POST",
  });
  return response.json();
}

export async function assignNoteToMode(
  noteId: string,
  modeId: string,
  method: string = "manual"
): Promise<void> {
  await fetch(`${API_BASE}/taxonomy/notes/assign`, {
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
  const response = await fetch(`${API_BASE}/taxonomy/failure-modes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      description,
      severity,
      suggested_fix: suggestedFix,
    }),
  });
  return response.json();
}

export async function deleteFailureMode(modeId: string): Promise<void> {
  await fetch(`${API_BASE}/taxonomy/failure-modes/${modeId}`, { method: "DELETE" });
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
  const response = await fetch(`${API_BASE}/taxonomy/failure-modes/${modeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to update failure mode");
  }
  return response.json();
}

export async function updateFailureModeStatus(
  modeId: string,
  status: FailureModeStatus
): Promise<FailureMode> {
  const response = await fetch(`${API_BASE}/taxonomy/failure-modes/${modeId}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to update status");
  }
  return response.json();
}

export async function mergeFailureModes(
  sourceId: string,
  targetId: string,
  newName?: string,
  newDescription?: string
): Promise<FailureMode> {
  const response = await fetch(`${API_BASE}/taxonomy/failure-modes/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_id: sourceId,
      target_id: targetId,
      new_name: newName,
      new_description: newDescription,
    }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to merge failure modes");
  }
  return response.json();
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
  const response = await fetch(`${API_BASE}/taxonomy/batch-suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note_ids: noteIds || null }),
  });
  return response.json();
}

export async function batchApplyCategories(
  assignments: BatchApplyAssignment[]
): Promise<BatchApplyResult> {
  const response = await fetch(`${API_BASE}/taxonomy/batch-apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignments }),
  });
  return response.json();
}

// ============================================================================
// Synthetic Data API
// ============================================================================

export async function fetchDimensions(agentId: string): Promise<Dimension[]> {
  const response = await fetch(`${API_BASE}/agents/${agentId}/dimensions`);
  return response.json();
}

export async function importDimensions(
  agentId: string
): Promise<{ imported: number; dimensions: Dimension[] }> {
  const response = await fetch(`${API_BASE}/agents/${agentId}/dimensions/import-from-agent`, {
    method: "POST",
  });
  return response.json();
}

export async function saveDimension(
  agentId: string,
  name: string,
  values: string[]
): Promise<void> {
  await fetch(`${API_BASE}/agents/${agentId}/dimensions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, values }),
  });
}

export async function deleteDimension(agentId: string, dimName: string): Promise<void> {
  await fetch(`${API_BASE}/agents/${agentId}/dimensions/${dimName}`, {
    method: "DELETE",
  });
}

export async function fetchBatches(agentId: string): Promise<SyntheticBatch[]> {
  const response = await fetch(`${API_BASE}/synthetic/batches?agent_id=${agentId}`);
  return response.json();
}

export async function fetchBatchDetail(batchId: string): Promise<BatchDetail> {
  const response = await fetch(`${API_BASE}/synthetic/batches/${batchId}`);
  return response.json();
}

export async function deleteBatch(batchId: string): Promise<void> {
  await fetch(`${API_BASE}/synthetic/batches/${batchId}`, { method: "DELETE" });
}

export async function resetBatch(batchId: string, onlyFailed: boolean = false): Promise<void> {
  await fetch(`${API_BASE}/synthetic/batches/${batchId}/reset?only_failed=${onlyFailed}`, {
    method: "POST",
  });
}

export async function updateQuery(queryId: string, queryText: string): Promise<void> {
  await fetch(`${API_BASE}/synthetic/queries/${queryId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query_text: queryText }),
  });
}

export async function bulkDeleteQueries(queryIds: string[]): Promise<void> {
  await fetch(`${API_BASE}/synthetic/queries/bulk-delete`, {
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
  const response = await fetch(`${API_BASE}/settings/grouped`);
  const data = await response.json();
  return data.groups;
}

export async function fetchConfigStatus(): Promise<ConfigStatus> {
  const response = await fetch(`${API_BASE}/settings/status`);
  return response.json();
}

export async function updateSetting(key: string, value: string): Promise<void> {
  logger.info("setting.update_start", { key });
  
  const response = await fetch(`${API_BASE}/settings/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });

  if (!response.ok) {
    const error = await response.json();
    logger.error("setting.update_failed", { key, error: error.detail });
    throw new Error(error.detail || "Failed to update setting");
  }
  
  logger.info("setting.update_complete", { key });
}

export async function bulkUpdateSettings(settings: Record<string, string>): Promise<void> {
  const response = await fetch(`${API_BASE}/settings/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to update settings");
  }
}

export async function resetSetting(key: string): Promise<void> {
  await fetch(`${API_BASE}/settings/${key}`, { method: "DELETE" });
}

export async function testLLMConnection(): Promise<TestConnectionResult> {
  logger.info("llm.test_start");
  
  const response = await fetch(`${API_BASE}/settings/test-llm`, {
    method: "POST",
  });
  const result = await response.json();
  
  logger.info("llm.test_complete", { 
    success: result.success, 
    model: result.model,
    latency_ms: result.latency_ms 
  });
  
  return result;
}

export async function testWeaveConnection(): Promise<TestConnectionResult> {
  const response = await fetch(`${API_BASE}/settings/test-weave`, {
    method: "POST",
  });
  return response.json();
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

  const response = await fetch(`${API_BASE}/sessions?${urlParams}`);
  return response.json();
}

export async function fetchSessionDetail(sessionId: string): Promise<SessionDetail> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}`);
  if (!response.ok) {
    throw new Error("Session not found");
  }
  return response.json();
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
  const response = await fetch(`${API_BASE}/sessions/sync-status`);
  return response.json();
}

export async function triggerSync(fullSync: boolean = false, batchId?: string): Promise<{ status: string; message: string }> {
  const params = new URLSearchParams();
  if (fullSync) params.append("full_sync", "true");
  if (batchId) params.append("batch_id", batchId);
  
  const response = await fetch(`${API_BASE}/sessions/sync?${params}`, {
    method: "POST",
  });
  return response.json();
}

export async function fetchSessionStats(batchId?: string): Promise<SessionStats> {
  const params = new URLSearchParams();
  if (batchId) params.append("batch_id", batchId);
  
  const response = await fetch(`${API_BASE}/sessions/stats/summary?${params}`);
  return response.json();
}

export async function markSessionReviewed(sessionId: string, notes?: string): Promise<void> {
  await fetch(`${API_BASE}/sessions/${sessionId}/mark-reviewed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
}

export async function unmarkSessionReviewed(sessionId: string): Promise<void> {
  await fetch(`${API_BASE}/sessions/${sessionId}/mark-reviewed`, {
    method: "DELETE",
  });
}

export async function fetchSessionNotes(sessionId: string): Promise<SessionDetail["notes"]> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/notes`);
  return response.json();
}

export async function createSessionNote(
  sessionId: string,
  content: string,
  noteType: string = "observation",
  callId?: string
): Promise<void> {
  await fetch(`${API_BASE}/sessions/${sessionId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, note_type: noteType, call_id: callId }),
  });
}

export async function deleteSessionNote(sessionId: string, noteId: string): Promise<void> {
  await fetch(`${API_BASE}/sessions/${sessionId}/notes/${noteId}`, {
    method: "DELETE",
  });
}

export async function fetchBatchReviewProgress(batchId: string): Promise<BatchReviewProgress> {
  const response = await fetch(`${API_BASE}/sessions/batches/${batchId}/review-progress`);
  return response.json();
}

export async function fetchModelOptions(): Promise<{ models: string[] }> {
  const response = await fetch(`${API_BASE}/sessions/options/models`);
  return response.json();
}

export async function fetchBatchOptions(): Promise<{ batches: { id: string; name: string }[] }> {
  const response = await fetch(`${API_BASE}/sessions/options/batches`);
  return response.json();
}

export async function fetchFilterRanges(): Promise<FilterRanges> {
  const response = await fetch(`${API_BASE}/sessions/options/filter-ranges`);
  return response.json();
}

// ============================================================================
// AI Suggestions API (Sprint 2 - Suggestion Service)
// ============================================================================

export async function analyzeSession(
  sessionId: string,
  model?: string
): Promise<SuggestionAnalysisResponse> {
  const response = await fetch(`${API_BASE}/suggestions/sessions/${sessionId}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to analyze session");
  }
  
  return response.json();
}

export async function analyzeBatch(
  batchId: string,
  maxConcurrent: number = 10,
  model?: string
): Promise<SuggestionAnalysisResponse> {
  const response = await fetch(`${API_BASE}/suggestions/batches/${batchId}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ max_concurrent: maxConcurrent, model }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to analyze batch");
  }
  
  return response.json();
}

export async function fetchSessionSuggestions(sessionId: string): Promise<TraceSuggestion[]> {
  const response = await fetch(`${API_BASE}/suggestions/sessions/${sessionId}`);
  return response.json();
}

export async function fetchBatchSuggestions(batchId: string): Promise<TraceSuggestion[]> {
  const response = await fetch(`${API_BASE}/suggestions/batches/${batchId}`);
  return response.json();
}

export async function fetchPendingSuggestions(
  batchId?: string,
  minConfidence: number = 0.6
): Promise<TraceSuggestion[]> {
  const params = new URLSearchParams();
  if (batchId) params.append("batch_id", batchId);
  params.append("min_confidence", String(minConfidence));
  
  const response = await fetch(`${API_BASE}/suggestions/pending?${params}`);
  return response.json();
}

export async function fetchSuggestionStats(batchId?: string): Promise<SuggestionStats> {
  const params = batchId ? `?batch_id=${batchId}` : "";
  const response = await fetch(`${API_BASE}/suggestions/stats${params}`);
  return response.json();
}

export async function acceptSuggestion(
  suggestionId: string,
  editedText?: string,
  failureModeId?: string
): Promise<AcceptSuggestionResult> {
  const response = await fetch(`${API_BASE}/suggestions/${suggestionId}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      edited_text: editedText,
      failure_mode_id: failureModeId 
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to accept suggestion");
  }
  
  return response.json();
}

export async function skipSuggestion(suggestionId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/suggestions/${suggestionId}/skip`, {
    method: "POST",
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to skip suggestion");
  }
}

export async function rejectSuggestion(suggestionId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/suggestions/${suggestionId}/reject`, {
    method: "POST",
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to reject suggestion");
  }
}

export async function bulkAcceptSuggestions(suggestionIds: string[]): Promise<{
  accepted: number;
  failed: number;
  notes_created: AcceptSuggestionResult[];
}> {
  const response = await fetch(`${API_BASE}/suggestions/bulk-accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ suggestion_ids: suggestionIds }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to bulk accept suggestions");
  }
  
  return response.json();
}

export async function bulkRejectSuggestions(suggestionIds: string[]): Promise<{
  rejected: number;
  failed: number;
}> {
  const response = await fetch(`${API_BASE}/suggestions/bulk-reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ suggestion_ids: suggestionIds }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to bulk reject suggestions");
  }
  
  return response.json();
}

export async function bulkSkipSuggestions(suggestionIds: string[]): Promise<{
  skipped: number;
  failed: number;
}> {
  const response = await fetch(`${API_BASE}/suggestions/bulk-skip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ suggestion_ids: suggestionIds }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to bulk skip suggestions");
  }
  
  return response.json();
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
  
  const response = await fetch(`${API_BASE}/suggestions/history?${params}`);
  return response.json();
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
  const response = await fetch(`${API_BASE}/prompts`);
  return response.json();
}

export async function fetchPromptsByFeature(feature: string): Promise<{ prompts: PromptConfig[] }> {
  const response = await fetch(`${API_BASE}/prompts/by-feature/${feature}`);
  return response.json();
}

export async function fetchPrompt(promptId: string): Promise<PromptConfig> {
  const response = await fetch(`${API_BASE}/prompts/${promptId}`);
  if (!response.ok) {
    throw new Error("Prompt not found");
  }
  return response.json();
}

export async function updatePrompt(
  promptId: string,
  systemPrompt: string | null,
  userPromptTemplate: string
): Promise<PromptConfig> {
  const response = await fetch(`${API_BASE}/prompts/${promptId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_prompt: systemPrompt,
      user_prompt_template: userPromptTemplate,
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to update prompt");
  }
  
  return response.json();
}

export async function resetPrompt(promptId: string): Promise<PromptConfig> {
  const response = await fetch(`${API_BASE}/prompts/${promptId}/reset`, {
    method: "POST",
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to reset prompt");
  }
  
  return response.json();
}

export async function fetchPromptVersions(promptId: string): Promise<PromptVersionsResponse> {
  const response = await fetch(`${API_BASE}/prompts/${promptId}/versions`);
  if (!response.ok) {
    throw new Error("Failed to fetch prompt versions");
  }
  return response.json();
}

export async function setPromptVersion(promptId: string, version: string): Promise<PromptConfig> {
  const response = await fetch(`${API_BASE}/prompts/${promptId}/set-version`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to switch version");
  }
  
  return response.json();
}

