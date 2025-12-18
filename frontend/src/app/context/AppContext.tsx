"use client";

/**
 * AppContext - Slim Coordinator Context
 * 
 * This context has been refactored from a 1009-line god object into a slim
 * coordinator that composes domain-specific contexts:
 * 
 * - SessionContext: Sessions, filters, sync status
 * - AgentContext: Agents, connection testing  
 * - SyntheticContext: Dimensions, batches
 * - TaxonomyContext: Failure modes, categorization
 * 
 * This context now only manages:
 * - Navigation (active tab)
 * - Setup/config status
 * - Landing page state
 * - Playground state
 * - Workflow progress computation
 * 
 * For backwards compatibility, useApp() returns a combined interface that
 * delegates to the child contexts. Components should gradually migrate to
 * use the domain-specific hooks (useSession, useAgent, etc.) for better
 * performance.
 */

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
  ConfigStatus,
  ToolCall,
  PlaygroundEvent,
  WorkflowProgress,
} from "../types";
import * as api from "../lib/api";

// Import child contexts
import { SessionProvider, useSession } from "./SessionContext";
import { AgentProvider, useAgent } from "./AgentContext";
import { SyntheticProvider, useSynthetic } from "./SyntheticContext";
import { TaxonomyProvider, useTaxonomy } from "./TaxonomyContext";

// ============================================================================
// Core App State (navigation, setup, landing, playground)
// ============================================================================

interface CoreAppState {
  // Setup State
  configStatus: ConfigStatus | null;
  needsSetup: boolean;
  checkingSetup: boolean;
  completeSetup: () => void;
  refreshConfigStatus: () => Promise<void>;
  
  // Landing Page
  showLandingPage: boolean;
  setShowLandingPage: (show: boolean) => void;
  workflowProgress: WorkflowProgress;
  dismissLandingPage: () => void;

  // Navigation
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;

  // Playground (lightweight, kept here)
  playgroundRunning: boolean;
  playgroundResponse: string;
  playgroundToolCalls: ToolCall[];
  playgroundError: string | null;
  playgroundEvents: PlaygroundEvent[];
  resetPlayground: () => void;
}

const CoreAppContext = createContext<CoreAppState | null>(null);

// ============================================================================
// Core App Provider (slim - only navigation, setup, landing, playground)
// ============================================================================

function CoreAppProvider({ children }: { children: ReactNode }) {
  // Setup State
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [needsSetup, setNeedsSetup] = useState<boolean>(false);
  const [checkingSetup, setCheckingSetup] = useState<boolean>(true);
  const [setupComplete, setSetupComplete] = useState<boolean>(false);
  
  // Landing Page State
  const [showLandingPage, setShowLandingPage] = useState<boolean>(true);
  const [isHydrated, setIsHydrated] = useState(false);

  // Navigation
  const [activeTab, setActiveTab] = useState<TabType>("agents");

  // Playground state
  const [playgroundRunning, setPlaygroundRunning] = useState(false);
  const [playgroundResponse, setPlaygroundResponse] = useState("");
  const [playgroundToolCalls, setPlaygroundToolCalls] = useState<ToolCall[]>([]);
  const [playgroundError, setPlaygroundError] = useState<string | null>(null);
  const [playgroundEvents, setPlaygroundEvents] = useState<PlaygroundEvent[]>([]);

  // Config status check
  const refreshConfigStatus = useCallback(async () => {
    try {
      const status = await api.fetchConfigStatus();
      setConfigStatus(status);
      setNeedsSetup(!status.llm.configured);
    } catch (error) {
      console.error("Error checking config status:", error);
      setNeedsSetup(false);
    } finally {
      setCheckingSetup(false);
    }
  }, []);

  const completeSetup = useCallback(() => {
    setSetupComplete(true);
    setNeedsSetup(false);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('setupCompleted', 'true');
    }
  }, []);

  // Check setup on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const completed = sessionStorage.getItem('setupCompleted');
      if (completed === 'true') {
        setSetupComplete(true);
        setNeedsSetup(false);
        setCheckingSetup(false);
        return;
      }
    }
    refreshConfigStatus();
  }, [refreshConfigStatus]);

  // Hydrate landing page state
  useEffect(() => {
    const dismissed = sessionStorage.getItem('landingPageDismissed');
    if (dismissed === 'true') {
      setShowLandingPage(false);
    }
    setIsHydrated(true);
  }, []);

  const dismissLandingPage = useCallback(() => {
    setShowLandingPage(false);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('landingPageDismissed', 'true');
    }
  }, []);

  const resetPlayground = useCallback(() => {
    setPlaygroundResponse("");
    setPlaygroundToolCalls([]);
    setPlaygroundError(null);
    setPlaygroundEvents([]);
  }, []);

  // Workflow progress is computed from child context state - will be computed in useApp
  const workflowProgress: WorkflowProgress = {
    hasAgents: false, // Will be computed in useApp from useAgent
    hasBatches: false, // Will be computed in useApp from useSynthetic
    hasReviewedSessions: false, // Will be computed in useApp from useSession
    hasFailureModes: false, // Will be computed in useApp from useTaxonomy
  };

  const value: CoreAppState = {
    configStatus,
    needsSetup: needsSetup && !setupComplete,
    checkingSetup,
    completeSetup,
    refreshConfigStatus,
    showLandingPage,
    setShowLandingPage,
    workflowProgress,
    dismissLandingPage,
    activeTab,
    setActiveTab,
    playgroundRunning,
    playgroundResponse,
    playgroundToolCalls,
    playgroundError,
    playgroundEvents,
    resetPlayground,
  };

  return (
    <CoreAppContext.Provider value={value}>
      {children}
    </CoreAppContext.Provider>
  );
}

