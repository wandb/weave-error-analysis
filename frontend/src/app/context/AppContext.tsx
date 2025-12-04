"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
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
} from "../types";
import * as api from "../lib/api";

// ============================================================================
// Context Types
// ============================================================================

interface AppState {
  // Navigation
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;

  // Sessions
  threads: Thread[];
  selectedThread: ThreadDetail | null;
  feedbackSummary: FeedbackSummary | null;
  annotationProgress: AnnotationProgress | null;
  loadingThreads: boolean;
  loadingDetail: boolean;

  // Session Filters
  sortBy: string;
  setSortBy: (s: string) => void;
  sortDirection: string;
  setSortDirection: (s: string) => void;
  filterMinTurns: number | null;
  setFilterMinTurns: (n: number | null) => void;
  filterReviewed: boolean | null;
  setFilterReviewed: (b: boolean | null) => void;
  filterBatchId: string | null;
  setFilterBatchId: (s: string | null) => void;
  filterBatchName: string | null;
  setFilterBatchName: (s: string | null) => void;
  searchQuery: string;
  setSearchQuery: (s: string) => void;

  // Session Actions
  fetchThreads: () => Promise<void>;
  fetchRandomSample: (size?: number) => Promise<void>;
  fetchThreadDetail: (threadId: string) => Promise<void>;
  markThreadReviewed: (threadId: string) => Promise<void>;
  unmarkThreadReviewed: (threadId: string) => Promise<void>;
  addNoteToThread: (threadId: string, note: string) => Promise<void>;

  // Agents
  agents: Agent[];
  selectedAgent: AgentDetail | null;
  loadingAgents: boolean;
  connectionResult: ConnectionTestResult | null;

  // Agent Actions
  fetchAgents: () => Promise<void>;
  fetchAgentDetail: (agentId: string) => Promise<void>;
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

  // Sessions state
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<ThreadDetail | null>(null);
  const [feedbackSummary, setFeedbackSummary] = useState<FeedbackSummary | null>(null);
  const [annotationProgress, setAnnotationProgress] = useState<AnnotationProgress | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Session Filters
  const [sortBy, setSortBy] = useState("last_updated");
  const [sortDirection, setSortDirection] = useState("desc");
  const [filterMinTurns, setFilterMinTurns] = useState<number | null>(null);
  const [filterReviewed, setFilterReviewed] = useState<boolean | null>(null);
  const [filterBatchId, setFilterBatchId] = useState<string | null>(null);
  const [filterBatchName, setFilterBatchName] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

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
      await fetchDimensionsData(agentId);
      await fetchBatchesData(agentId);
    } catch (error) {
      console.error("Error fetching agent detail:", error);
    }
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

  useEffect(() => {
    fetchThreads();
    fetchFeedbackSummaryData();
    fetchAnnotationProgressData();
  }, [fetchThreads, fetchFeedbackSummaryData, fetchAnnotationProgressData]);

  useEffect(() => {
    if (activeTab === "taxonomy") {
      fetchTaxonomyData();
    } else if (activeTab === "agents" || activeTab === "synthetic" || activeTab === "runs") {
      fetchAgentsData();
    }
  }, [activeTab, fetchTaxonomyData, fetchAgentsData]);

  // ============================================================================
  // Context Value
  // ============================================================================

  const value: AppState = {
    activeTab,
    setActiveTab,

    threads,
    selectedThread,
    feedbackSummary,
    annotationProgress,
    loadingThreads,
    loadingDetail,

    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
    filterMinTurns,
    setFilterMinTurns,
    filterReviewed,
    setFilterReviewed,
    filterBatchId,
    setFilterBatchId,
    filterBatchName,
    setFilterBatchName,
    searchQuery,
    setSearchQuery,

    fetchThreads,
    fetchRandomSample,
    fetchThreadDetail,
    markThreadReviewed,
    unmarkThreadReviewed,
    addNoteToThread,

    agents,
    selectedAgent,
    loadingAgents,
    connectionResult,

    fetchAgents: fetchAgentsData,
    fetchAgentDetail: fetchAgentDetailData,
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

