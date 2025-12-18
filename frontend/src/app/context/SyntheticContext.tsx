"use client";

/**
 * SyntheticContext - Manages synthetic test data generation
 * 
 * Extracted from AppContext to reduce re-render scope. Components that only
 * need synthetic data won't re-render when session or taxonomy state changes.
 * 
 * Responsibilities:
 * - Dimensions management
 * - Batch management (list, detail, CRUD)
 * - Generation and execution state (moved to component-local state for now)
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";
import type {
  Dimension,
  SyntheticBatch,
  BatchDetail,
} from "../types";
import * as api from "../lib/api";

// ============================================================================
// Context Types
// ============================================================================

// Type for setState that accepts both value and updater function
type BatchDetailSetter = (
  batch: BatchDetail | null | ((prev: BatchDetail | null) => BatchDetail | null)
) => void;

interface SyntheticContextState {
  // Dimensions
  dimensions: Dimension[];
  loadingDimensions: boolean;
  
  // Batches
  syntheticBatches: SyntheticBatch[];
  selectedBatch: BatchDetail | null;
  
  // Actions
  fetchDimensions: (agentId: string) => Promise<void>;
  importDimensions: (agentId: string) => Promise<void>;
  fetchBatches: (agentId: string) => Promise<void>;
  fetchBatchDetail: (batchId: string) => Promise<void>;
  setSelectedBatch: BatchDetailSetter;
  deleteBatch: (batchId: string, agentId: string) => Promise<void>;
  
  // For loading data when agent is selected (called by AgentContext)
  loadAgentData: (agentId: string) => Promise<void>;
}

const SyntheticContext = createContext<SyntheticContextState | null>(null);

export function useSynthetic() {
  const ctx = useContext(SyntheticContext);
  if (!ctx) throw new Error("useSynthetic must be used within SyntheticProvider");
  return ctx;
}

// ============================================================================
// Provider
// ============================================================================

interface SyntheticProviderProps {
  children: ReactNode;
}

export function SyntheticProvider({ children }: SyntheticProviderProps) {
  // Dimensions state
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [loadingDimensions, setLoadingDimensions] = useState(false);
  
  // Batches state
  const [syntheticBatches, setSyntheticBatches] = useState<SyntheticBatch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<BatchDetail | null>(null);
  
  // ============================================================================
  // Dimension Actions
  // ============================================================================
  
  const fetchDimensions = useCallback(async (agentId: string) => {
    setLoadingDimensions(true);
    try {
      const data = await api.fetchDimensions(agentId);
      setDimensions(data || []);
    } catch (error) {
      console.error("Error fetching dimensions:", error);
    } finally {
      setLoadingDimensions(false);
    }
  }, []);
  
  const importDimensions = useCallback(async (agentId: string) => {
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
  }, []);
  
  // ============================================================================
  // Batch Actions
  // ============================================================================
  
  const fetchBatches = useCallback(async (agentId: string) => {
    try {
      const data = await api.fetchBatches(agentId);
      setSyntheticBatches(data || []);
    } catch (error) {
      console.error("Error fetching batches:", error);
    }
  }, []);
  
  const fetchBatchDetail = useCallback(async (batchId: string) => {
    try {
      const data = await api.fetchBatchDetail(batchId);
      setSelectedBatch(data);
    } catch (error) {
      console.error("Error fetching batch detail:", error);
    }
  }, []);
  
  const deleteBatch = useCallback(async (batchId: string, agentId: string) => {
    try {
      await api.deleteBatch(batchId);
      await fetchBatches(agentId);
      if (selectedBatch?.id === batchId) {
        setSelectedBatch(null);
      }
    } catch (error) {
      console.error("Error deleting batch:", error);
    }
  }, [selectedBatch?.id, fetchBatches]);
  
  // ============================================================================
  // Combined Loader (for agent selection)
  // ============================================================================
  
  const loadAgentData = useCallback(async (agentId: string) => {
    await Promise.all([
      fetchDimensions(agentId),
      fetchBatches(agentId),
    ]);
  }, [fetchDimensions, fetchBatches]);
  
  // ============================================================================
  // Context Value
  // ============================================================================
  
  const value: SyntheticContextState = {
    dimensions,
    loadingDimensions,
    syntheticBatches,
    selectedBatch,
    fetchDimensions,
    importDimensions,
    fetchBatches,
    fetchBatchDetail,
    setSelectedBatch,
    deleteBatch,
    loadAgentData,
  };
  
  return (
    <SyntheticContext.Provider value={value}>
      {children}
    </SyntheticContext.Provider>
  );
}

