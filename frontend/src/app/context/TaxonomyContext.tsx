"use client";

/**
 * TaxonomyContext - Manages taxonomy and failure modes
 * 
 * Extracted from AppContext to reduce re-render scope. Components that only
 * need taxonomy data won't re-render when session or agent state changes.
 * 
 * Responsibilities:
 * - Taxonomy data (failure modes, notes)
 * - Sync from Weave
 * - Auto-categorization
 * - Failure mode CRUD
 * - Agent-specific taxonomy filtering
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";
import type { Taxonomy } from "../types";
import * as api from "../lib/api";

// ============================================================================
// Context Types
// ============================================================================

interface TaxonomyContextState {
  // Taxonomy
  taxonomy: Taxonomy | null;
  loadingTaxonomy: boolean;
  syncing: boolean;
  categorizing: boolean;
  
  // Actions - now accept optional agentId for filtering
  fetchTaxonomy: (agentId?: string) => Promise<void>;
  syncNotesFromWeave: (agentId?: string) => Promise<void>;
  autoCategorize: (agentId?: string) => Promise<void>;
  createFailureMode: (name: string, desc: string, severity: string, agentId?: string) => Promise<{ id: string }>;
  deleteFailureMode: (modeId: string, agentId?: string) => Promise<void>;
}

const TaxonomyContext = createContext<TaxonomyContextState | null>(null);

export function useTaxonomy() {
  const ctx = useContext(TaxonomyContext);
  if (!ctx) throw new Error("useTaxonomy must be used within TaxonomyProvider");
  return ctx;
}

// ============================================================================
// Provider
// ============================================================================

interface TaxonomyProviderProps {
  children: ReactNode;
}

export function TaxonomyProvider({ children }: TaxonomyProviderProps) {
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [loadingTaxonomy, setLoadingTaxonomy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  // Track current agentId for refetching
  const [currentAgentId, setCurrentAgentId] = useState<string | undefined>(undefined);
  
  // ============================================================================
  // Actions
  // ============================================================================
  
  const fetchTaxonomy = useCallback(async (agentId?: string) => {
    setLoadingTaxonomy(true);
    setCurrentAgentId(agentId);
    try {
      const data = await api.fetchTaxonomy(agentId);
      setTaxonomy(data);
    } catch (error) {
      console.error("Error fetching taxonomy:", error);
    } finally {
      setLoadingTaxonomy(false);
    }
  }, []);
  
  const syncNotesFromWeave = useCallback(async (agentId?: string) => {
    setSyncing(true);
    try {
      await api.syncNotesFromWeave(agentId);
      await fetchTaxonomy(agentId || currentAgentId);
    } catch (error) {
      console.error("Error syncing notes:", error);
    } finally {
      setSyncing(false);
    }
  }, [fetchTaxonomy, currentAgentId]);
  
  const autoCategorize = useCallback(async (agentId?: string) => {
    setCategorizing(true);
    try {
      await api.autoCategorize(agentId);
      await fetchTaxonomy(agentId || currentAgentId);
    } catch (error) {
      console.error("Error categorizing:", error);
    } finally {
      setCategorizing(false);
    }
  }, [fetchTaxonomy, currentAgentId]);
  
  const createFailureMode = useCallback(async (
    name: string,
    desc: string,
    severity: string,
    agentId?: string
  ) => {
    const result = await api.createFailureMode(name, desc, severity, undefined, agentId);
    await fetchTaxonomy(agentId || currentAgentId);
    return result;
  }, [fetchTaxonomy, currentAgentId]);
  
  const deleteFailureMode = useCallback(async (modeId: string, agentId?: string) => {
    await api.deleteFailureMode(modeId);
    await fetchTaxonomy(agentId || currentAgentId);
  }, [fetchTaxonomy, currentAgentId]);
  
  // ============================================================================
  // Context Value
  // ============================================================================
  
  const value: TaxonomyContextState = {
    taxonomy,
    loadingTaxonomy,
    syncing,
    categorizing,
    fetchTaxonomy,
    syncNotesFromWeave,
    autoCategorize,
    createFailureMode,
    deleteFailureMode,
  };
  
  return (
    <TaxonomyContext.Provider value={value}>
      {children}
    </TaxonomyContext.Provider>
  );
}