// ============================================================================
// Combined AppState for backwards compatibility
// ============================================================================

// Re-export the full interface that components expect from useApp()
// This combines CoreAppState with all child context states
interface AppState extends CoreAppState {
  // From SessionContext
  sessions: ReturnType<typeof useSession>['sessions'];
  selectedSession: ReturnType<typeof useSession>['selectedSession'];
  syncStatus: ReturnType<typeof useSession>['syncStatus'];
  batchReviewProgress: ReturnType<typeof useSession>['batchReviewProgress'];
  loadingSessions: ReturnType<typeof useSession>['loadingSessions'];
  loadingSessionDetail: ReturnType<typeof useSession>['loadingSessionDetail'];
  
  // Session Filters (individual for backwards compatibility)
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
  filterRanges: ReturnType<typeof useSession>['filterRanges'];
  loadingFilterRanges: ReturnType<typeof useSession>['loadingFilterRanges'];
  fetchFilterRanges: ReturnType<typeof useSession>['fetchFilterRanges'];
  
  // Session actions
  fetchSessions: ReturnType<typeof useSession>['fetchSessions'];
  fetchSessionDetail: ReturnType<typeof useSession>['fetchSessionDetail'];
  markSessionReviewed: ReturnType<typeof useSession>['markSessionReviewed'];
  unmarkSessionReviewed: ReturnType<typeof useSession>['unmarkSessionReviewed'];
  addSessionNote: ReturnType<typeof useSession>['addSessionNote'];
  triggerSync: ReturnType<typeof useSession>['triggerSync'];
  refreshSyncStatus: ReturnType<typeof useSession>['refreshSyncStatus'];

  // From AgentContext
  agents: ReturnType<typeof useAgent>['agents'];
  selectedAgent: ReturnType<typeof useAgent>['selectedAgent'];
  agentStats: ReturnType<typeof useAgent>['agentStats'];
  loadingAgents: ReturnType<typeof useAgent>['loadingAgents'];
  loadingAgentStats: ReturnType<typeof useAgent>['loadingAgentStats'];
  connectionResult: ReturnType<typeof useAgent>['connectionResult'];
  fetchAgents: ReturnType<typeof useAgent>['fetchAgents'];
  fetchAgentDetail: ReturnType<typeof useAgent>['fetchAgentDetail'];
  fetchAgentStats: ReturnType<typeof useAgent>['fetchAgentStats'];
  selectAgentWithData: ReturnType<typeof useAgent>['selectAgentWithData'];
  testAgentConnection: ReturnType<typeof useAgent>['testAgentConnection'];
  createAgent: ReturnType<typeof useAgent>['createAgent'];
  updateAgent: ReturnType<typeof useAgent>['updateAgent'];
  deleteAgent: ReturnType<typeof useAgent>['deleteAgent'];
  setSelectedAgent: ReturnType<typeof useAgent>['setSelectedAgent'];

