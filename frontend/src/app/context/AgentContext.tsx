"use client";

/**
 * AgentContext - Manages agent state
 * 
 * Extracted from AppContext to reduce re-render scope. Components that only
 * need agent data won't re-render when session or taxonomy state changes.
 * 
 * Responsibilities:
 * - Agent list and selection
 * - Agent details and stats
 * - Connection testing and health checks
 * - Agent CRUD operations
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
  Agent,
  AgentDetail,
  AgentStats,
  ConnectionTestResult,
} from "../types";
import * as api from "../lib/api";
import { AGENT_HEALTH_CHECK_INTERVAL_MS } from "../constants";

// ============================================================================
// Context Types
// ============================================================================

interface AgentContextState {
  // Agents
  agents: Agent[];
  selectedAgent: AgentDetail | null;
  agentStats: AgentStats | null;
  loadingAgents: boolean;
  loadingAgentStats: boolean;
  connectionResult: ConnectionTestResult | null;
  
  // Actions
  fetchAgents: () => Promise<void>;
  fetchAgentDetail: (agentId: string) => Promise<void>;
  fetchAgentStats: (agentId: string) => Promise<void>;
  selectAgentWithData: (agent: Agent) => Promise<void>;
  testAgentConnection: (agentId: string) => Promise<void>;
  createAgent: (name: string, endpoint: string, info: string) => Promise<void>;
  updateAgent: (id: string, name: string, endpoint: string, info: string) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  setSelectedAgent: (agent: AgentDetail | null) => void;
}

const AgentContext = createContext<AgentContextState | null>(null);

export function useAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgent must be used within AgentProvider");
  return ctx;
}

// ============================================================================
// Provider
// ============================================================================

interface AgentProviderProps {
  children: ReactNode;
  /** Callback to load agent-related data (dimensions, batches) when agent is selected */
  onAgentSelected?: (agentId: string) => Promise<void>;
}

