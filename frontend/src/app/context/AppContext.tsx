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
  Agent,
  AgentDetail,
  AgentStats,
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
  FilterRanges,
  WorkflowProgress,
} from "../types";
import * as api from "../lib/api";
import { ORGANIC_FILTER, SESSION_ID_PREFIX } from "../constants";

// ============================================================================
// Context Types
// ============================================================================

interface AppState {
  // Landing Page
  showLandingPage: boolean;
  setShowLandingPage: (show: boolean) => void;
  workflowProgress: WorkflowProgress;
  dismissLandingPage: () => void;

  // Navigation
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;

  // Sessions (Local DB based)
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
  filterMinTokens: number | null;
  setFilterMinTokens: (n: number | null) => void;
  filterMaxTokens: number | null;
  setFilterMaxTokens: (n: number | null) => void;
  filterMinCost: number | null;
  setFilterMinCost: (n: number | null) => void;
  filterMaxCost: number | null;
  setFilterMaxCost: (n: number | null) => void;
  filterMinLatency: number | null;
  setFilterMinLatency: (n: number | null) => void;
  filterMaxLatency: number | null;
  setFilterMaxLatency: (n: number | null) => void;
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
  
  // Filter ranges (data bounds for sliders)
  filterRanges: FilterRanges | null;
  loadingFilterRanges: boolean;
  fetchFilterRanges: () => Promise<void>;

  // Session Actions
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
  agentStats: AgentStats | null;
  loadingAgents: boolean;
  loadingAgentStats: boolean;
  connectionResult: ConnectionTestResult | null;

  // Agent Actions
  fetchAgents: () => Promise<void>;
  fetchAgentDetail: (agentId: string) => Promise<void>;
  fetchAgentStats: (agentId: string) => Promise<void>;
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
  // Landing Page State
  // Initialize to true to match server render, then hydrate from localStorage
  const [showLandingPage, setShowLandingPage] = useState<boolean>(true);
  const [isHydrated, setIsHydrated] = useState(false);

  // Hydrate landing page state from sessionStorage after initial render
  // Using sessionStorage so the landing page shows once per browser session
  useEffect(() => {
    const dismissed = sessionStorage.getItem('landingPageDismissed');
    if (dismissed === 'true') {
      setShowLandingPage(false);
    }
    setIsHydrated(true);
  }, []);

  // Navigation
  // Start with Agents tab - first step in the workflow
  const [activeTab, setActiveTab] = useState<TabType>("agents");

  // Sessions state (Local DB based)
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
  const [filterMinTokens, setFilterMinTokens] = useState<number | null>(null);
  const [filterMaxTokens, setFilterMaxTokens] = useState<number | null>(null);
  const [filterMinCost, setFilterMinCost] = useState<number | null>(null);
  const [filterMaxCost, setFilterMaxCost] = useState<number | null>(null);
  const [filterMinLatency, setFilterMinLatency] = useState<number | null>(null);
  const [filterMaxLatency, setFilterMaxLatency] = useState<number | null>(null);
  const [filterReviewed, setFilterReviewed] = useState<boolean | null>(null);
  const [filterHasError, setFilterHasError] = useState<boolean | null>(null);
  const [filterBatchId, setFilterBatchId] = useState<string | null>(null);
  const [filterBatchName, setFilterBatchName] = useState<string | null>(null);
  const [filterModel, setFilterModel] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Filter ranges (data bounds for sliders)
  const [filterRanges, setFilterRanges] = useState<FilterRanges | null>(null);
  const [loadingFilterRanges, setLoadingFilterRanges] = useState(false);

  // Sync status polling ref
  const syncPollRef = useRef<NodeJS.Timeout | null>(null);

  // Agents state
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentDetail | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [loadingAgentStats, setLoadingAgentStats] = useState(false);
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
  // Workflow Progress Computation
  // ============================================================================

  // Compute workflow progress based on app state
  const workflowProgress: WorkflowProgress = {
    hasAgents: agents.length > 0,
    hasBatches: syntheticBatches.some(b => b.status === 'completed'),
    hasReviewedSessions: sessions.some(s => s.is_reviewed),
    hasFailureModes: (taxonomy?.failure_modes?.length ?? 0) > 0,
  };