  // From SyntheticContext
  dimensions: ReturnType<typeof useSynthetic>['dimensions'];
  loadingDimensions: ReturnType<typeof useSynthetic>['loadingDimensions'];
  syntheticBatches: ReturnType<typeof useSynthetic>['syntheticBatches'];
  selectedBatch: ReturnType<typeof useSynthetic>['selectedBatch'];
  fetchDimensions: ReturnType<typeof useSynthetic>['fetchDimensions'];
  importDimensions: ReturnType<typeof useSynthetic>['importDimensions'];
  fetchBatches: ReturnType<typeof useSynthetic>['fetchBatches'];
  fetchBatchDetail: ReturnType<typeof useSynthetic>['fetchBatchDetail'];
  setSelectedBatch: ReturnType<typeof useSynthetic>['setSelectedBatch'];
  deleteBatch: ReturnType<typeof useSynthetic>['deleteBatch'];
  
  // Execution state (was in AppContext, now component-local but exposed for compatibility)
  generatingBatch: boolean;
  generationProgress: { total: number; completed: number; percent: number; currentQuery?: string } | null;
  executingBatch: boolean;
  executionProgress: { batch_id: string; status: string; total_queries: number; completed_queries: number; success_count: number; failure_count: number; progress_percent: number } | null;

  // From TaxonomyContext
  taxonomy: ReturnType<typeof useTaxonomy>['taxonomy'];
  loadingTaxonomy: ReturnType<typeof useTaxonomy>['loadingTaxonomy'];
  syncing: ReturnType<typeof useTaxonomy>['syncing'];
  categorizing: ReturnType<typeof useTaxonomy>['categorizing'];
  fetchTaxonomy: ReturnType<typeof useTaxonomy>['fetchTaxonomy'];
  syncNotesFromWeave: ReturnType<typeof useTaxonomy>['syncNotesFromWeave'];
  autoCategorize: ReturnType<typeof useTaxonomy>['autoCategorize'];
  createFailureMode: ReturnType<typeof useTaxonomy>['createFailureMode'];
  deleteFailureMode: ReturnType<typeof useTaxonomy>['deleteFailureMode'];
}

// ============================================================================
// useApp - Backwards Compatible Combined Hook
// ============================================================================

/**
 * Combined hook for backwards compatibility.
 * 
 * Components should migrate to use domain-specific hooks for better performance:
 * - useSession() for session/thread state
 * - useAgent() for agent state
 * - useSynthetic() for synthetic data state
 * - useTaxonomy() for taxonomy state
 */