export function AgentProvider({ children, onAgentSelected }: AgentProviderProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentDetail | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [loadingAgentStats, setLoadingAgentStats] = useState(false);
  const [connectionResult, setConnectionResult] = useState<ConnectionTestResult | null>(null);
  
  // Track if user manually cleared selection (prevents auto-reselect)
  const userClearedSelectionRef = useRef(false);
  
  // Health check polling ref
  const agentHealthPollRef = useRef<NodeJS.Timeout | null>(null);
  
  // ============================================================================
  // Agent Actions
  // ============================================================================
  
  const fetchAgents = useCallback(async () => {
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
  
  const fetchAgentStats = useCallback(async (agentId: string) => {
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
  }, []);
  
  const fetchAgentDetail = useCallback(async (agentId: string) => {
    try {
      const data = await api.fetchAgentDetail(agentId);
      setSelectedAgent(data);
      
      // Load related data in parallel
      await Promise.all([
        fetchAgentStats(agentId),
        onAgentSelected?.(agentId),
      ]);
    } catch (error) {
      console.error("Error fetching agent detail:", error);
    }
  }, [fetchAgentStats, onAgentSelected]);
  
  const selectAgentWithData = useCallback(async (agent: Agent) => {
    if (selectedAgent?.id === agent.id) {
      // Already selected, just ensure related data is loaded
      await onAgentSelected?.(agent.id);
      return;
    }
    await fetchAgentDetail(agent.id);
  }, [selectedAgent?.id, fetchAgentDetail, onAgentSelected]);
  
  const testAgentConnection = useCallback(async (agentId: string) => {
    setConnectionResult(null);
    try {
      const result = await api.testAgentConnection(agentId);
      setConnectionResult(result);
      await fetchAgents();
      
      // Update selected agent's connection status
      if (selectedAgent?.id === agentId) {
        setSelectedAgent(prev => prev ? {
          ...prev,
          connection_status: result.success ? "connected" : "error"
        } : null);
      }
    } catch (error) {
      setConnectionResult({
        success: false,
        status_code: null,
        response_time_ms: null,
        error: String(error),
      });
    }
  }, [selectedAgent?.id, fetchAgents]);
  
  // Silent health check (doesn't update connectionResult)
  const checkAgentHealthSilently = useCallback(async (agentId: string) => {
    try {
      const result = await api.testAgentConnection(agentId);
      
      setSelectedAgent(prev => {
        if (prev?.id !== agentId) return prev;
        const newStatus = result.success ? "connected" : "disconnected";
        if (prev.connection_status !== newStatus) {
          return { ...prev, connection_status: newStatus };
        }
        return prev;
      });
      
      setAgents(prev => prev.map(a => 
        a.id === agentId 
          ? { ...a, connection_status: result.success ? "connected" : "disconnected" }
          : a
      ));
    } catch {
      setSelectedAgent(prev => {
        if (prev?.id !== agentId) return prev;
        return { ...prev, connection_status: "disconnected" };
      });
    }
  }, []);
  
  const createAgent = useCallback(async (name: string, endpoint: string, info: string) => {
    if (!name || !endpoint || !info) return;
    await api.createAgent(name, endpoint, info);
    await fetchAgents();
  }, [fetchAgents]);
  
  const updateAgent = useCallback(async (
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
    await fetchAgents();
    if (selectedAgent?.id === id) {
      await fetchAgentDetail(id);
    }
  }, [fetchAgents, selectedAgent?.id, fetchAgentDetail]);
  
  const deleteAgent = useCallback(async (agentId: string) => {
    await api.deleteAgent(agentId);
    await fetchAgents();
    if (selectedAgent?.id === agentId) {
      setSelectedAgent(null);
    }
  }, [fetchAgents, selectedAgent?.id]);
  
  // Wrapper that tracks user-initiated clears to prevent auto-reselect
  const handleSetSelectedAgent = useCallback((agent: AgentDetail | null) => {
    if (agent === null) {
      userClearedSelectionRef.current = true;
    } else {
      userClearedSelectionRef.current = false;
    }
    setSelectedAgent(agent);
  }, []);
  
  // ============================================================================
  // Effects
  // ============================================================================
  
  // Load agents on mount
  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);
  
  // Auto-select a connected agent when agents load (but not if user manually cleared)
  useEffect(() => {
    if (!selectedAgent && agents.length > 0 && !loadingAgents) {
      // Don't auto-select if user intentionally closed the agent card
      if (userClearedSelectionRef.current) {
        return;
      }
      
      const connectedAgent = agents.find(a => a.connection_status === "connected");
      const agentToSelect = connectedAgent || agents[0];
      
      if (agentToSelect) {
        fetchAgentDetail(agentToSelect.id);
      }
    }
  }, [agents, selectedAgent, loadingAgents, fetchAgentDetail]);
  
  // Background health checks (every 30s)
  useEffect(() => {
    if (agentHealthPollRef.current) {
      clearInterval(agentHealthPollRef.current);
      agentHealthPollRef.current = null;
    }
    
    if (selectedAgent) {
      checkAgentHealthSilently(selectedAgent.id);
      
      agentHealthPollRef.current = setInterval(() => {
        if (selectedAgent) {
          checkAgentHealthSilently(selectedAgent.id);
        }
      }, AGENT_HEALTH_CHECK_INTERVAL_MS);
    }
    
    return () => {
      if (agentHealthPollRef.current) {
        clearInterval(agentHealthPollRef.current);
        agentHealthPollRef.current = null;
      }
    };
  }, [selectedAgent?.id, checkAgentHealthSilently]);
  
  // ============================================================================
  // Context Value
  // ============================================================================
  
  const value: AgentContextState = {
    agents,
    selectedAgent,
    agentStats,
    loadingAgents,
    loadingAgentStats,
    connectionResult,
    fetchAgents,
    fetchAgentDetail,
    fetchAgentStats,
    selectAgentWithData,
    testAgentConnection,
    createAgent,
    updateAgent,
    deleteAgent,
    setSelectedAgent: handleSetSelectedAgent,
  };
  
  return (
    <AgentContext.Provider value={value}>
      {children}
    </AgentContext.Provider>
  );
}

