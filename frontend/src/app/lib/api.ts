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
  FailureMode,
  FailureModeStatus,
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

// =============================================================================
// Request Deduplication & Caching
// =============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

interface PendingRequest<T> {
  promise: Promise<T>;
  abortController: AbortController;
}

/**
 * Request cache for GET requests.
 * - Deduplicates concurrent identical requests
 * - Caches responses for a configurable TTL
 * - Supports manual cache invalidation
 */
class RequestCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private pending = new Map<string, PendingRequest<unknown>>();
  private defaultTTL = 5000; // 5 seconds default cache

  /**
   * Get or fetch data with deduplication and caching
   */
  async getOrFetch<T>(
    key: string,
    fetcher: (signal: AbortSignal) => Promise<T>,
    options: { ttl?: number; skipCache?: boolean } = {}
  ): Promise<T> {
    const { ttl = this.defaultTTL, skipCache = false } = options;

    // Check cache first (unless skipped)
    if (!skipCache) {
      const cached = this.cache.get(key) as CacheEntry<T> | undefined;
      if (cached && Date.now() < cached.expiresAt) {
        logger.debug("cache.hit", { key });
        return cached.data;
      }
    }

    // Check for pending request (deduplication)
    const pendingRequest = this.pending.get(key) as PendingRequest<T> | undefined;
    if (pendingRequest) {
      logger.debug("request.deduplicated", { key });
      return pendingRequest.promise;
    }

    // Create new request with AbortController
    const abortController = new AbortController();
    const promise = fetcher(abortController.signal)
      .then((data) => {
        // Cache successful response
        this.cache.set(key, {
          data,
          timestamp: Date.now(),
          expiresAt: Date.now() + ttl,
        });
        return data;
      })
      .finally(() => {
        // Remove from pending
        this.pending.delete(key);
      });

    this.pending.set(key, { promise, abortController });
    return promise;
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  invalidate(pattern?: string | RegExp): void {
    if (!pattern) {
      this.cache.clear();
      logger.debug("cache.cleared");
      return;
    }

    const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
    const keysToDelete: string[] = [];
    this.cache.forEach((_, key) => {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach((key) => this.cache.delete(key));
    logger.debug("cache.invalidated", { pattern: pattern.toString() });
  }

  /**
   * Cancel pending requests matching a pattern
   */
  cancelPending(pattern?: string | RegExp): void {
    if (!pattern) {
      this.pending.forEach(({ abortController }) => {
        abortController.abort();
      });
      this.pending.clear();
      return;
    }

    const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
    const keysToDelete: string[] = [];
    this.pending.forEach(({ abortController }, key) => {
      if (regex.test(key)) {
        abortController.abort();
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach((key) => this.pending.delete(key));
  }

  /**
   * Get cache statistics for debugging
   */
  getStats(): { cacheSize: number; pendingCount: number } {
    return {
      cacheSize: this.cache.size,
      pendingCount: this.pending.size,
    };
  }
}

// Global cache instance
export const requestCache = new RequestCache();

// =============================================================================
// API Call Wrapper with Deduplication
// =============================================================================

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
 * Cached GET request with deduplication.
 * Use this for read-only endpoints that can be cached.
 * 
 * @param url - API endpoint
 * @param options - Cache options (ttl in ms, skipCache to bypass)
 */
async function cachedGet<T>(
  url: string,
  options: { ttl?: number; skipCache?: boolean } = {}
): Promise<T> {
  return requestCache.getOrFetch<T>(
    url,
    async (signal) => {
      const response = await fetch(url, { signal });
      
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ detail: "Request failed" }));
        const message = errorBody.detail || errorBody.message || `HTTP ${response.status}`;
        throw new ApiError(response.status, message, url);
      }
      
      return response.json();
    },
    options
  );
}

/**
 * Invalidate cache for specific patterns after mutations.
 * Call after POST/PUT/DELETE operations that affect cached data.
 */
export function invalidateCache(pattern?: string | RegExp): void {
  requestCache.invalidate(pattern);
}

/**
 * Cancel pending requests when component unmounts or user navigates away.
 */
export function cancelPendingRequests(pattern?: string | RegExp): void {
  requestCache.cancelPending(pattern);
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
// Cache TTL Constants
// ============================================================================

const CACHE_TTL = {
  SHORT: 5_000,      // 5 seconds - for frequently changing data
  MEDIUM: 30_000,    // 30 seconds - for moderately stable data
  LONG: 60_000,      // 1 minute - for stable reference data
} as const;

// ============================================================================
// Feedback API (used by header stats)
// ============================================================================

export async function fetchFeedbackSummary(): Promise<FeedbackSummary> {
  return cachedGet(`${API_BASE}/feedback-summary`, { ttl: CACHE_TTL.SHORT });
}

// Note: fetchAnnotationProgress was removed - use session stats or batch review progress instead

// ============================================================================
// Agent API
// ============================================================================

export async function fetchAgents(): Promise<Agent[]> {
  return cachedGet(`${API_BASE}/agents`, { ttl: CACHE_TTL.MEDIUM });
}

export async function fetchAgentDetail(agentId: string): Promise<AgentDetail> {
  return cachedGet(`${API_BASE}/agents/${agentId}`, { ttl: CACHE_TTL.SHORT });
}

export async function testAgentConnection(agentId: string): Promise<ConnectionTestResult> {
  return apiCall(`${API_BASE}/agents/${agentId}/test-connection`, { method: "POST" });
}

export async function createAgent(
  name: string,
  endpointUrl: string,
  agentContext: string,
  weaveProject?: string
): Promise<Agent> {
  const result = await apiCall<Agent>(`${API_BASE}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      endpoint_url: endpointUrl,
      agent_context: agentContext,
      weave_project: weaveProject || null,
    }),
  });
  invalidateCache(/\/agents/);
  return result;
}

export async function updateAgent(
  agentId: string,
  updates: { 
    name?: string; 
    endpoint_url?: string; 
    agent_context?: string;
    weave_project?: string;
  }
): Promise<Agent> {
  const result = await apiCall<Agent>(`${API_BASE}/agents/${agentId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  invalidateCache(/\/agents/);
  return result;
}

export async function deleteAgent(agentId: string): Promise<void> {
  await apiCall(`${API_BASE}/agents/${agentId}`, { method: "DELETE" });
  invalidateCache(/\/agents/);
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

export async function fetchTaxonomy(agentId?: string): Promise<Taxonomy> {
  const params = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
  return cachedGet(`${API_BASE}/taxonomy${params}`, { ttl: CACHE_TTL.SHORT });
}

export async function syncNotesFromWeave(agentId?: string): Promise<{ synced: number }> {
  const params = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
  return apiCall(`${API_BASE}/taxonomy/notes/sync${params}`, { method: "POST" });
}

export async function autoCategorize(agentId?: string): Promise<{ categorized: number }> {
  return apiCall(`${API_BASE}/taxonomy/auto-categorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: agentId || null }),
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

export async function fetchSaturationHistory(agentId?: string): Promise<SaturationHistory> {
  const params = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
  return apiCall(`${API_BASE}/taxonomy/saturation-history${params}`);
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

export async function fetchBatchSaturation(agentId?: string): Promise<BatchSaturationResponse> {
  const params = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
  return apiCall(`${API_BASE}/taxonomy/saturation-by-batch${params}`);
}

export async function suggestCategoryForNote(noteId: string, agentId?: string): Promise<AISuggestion> {
  const params = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
  return apiCall(`${API_BASE}/taxonomy/notes/${noteId}/suggest${params}`, { method: "POST" });
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
  suggestedFix?: string,
  agentId?: string
): Promise<{ id: string }> {
  const result = await apiCall<{ id: string }>(`${API_BASE}/taxonomy/failure-modes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      description,
      severity,
      suggested_fix: suggestedFix,
      agent_id: agentId || null,
    }),
  });
  invalidateCache(/\/taxonomy/);
  return result;
}

export async function deleteFailureMode(modeId: string): Promise<void> {
  await apiCall(`${API_BASE}/taxonomy/failure-modes/${modeId}`, { method: "DELETE" });
  invalidateCache(/\/taxonomy/);
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
  const result = await apiCall<FailureMode>(`${API_BASE}/taxonomy/failure-modes/${modeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  invalidateCache(/\/taxonomy/);
  return result;
}

export async function updateFailureModeStatus(
  modeId: string,
  status: FailureModeStatus
): Promise<FailureMode> {
  const result = await apiCall<FailureMode>(`${API_BASE}/taxonomy/failure-modes/${modeId}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  invalidateCache(/\/taxonomy/);
  return result;
}

export async function mergeFailureModes(
  sourceId: string,
  targetId: string,
  newName?: string,
  newDescription?: string
): Promise<FailureMode> {
  const result = await apiCall<FailureMode>(`${API_BASE}/taxonomy/failure-modes/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_id: sourceId,
      target_id: targetId,
      new_name: newName,
      new_description: newDescription,
    }),
  });
  invalidateCache(/\/taxonomy/);
  return result;
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

export async function batchSuggestCategories(noteIds?: string[], agentId?: string): Promise<BatchSuggestResult> {
  return apiCall(`${API_BASE}/taxonomy/batch-suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note_ids: noteIds || null, agent_id: agentId || null }),
  });
}

