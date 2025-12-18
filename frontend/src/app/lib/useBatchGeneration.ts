/**
 * useBatchGeneration - Hook for synthetic batch generation with SSE streaming
 *
 * Extracts generation logic from SyntheticTab to:
 * - Reduce component complexity and re-renders
 * - Enable reuse of generation logic
 * - Centralize SSE event handling for batch generation
 *
 * Handles:
 * - Tuple generation (for preview/review flow)
 * - Query generation from tuples
 * - Direct batch generation (one-step flow)
 * - Progress tracking
 * - Abort/cleanup
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { getBackendUrl } from "./api";
import type { Dimension, BatchDetail } from "../types";

// ============================================================================
// Types
// ============================================================================

export interface PreviewTuple {
  id: string;
  values: Record<string, string>;
}

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
  useDimensions: boolean;
  onBatchCreated?: (batchId: string, batchName: string) => void;
  onBatchComplete?: (batch: { id: string; name: string; queries: GeneratedQuery[] }) => void;
  onQueryGenerated?: (query: GeneratedQuery, progress: GenerationProgress) => void;
}

export interface UseBatchGenerationReturn {
  // Tuple preview state
  previewTuples: PreviewTuple[];
  selectedTupleIds: Set<string>;
  editingTupleId: string | null;
  generatingTuples: boolean;

  // Query generation state
  generating: boolean;
  generatingQueries: boolean;
  genProgress: GenerationProgress | null;

  // Accumulated queries during streaming (for batch UI updates)
  streamingQueries: GeneratedQuery[];

  // Actions
  generateTuplesPreview: (count: number) => Promise<void>;
  generateQueriesFromTuples: () => Promise<void>;
  generateBatch: (count: number) => Promise<void>;
  stopGeneration: () => void;

  // Tuple management
  setSelectedTupleIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setEditingTupleId: React.Dispatch<React.SetStateAction<string | null>>;
  updateTupleValue: (tupleId: string, dimensionKey: string, newValue: string) => void;
  deleteTupleFromPreview: (tupleId: string) => void;
  clearTuplesPreview: () => void;
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
    useDimensions,
    onBatchCreated,
    onBatchComplete,
    onQueryGenerated,
  } = options;

  // ========== STATE ==========

  // Tuple preview (two-step flow)
  const [previewTuples, setPreviewTuples] = useState<PreviewTuple[]>([]);
  const [selectedTupleIds, setSelectedTupleIds] = useState<Set<string>>(new Set());
  const [editingTupleId, setEditingTupleId] = useState<string | null>(null);
  const [generatingTuples, setGeneratingTuples] = useState(false);

  // Query generation
  const [generating, setGenerating] = useState(false);
  const [generatingQueries, setGeneratingQueries] = useState(false);
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

  // ========== TUPLE ACTIONS ==========

  const updateTupleValue = useCallback(
    (tupleId: string, dimensionKey: string, newValue: string) => {
      setPreviewTuples((prev) =>
        prev.map((t) => {
          if (t.id === tupleId) {
            return { ...t, values: { ...t.values, [dimensionKey]: newValue } };
          }
          return t;
        })
      );
    },
    []
  );

  const deleteTupleFromPreview = useCallback((tupleId: string) => {
    setPreviewTuples((prev) => prev.filter((t) => t.id !== tupleId));
    setSelectedTupleIds((prev) => {
      const newSet = new Set(prev);
      newSet.delete(tupleId);
      return newSet;
    });
    setEditingTupleId((prev) => (prev === tupleId ? null : prev));
  }, []);

  const clearTuplesPreview = useCallback(() => {
    setPreviewTuples([]);
    setSelectedTupleIds(new Set());
    setEditingTupleId(null);
  }, []);

  // ========== GENERATION ACTIONS ==========

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setGenerating(false);
    setGeneratingQueries(false);
    setGenProgress(null);
  }, []);

  /**
   * Step 1: Generate tuples only (for user preview/review)
   * Used when useDimensions=false (LLM Decides mode)
   */
  const generateTuplesPreview = useCallback(
    async (count: number) => {
      if (!agentId) return;

      setGeneratingTuples(true);
      setPreviewTuples([]);
      setSelectedTupleIds(new Set());

      try {
        const backendUrl = getBackendUrl();

        // Get selected dimensions (only if useDimensions is true)
        const customDimensions =
          useDimensions && dimensions.length > 0
            ? dimensions
                .filter((d) => selectedDimensionIds.has(d.id))
                .reduce(
                  (acc, d) => ({ ...acc, [d.name]: d.values }),
                  {} as Record<string, string[]>
                )
            : undefined;

        const response = await fetch(`${backendUrl}/api/synthetic/tuples`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_id: agentId,
            count,
            custom_dimensions: customDimensions,
          }),
        });

        if (!response.ok) throw new Error("Failed to generate tuples");

        const tuples = await response.json();
        setPreviewTuples(tuples);
        // Select all tuples by default
        setSelectedTupleIds(new Set(tuples.map((t: PreviewTuple) => t.id)));
      } catch (error) {
        console.error("Error generating tuples:", error);
      } finally {
        setGeneratingTuples(false);
      }
    },
    [agentId, useDimensions, dimensions, selectedDimensionIds]
  );

  /**
   * Step 2: Generate queries from approved tuples
   */
  const generateQueriesFromTuples = useCallback(async () => {
    if (!agentId || previewTuples.length === 0) return;

    // Get only selected tuples
    const approvedTuples = previewTuples.filter((t) =>
      selectedTupleIds.has(t.id)
    );
    if (approvedTuples.length === 0) return;

    setGeneratingQueries(true);
    setGenProgress({ total: approvedTuples.length, completed: 0, percent: 0 });
    streamingQueriesRef.current = [];
    setStreamingQueries([]);

    let currentBatchId = "";
    let currentBatchName = "";

    try {
      const backendUrl = getBackendUrl();

      const response = await fetch(
        `${backendUrl}/api/synthetic/batches/generate-from-tuples`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_id: agentId,
            tuples: approvedTuples.map((t) => t.values),
          }),
        }
      );

      if (!response.ok) throw new Error("Failed to generate queries");

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
              } else if (event.type === "query_generated") {
                streamingQueriesRef.current = [
                  ...streamingQueriesRef.current,
                  event.query,
                ];
                const progress: GenerationProgress = {
                  total: event.total,
                  completed: event.completed,
                  percent: event.progress_percent,
                };
                setGenProgress(progress);
                onQueryGenerated?.(event.query, progress);

                // Batch update UI every 10 queries
                if (streamingQueriesRef.current.length % 10 === 0) {
                  setStreamingQueries([...streamingQueriesRef.current]);
                }
              } else if (event.type === "batch_complete") {
                // Clear tuples preview after successful generation
                setPreviewTuples([]);
                setSelectedTupleIds(new Set());
                onBatchComplete?.({
                  id: currentBatchId,
                  name: currentBatchName,
                  queries: event.queries || streamingQueriesRef.current,
                });
              }
            } catch {
              console.warn("Failed to parse SSE event:", line);
            }
          }
        }
      }
    } catch (error) {
      console.error("Error generating queries:", error);
    } finally {
      setGeneratingQueries(false);
      setStreamingQueries([...streamingQueriesRef.current]);
      setTimeout(() => setGenProgress(null), 2000);
    }
  }, [
    agentId,
    previewTuples,
    selectedTupleIds,
    onBatchCreated,
    onBatchComplete,
    onQueryGenerated,
  ]);

  /**
   * One-step generation: Generate batch directly (when useDimensions=true)
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
          useDimensions && dimensions.length > 0
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
              use_dimensions: useDimensions,
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
      useDimensions,
      dimensions,
      selectedDimensionIds,
      onBatchCreated,
      onBatchComplete,
      onQueryGenerated,
    ]
  );

  // ========== RETURN ==========

  return {
    // Tuple preview state
    previewTuples,
    selectedTupleIds,
    editingTupleId,
    generatingTuples,

    // Query generation state
    generating,
    generatingQueries,
    genProgress,
    streamingQueries,

    // Actions
    generateTuplesPreview,
    generateQueriesFromTuples,
    generateBatch,
    stopGeneration,

    // Tuple management
    setSelectedTupleIds,
    setEditingTupleId,
    updateTupleValue,
    deleteTupleFromPreview,
    clearTuplesPreview,
  };
}

