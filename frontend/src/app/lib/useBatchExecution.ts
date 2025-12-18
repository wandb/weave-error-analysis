/**
 * useBatchExecution - Hook for batch execution with SSE streaming
 *
 * Extracts execution logic from SyntheticTab to:
 * - Reduce component complexity and re-renders
 * - Enable reuse of execution logic
 * - Centralize SSE event handling for batch execution
 *
 * Handles:
 * - Batch execution via SSE streaming
 * - Progress tracking (success/failure counts)
 * - Batch reset (re-run all or failed only)
 * - Abort/cleanup
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { getBackendUrl } from "./api";
import * as api from "./api";
import type { ExecutionProgress } from "../types";

// ============================================================================
// Types
// ============================================================================

export interface UseBatchExecutionOptions {
  /** Called when execution starts running (to update batch list UI) */
  onExecutionStart?: (batchId: string) => void;
  /** Called periodically during execution for batch detail refresh */
  onProgressUpdate?: (batchId: string, completedQueries: number) => void;
  /** Called when execution completes (success, failure, or cancelled) */
  onExecutionComplete?: (batchId: string, status: string) => void;
}

export interface UseBatchExecutionReturn {
  // State
  executingBatchId: string | null;
  executionProgress: ExecutionProgress | null;

  // Actions
  executeBatch: (batchId: string, batchName: string, agentId: string) => Promise<void>;
  stopExecution: () => void;
  resetBatch: (batchId: string, agentId: string, onlyFailed?: boolean) => Promise<void>;
}

// ============================================================================
// Constants
// ============================================================================

/** How many queries between batch detail refreshes during execution */
const BATCH_REFRESH_INTERVAL = 5;

/** How long to keep progress visible after completion */
const PROGRESS_CLEAR_DELAY_MS = 3000;

// ============================================================================
// Hook Implementation
// ============================================================================

export function useBatchExecution(
  options: UseBatchExecutionOptions = {}
): UseBatchExecutionReturn {
  const { onExecutionStart, onProgressUpdate, onExecutionComplete } = options;

  // ========== STATE ==========

  const [executingBatchId, setExecutingBatchId] = useState<string | null>(null);
  const [executionProgress, setExecutionProgress] = useState<ExecutionProgress | null>(null);

  // Refs
  const executionAbortRef = useRef<AbortController | null>(null);
  const lastFetchedCountRef = useRef<number>(0);

  // ========== CLEANUP ==========

  useEffect(() => {
    return () => {
      executionAbortRef.current?.abort();
    };
  }, []);

  // ========== ACTIONS ==========

  const stopExecution = useCallback(() => {
    executionAbortRef.current?.abort();
    executionAbortRef.current = null;
    setExecutingBatchId(null);
    setExecutionProgress(null);
  }, []);

  const executeBatch = useCallback(
    async (batchId: string, batchName: string, agentId: string) => {
      // Create abort controller for this execution
      executionAbortRef.current = new AbortController();
      // Reset last fetched count ref
      lastFetchedCountRef.current = 0;

      setExecutingBatchId(batchId);
      const startTime = Date.now();
      setExecutionProgress({
        batch_id: batchId,
        status: "starting",
        total_queries: 0,
        completed_queries: 0,
        success_count: 0,
        failure_count: 0,
        progress_percent: 0,
        start_time: startTime,
      });

      let hasNotifiedStart = false;

      try {
        const backendUrl = getBackendUrl();

        const response = await fetch(
          `${backendUrl}/api/synthetic/batches/${batchId}/execute`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ timeout_per_query: 60.0 }),
            signal: executionAbortRef.current.signal,
          }
        );

        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                setExecutionProgress({ ...data, start_time: startTime });

                // Notify when status changes to running
                if (data.status === "running" && !hasNotifiedStart) {
                  hasNotifiedStart = true;
                  onExecutionStart?.(batchId);
                }

                // Batch refresh: only notify every N completed queries
                const completedQueries = data.completed_queries || 0;
                if (
                  completedQueries > 0 &&
                  completedQueries - lastFetchedCountRef.current >= BATCH_REFRESH_INTERVAL
                ) {
                  lastFetchedCountRef.current = completedQueries;
                  onProgressUpdate?.(batchId, completedQueries);
                }

                // Final notification when done
                if (
                  data.status === "completed" ||
                  data.status === "failed" ||
                  data.status === "cancelled"
                ) {
                  onExecutionComplete?.(batchId, data.status);
                }
              } catch (e) {
                console.debug("[Execute] Failed to parse:", line, e);
              }
            }
          }
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("Error executing batch:", error);
        }
      } finally {
        setExecutingBatchId(null);
        // Don't clear progress immediately so user can see final state
        setTimeout(() => setExecutionProgress(null), PROGRESS_CLEAR_DELAY_MS);
      }
    },
    [onExecutionStart, onProgressUpdate, onExecutionComplete]
  );

  const resetBatch = useCallback(
    async (batchId: string, agentId: string, onlyFailed: boolean = false) => {
      try {
        await api.resetBatch(batchId, onlyFailed);
        // Let caller handle refreshing batch list and detail
        onExecutionComplete?.(batchId, "reset");
      } catch (error) {
        console.error("Error resetting batch:", error);
      }
    },
    [onExecutionComplete]
  );

  // ========== RETURN ==========

  return {
    executingBatchId,
    executionProgress,
    executeBatch,
    stopExecution,
    resetBatch,
  };
}

