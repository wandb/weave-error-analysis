"use client";

/**
 * AppContext - Slim Coordinator Context
 * 
 * This context composes domain-specific contexts:
 * 
 * - AgentContext: Agents, connection testing  
 * - SyntheticContext: Dimensions, batches
 * - TaxonomyContext: Failure modes, categorization
 * 
 * This context manages:
 * - Navigation (active tab)
 * - Setup/config status
 * - Landing page state
 * - Playground state
 * - Workflow progress computation
 * 
 * Note: SessionContext removed - users review traces in Weave UI directly.
 */

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
  ConfigStatus,
  ToolCall,
  PlaygroundEvent,
  WorkflowProgress,
} from "../types";
import * as api from "../lib/api";

// Import child contexts
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

  // Navigation - default to agents tab (no threads tab anymore)
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

  // Workflow progress placeholder - computed in useApp
  const workflowProgress: WorkflowProgress = {
    hasAgents: false,
    hasBatches: false,
    hasFailureModes: false,
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

interface AppState extends CoreAppState {
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
  fetchBatches: ReturnType<typeof useSynthetic>['fetchBatches'];
  fetchBatchDetail: ReturnType<typeof useSynthetic>['fetchBatchDetail'];
  setSelectedBatch: ReturnType<typeof useSynthetic>['setSelectedBatch'];
  deleteBatch: ReturnType<typeof useSynthetic>['deleteBatch'];
  
  // Execution state (placeholder)
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
// useApp - Combined Hook
// ============================================================================

/**
 * Combined hook for accessing all app state.
 * 
 * Components can also use domain-specific hooks for better performance:
 * - useAgent() for agent state
 * - useSynthetic() for synthetic data state
 * - useTaxonomy() for taxonomy state
 */
export function useApp(): AppState {
  const core = useContext(CoreAppContext);
  const agent = useAgent();
  const synthetic = useSynthetic();
  const taxonomy = useTaxonomy();

  if (!core) throw new Error("useApp must be used within AppProvider");

  // Compute workflow progress from child contexts
  const workflowProgress: WorkflowProgress = {
    hasAgents: agent.agents.length > 0,
    hasBatches: synthetic.syntheticBatches.some(b => b.status === 'completed'),
    hasFailureModes: (taxonomy.taxonomy?.failure_modes?.length ?? 0) > 0,
  };

  return {
    // Core app state
    ...core,
    workflowProgress,

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
    fetchBatches: synthetic.fetchBatches,
    fetchBatchDetail: synthetic.fetchBatchDetail,
    setSelectedBatch: synthetic.setSelectedBatch,
    deleteBatch: synthetic.deleteBatch,
    
    // Generation/Execution state (placeholder)
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
 * - CoreAppProvider (outermost - navigation/setup)
 * 
 * Note: SessionProvider removed - users review traces in Weave UI directly.
 */
export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <SyntheticProvider>
      <TaxonomyProvider>
        <AgentProviderWithSynthetic>
          <CoreAppProvider>
            <TabEffects>
              {children}
            </TabEffects>
          </CoreAppProvider>
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
  const taxonomy = useTaxonomy();
  const agent = useAgent();
  const synthetic = useSynthetic();
  
  // Track which agent's synthetic data has been fetched
  const fetchedAgentIdRef = useRef<string | null>(null);
  
  // Load data when switching tabs
  useEffect(() => {
    if (!core) return;
    
    if (core.activeTab === "taxonomy") {
      taxonomy.fetchTaxonomy();
    } else if (core.activeTab === "synthetic" && agent.selectedAgent) {
      const needsFetch = fetchedAgentIdRef.current !== agent.selectedAgent.id;
      if (needsFetch) {
        fetchedAgentIdRef.current = agent.selectedAgent.id;
        synthetic.loadAgentData(agent.selectedAgent.id);
      }
    }
  }, [
    core?.activeTab,
    agent.selectedAgent?.id,
    taxonomy.fetchTaxonomy,
    synthetic.loadAgentData,
    agent.selectedAgent,
  ]);
  
  return <>{children}</>;
}
