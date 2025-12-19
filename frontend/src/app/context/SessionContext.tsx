"use client";

/**
 * SessionContext - Manages session/thread state and filtering
 * 
 * Extracted from AppContext to reduce re-render scope. Components that only
 * need session data won't re-render when agent or taxonomy state changes.
 * 
 * Responsibilities:
 * - Session list and selection
 * - Filter state (turns, tokens, cost, latency, reviewed, error, batch, model)
 * - Sync status with Weave
 * - Batch review progress tracking
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
  Session,
  SessionDetail,
  SyncStatus,
  BatchReviewProgress,
  FilterRanges,
} from "../types";
import * as api from "../lib/api";
import { ORGANIC_FILTER, SESSION_ID_PREFIX } from "../constants";

// ============================================================================
// Filter State Type
// ============================================================================

export interface SessionFilters {
  sortBy: string;
  sortDirection: string;
  minTurns: number | null;
  maxTurns: number | null;
  minTokens: number | null;
  maxTokens: number | null;
  minCost: number | null;
  maxCost: number | null;
  minLatency: number | null;
  maxLatency: number | null;
  isReviewed: boolean | null;
  hasError: boolean | null;
  batchId: string | null;
  batchName: string | null;
  model: string | null;
  searchQuery: string;
}

const initialFilters: SessionFilters = {
  sortBy: "started_at",
  sortDirection: "desc",
  minTurns: null,
  maxTurns: null,
  minTokens: null,
  maxTokens: null,
  minCost: null,
  maxCost: null,
  minLatency: null,
  maxLatency: null,
  isReviewed: null,
  hasError: null,
  batchId: null,
  batchName: null,
  model: null,
  searchQuery: "",
};

// ============================================================================
// Context Types
// ============================================================================

interface SessionContextState {
  // Sessions
  sessions: Session[];
  selectedSession: SessionDetail | null;
  loadingSessions: boolean;
  loadingSessionDetail: boolean;
  
  // Sync
  syncStatus: SyncStatus | null;
  batchReviewProgress: BatchReviewProgress | null;
  
  // Filters (consolidated)
  filters: SessionFilters;
  setFilters: (filters: Partial<SessionFilters>) => void;
  resetFilters: () => void;
  
  // Filter ranges (data bounds for sliders)
  filterRanges: FilterRanges | null;
  loadingFilterRanges: boolean;
  
  // Actions
  fetchSessions: () => Promise<void>;
  fetchSessionDetail: (sessionId: string) => Promise<void>;
  markSessionReviewed: (sessionId: string) => Promise<void>;
  unmarkSessionReviewed: (sessionId: string) => Promise<void>;
  addSessionNote: (sessionId: string, content: string, noteType?: string) => Promise<void>;
  triggerSync: (fullSync?: boolean) => Promise<void>;
  refreshSyncStatus: () => Promise<SyncStatus | null>;
  fetchFilterRanges: () => Promise<void>;
  
  // For external components that need to set batch filter
  setSelectedSession: (session: SessionDetail | null) => void;
}

const SessionContext = createContext<SessionContextState | null>(null);

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

// ============================================================================
// Provider
// ============================================================================

interface SessionProviderProps {
  children: ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps) {
  // Session state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingSessionDetail, setLoadingSessionDetail] = useState(false);
  
  // Sync state
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [batchReviewProgress, setBatchReviewProgress] = useState<BatchReviewProgress | null>(null);
  
  // Consolidated filter state (instead of 16 separate useState calls)
  const [filters, setFiltersState] = useState<SessionFilters>(initialFilters);
  
  // Filter ranges
  const [filterRanges, setFilterRanges] = useState<FilterRanges | null>(null);
  const [loadingFilterRanges, setLoadingFilterRanges] = useState(false);
  
  // Sync polling refs
  const syncPollRef = useRef<NodeJS.Timeout | null>(null);
  const syncPollIntervalRef = useRef<number>(1000);
  
  // ============================================================================
  // Filter Actions
  // ============================================================================
  
  const setFilters = useCallback((updates: Partial<SessionFilters>) => {
    setFiltersState(prev => ({ ...prev, ...updates }));
  }, []);
  
  const resetFilters = useCallback(() => {
    setFiltersState(initialFilters);
  }, []);
  
  // ============================================================================
  // Session Actions
  // ============================================================================
  
  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const isOrganicFilter = filters.batchId === ORGANIC_FILTER;
      // When viewing a specific batch, don't filter by id_prefix since batch sessions
      // have IDs from Weave that may not start with "session_"
      const isBatchFilter = filters.batchId && !isOrganicFilter;
      
      const data = await api.fetchSessions({
        sort_by: filters.sortBy,
        direction: filters.sortDirection,
        min_turns: filters.minTurns,
        max_turns: filters.maxTurns,
        min_tokens: filters.minTokens,
        max_tokens: filters.maxTokens,
        min_cost: filters.minCost,
        max_cost: filters.maxCost,
        min_latency: filters.minLatency,
        max_latency: filters.maxLatency,
        is_reviewed: filters.isReviewed,
        has_error: filters.hasError,
        batch_id: isOrganicFilter ? null : filters.batchId,
        exclude_batches: isOrganicFilter ? true : undefined,
        primary_model: filters.model,
        // Only filter by id_prefix when not viewing a specific batch
        // Batch sessions have Weave-generated IDs that may not have our prefix
        id_prefix: isBatchFilter ? undefined : SESSION_ID_PREFIX,
        limit: 100,
      });
      setSessions(data.sessions);
      
      // Fetch batch review progress if filtering by a specific batch
      if (filters.batchId && !isOrganicFilter) {
        try {
          const progress = await api.fetchBatchReviewProgress(filters.batchId);
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
  }, [filters]);
  
  const fetchSessionDetail = useCallback(async (sessionId: string) => {
    setLoadingSessionDetail(true);
    try {
      const data = await api.fetchSessionDetail(sessionId);
      setSelectedSession(data);
    } catch (error) {
      console.error("Error fetching session detail:", error);
    } finally {
      setLoadingSessionDetail(false);
    }
  }, []);
  
  const markSessionReviewed = useCallback(async (sessionId: string) => {
    try {
      await api.markSessionReviewed(sessionId);
      setSelectedSession(prev => (prev ? { ...prev, is_reviewed: true } : null));
      setSessions(prev =>
        prev.map(s => (s.id === sessionId ? { ...s, is_reviewed: true } : s))
      );
      // Refresh batch progress if applicable
      if (filters.batchId && filters.batchId !== ORGANIC_FILTER) {
        const progress = await api.fetchBatchReviewProgress(filters.batchId);
        setBatchReviewProgress(progress);
      }
    } catch (error) {
      console.error("Error marking session as reviewed:", error);
    }
  }, [filters.batchId]);
  
  const unmarkSessionReviewed = useCallback(async (sessionId: string) => {
    try {
      await api.unmarkSessionReviewed(sessionId);
      setSelectedSession(prev => (prev ? { ...prev, is_reviewed: false } : null));
      setSessions(prev =>
        prev.map(s => (s.id === sessionId ? { ...s, is_reviewed: false } : s))
      );
      if (filters.batchId && filters.batchId !== ORGANIC_FILTER) {
        const progress = await api.fetchBatchReviewProgress(filters.batchId);
        setBatchReviewProgress(progress);
      }
    } catch (error) {
      console.error("Error unmarking session as reviewed:", error);
    }
  }, [filters.batchId]);
  
  const addSessionNote = useCallback(async (
    sessionId: string, 
    content: string, 
    noteType: string = "observation"
  ) => {
    if (!content.trim()) return;
    try {
      await api.createSessionNote(sessionId, content, noteType);
      // Refresh session detail to show new note
      if (selectedSession?.id === sessionId) {
        const data = await api.fetchSessionDetail(sessionId);
        setSelectedSession(data);
      }
    } catch (error) {
      console.error("Error adding session note:", error);
    }
  }, [selectedSession?.id]);
  
  // ============================================================================
  // Sync Actions
  // ============================================================================
  
  const refreshSyncStatus = useCallback(async () => {
    try {
      const status = await api.fetchSyncStatus();
      setSyncStatus(status);
      return status;
    } catch (error) {
      console.error("Error fetching sync status:", error);
      return null;
    }
  }, []);
  
  const fetchFilterRanges = useCallback(async () => {
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
  
  const triggerSync = useCallback(async (fullSync: boolean = false) => {
    try {
      await api.triggerSync(fullSync, filters.batchId ?? undefined);
      refreshSyncStatus();
      
      // Reset polling interval
      syncPollIntervalRef.current = 1000;
      
      if (syncPollRef.current) {
        clearTimeout(syncPollRef.current);
        syncPollRef.current = null;
      }
      
      // Poll with exponential backoff
      const pollWithBackoff = async () => {
        const status = await refreshSyncStatus();
        
        if (status && !status.is_syncing) {
          fetchSessions();
          fetchFilterRanges();
          syncPollRef.current = null;
        } else {
          syncPollIntervalRef.current = Math.min(
            syncPollIntervalRef.current * 1.5,
            5000
          );
          syncPollRef.current = setTimeout(pollWithBackoff, syncPollIntervalRef.current);
        }
      };
      
      syncPollRef.current = setTimeout(pollWithBackoff, syncPollIntervalRef.current);
    } catch (error) {
      console.error("Error triggering sync:", error);
    }
  }, [filters.batchId, refreshSyncStatus, fetchSessions, fetchFilterRanges]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (syncPollRef.current) clearTimeout(syncPollRef.current);
    };
  }, []);
  
  // ============================================================================
  // Context Value
  // ============================================================================
  
  const value: SessionContextState = {
    sessions,
    selectedSession,
    loadingSessions,
    loadingSessionDetail,
    syncStatus,
    batchReviewProgress,
    filters,
    setFilters,
    resetFilters,
    filterRanges,
    loadingFilterRanges,
    fetchSessions,
    fetchSessionDetail,
    markSessionReviewed,
    unmarkSessionReviewed,
    addSessionNote,
    triggerSync,
    refreshSyncStatus,
    fetchFilterRanges,
    setSelectedSession,
  };
  
  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

