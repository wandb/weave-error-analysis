/**
 * useSSEStream - Reusable hook for Server-Sent Events streaming
 * 
 * Extracts common SSE streaming logic from SyntheticTab to provide:
 * - Automatic abort controller management
 * - SSE message parsing (data: prefix)
 * - Progress tracking
 * - Error handling
 * - Cleanup on unmount
 * 
 * Used by:
 * - Batch generation (generate-stream)
 * - Batch execution (execute)
 * - Tuple-based query generation (generate-from-tuples)
 */

import { useRef, useCallback, useEffect, useState } from "react";
import { getBackendUrl } from "./api";

// ============================================================================
// Types
// ============================================================================

export interface SSEStreamOptions<TEvent, TResult> {
  /** The endpoint path (appended to backend URL) */
  endpoint: string;
  
  /** HTTP method (default: POST) */
  method?: "GET" | "POST";
  
  /** Request body for POST requests */
  body?: Record<string, unknown>;
  
  /** Called for each parsed SSE event */
  onEvent: (event: TEvent) => void;
  
  /** Called when stream completes successfully */
  onComplete?: (result?: TResult) => void;
  
  /** Called when stream errors */
  onError?: (error: Error) => void;
  
  /** Called when stream starts */
  onStart?: () => void;
}

export interface SSEStreamState {
  /** Whether the stream is currently active */
  isStreaming: boolean;
  
  /** Progress percentage (0-100) if available */
  progress: number | null;
  
  /** Current status message */
  statusMessage: string | null;
}

export interface SSEStreamControls {
  /** Start the stream */
  start: () => Promise<void>;
  
  /** Abort the stream */
  stop: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useSSEStream<TEvent = unknown, TResult = unknown>(): [
  SSEStreamState,
  (options: SSEStreamOptions<TEvent, TResult>) => SSEStreamControls
] {
  const [state, setState] = useState<SSEStreamState>({
    isStreaming: false,
    progress: null,
    statusMessage: null,
  });
  
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);
  
  const createStream = useCallback(<TEvent, TResult>(
    options: SSEStreamOptions<TEvent, TResult>
  ): SSEStreamControls => {
    const start = async () => {
      // Abort any existing stream
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      
      setState({
        isStreaming: true,
        progress: 0,
        statusMessage: "Starting...",
      });
      
      options.onStart?.();
      
      try {
        const backendUrl = getBackendUrl();
        const url = `${backendUrl}${options.endpoint}`;
        
        const fetchOptions: RequestInit = {
          method: options.method || "POST",
          headers: { "Content-Type": "application/json" },
          signal: abortControllerRef.current.signal,
        };
        
        if (options.body && options.method !== "GET") {
          fetchOptions.body = JSON.stringify(options.body);
        }
        
        const response = await fetch(url, fetchOptions);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        if (!response.body) {
          throw new Error("No response body");
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalResult: TResult | undefined;
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer
          
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const eventData = JSON.parse(line.slice(6)) as TEvent;
                options.onEvent(eventData);
                
                // Update progress if event has progress info
                const eventWithProgress = eventData as unknown as { 
                  progress_percent?: number; 
                  completed?: number;
                  total?: number;
                  status?: string;
                };
                
                if (eventWithProgress.progress_percent !== undefined) {
                  setState(prev => ({
                    ...prev,
                    progress: eventWithProgress.progress_percent ?? prev.progress,
                  }));
                } else if (eventWithProgress.completed !== undefined && eventWithProgress.total) {
                  setState(prev => ({
                    ...prev,
                    progress: Math.round((eventWithProgress.completed! / eventWithProgress.total!) * 100),
                  }));
                }
                
                if (eventWithProgress.status) {
                  setState(prev => ({
                    ...prev,
                    statusMessage: eventWithProgress.status ?? prev.statusMessage,
                  }));
                }
                
                // Check for completion markers
                const eventWithType = eventData as unknown as { type?: string };
                if (eventWithType.type === "batch_complete" || 
                    eventWithType.type === "completed" ||
                    eventWithProgress.status === "completed") {
                  finalResult = eventData as unknown as TResult;
                }
              } catch {
                // Skip malformed events
                console.debug("[SSE] Skipped malformed event:", line);
              }
            }
          }
        }
        
        setState({
          isStreaming: false,
          progress: 100,
          statusMessage: "Complete",
        });
        
        options.onComplete?.(finalResult);
        
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          setState({
            isStreaming: false,
            progress: null,
            statusMessage: "Cancelled",
          });
          return;
        }
        
        setState({
          isStreaming: false,
          progress: null,
          statusMessage: `Error: ${(error as Error).message}`,
        });
        
        options.onError?.(error as Error);
        console.error("[SSE] Stream error:", error);
      }
    };
    
    const stop = () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setState({
        isStreaming: false,
        progress: null,
        statusMessage: "Stopped",
      });
    };
    
    return { start, stop };
  }, []);
  
  return [state, createStream];
}

// ============================================================================
// Typed Event Helpers (for common patterns)
// ============================================================================

/** Event types for batch generation streaming */
export interface BatchGenerationEvent {
  type: "batch_started" | "tuples_generated" | "query_generated" | "batch_complete";
  batch_id?: string;
  name?: string;
  total?: number;
  completed?: number;
  progress_percent?: number;
  query?: {
    id: string;
    query_text: string;
    tuple_values: Record<string, string>;
  };
  queries?: Array<{
    id: string;
    query_text: string;
    tuple_values: Record<string, string>;
  }>;
  count?: number;
}

/** Event types for batch execution streaming */
export interface BatchExecutionEvent {
  batch_id: string;
  status: "starting" | "running" | "completed" | "failed" | "cancelled";
  total_queries: number;
  completed_queries: number;
  success_count: number;
  failure_count: number;
  progress_percent: number;
  current_query_id?: string;
  current_query_text?: string;
  estimated_remaining_seconds?: number;
}

/** Event types for tuple generation */
export interface TupleGenerationEvent {
  type: "tuples" | "error";
  tuples?: Array<{
    id: string;
    values: Record<string, string>;
  }>;
  error?: string;
}

