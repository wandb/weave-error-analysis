import type {
  Thread,
  ThreadDetail,
  FeedbackSummary,
  AnnotationProgress,
  Agent,
  AgentDetail,
  ConnectionTestResult,
  Taxonomy,
  AISuggestion,
  Dimension,
  SyntheticBatch,
  BatchDetail,
  AutoReview,
  SettingsGroup,
  ConfigStatus,
  TestConnectionResult,
  Session,
  SessionDetail,
  SessionListResponse,
  SyncStatus,
  SessionStats,
  BatchReviewProgress,
  SessionFilters,
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
// Thread API
// ============================================================================

export interface FetchThreadsParams {
  limit?: number;
  sortBy?: string;
  sortDirection?: string;
  filterMinTurns?: number | null;
  filterReviewed?: boolean | null;
  filterBatchId?: string | null;
  sample?: string;
  sampleSize?: number;
}

export async function fetchThreads(params: FetchThreadsParams = {}): Promise<Thread[]> {
  const urlParams = new URLSearchParams({
    limit: String(params.limit ?? 100),
    sort_by: params.sortBy ?? "last_updated",
    direction: params.sortDirection ?? "desc",
  });

  if (params.filterMinTurns != null) {
    urlParams.append("min_turns", params.filterMinTurns.toString());
  }
  if (params.filterReviewed != null) {
    urlParams.append("reviewed", params.filterReviewed.toString());
  }
  if (params.filterBatchId != null) {
    urlParams.append("batch_id", params.filterBatchId);
  }
  if (params.sample) {
    urlParams.append("sample", params.sample);
    if (params.sampleSize) {
      urlParams.append("sample_size", params.sampleSize.toString());
    }
  }

  const response = await fetch(`${API_BASE}/threads?${urlParams}`);
  const data = await response.json();
  return data.threads || [];
}

export async function fetchThreadDetail(threadId: string): Promise<ThreadDetail> {
  const response = await fetch(`${API_BASE}/threads/${threadId}`);
  return response.json();
}

export async function markThreadReviewed(threadId: string): Promise<void> {
  await fetch(`${API_BASE}/threads/${threadId}/mark-reviewed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function unmarkThreadReviewed(threadId: string): Promise<void> {
  await fetch(`${API_BASE}/threads/${threadId}/mark-reviewed`, {
    method: "DELETE",
  });
}

export async function addNoteToThread(threadId: string, note: string): Promise<void> {
  await fetch(`${API_BASE}/threads/${threadId}/note`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
}

export async function fetchFeedbackSummary(): Promise<FeedbackSummary> {
  const response = await fetch(`${API_BASE}/feedback-summary`);
  return response.json();
}

export async function fetchAnnotationProgress(): Promise<AnnotationProgress> {
  const response = await fetch(`${API_BASE}/annotation-progress`);
  return response.json();
}

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
// Auto Review API
// ============================================================================

export interface AutoReviewConfig {
  model?: string;
  max_concurrent_llm_calls?: number;
}

export async function runAutoReview(
  batchId: string,
  config: AutoReviewConfig = {}
): Promise<AutoReview> {
  const response = await fetch(`${API_BASE}/synthetic/batches/${batchId}/auto-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model || "gemini/gemini-2.5-pro",
      max_concurrent_llm_calls: config.max_concurrent_llm_calls || 10,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to run auto-review");
  }

  return response.json();
}

export async function fetchBatchReviews(batchId: string): Promise<AutoReview[]> {
  const response = await fetch(`${API_BASE}/synthetic/batches/${batchId}/reviews`);
  return response.json();
}

export async function fetchLatestReview(batchId: string): Promise<AutoReview | null> {
  try {
    const response = await fetch(`${API_BASE}/synthetic/batches/${batchId}/reviews/latest`);
    if (response.status === 404) {
      return null;
    }
    return response.json();
  } catch {
    return null;
  }
}

export async function fetchReview(reviewId: string): Promise<AutoReview> {
  const response = await fetch(`${API_BASE}/synthetic/reviews/${reviewId}`);
  if (!response.ok) {
    throw new Error("Review not found");
  }
  return response.json();
}

export async function deleteReview(reviewId: string): Promise<void> {
  await fetch(`${API_BASE}/synthetic/reviews/${reviewId}`, { method: "DELETE" });
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

