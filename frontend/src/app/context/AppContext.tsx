"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import type {
  TabType,
  Thread,
  ThreadDetail,
  FeedbackSummary,
  AnnotationProgress,
  Agent,
  AgentDetail,
  Taxonomy,
  Dimension,
  SyntheticBatch,
  BatchDetail,
  ExecutionProgress,
  GenerationProgress,
  ConnectionTestResult,
  ToolCall,
  PlaygroundEvent,
  Session,
  SessionDetail,
  SyncStatus,
  BatchReviewProgress,
} from "../types";
import * as api from "../lib/api";

// ============================================================================
// Context Types
// ============================================================================

interface AppState {
  // Navigation
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;

  // Sessions (Legacy - Thread-based)
  threads: Thread[];
  selectedThread: ThreadDetail | null;
  feedbackSummary: FeedbackSummary | null;
  annotationProgress: AnnotationProgress | null;
  loadingThreads: boolean;
  loadingDetail: boolean;

  // Sessions (New - Local DB based)
  sessions: Session[];
  selectedSession: SessionDetail | null;
  syncStatus: SyncStatus | null;
  batchReviewProgress: BatchReviewProgress | null;
  loadingSessions: boolean;
  loadingSessionDetail: boolean;

  // Session Filters
  sortBy: string;
  setSortBy: (s: string) => void;
  sortDirection: string;
  setSortDirection: (s: string | ((prev: string) => string)) => void;
  filterMinTurns: number | null;
  setFilterMinTurns: (n: number | null) => void;
  filterMaxTurns: number | null;
  setFilterMaxTurns: (n: number | null) => void;
  filterReviewed: boolean | null;
  setFilterReviewed: (b: boolean | null) => void;
  filterHasError: boolean | null;
  setFilterHasError: (b: boolean | null) => void;
  filterBatchId: string | null;
  setFilterBatchId: (s: string | null) => void;
  filterBatchName: string | null;
  setFilterBatchName: (s: string | null) => void;
  filterModel: string | null;
  setFilterModel: (s: string | null) => void;
  searchQuery: string;
  setSearchQuery: (s: string) => void;

  // Session Actions (Legacy)
  fetchThreads: () => Promise<void>;
  fetchRandomSample: (size?: number) => Promise<void>;
  fetchThreadDetail: (threadId: string) => Promise<void>;
  markThreadReviewed: (threadId: string) => Promise<void>;
  unmarkThreadReviewed: (threadId: string) => Promise<void>;
  addNoteToThread: (threadId: string, note: string) => Promise<void>;

  // Session Actions (New - Local DB)
  fetchSessions: () => Promise<void>;
  fetchSessionDetail: (sessionId: string) => Promise<void>;
  markSessionReviewed: (sessionId: string) => Promise<void>;
  unmarkSessionReviewed: (sessionId: string) => Promise<void>;
  addSessionNote: (sessionId: string, content: string, noteType?: string) => Promise<void>;
  triggerSync: (fullSync?: boolean) => Promise<void>;
  refreshSyncStatus: () => Promise<SyncStatus | null>;

  // Agents
  agents: Agent[];
  selectedAgent: AgentDetail | null;
  loadingAgents: boolean;
  connectionResult: ConnectionTestResult | null;

  // Agent Actions
  fetchAgents: () => Promise<void>;
  fetchAgentDetail: (agentId: string) => Promise<void>;
  selectAgentWithData: (agent: Agent) => Promise<void>;
  testAgentConnection: (agentId: string) => Promise<void>;
  createAgent: (name: string, endpoint: string, info: string) => Promise<void>;
  updateAgent: (id: string, name: string, endpoint: string, info: string) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  setSelectedAgent: (agent: AgentDetail | null) => void;

  // Taxonomy
  taxonomy: Taxonomy | null;
  loadingTaxonomy: boolean;
  syncing: boolean;
  categorizing: boolean;

  // Taxonomy Actions
  fetchTaxonomy: () => Promise<void>;
  syncNotesFromWeave: () => Promise<void>;
  autoCategorize: () => Promise<void>;
  createFailureMode: (name: string, desc: string, severity: string) => Promise<{ id: string }>;
  deleteFailureMode: (modeId: string) => Promise<void>;