  // Dismiss landing page and persist to sessionStorage
  const dismissLandingPage = useCallback(() => {
    setShowLandingPage(false);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('landingPageDismissed', 'true');
    }
  }, []);

  // ============================================================================
  // Session Actions
  // ============================================================================

  const fetchSessionsData = useCallback(async () => {
    setLoadingSessions(true);
    try {
      // Handle special organic filter (sessions without a batch)
      const isOrganicFilter = filterBatchId === ORGANIC_FILTER;
      
      const data = await api.fetchSessions({
        sort_by: sortBy,
        direction: sortDirection,
        min_turns: filterMinTurns,
        max_turns: filterMaxTurns,
        min_tokens: filterMinTokens,
        max_tokens: filterMaxTokens,
        min_cost: filterMinCost,
        max_cost: filterMaxCost,
        min_latency: filterMinLatency,
        max_latency: filterMaxLatency,
        is_reviewed: filterReviewed,
        has_error: filterHasError,
        batch_id: isOrganicFilter ? null : filterBatchId,
        exclude_batches: isOrganicFilter ? true : undefined,
        primary_model: filterModel,
        id_prefix: SESSION_ID_PREFIX,  // Only show session_* threads (not random UUIDs)
        limit: 100,
      });
      setSessions(data.sessions);
      
      // Fetch batch review progress if filtering by a specific batch (not organic)
      if (filterBatchId && !isOrganicFilter) {
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
  }, [sortBy, sortDirection, filterMinTurns, filterMaxTurns, filterMinTokens, filterMaxTokens, filterMinCost, filterMaxCost, filterMinLatency, filterMaxLatency, filterReviewed, filterHasError, filterBatchId, filterModel]);

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
          // Refresh sessions and filter ranges after sync completes
          fetchSessionsData();
          fetchFilterRangesData();
        }
      }, 2000);
    } catch (error) {
      console.error("Error triggering sync:", error);
    }
  };

  const fetchFilterRangesData = useCallback(async () => {
    setLoadingFilterRanges(true);
    try {
      const ranges = await api.fetchFilterRanges();
      setFilterRanges(ranges);
    } catch (error) {
      console.error("Error fetching filter ranges:", error);
    } finally {
      setLoadingFilterRanges(false);
    }
  }, []);

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
      // Load dimensions, batches, and stats in parallel for faster loading
      await Promise.all([
        fetchDimensionsData(agentId),
        fetchBatchesData(agentId),
        fetchAgentStatsData(agentId)
      ]);
    } catch (error) {
      console.error("Error fetching agent detail:", error);
    }
  };

  const fetchAgentStatsData = async (agentId: string) => {
    setLoadingAgentStats(true);
    try {
      const stats = await api.fetchAgentStats(agentId);
      setAgentStats(stats);
    } catch (error) {
      console.error("Error fetching agent stats:", error);
      setAgentStats(null);
    } finally {
      setLoadingAgentStats(false);
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
    fetchAgentsData(); // Load agents on startup for auto-selection
  }, [fetchAgentsData]);

  // Threads tab - load from local DB
  useEffect(() => {
    if (activeTab === "threads") {
      fetchSessionsData();
      refreshSyncStatusData();
      fetchFilterRangesData();
    }
  }, [activeTab, fetchSessionsData, refreshSyncStatusData, fetchFilterRangesData]);

  // Cleanup sync polling on unmount
  useEffect(() => {
    return () => {
      if (syncPollRef.current) clearInterval(syncPollRef.current);
    };
  }, []);

  useEffect(() => {
    if (activeTab === "taxonomy") {
      fetchTaxonomyData();
    } else if (activeTab === "agents" || activeTab === "synthetic") {
      // Only fetch agents if not already loaded (avoid redundant fetches on tab switch)
      if (agents.length === 0) {
        fetchAgentsData();
      }
    }
  }, [activeTab, fetchTaxonomyData, fetchAgentsData, agents.length]);

  // Automatically load agent data when switching to synthetic tab with a selected agent
  useEffect(() => {
    if (activeTab === "synthetic" && selectedAgent) {
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

  // Auto-select a connected agent when agents are loaded and no agent is selected
  useEffect(() => {
    if (!selectedAgent && agents.length > 0 && !loadingAgents) {
      // Find a connected agent, or fall back to first agent
      const connectedAgent = agents.find(a => a.connection_status === "connected");
      const agentToSelect = connectedAgent || agents[0];
      
      if (agentToSelect) {
        // Fetch full agent details and related data
        fetchAgentDetailData(agentToSelect.id);
      }
    }
  }, [agents, selectedAgent, loadingAgents]);

  // ============================================================================
  // Context Value
  // ============================================================================

  const value: AppState = {
    // Landing Page
    showLandingPage,
    setShowLandingPage,
    workflowProgress,
    dismissLandingPage,

    activeTab,
    setActiveTab,

    // Sessions (Local DB)
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
    filterMinTokens,
    setFilterMinTokens,
    filterMaxTokens,
    setFilterMaxTokens,
    filterMinCost,
    setFilterMinCost,
    filterMaxCost,
    setFilterMaxCost,
    filterMinLatency,
    setFilterMinLatency,
    filterMaxLatency,
    setFilterMaxLatency,
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
    filterRanges,
    loadingFilterRanges,
    fetchFilterRanges: fetchFilterRangesData,

    // Session actions
    fetchSessions: fetchSessionsData,
    fetchSessionDetail: fetchSessionDetailData,
    markSessionReviewed: markSessionReviewedAction,
    unmarkSessionReviewed: unmarkSessionReviewedAction,
    addSessionNote: addSessionNoteAction,
    triggerSync: triggerSyncAction,
    refreshSyncStatus: refreshSyncStatusData,

    agents,
    selectedAgent,
    agentStats,
    loadingAgents,
    loadingAgentStats,
    connectionResult,

    fetchAgents: fetchAgentsData,
    fetchAgentDetail: fetchAgentDetailData,
    fetchAgentStats: fetchAgentStatsData,
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