export async function batchApplyCategories(
  assignments: BatchApplyAssignment[],
  agentId?: string
): Promise<BatchApplyResult> {
  return apiCall(`${API_BASE}/taxonomy/batch-apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignments, agent_id: agentId || null }),
  });
}

// ============================================================================
// Synthetic Data API
// ============================================================================

export async function fetchDimensions(agentId: string): Promise<Dimension[]> {
  return cachedGet(`${API_BASE}/agents/${agentId}/dimensions`, { ttl: CACHE_TTL.MEDIUM });
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
  invalidateCache(new RegExp(`/agents/${agentId}/dimensions`));
}

export async function deleteDimension(agentId: string, dimName: string): Promise<void> {
  await apiCall(`${API_BASE}/agents/${agentId}/dimensions/${dimName}`, {
    method: "DELETE",
  });
  invalidateCache(new RegExp(`/agents/${agentId}/dimensions`));
}

// ============================================================================
// LLM-Powered Dimension Suggestion API
// ============================================================================

export interface SuggestedValue {
  id: string;
  label: string;
}

export interface SuggestedDimension {
  name: string;
  description?: string;
  values: SuggestedValue[];
}

export interface SuggestDimensionsResponse {
  dimensions: SuggestedDimension[];
}

export interface SuggestValuesResponse {
  dimension_name: string;
  new_values: SuggestedValue[];
}

export async function suggestDimensions(
  agentId: string,
  testingGoals?: string,
  count: number = 4
): Promise<SuggestDimensionsResponse> {
  return apiCall(`${API_BASE}/agents/${agentId}/dimensions/suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ testing_goals: testingGoals, count }),
  });
}

