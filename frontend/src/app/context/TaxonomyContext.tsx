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
  
  // Actions
  fetchTaxonomy: () => Promise<void>;
  syncNotesFromWeave: () => Promise<void>;
  autoCategorize: () => Promise<void>;
  createFailureMode: (name: string, desc: string, severity: string) => Promise<{ id: string }>;
  deleteFailureMode: (modeId: string) => Promise<void>;
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
  
  // ============================================================================
  // Actions
  // ============================================================================
  
  const fetchTaxonomy = useCallback(async () => {
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
  
  const syncNotesFromWeave = useCallback(async () => {
    setSyncing(true);
    try {
      await api.syncNotesFromWeave();
      await fetchTaxonomy();
    } catch (error) {
      console.error("Error syncing notes:", error);
    } finally {
      setSyncing(false);
    }
  }, [fetchTaxonomy]);
  
  const autoCategorize = useCallback(async () => {
    setCategorizing(true);
    try {
      await api.autoCategorize();
      await fetchTaxonomy();
    } catch (error) {
      console.error("Error categorizing:", error);
    } finally {
      setCategorizing(false);
    }
  }, [fetchTaxonomy]);
  
  const createFailureMode = useCallback(async (
    name: string,
    desc: string,
    severity: string
  ) => {
    const result = await api.createFailureMode(name, desc, severity);
    await fetchTaxonomy();
    return result;
  }, [fetchTaxonomy]);
  
  const deleteFailureMode = useCallback(async (modeId: string) => {
    await api.deleteFailureMode(modeId);
    await fetchTaxonomy();
  }, [fetchTaxonomy]);
  
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