export function useApp(): AppState {
  const core = useContext(CoreAppContext);
  const session = useSession();
  const agent = useAgent();
  const synthetic = useSynthetic();
  const taxonomy = useTaxonomy();

  if (!core) throw new Error("useApp must be used within AppProvider");

  // Compute workflow progress from child contexts
  const workflowProgress: WorkflowProgress = {
    hasAgents: agent.agents.length > 0,
    hasBatches: synthetic.syntheticBatches.some(b => b.status === 'completed'),
    hasReviewedSessions: session.sessions.some(s => s.is_reviewed),
    hasFailureModes: (taxonomy.taxonomy?.failure_modes?.length ?? 0) > 0,
  };

  // Build backwards-compatible filter setters
  const setSortBy = useCallback((s: string) => session.setFilters({ sortBy: s }), [session]);
  const setSortDirection = useCallback((s: string | ((prev: string) => string)) => {
    if (typeof s === 'function') {
      session.setFilters({ sortDirection: s(session.filters.sortDirection) });
      } else {
      session.setFilters({ sortDirection: s });
    }
  }, [session]);
  const setFilterMinTurns = useCallback((n: number | null) => session.setFilters({ minTurns: n }), [session]);
  const setFilterMaxTurns = useCallback((n: number | null) => session.setFilters({ maxTurns: n }), [session]);
  const setFilterMinTokens = useCallback((n: number | null) => session.setFilters({ minTokens: n }), [session]);
  const setFilterMaxTokens = useCallback((n: number | null) => session.setFilters({ maxTokens: n }), [session]);
  const setFilterMinCost = useCallback((n: number | null) => session.setFilters({ minCost: n }), [session]);
  const setFilterMaxCost = useCallback((n: number | null) => session.setFilters({ maxCost: n }), [session]);
  const setFilterMinLatency = useCallback((n: number | null) => session.setFilters({ minLatency: n }), [session]);
  const setFilterMaxLatency = useCallback((n: number | null) => session.setFilters({ maxLatency: n }), [session]);
  const setFilterReviewed = useCallback((b: boolean | null) => session.setFilters({ isReviewed: b }), [session]);
  const setFilterHasError = useCallback((b: boolean | null) => session.setFilters({ hasError: b }), [session]);
  const setFilterBatchId = useCallback((s: string | null) => session.setFilters({ batchId: s }), [session]);
  const setFilterBatchName = useCallback((s: string | null) => session.setFilters({ batchName: s }), [session]);
  const setFilterModel = useCallback((s: string | null) => session.setFilters({ model: s }), [session]);
  const setSearchQuery = useCallback((s: string) => session.setFilters({ searchQuery: s }), [session]);

  return {
    // Core app state
    ...core,
    workflowProgress, // Override with computed value
    
    // Session state (from SessionContext)
    sessions: session.sessions,
    selectedSession: session.selectedSession,
    syncStatus: session.syncStatus,
    batchReviewProgress: session.batchReviewProgress,
    loadingSessions: session.loadingSessions,
    loadingSessionDetail: session.loadingSessionDetail,
    
    // Filter state (backwards compatible individual accessors)
    sortBy: session.filters.sortBy,
    setSortBy,
    sortDirection: session.filters.sortDirection,
    setSortDirection,
    filterMinTurns: session.filters.minTurns,
    setFilterMinTurns,
    filterMaxTurns: session.filters.maxTurns,
    setFilterMaxTurns,
    filterMinTokens: session.filters.minTokens,
    setFilterMinTokens,
    filterMaxTokens: session.filters.maxTokens,
    setFilterMaxTokens,
    filterMinCost: session.filters.minCost,
    setFilterMinCost,
    filterMaxCost: session.filters.maxCost,
    setFilterMaxCost,
    filterMinLatency: session.filters.minLatency,
    setFilterMinLatency,
    filterMaxLatency: session.filters.maxLatency,
    setFilterMaxLatency,
    filterReviewed: session.filters.isReviewed,
    setFilterReviewed,
    filterHasError: session.filters.hasError,
    setFilterHasError,
    filterBatchId: session.filters.batchId,
    setFilterBatchId,
    filterBatchName: session.filters.batchName,
    setFilterBatchName,
    filterModel: session.filters.model,
    setFilterModel,
    searchQuery: session.filters.searchQuery,
    setSearchQuery,
    filterRanges: session.filterRanges,
    loadingFilterRanges: session.loadingFilterRanges,
    fetchFilterRanges: session.fetchFilterRanges,

    // Session actions
    fetchSessions: session.fetchSessions,
    fetchSessionDetail: session.fetchSessionDetail,
    markSessionReviewed: session.markSessionReviewed,
    unmarkSessionReviewed: session.unmarkSessionReviewed,
    addSessionNote: session.addSessionNote,
    triggerSync: session.triggerSync,
    refreshSyncStatus: session.refreshSyncStatus,

    // Agent state (from AgentContext)
    agents: agent.agents,
    selectedAgent: agent.selectedAgent,
    agentStats: agent.agentStats,
    loadingAgents: agent.loadingAgents,
    loadingAgentStats: agent.loadingAgentStats,
    connectionResult: agent.connectionResult,
    fetchAgents: agent.fetchAgents,
    fetchAgentDetail: agent.fetchAgentDetail,
    fetchAgentStats: agent.fetchAgentStats,
    selectAgentWithData: agent.selectAgentWithData,
    testAgentConnection: agent.testAgentConnection,
    createAgent: agent.createAgent,
    updateAgent: agent.updateAgent,
    deleteAgent: agent.deleteAgent,
    setSelectedAgent: agent.setSelectedAgent,

    // Synthetic state (from SyntheticContext)
    dimensions: synthetic.dimensions,
    loadingDimensions: synthetic.loadingDimensions,
    syntheticBatches: synthetic.syntheticBatches,
    selectedBatch: synthetic.selectedBatch,
    fetchDimensions: synthetic.fetchDimensions,
    importDimensions: synthetic.importDimensions,
    fetchBatches: synthetic.fetchBatches,
    fetchBatchDetail: synthetic.fetchBatchDetail,
    setSelectedBatch: synthetic.setSelectedBatch,
    deleteBatch: synthetic.deleteBatch,
    
    // Generation/Execution state (placeholder - moved to component-local state)
    generatingBatch: false,
    generationProgress: null,
    executingBatch: false,
    executionProgress: null,

    // Taxonomy state (from TaxonomyContext)
    taxonomy: taxonomy.taxonomy,
    loadingTaxonomy: taxonomy.loadingTaxonomy,
    syncing: taxonomy.syncing,
    categorizing: taxonomy.categorizing,
    fetchTaxonomy: taxonomy.fetchTaxonomy,
    syncNotesFromWeave: taxonomy.syncNotesFromWeave,
    autoCategorize: taxonomy.autoCategorize,
    createFailureMode: taxonomy.createFailureMode,
    deleteFailureMode: taxonomy.deleteFailureMode,
  };
}