  // Synthetic Data
  dimensions: Dimension[];
  loadingDimensions: boolean;
  syntheticBatches: SyntheticBatch[];
  selectedBatch: BatchDetail | null;
  generatingBatch: boolean;
  generationProgress: GenerationProgress | null;

  // Synthetic Actions
  fetchDimensions: (agentId: string) => Promise<void>;
  importDimensions: (agentId: string) => Promise<void>;
  fetchBatches: (agentId: string) => Promise<void>;
  fetchBatchDetail: (batchId: string) => Promise<void>;
  setSelectedBatch: (batch: BatchDetail | null) => void;
  deleteBatch: (batchId: string, agentId: string) => Promise<void>;

  // Batch Execution
  executingBatch: boolean;
  executionProgress: ExecutionProgress | null;

  // Playground
  playgroundRunning: boolean;
  playgroundResponse: string;
  playgroundToolCalls: ToolCall[];
  playgroundError: string | null;
  playgroundEvents: PlaygroundEvent[];
  resetPlayground: () => void;
}

const AppContext = createContext<AppState | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

// ============================================================================
// Provider
// ============================================================================

export function AppProvider({ children }: { children: ReactNode }) {
  // Navigation
  // Start with Agents tab - first step in the workflow
  const [activeTab, setActiveTab] = useState<TabType>("agents");

  // Sessions state (Legacy - Thread-based)
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<ThreadDetail | null>(null);
  const [feedbackSummary, setFeedbackSummary] = useState<FeedbackSummary | null>(null);
  const [annotationProgress, setAnnotationProgress] = useState<AnnotationProgress | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Sessions state (New - Local DB based)
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [batchReviewProgress, setBatchReviewProgress] = useState<BatchReviewProgress | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingSessionDetail, setLoadingSessionDetail] = useState(false);

  // Session Filters
  const [sortBy, setSortBy] = useState("started_at");
  const [sortDirection, setSortDirection] = useState("desc");
  const [filterMinTurns, setFilterMinTurns] = useState<number | null>(null);
  const [filterMaxTurns, setFilterMaxTurns] = useState<number | null>(null);
  const [filterReviewed, setFilterReviewed] = useState<boolean | null>(null);
  const [filterHasError, setFilterHasError] = useState<boolean | null>(null);
  const [filterBatchId, setFilterBatchId] = useState<string | null>(null);
  const [filterBatchName, setFilterBatchName] = useState<string | null>(null);
  const [filterModel, setFilterModel] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Sync status polling ref
  const syncPollRef = useRef<NodeJS.Timeout | null>(null);

  // Agents state
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentDetail | null>(null);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [connectionResult, setConnectionResult] = useState<ConnectionTestResult | null>(null);

  // Taxonomy state
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [loadingTaxonomy, setLoadingTaxonomy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [categorizing, setCategorizing] = useState(false);

  // Synthetic state
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [loadingDimensions, setLoadingDimensions] = useState(false);
  const [syntheticBatches, setSyntheticBatches] = useState<SyntheticBatch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<BatchDetail | null>(null);
  const [generatingBatch, setGeneratingBatch] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);

  // Execution state
  const [executingBatch, setExecutingBatch] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<ExecutionProgress | null>(null);

  // Playground state
  const [playgroundRunning, setPlaygroundRunning] = useState(false);
  const [playgroundResponse, setPlaygroundResponse] = useState("");
  const [playgroundToolCalls, setPlaygroundToolCalls] = useState<ToolCall[]>([]);
  const [playgroundError, setPlaygroundError] = useState<string | null>(null);
  const [playgroundEvents, setPlaygroundEvents] = useState<PlaygroundEvent[]>([]);

  // ============================================================================
  // Session Actions
  // ============================================================================

  const fetchThreads = useCallback(async () => {
    setLoadingThreads(true);
    try {
      const data = await api.fetchThreads({
        sortBy,
        sortDirection,
        filterMinTurns,
        filterReviewed,
        filterBatchId,
      });
      setThreads(data);
    } catch (error) {
      console.error("Error fetching threads:", error);
    } finally {
      setLoadingThreads(false);
    }
  }, [sortBy, sortDirection, filterMinTurns, filterReviewed, filterBatchId]);

  const fetchRandomSample = async (size: number = 20) => {
    setLoadingThreads(true);
    try {
      const data = await api.fetchThreads({ sample: "random", sampleSize: size });
      setThreads(data);
    } catch (error) {
      console.error("Error fetching random sample:", error);
    } finally {
      setLoadingThreads(false);
    }
  };

  const fetchFeedbackSummaryData = useCallback(async () => {
    try {
      const data = await api.fetchFeedbackSummary();
      setFeedbackSummary(data);
    } catch (error) {
      console.error("Error fetching feedback summary:", error);
    }
  }, []);

  const fetchAnnotationProgressData = useCallback(async () => {
    try {
      const data = await api.fetchAnnotationProgress();
      setAnnotationProgress(data);
    } catch (error) {
      console.error("Error fetching annotation progress:", error);
    }
  }, []);

  const fetchThreadDetail = async (threadId: string) => {
    setLoadingDetail(true);
    try {
      const data = await api.fetchThreadDetail(threadId);
      setSelectedThread(data);
    } catch (error) {
      console.error("Error fetching thread detail:", error);
    } finally {
      setLoadingDetail(false);
    }
  };

  const markThreadReviewed = async (threadId: string) => {
    try {
      await api.markThreadReviewed(threadId);
      setSelectedThread((prev) => (prev ? { ...prev, is_reviewed: true } : null));
      setThreads((prev) =>
        prev.map((t) => (t.thread_id === threadId ? { ...t, is_reviewed: true } : t))
      );
      fetchAnnotationProgressData();
    } catch (error) {
      console.error("Error marking thread as reviewed:", error);
    }
  };

  const unmarkThreadReviewed = async (threadId: string) => {
    try {
      await api.unmarkThreadReviewed(threadId);
      setSelectedThread((prev) => (prev ? { ...prev, is_reviewed: false } : null));
      setThreads((prev) =>
        prev.map((t) => (t.thread_id === threadId ? { ...t, is_reviewed: false } : t))
      );
      fetchAnnotationProgressData();
    } catch (error) {
      console.error("Error unmarking thread as reviewed:", error);
    }
  };

  const addNoteToThread = async (threadId: string, note: string) => {
    if (!note.trim()) return;
    try {
      await api.addNoteToThread(threadId, note);
      fetchFeedbackSummaryData();
    } catch (error) {
      console.error("Error adding note:", error);
    }
  };

  // ============================================================================
  // Session Actions (New - Local DB based)
  // ============================================================================

  const fetchSessionsData = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const data = await api.fetchSessions({
        sort_by: sortBy,
        direction: sortDirection,
        min_turns: filterMinTurns,
        max_turns: filterMaxTurns,
        is_reviewed: filterReviewed,
        has_error: filterHasError,
        batch_id: filterBatchId,
        primary_model: filterModel,
        limit: 100,
      });
      setSessions(data.sessions);
      
      // Fetch batch review progress if filtering by batch
      if (filterBatchId) {
        try {
          const progress = await api.fetchBatchReviewProgress(filterBatchId);
          setBatchReviewProgress(progress);
        } catch {
          setBatchReviewProgress(null);
        }
      } else {
        setBatchReviewProgress(null);
      }
    } catch (error) {
      console.error("Error fetching sessions:", error);
    } finally {
      setLoadingSessions(false);
    }
  }, [sortBy, sortDirection, filterMinTurns, filterMaxTurns, filterReviewed, filterHasError, filterBatchId, filterModel]);

  const fetchSessionDetailData = async (sessionId: string) => {
    setLoadingSessionDetail(true);
    try {
      const data = await api.fetchSessionDetail(sessionId);
      setSelectedSession(data);
    } catch (error) {
      console.error("Error fetching session detail:", error);
    } finally {
      setLoadingSessionDetail(false);
    }
  };

  const markSessionReviewedAction = async (sessionId: string) => {
    try {
      await api.markSessionReviewed(sessionId);
      setSelectedSession((prev) => (prev ? { ...prev, is_reviewed: true } : null));
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, is_reviewed: true } : s))
      );
      // Refresh batch progress if applicable
      if (filterBatchId) {
        const progress = await api.fetchBatchReviewProgress(filterBatchId);
        setBatchReviewProgress(progress);
      }
    } catch (error) {
      console.error("Error marking session as reviewed:", error);
    }
  };

  const unmarkSessionReviewedAction = async (sessionId: string) => {
    try {
      await api.unmarkSessionReviewed(sessionId);
      setSelectedSession((prev) => (prev ? { ...prev, is_reviewed: false } : null));
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, is_reviewed: false } : s))
      );
      // Refresh batch progress if applicable
      if (filterBatchId) {
        const progress = await api.fetchBatchReviewProgress(filterBatchId);
        setBatchReviewProgress(progress);
      }
    } catch (error) {
      console.error("Error unmarking session as reviewed:", error);
    }
  };

  const addSessionNoteAction = async (sessionId: string, content: string, noteType: string = "observation") => {
    if (!content.trim()) return;
    try {
      await api.createSessionNote(sessionId, content, noteType);
      // Refresh session detail to show new note
      if (selectedSession?.id === sessionId) {
        await fetchSessionDetailData(sessionId);
      }
    } catch (error) {
      console.error("Error adding session note:", error);
    }
  };

  const refreshSyncStatusData = useCallback(async () => {
    try {
      const status = await api.fetchSyncStatus();
      setSyncStatus(status);
      return status;
    } catch (error) {
      console.error("Error fetching sync status:", error);
      return null;
    }
  }, []);

  const triggerSyncAction = async (fullSync: boolean = false) => {
    try {
      await api.triggerSync(fullSync, filterBatchId ?? undefined);
      // Start polling for sync status
      refreshSyncStatusData();
      
      // Poll while syncing
      if (syncPollRef.current) clearInterval(syncPollRef.current);
      syncPollRef.current = setInterval(async () => {
        const status = await refreshSyncStatusData();
        if (status && !status.is_syncing) {
          if (syncPollRef.current) clearInterval(syncPollRef.current);
          // Refresh sessions after sync completes
          fetchSessionsData();
        }
      }, 2000);
    } catch (error) {
      console.error("Error triggering sync:", error);
    }
  };

  // ============================================================================
  // Agent Actions
  // ============================================================================

  const fetchAgentsData = useCallback(async () => {
    setLoadingAgents(true);
    try {
      const data = await api.fetchAgents();
      setAgents(data);
    } catch (error) {
      console.error("Error fetching agents:", error);
    } finally {
      setLoadingAgents(false);
    }
  }, []);

  const fetchAgentDetailData = async (agentId: string) => {
    try {
      const data = await api.fetchAgentDetail(agentId);
      setSelectedAgent(data);
      // Load dimensions and batches in parallel for faster loading
      await Promise.all([
        fetchDimensionsData(agentId),
        fetchBatchesData(agentId)
      ]);
    } catch (error) {
      console.error("Error fetching agent detail:", error);
    }
  };

  // Unified agent selection with automatic data loading
  // Use this when selecting an agent from a list (not fetching full details)
  const selectAgentWithData = async (agent: Agent) => {
    // If we already have this agent selected with full details, just ensure data is loaded
    if (selectedAgent?.id === agent.id) {
      // Already selected, but ensure dimensions and batches are loaded
      if (dimensions.length === 0 || syntheticBatches.length === 0) {
        await Promise.all([
          fetchDimensionsData(agent.id),
          fetchBatchesData(agent.id)
        ]);
      }
      return;
    }
    // Fetch full agent details and related data
    await fetchAgentDetailData(agent.id);
  };

  const testAgentConnectionAction = async (agentId: string) => {
    setConnectionResult(null);
    try {
      const result = await api.testAgentConnection(agentId);
      setConnectionResult(result);
      await fetchAgentsData();
    } catch (error) {
      setConnectionResult({
        success: false,
        status_code: null,
        response_time_ms: null,
        error: String(error),
      });
    }
  };

  const createAgentAction = async (name: string, endpoint: string, info: string) => {
    if (!name || !endpoint || !info) return;
    await api.createAgent(name, endpoint, info);
    await fetchAgentsData();
  };

  const updateAgentAction = async (
    id: string,
    name: string,
    endpoint: string,
    info: string
  ) => {
    const updates: Record<string, string> = {};
    if (name) updates.name = name;
    if (endpoint) updates.endpoint_url = endpoint;
    if (info) updates.agent_info_content = info;
    await api.updateAgent(id, updates);
    await fetchAgentsData();
    if (selectedAgent?.id === id) {
      await fetchAgentDetailData(id);
    }
  };

  const deleteAgentAction = async (agentId: string) => {
    await api.deleteAgent(agentId);
    await fetchAgentsData();
    if (selectedAgent?.id === agentId) {
      setSelectedAgent(null);
    }
  };

  // ============================================================================
  // Taxonomy Actions
  // ============================================================================

  const fetchTaxonomyData = useCallback(async () => {
    setLoadingTaxonomy(true);
    try {
      const data = await api.fetchTaxonomy();
      setTaxonomy(data);
    } catch (error) {
      console.error("Error fetching taxonomy:", error);
    } finally {
      setLoadingTaxonomy(false);
    }
  }, []);

  const syncNotesFromWeaveAction = async () => {
    setSyncing(true);
    try {
      await api.syncNotesFromWeave();
      await fetchTaxonomyData();
    } catch (error) {
      console.error("Error syncing notes:", error);
    } finally {
      setSyncing(false);
    }
  };

  const autoCategorizeAction = async () => {
    setCategorizing(true);
    try {
      await api.autoCategorize();
      await fetchTaxonomyData();
    } catch (error) {
      console.error("Error categorizing:", error);
    } finally {
      setCategorizing(false);
    }
  };

  const createFailureModeAction = async (
    name: string,
    desc: string,
    severity: string
  ) => {
    const result = await api.createFailureMode(name, desc, severity);
    await fetchTaxonomyData();
    return result;
  };

  const deleteFailureModeAction = async (modeId: string) => {
    await api.deleteFailureMode(modeId);
    await fetchTaxonomyData();
  };

  // ============================================================================
  // Synthetic Data Actions
  // ============================================================================

  const fetchDimensionsData = async (agentId: string) => {
    setLoadingDimensions(true);
    try {
      const data = await api.fetchDimensions(agentId);
      setDimensions(data || []);
    } catch (error) {
      console.error("Error fetching dimensions:", error);
    } finally {
      setLoadingDimensions(false);
    }
  };

  const importDimensionsAction = async (agentId: string) => {
    setLoadingDimensions(true);
    try {
      const data = await api.importDimensions(agentId);
      if (data.imported > 0) {
        setDimensions(data.dimensions || []);
      }
    } catch (error) {
      console.error("Error importing dimensions:", error);
    } finally {
      setLoadingDimensions(false);
    }
  };

  const fetchBatchesData = async (agentId: string) => {
    try {
      const data = await api.fetchBatches(agentId);
      setSyntheticBatches(data || []);
    } catch (error) {
      console.error("Error fetching batches:", error);
    }
  };

  const fetchBatchDetailData = async (batchId: string) => {
    try {
      const data = await api.fetchBatchDetail(batchId);
      setSelectedBatch(data);
    } catch (error) {
      console.error("Error fetching batch detail:", error);
    }
  };

  const deleteBatchAction = async (batchId: string, agentId: string) => {
    try {
      await api.deleteBatch(batchId);
      await fetchBatchesData(agentId);
      if (selectedBatch?.id === batchId) {
        setSelectedBatch(null);
      }
    } catch (error) {
      console.error("Error deleting batch:", error);
    }
  };

  // Playground
  const resetPlayground = () => {
    setPlaygroundResponse("");
    setPlaygroundToolCalls([]);
    setPlaygroundError(null);
    setPlaygroundEvents([]);
  };

  // ============================================================================
  // Effects
  // ============================================================================

  // Initial data load
  useEffect(() => {
    fetchThreads();
    fetchFeedbackSummaryData();
    fetchAnnotationProgressData();
  }, [fetchThreads, fetchFeedbackSummaryData, fetchAnnotationProgressData]);

  // Sessions tab - load from local DB
  useEffect(() => {
    if (activeTab === "sessions") {
      fetchSessionsData();
      refreshSyncStatusData();
    }
  }, [activeTab, fetchSessionsData, refreshSyncStatusData]);

  // Cleanup sync polling on unmount
  useEffect(() => {
    return () => {
      if (syncPollRef.current) clearInterval(syncPollRef.current);
    };
  }, []);

  useEffect(() => {
    if (activeTab === "taxonomy") {
      fetchTaxonomyData();
    } else if (activeTab === "agents" || activeTab === "synthetic" || activeTab === "runs") {
      // Only fetch agents if not already loaded (avoid redundant fetches on tab switch)
      if (agents.length === 0) {
        fetchAgentsData();
      }
    }
  }, [activeTab, fetchTaxonomyData, fetchAgentsData, agents.length]);

  // Automatically load agent data when switching to synthetic/runs tabs with a selected agent
  useEffect(() => {
    if ((activeTab === "synthetic" || activeTab === "runs") && selectedAgent) {
      // Load dimensions and batches if not already loaded
      const needsDimensions = dimensions.length === 0;
      const needsBatches = syntheticBatches.length === 0;
      
      if (needsDimensions || needsBatches) {
        Promise.all([
          needsDimensions ? fetchDimensionsData(selectedAgent.id) : Promise.resolve(),
          needsBatches ? fetchBatchesData(selectedAgent.id) : Promise.resolve()
        ]);
      }
    }
  }, [activeTab, selectedAgent, dimensions.length, syntheticBatches.length]);

  // ============================================================================
  // Context Value
  // ============================================================================

  const value: AppState = {
    activeTab,
    setActiveTab,

    // Legacy thread-based
    threads,
    selectedThread,
    feedbackSummary,
    annotationProgress,
    loadingThreads,
    loadingDetail,

    // New local DB sessions
    sessions,
    selectedSession,
    syncStatus,
    batchReviewProgress,
    loadingSessions,
    loadingSessionDetail,

    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
    filterMinTurns,
    setFilterMinTurns,
    filterMaxTurns,
    setFilterMaxTurns,
    filterReviewed,
    setFilterReviewed,
    filterHasError,
    setFilterHasError,
    filterBatchId,
    setFilterBatchId,
    filterBatchName,
    setFilterBatchName,
    filterModel,
    setFilterModel,
    searchQuery,
    setSearchQuery,

    // Legacy thread actions
    fetchThreads,
    fetchRandomSample,
    fetchThreadDetail,
    markThreadReviewed,
    unmarkThreadReviewed,
    addNoteToThread,

    // New session actions
    fetchSessions: fetchSessionsData,
    fetchSessionDetail: fetchSessionDetailData,
    markSessionReviewed: markSessionReviewedAction,
    unmarkSessionReviewed: unmarkSessionReviewedAction,
    addSessionNote: addSessionNoteAction,
    triggerSync: triggerSyncAction,
    refreshSyncStatus: refreshSyncStatusData,

    agents,
    selectedAgent,
    loadingAgents,
    connectionResult,

    fetchAgents: fetchAgentsData,
    fetchAgentDetail: fetchAgentDetailData,
    selectAgentWithData,
    testAgentConnection: testAgentConnectionAction,
    createAgent: createAgentAction,
    updateAgent: updateAgentAction,
    deleteAgent: deleteAgentAction,
    setSelectedAgent,

    taxonomy,
    loadingTaxonomy,
    syncing,
    categorizing,

    fetchTaxonomy: fetchTaxonomyData,
    syncNotesFromWeave: syncNotesFromWeaveAction,
    autoCategorize: autoCategorizeAction,
    createFailureMode: createFailureModeAction,
    deleteFailureMode: deleteFailureModeAction,

    dimensions,
    loadingDimensions,
    syntheticBatches,
    selectedBatch,
    generatingBatch,
    generationProgress,

    fetchDimensions: fetchDimensionsData,
    importDimensions: importDimensionsAction,
    fetchBatches: fetchBatchesData,
    fetchBatchDetail: fetchBatchDetailData,
    setSelectedBatch,
    deleteBatch: deleteBatchAction,

    executingBatch,
    executionProgress,

    playgroundRunning,
    playgroundResponse,
    playgroundToolCalls,
    playgroundError,
    playgroundEvents,
    resetPlayground,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