export async function suggestBucketValues(
  agentId: string,
  dimensionName: string,
  count: number = 5
): Promise<SuggestValuesResponse> {
  return apiCall(`${API_BASE}/agents/${agentId}/dimensions/${dimensionName}/suggest-values`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count }),
  });
}

export async function fetchBatches(agentId: string): Promise<SyntheticBatch[]> {
  return cachedGet(`${API_BASE}/synthetic/batches?agent_id=${agentId}`, { ttl: CACHE_TTL.SHORT });
}

export async function fetchBatchDetail(batchId: string): Promise<BatchDetail> {
  return cachedGet(`${API_BASE}/synthetic/batches/${batchId}`, { ttl: CACHE_TTL.SHORT });
}

export async function deleteBatch(batchId: string): Promise<void> {
  await apiCall(`${API_BASE}/synthetic/batches/${batchId}`, { method: "DELETE" });
  invalidateCache(/\/synthetic\/batches/);
  invalidateCache(/\/sessions/);
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
// Weave Integration API
// ============================================================================

export interface WeaveUrlResponse {
  url: string;
  batch_id: string;
  configured: boolean;
}

/**
 * Get a Weave deep link URL for reviewing batch traces.
 * Opens Weave's trace viewer pre-filtered to show only traces from this batch.
 */
export async function getBatchWeaveUrl(batchId: string): Promise<WeaveUrlResponse> {
  return apiCall(`${API_BASE}/synthetic/batches/${batchId}/weave-url`);
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
  const data = await cachedGet<{ groups: SettingsGroup[] }>(`${API_BASE}/settings/grouped`, { ttl: CACHE_TTL.LONG });
  return data.groups;
}

export async function fetchConfigStatus(): Promise<ConfigStatus> {
  return cachedGet(`${API_BASE}/settings/status`, { ttl: CACHE_TTL.MEDIUM });
}

export async function updateSetting(key: string, value: string): Promise<void> {
  logger.info("setting.update_start", { key });
  
  try {
    await apiCall(`${API_BASE}/settings/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    invalidateCache(/\/settings/);
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
  invalidateCache(/\/settings/);
}

export async function resetSetting(key: string): Promise<void> {
  await apiCall(`${API_BASE}/settings/${key}`, { method: "DELETE" });
  invalidateCache(/\/settings/);
}

export async function testLLMConnection(): Promise<TestConnectionResult> {
  logger.info("llm.test_start");
  
  const result = await apiCall<TestConnectionResult>(`${API_BASE}/settings/test-llm`, {
    method: "POST",
  });
  
  logger.info("llm.test_complete", { 
    success: result.success, 
    model: result.model,
  });
  
  return result;
}

export async function testWeaveConnection(): Promise<TestConnectionResult> {
  return apiCall(`${API_BASE}/settings/test-weave`, { method: "POST" });
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
  return cachedGet(`${API_BASE}/prompts`, { ttl: CACHE_TTL.LONG });
}

export async function fetchPromptsByFeature(feature: string): Promise<{ prompts: PromptConfig[] }> {
  return cachedGet(`${API_BASE}/prompts/by-feature/${feature}`, { ttl: CACHE_TTL.LONG });
}

export async function fetchPrompt(promptId: string): Promise<PromptConfig> {
  return cachedGet(`${API_BASE}/prompts/${promptId}`, { ttl: CACHE_TTL.MEDIUM });
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
  
  const result = await apiCall<PromptConfig>(`${API_BASE}/prompts/${promptId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  invalidateCache(/\/prompts/);
  return result;
}

export async function resetPrompt(promptId: string): Promise<PromptConfig> {
  const result = await apiCall<PromptConfig>(`${API_BASE}/prompts/${promptId}/reset`, { method: "POST" });
  invalidateCache(/\/prompts/);
  return result;
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

