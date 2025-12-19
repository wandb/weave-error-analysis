/**
 * useBatchGeneration - Hook for synthetic batch generation with SSE streaming
 *
 * Extracts generation logic from SyntheticTab to:
 * - Reduce component complexity and re-renders
 * - Enable reuse of generation logic
 * - Centralize SSE event handling for batch generation
 *
 * Handles:
 * - Direct batch generation (heuristic tuples + LLM queries)
 * - Progress tracking
 * - Abort/cleanup
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { getBackendUrl } from "./api";
import type { Dimension } from "../types";

// ============================================================================
// Types
// ============================================================================

export interface GenerationProgress {
  total: number;
  completed: number;
  percent: number;
  currentQuery?: string;
}

interface GeneratedQuery {
  id: string;
  query_text: string;
  tuple_values: Record<string, string>;
}

export interface UseBatchGenerationOptions {
  agentId: string | null;
  dimensions: Dimension[];
  selectedDimensionIds: Set<string>;
  // Heuristic sampling parameters
  variety?: number; // 0.0 = predictable, 1.0 = surprising (default: 0.5)
  favorites?: Record<string, string[]>; // dimension_name -> favorite values (5x weight)
  noDuplicates?: boolean; // Ensure unique combinations (default: true)
  onBatchCreated?: (batchId: string, batchName: string) => void;
  onBatchComplete?: (batch: { id: string; name: string; queries: GeneratedQuery[] }) => void;
  onQueryGenerated?: (query: GeneratedQuery, progress: GenerationProgress) => void;
}

export interface UseBatchGenerationReturn {
  // Query generation state
  generating: boolean;
  genProgress: GenerationProgress | null;

  // Accumulated queries during streaming (for batch UI updates)
  streamingQueries: GeneratedQuery[];

  // Actions
  generateBatch: (count: number) => Promise<void>;
  stopGeneration: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useBatchGeneration(
  options: UseBatchGenerationOptions
): UseBatchGenerationReturn {
  const {
    agentId,
    dimensions,
    selectedDimensionIds,
    variety = 0.5,
    favorites,
    noDuplicates = true,
    onBatchCreated,
    onBatchComplete,
    onQueryGenerated,
  } = options;

  // ========== STATE ==========

  // Query generation
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<GenerationProgress | null>(null);

  // Streaming queries ref (avoid re-renders during streaming)
  const streamingQueriesRef = useRef<GeneratedQuery[]>([]);
  const [streamingQueries, setStreamingQueries] = useState<GeneratedQuery[]>([]);

  // Abort controller
  const abortControllerRef = useRef<AbortController | null>(null);

  // ========== CLEANUP ==========

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // ========== GENERATION ACTIONS ==========

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setGenerating(false);
    setGenProgress(null);
  }, []);

  /**
   * Generate batch directly using heuristic tuple sampling + LLM query generation
   */
  const generateBatch = useCallback(
    async (count: number) => {
      if (!agentId) return;

      // Create new abort controller
      abortControllerRef.current = new AbortController();
      streamingQueriesRef.current = [];
      setStreamingQueries([]);

      setGenerating(true);
      setGenProgress({ total: count, completed: 0, percent: 0 });

      let currentBatchId = "";
      let currentBatchName = "";

      try {
        const backendUrl = getBackendUrl();

        // Get selected dimensions
        const selectedDimensions =
          dimensions.length > 0
            ? dimensions
                .filter((d) => selectedDimensionIds.has(d.id))
                .reduce(
                  (acc, d) => ({ ...acc, [d.name]: d.values }),
                  {} as Record<string, string[]>
                )
            : undefined;

        const response = await fetch(
          `${backendUrl}/api/synthetic/batches/generate-stream`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agent_id: agentId,
              count,
              selected_dimensions: selectedDimensions,
              variety,
              favorites,
              no_duplicates: noDuplicates,
            }),
            signal: abortControllerRef.current.signal,
          }
        );

        if (!response.ok) throw new Error("Failed to generate batch");

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6));

                if (event.type === "batch_started") {
                  currentBatchId = event.batch_id;
                  currentBatchName = event.name;
                  onBatchCreated?.(event.batch_id, event.name);
                  setGenProgress({
                    total: event.total,
                    completed: 0,
                    percent: 0,
                    currentQuery: "Preparing test cases...",
                  });
                } else if (event.type === "tuples_generated") {
                  setGenProgress((prev) =>
                    prev
                      ? {
                          ...prev,
                          total: event.count,
                          currentQuery: "Generating queries...",
                        }
                      : null
                  );
                } else if (event.type === "query_generated") {
                  streamingQueriesRef.current.push(event.query);
                  const progress: GenerationProgress = {
                    total: event.total,
                    completed: event.completed,
                    percent: event.progress_percent,
                    currentQuery:
                      event.query.query_text.slice(0, 60) + "...",
                  };
                  setGenProgress(progress);
                  onQueryGenerated?.(event.query, progress);

                  // Batch update UI every 10 queries
                  if (streamingQueriesRef.current.length % 10 === 0) {
                    setStreamingQueries([...streamingQueriesRef.current]);
                  }
                } else if (event.type === "batch_complete") {
                  const finalQueries = event.queries || streamingQueriesRef.current;
                  setStreamingQueries(finalQueries);
                  onBatchComplete?.({
                    id: event.batch_id,
                    name: event.name,
                    queries: finalQueries,
                  });
                }
              } catch {
                // Skip malformed events
              }
            }
          }
        }

        // If stream ended without batch_complete, finalize with accumulated queries
        if (streamingQueriesRef.current.length > 0 && currentBatchId) {
          setStreamingQueries([...streamingQueriesRef.current]);
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("Error generating batch:", error);
        }
      } finally {
        setGenerating(false);
        setGenProgress(null);
        streamingQueriesRef.current = [];
      }
    },
    [
      agentId,
      dimensions,
      selectedDimensionIds,
      variety,
      favorites,
      noDuplicates,
      onBatchCreated,
      onBatchComplete,
      onQueryGenerated,
    ]
  );

  // ========== RETURN ==========

  return {
    // Query generation state
    generating,
    genProgress,
    streamingQueries,

    // Actions
    generateBatch,
    stopGeneration,
  };
}