// ============================================================================
// Composite Provider
// ============================================================================

/**
 * AppProvider wraps all domain-specific contexts.
 * 
 * Provider hierarchy:
 * - SyntheticProvider (innermost - no deps)
 * - TaxonomyProvider (no deps)
 * - AgentProvider (depends on Synthetic for loadAgentData)
 * - SessionProvider (no deps)
 * - CoreAppProvider (outermost - navigation/setup)
 */
export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <SyntheticProvider>
      <TaxonomyProvider>
        <AgentProviderWithSynthetic>
          <SessionProvider>
            <CoreAppProvider>
              <TabEffects>
                {children}
              </TabEffects>
            </CoreAppProvider>
          </SessionProvider>
        </AgentProviderWithSynthetic>
      </TaxonomyProvider>
    </SyntheticProvider>
  );
}

/**
 * Wrapper to connect AgentProvider with SyntheticContext
 */
function AgentProviderWithSynthetic({ children }: { children: ReactNode }) {
  const { loadAgentData } = useSynthetic();
  
  return (
    <AgentProvider onAgentSelected={loadAgentData}>
      {children}
    </AgentProvider>
  );
}

/**
 * Handles tab-based data loading effects
 */
function TabEffects({ children }: { children: ReactNode }) {
  const core = useContext(CoreAppContext);
  const session = useSession();
  const taxonomy = useTaxonomy();
  const agent = useAgent();
  const synthetic = useSynthetic();
  
  // Load data when switching tabs
  useEffect(() => {
    if (!core) return;
    
    if (core.activeTab === "threads") {
      session.fetchSessions();
      session.refreshSyncStatus();
      session.fetchFilterRanges();
    } else if (core.activeTab === "taxonomy") {
      taxonomy.fetchTaxonomy();
    } else if (core.activeTab === "synthetic" && agent.selectedAgent) {
      // Load dimensions and batches if not already loaded
      if (synthetic.dimensions.length === 0 || synthetic.syntheticBatches.length === 0) {
        synthetic.loadAgentData(agent.selectedAgent.id);
      }
    }
  }, [core?.activeTab, agent.selectedAgent?.id]);
  
  return <>{children}</>;
}
