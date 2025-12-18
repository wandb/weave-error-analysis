"use client";

import { useState, useRef, useEffect } from "react";
import {
  Cpu,
  Target,
  Plus,
  Zap,
  MessageSquare,
  RefreshCw,
  Play,
  Trash2,
  Edit3,
  ChevronDown,
  ChevronUp,
  Hash,
  Copy,
  Check,
  HelpCircle,
  Square,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Bot,
  Tag,
  Eye,
  Loader2,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { formatRelativeTime } from "../../utils/formatters";
import { Panel, Badge, StatusBadge, SelectPrompt, ProgressBar } from "../ui";
import { EditPromptButton } from "../PromptEditDrawer";
import * as api from "../../lib/api";
import { getBackendUrl } from "../../lib/api";
import type { ExecutionProgress, BatchDetail } from "../../types";

export function SyntheticTab() {
  const {
    agents,
    selectedAgent,
    dimensions,
    loadingDimensions,
    syntheticBatches,
    selectedBatch,
    executingBatch,
    fetchAgentDetail,
    fetchDimensions,
    importDimensions,
    fetchBatches,
    fetchBatchDetail,
    setSelectedBatch,
    deleteBatch,
    setActiveTab,
    setFilterBatchId,
    setFilterBatchName,
    fetchSessionDetail,
  } = useApp();

  // ========== EXECUTION STATE (merged from RunsTab) ==========
  const [executingBatchId, setExecutingBatchId] = useState<string | null>(null);
  const [executionProgress, setExecutionProgress] = useState<ExecutionProgress | null>(null);
  const executionAbortRef = useRef<AbortController | null>(null);
  const lastFetchedCountRef = useRef<number>(0);

  // Cleanup execution AbortController on unmount
  useEffect(() => {
    return () => {
      executionAbortRef.current?.abort();
    };
  }, []);

  // Generation settings
  const [batchSize, setBatchSize] = useState(20);
  // LLM config (model/temperature) is now per-prompt, configured in prompt drawer
  
  
  // Generation state
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<{ completed: number; total: number; percent: number; currentQuery?: string } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingQueriesRef = useRef<Array<{ id: string; query_text: string; tuple_values: Record<string, string> }>>([]);

  // Cleanup AbortController on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Query editing and expansion
  const [selectedQueryIds, setSelectedQueryIds] = useState<Set<string>>(new Set());
  const [editingQueryId, setEditingQueryId] = useState<string | null>(null);
  const [expandedQueryIds, setExpandedQueryIds] = useState<Set<string>>(new Set());

  // ========== TWO-STEP GENERATION: Tuples Preview ==========
  // Step 1: Generate tuples for user review
  // Step 2: Generate queries from approved tuples
  interface PreviewTuple {
    id: string;
    values: Record<string, string>;
  }
  const [previewTuples, setPreviewTuples] = useState<PreviewTuple[]>([]);
  const [generatingTuples, setGeneratingTuples] = useState(false);
  const [generatingQueries, setGeneratingQueries] = useState(false);
  const [selectedTupleIds, setSelectedTupleIds] = useState<Set<string>>(new Set());
  const [editingTupleId, setEditingTupleId] = useState<string | null>(null);

  // Dimension editing
  const [editingDimension, setEditingDimension] = useState<string | null>(null);
  const [newDimensionName, setNewDimensionName] = useState("");
  const [newDimensionValues, setNewDimensionValues] = useState("");
  const [showAddDimension, setShowAddDimension] = useState(false);
  
  // LLM Guided dimension selection - which dimensions to use for generation
  const [selectedDimensionIds, setSelectedDimensionIds] = useState<Set<string>>(new Set());
  const [showDimensionSelector, setShowDimensionSelector] = useState(false);
  // Toggle: true = use user-defined dimensions, false = let LLM generate freely
  const [useDimensions, setUseDimensions] = useState(true);
  
  // Initialize selected dimensions when dimensions load
  useEffect(() => {
    if (dimensions.length > 0 && selectedDimensionIds.size === 0) {
      setSelectedDimensionIds(new Set(dimensions.map(d => d.id)));
    }
  }, [dimensions]);

  // Batches panel
  const [showBatches, setShowBatches] = useState(false);
  const [copiedBatchId, setCopiedBatchId] = useState<string | null>(null);
  const [copiedQueryId, setCopiedQueryId] = useState<string | null>(null);
  const [copiedAllSelected, setCopiedAllSelected] = useState(false);
  const [showImportHelp, setShowImportHelp] = useState(false);
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());

  // Collapsible sections
  const [dimensionsCollapsed, setDimensionsCollapsed] = useState(false);
  const [batchesCollapsed, setBatchesCollapsed] = useState(false);

  // Synced panel height - both panels resize together
  const [syncedPanelHeight, setSyncedPanelHeight] = useState(280);
  const dimensionsPanelRef = useRef<HTMLDivElement>(null);
  const batchesPanelRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);

  // ResizeObserver to sync panel heights
  useEffect(() => {
    const dimensionsPanel = dimensionsPanelRef.current;
    const batchesPanel = batchesPanelRef.current;
    
    if (!dimensionsPanel || !batchesPanel) return;

    const observer = new ResizeObserver((entries) => {
      // Avoid infinite loops by checking if we're programmatically resizing
      if (isResizingRef.current) return;
      
      for (const entry of entries) {
        const newHeight = entry.contentRect.height + 32; // Add padding
        if (Math.abs(newHeight - syncedPanelHeight) > 5) {
          isResizingRef.current = true;
          setSyncedPanelHeight(newHeight);
          // Reset flag after a short delay
          setTimeout(() => { isResizingRef.current = false; }, 50);
        }
      }
    });

    observer.observe(dimensionsPanel);
    observer.observe(batchesPanel);

    return () => observer.disconnect();
  }, [syncedPanelHeight]);

  const handleSaveDimension = async (dimName: string, values: string[]) => {
    if (!selectedAgent) return;
    try {
      await api.saveDimension(selectedAgent.id, dimName, values);
      await fetchDimensions(selectedAgent.id);
      setEditingDimension(null);
    } catch (error) {
      console.error("Error saving dimension:", error);
    }
  };

  const handleAddDimension = async () => {
    if (!selectedAgent || !newDimensionName || !newDimensionValues) return;
    const values = newDimensionValues.split(",").map((v) => v.trim()).filter(Boolean);
    await handleSaveDimension(newDimensionName, values);
    setNewDimensionName("");
    setNewDimensionValues("");
    setShowAddDimension(false);
  };

  const handleDeleteDimension = async (dimName: string) => {
    if (!selectedAgent) return;
    if (!confirm(`Delete dimension "${dimName}"?`)) return;
    try {
      await api.deleteDimension(selectedAgent.id, dimName);
      await fetchDimensions(selectedAgent.id);
    } catch (error) {
      console.error("Error deleting dimension:", error);
    }
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setGenerating(false);
    setGenProgress(null);
  };

  // ========== EXECUTION FUNCTIONS (merged from RunsTab) ==========
  
  const stopExecution = () => {
    if (executionAbortRef.current) {
      executionAbortRef.current.abort();
      executionAbortRef.current = null;
    }
    setExecutingBatchId(null);
    setExecutionProgress(null);
  };

  const executeBatch = async (batchId: string, batchName: string, agentId: string) => {
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

    // Immediately select this batch to show results as they come in
    setSelectedBatch({ id: batchId, name: batchName, queries: [] });

    let hasRefreshedBatches = false;

    try {
      // Use direct backend URL to avoid Next.js proxy buffering SSE
      const backendUrl = getBackendUrl();
      
      const response = await fetch(`${backendUrl}/api/synthetic/batches/${batchId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeout_per_query: 60.0 }),
        signal: executionAbortRef.current.signal,
      });

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
              console.log("[Execute] Progress update:", data);
              setExecutionProgress({ ...data, start_time: startTime });

              // Refresh batches once when status changes to running (to show in Active section)
              if (data.status === "running" && !hasRefreshedBatches) {
                hasRefreshedBatches = true;
                fetchBatches(agentId);
              }
              
              // Batch refresh: only fetch batch detail every 5 completed queries to reduce re-renders
              const completedQueries = data.completed_queries || 0;
              if (completedQueries > 0 && completedQueries - lastFetchedCountRef.current >= 5) {
                lastFetchedCountRef.current = completedQueries;
                fetchBatchDetail(batchId);
              }

              // Final refresh when done
              if (data.status === "completed" || data.status === "failed" || data.status === "cancelled") {
                await fetchBatches(agentId);
                await fetchBatchDetail(batchId);
                // Auto-trigger AI analysis on successful completion
              }
            } catch (e) {
              console.log("[Execute] Failed to parse:", line, e);
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error("Error executing batch:", error);
      }
    } finally {
      setExecutingBatchId(null);
      // Ensure final refresh
      await fetchBatches(agentId);
      // Don't clear progress immediately so user can see final state
      setTimeout(() => setExecutionProgress(null), 3000);
    }
  };

  const resetBatch = async (batchId: string, agentId: string, onlyFailed: boolean = false) => {
    try {
      await api.resetBatch(batchId, onlyFailed);
      await fetchBatches(agentId);
      await fetchBatchDetail(batchId);
    } catch (error) {
      console.error("Error resetting batch:", error);
    }
  };

  const viewInThreads = () => {
    if (!selectedBatch) return;
    setFilterBatchId(selectedBatch.id);
    setFilterBatchName(selectedBatch.name);
    setActiveTab("threads");
  };

  // ========== TWO-STEP GENERATION FUNCTIONS ==========
  
  // Step 1: Generate tuples only (for user preview/review)
  const generateTuplesPreview = async () => {
    if (!selectedAgent) return;
    
    setGeneratingTuples(true);
    setPreviewTuples([]);
    setSelectedTupleIds(new Set());
    
    try {
      const backendUrl = getBackendUrl();
      
      // Get selected dimensions (only if useDimensions is true)
      const customDimensions = (useDimensions && dimensions.length > 0)
        ? dimensions
            .filter(d => selectedDimensionIds.has(d.id))
            .reduce((acc, d) => ({ ...acc, [d.name]: d.values }), {} as Record<string, string[]>)
        : undefined;
      
      const response = await fetch(`${backendUrl}/api/synthetic/tuples`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: selectedAgent.id,
          count: batchSize,
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
  };
  
  // Step 2: Generate queries from approved tuples
  const generateQueriesFromTuples = async () => {
    if (!selectedAgent || previewTuples.length === 0) return;
    
    // Get only selected tuples
    const approvedTuples = previewTuples.filter(t => selectedTupleIds.has(t.id));
    if (approvedTuples.length === 0) return;
    
    setGeneratingQueries(true);
    setGenProgress({ total: approvedTuples.length, completed: 0, percent: 0 });
    streamingQueriesRef.current = [];
    
    let currentBatchId = "";
    let currentBatchName = "";
    
    try {
      const backendUrl = getBackendUrl();
      
      // Create batch and generate queries from approved tuples
      const response = await fetch(`${backendUrl}/api/synthetic/batches/generate-from-tuples`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: selectedAgent.id,
          tuples: approvedTuples.map(t => t.values),
        }),
      });
      
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
              } else if (event.type === "query_generated") {
                streamingQueriesRef.current = [...streamingQueriesRef.current, event.query];
                setGenProgress({
                  total: event.total,
                  completed: event.completed,
                  percent: event.progress_percent,
                });
              } else if (event.type === "batch_complete") {
                // Clear tuples preview after successful generation
                setPreviewTuples([]);
                setSelectedTupleIds(new Set());
              }
            } catch (e) {
              console.warn("Failed to parse SSE event:", line);
            }
          }
        }
      }
      
      // Refresh batches and select the new one
      await fetchBatches(selectedAgent.id);
      if (currentBatchId) {
        await fetchBatchDetail(currentBatchId);
      }
      
    } catch (error) {
      console.error("Error generating queries:", error);
    } finally {
      setGeneratingQueries(false);
      setTimeout(() => setGenProgress(null), 2000);
    }
  };
  
  // Delete a tuple from preview
  const deleteTupleFromPreview = (tupleId: string) => {
    setPreviewTuples(prev => prev.filter(t => t.id !== tupleId));
    setSelectedTupleIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(tupleId);
      return newSet;
    });
    if (editingTupleId === tupleId) setEditingTupleId(null);
  };
  
  // Clear tuples preview
  const clearTuplesPreview = () => {
    setPreviewTuples([]);
    setSelectedTupleIds(new Set());
    setEditingTupleId(null);
  };
  
  // Update a tuple's dimension value
  const updateTupleValue = (tupleId: string, dimensionKey: string, newValue: string) => {
    setPreviewTuples(prev => prev.map(t => {
      if (t.id === tupleId) {
        return { ...t, values: { ...t.values, [dimensionKey]: newValue } };
      }
      return t;
    }));
  };

  const generateBatch = async () => {
    if (!selectedAgent) return;
    
    // Create new abort controller for this generation
    abortControllerRef.current = new AbortController();
    // Reset streaming queries ref to avoid re-render storms
    streamingQueriesRef.current = [];
    
    setGenerating(true);
    setGenProgress({ total: batchSize, completed: 0, percent: 0 });

    // Let the backend generate a consistent batch name using its batch_id
    // This ensures the ID shown in Synthetic tab matches the name in Threads tab
    let currentBatchId = "";
    let currentBatchName = "";

    try {
      // Use direct backend URL for SSE streaming to bypass Next.js proxy buffering
      const backendUrl = getBackendUrl();
      
      // Get selected dimensions (only if useDimensions is true)
      const selectedDimensions = (useDimensions && dimensions.length > 0)
        ? dimensions
            .filter(d => selectedDimensionIds.has(d.id))
            .reduce((acc, d) => ({ ...acc, [d.name]: d.values }), {} as Record<string, string[]>)
        : undefined;
      
      const response = await fetch(`${backendUrl}/api/synthetic/batches/generate-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: selectedAgent.id,
          // Don't send name - let backend generate consistent name using its batch_id
          count: batchSize,
          // Model and temperature are now per-prompt, configured in the prompt drawer
          selected_dimensions: selectedDimensions,  // undefined = LLM decides freely
          use_dimensions: useDimensions,  // explicit flag for backend
        }),
        signal: abortControllerRef.current.signal,
      });

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
                setSelectedBatch({ id: event.batch_id, name: event.name, queries: [] });
                // Show initial progress with "preparing" state
                setGenProgress({
                  total: event.total,
                  completed: 0,
                  percent: 0,
                  currentQuery: "Preparing test cases...",
                });
              } else if (event.type === "tuples_generated") {
                // Update to show we're starting query generation
                setGenProgress((prev) => prev ? {
                  ...prev,
                  total: event.count,
                  currentQuery: "Generating queries...",
                } : null);
              } else if (event.type === "query_generated") {
                // Accumulate queries in ref to avoid re-render storms
                streamingQueriesRef.current.push(event.query);
                
                // Only update progress UI (lightweight update)
                setGenProgress({
                  total: event.total,
                  completed: event.completed,
                  percent: event.progress_percent,
                  currentQuery: event.query.query_text.slice(0, 60) + "...",
                });
                
                // Batch update UI every 10 queries to show progress without excessive re-renders
                if (streamingQueriesRef.current.length % 10 === 0) {
                  setSelectedBatch((prev) =>
                    prev ? { ...prev, queries: [...streamingQueriesRef.current] } : null
                  );
                }
              } else if (event.type === "batch_complete") {
                await fetchBatches(selectedAgent.id);
                // Final update with all queries from the event (authoritative source)
                setSelectedBatch({ id: event.batch_id, name: event.name, queries: event.queries });
                setShowBatches(true);
              }
            } catch {
              // Skip malformed events
            }
          }
        }
      }
      
      // If stream ended without batch_complete, update with accumulated queries
      if (streamingQueriesRef.current.length > 0 && currentBatchId) {
        setSelectedBatch((prev) =>
          prev?.id === currentBatchId 
            ? { ...prev, queries: streamingQueriesRef.current } 
            : prev
        );
      }
    } catch (error) {
      console.error("Error generating batch:", error);
    } finally {
      setGenerating(false);
      setGenProgress(null);
      streamingQueriesRef.current = []; // Clean up ref
    }
  };

  const handleDeleteSelectedQueries = async () => {
    if (!selectedAgent || selectedQueryIds.size === 0) return;
    if (!confirm(`Delete ${selectedQueryIds.size} selected queries?`)) return;
    try {
      await api.bulkDeleteQueries(Array.from(selectedQueryIds));
      setSelectedBatch((prev) =>
        prev ? { ...prev, queries: prev.queries.filter((q) => !selectedQueryIds.has(q.id)) } : null
      );
      setSelectedQueryIds(new Set());
      await fetchBatches(selectedAgent.id);
    } catch (error) {
      console.error("Error deleting queries:", error);
    }
  };

  const handleUpdateQuery = async (queryId: string, newText: string) => {
    try {
      await api.updateQuery(queryId, newText);
      setSelectedBatch((prev) =>
        prev ? { ...prev, queries: prev.queries.map((q) => (q.id === queryId ? { ...q, query_text: newText } : q)) } : null
      );
      setEditingQueryId(null);
    } catch (error) {
      console.error("Error updating query:", error);
    }
  };

  const handleDeleteBatch = async (batchId: string) => {
    if (!selectedAgent) return;
    if (!confirm("Delete this batch and all its queries?")) return;
    await deleteBatch(batchId, selectedAgent.id);
    if (selectedBatch?.id === batchId) {
      setSelectedBatch(null);
    }
    setSelectedBatchIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(batchId);
      return newSet;
    });
  };

  const handleDeleteSelectedBatches = async () => {
    if (!selectedAgent || selectedBatchIds.size === 0) return;
    if (!confirm(`Delete ${selectedBatchIds.size} selected batches and all their queries?`)) return;
    
    for (const batchId of selectedBatchIds) {
      await deleteBatch(batchId, selectedAgent.id);
      if (selectedBatch?.id === batchId) {
        setSelectedBatch(null);
      }
    }
    setSelectedBatchIds(new Set());
  };

  const copyBatchId = (batchId: string) => {
    navigator.clipboard.writeText(batchId);
    setCopiedBatchId(batchId);
    setTimeout(() => setCopiedBatchId(null), 2000);
  };

  const copyQueryText = (queryId: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedQueryId(queryId);
    setTimeout(() => setCopiedQueryId(null), 2000);
  };

  const copySelectedQueries = () => {
    if (!selectedBatch?.queries || selectedQueryIds.size === 0) return;
    const selectedTexts = selectedBatch.queries
      .filter(q => selectedQueryIds.has(q.id))
      .map(q => q.query_text)
      .join('\n\n---\n\n');
    navigator.clipboard.writeText(selectedTexts);
    setCopiedAllSelected(true);
    setTimeout(() => setCopiedAllSelected(false), 2000);
  };

  // If no agent selected, show prompt pointing to Agents tab
  if (!selectedAgent) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <div className="text-center text-moon-450">
          <Cpu className="w-16 h-16 mx-auto mb-4 opacity-40" />
          <h2 className="text-xl font-display mb-2 text-moon-50">Select an agent to get started</h2>
          <p className="mb-4">
            {agents.length === 0 
              ? "Register an agent first to generate synthetic test data."
              : "Select an agent from the Agents tab to generate synthetic test data."
            }
          </p>
          <button 
            onClick={() => setActiveTab("agents")} 
            className="inline-flex items-center gap-2 px-6 py-3 rounded-md font-medium transition-all bg-gold text-moon-900"
          >
            <Cpu className="w-4 h-4" />
            {agents.length === 0 ? "REGISTER AN AGENT" : "GO TO AGENTS TAB"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ========== TOP CONTROL BAR ========== */}
      <div className="rounded-lg p-4 flex flex-wrap items-center gap-4 bg-moon-800 border border-moon-700">
        {/* Agent Dropdown */}
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-moon-450" />
          <select
            value={selectedAgent?.id || ""}
            onChange={(e) => {
              const agent = agents.find(a => a.id === e.target.value);
              if (agent) fetchAgentDetail(agent.id);
            }}
            className="px-3 py-2 rounded-md text-sm min-w-[200px] bg-moon-900 border border-moon-700 text-moon-50"
          >
              {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} ({agent.connection_status})
              </option>
            ))}
          </select>
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-moon-700" />

        {/* Quick Settings */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Hash className="w-4 h-4 text-moon-450" />
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={batchSize}
              onChange={(e) => {
                const val = e.target.value;
                // Allow empty string while typing
                if (val === '') {
                  setBatchSize('' as unknown as number);
                  return;
                }
                // Only allow numeric input
                if (/^\d+$/.test(val)) {
                  const num = parseInt(val, 10);
                  setBatchSize(Math.min(100, num));
                }
              }}
              onBlur={(e) => {
                // On blur, ensure valid value (minimum 1)
                const val = e.target.value;
                if (val === '' || parseInt(val, 10) < 1) {
                  setBatchSize(1);
                }
              }}
              className="w-16 px-2 py-1.5 rounded text-sm text-center bg-moon-900 border border-moon-700 text-moon-50"
            />
            <span className="text-xs text-moon-450">queries</span>
          </div>

          {/* Dimension mode selector */}
          {(
            <div className="relative">
              <button
                onClick={() => setShowDimensionSelector(!showDimensionSelector)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors border border-moon-700 ${
                  showDimensionSelector ? 'bg-teal/15 text-teal' : 'bg-moon-900 text-moon-50'
                }`}
              >
                <Target className="w-3.5 h-3.5" />
                <span>
                  {useDimensions 
                    ? `${selectedDimensionIds.size}/${dimensions.length} dimensions` 
                    : 'LLM decides'
                  }
                </span>
                {showDimensionSelector ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              
              {showDimensionSelector && (
                <div className="absolute top-full left-0 mt-1 p-3 rounded-lg z-50 min-w-[320px] bg-moon-800 border border-teal shadow-lg">
                  {/* Mode Toggle */}
                  <div className="flex gap-1 p-1 rounded-lg mb-3 bg-moon-900">
                    <button
                      onClick={() => setUseDimensions(true)}
                      className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition-all ${
                        useDimensions ? 'bg-teal text-moon-900' : 'bg-transparent text-moon-450'
                      }`}
                    >
                      Use Dimensions
                    </button>
                    <button
                      onClick={() => setUseDimensions(false)}
                      className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition-all ${
                        !useDimensions ? 'bg-gold text-moon-900' : 'bg-transparent text-moon-450'
                      }`}
                    >
                      LLM Decides
                    </button>
                  </div>
                  
                  {useDimensions ? (
                    <>
                      {/* Dimensions selection */}
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-teal">Select dimensions to use</span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setSelectedDimensionIds(new Set(dimensions.map(d => d.id)))}
                            className="text-xs px-2 py-0.5 rounded bg-moon-700 text-moon-450"
                          >
                            All
                          </button>
                          <button
                            onClick={() => setSelectedDimensionIds(new Set())}
                            className="text-xs px-2 py-0.5 rounded bg-moon-700 text-moon-450"
                          >
                            None
                          </button>
                        </div>
                      </div>
                      
                      {dimensions.length > 0 ? (
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {dimensions.map(dim => (
                            <label 
                              key={dim.id} 
                              className={`flex items-start gap-2 cursor-pointer p-2 rounded transition-colors hover:bg-opacity-50 ${
                                selectedDimensionIds.has(dim.id) ? 'bg-teal/10' : 'bg-transparent'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedDimensionIds.has(dim.id)}
                                onChange={(e) => {
                                  const newSet = new Set(selectedDimensionIds);
                                  if (e.target.checked) newSet.add(dim.id);
                                  else newSet.delete(dim.id);
                                  setSelectedDimensionIds(newSet);
                                }}
                                className="w-4 h-4 mt-0.5 rounded accent-teal"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm text-moon-50">{dim.name}</div>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {dim.values?.slice(0, 4).map((val, i) => (
                                    <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-moon-700 text-moon-450">
                                      {val}
                                    </span>
                                  ))}
                                  {dim.values?.length > 4 && (
                                    <span className="text-xs text-moon-450">+{dim.values.length - 4} more</span>
                                  )}
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-center py-4 text-moon-450">
                          No dimensions defined. Add them in the Testing Dimensions panel or use "LLM Decides" mode.
                        </p>
                      )}
                      
                      {dimensions.length > 0 && selectedDimensionIds.size === 0 && (
                        <p className="text-xs mt-2 text-center text-gold">
                          ⚠️ Select at least one dimension
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-3">
                      <p className="text-sm mb-2 text-moon-50">
                        LLM will generate test case combinations freely
                      </p>
                      <p className="text-xs text-moon-450">
                        The LLM will create diverse tuples based on the agent's purpose without being constrained to predefined dimension values.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Edit Prompt Buttons - for customizing LLM prompts (model/temperature configured per-prompt) */}
        <div className="flex items-center gap-1 border-l border-moon-700 pl-2 ml-1">
          {/* Only show Tuples edit when LLM decides mode is active */}
          {!useDimensions && (
            <EditPromptButton
              promptId="tuple_generation_free"
              label="Tuples"
              size="sm"
              variant="ghost"
            />
          )}
          <EditPromptButton
            promptId="query_generation"
            label="Queries"
            size="sm"
            variant="ghost"
          />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Generation Buttons - Different flow based on useDimensions */}
        <div className="flex items-center gap-2">
          {/* When useDimensions=true: Direct query generation (yellow) */}
          {useDimensions && previewTuples.length === 0 && (
            <button
              onClick={generateBatch}
              disabled={generating || selectedDimensionIds.size === 0}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-md font-medium transition-all disabled:opacity-50 ${
                generating ? 'bg-moon-700 text-moon-450' : 'bg-gold text-moon-900'
              }`}
              title={selectedDimensionIds.size === 0 ? "Select at least one dimension" : undefined}
            >
              {generating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>GENERATING...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>GENERATE {batchSize} QUERIES</span>
                </>
              )}
            </button>
          )}
          
          {/* When useDimensions=false (LLM Decides): Two-step flow with tuple preview (cyan) */}
          {!useDimensions && previewTuples.length === 0 && (
            <button
              onClick={generateTuplesPreview}
              disabled={generatingTuples || generatingQueries}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-md font-medium transition-all disabled:opacity-50 ${
                generatingTuples ? 'bg-moon-700 text-moon-450' : 'bg-teal text-moon-900'
              }`}
              title="LLM will generate test case combinations for your review"
            >
              {generatingTuples ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>GENERATING TUPLES...</span>
                </>
              ) : (
                <>
                  <Target className="w-4 h-4" />
                  <span>GENERATE {batchSize} TUPLES</span>
                </>
              )}
            </button>
          )}
          
          {/* After tuples generated: Show approve/generate buttons */}
          {previewTuples.length > 0 && (
            <>
              <button
                onClick={clearTuplesPreview}
                disabled={generatingQueries}
                className="flex items-center gap-2 px-3 py-2.5 rounded-md font-medium transition-all disabled:opacity-50 bg-moon-700 text-moon-450"
                title="Clear tuples and start over"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                onClick={generateQueriesFromTuples}
                disabled={generatingQueries || selectedTupleIds.size === 0}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-md font-medium transition-all disabled:opacity-50 ${
                  generatingQueries ? 'bg-moon-700 text-moon-450' : 'bg-gold text-moon-900'
                }`}
                title={selectedTupleIds.size === 0 ? "Select at least one tuple" : `Generate queries from ${selectedTupleIds.size} selected tuples`}
              >
                {generatingQueries ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>GENERATING QUERIES...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    <span>GENERATE {selectedTupleIds.size} QUERIES</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
      
      {/* Click-away listener for dimension selector */}
      {showDimensionSelector && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setShowDimensionSelector(false)}
        />
      )}

      {/* ========== MAIN CONTENT ========== */}
      <div className="flex flex-col gap-4">
        {/* TOP ROW: Testing Dimensions + Generated Batches (side by side) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* LEFT: Testing Dimensions */}
          <div 
            ref={dimensionsPanelRef}
            className={`rounded-lg p-4 flex flex-col overflow-hidden bg-ink-900 border border-moon-700 ${
              dimensionsCollapsed ? '' : 'resize-y'
            }`}
            style={{ 
              height: dimensionsCollapsed ? 'auto' : `${syncedPanelHeight}px`,
              minHeight: dimensionsCollapsed ? 'auto' : '200px',
              maxHeight: dimensionsCollapsed ? 'auto' : '600px',
            }}
          >
          <div className="flex items-center justify-between flex-shrink-0">
            <button
              onClick={() => setDimensionsCollapsed(!dimensionsCollapsed)}
              className="font-display text-lg flex items-center gap-2 hover:opacity-80 transition-opacity text-moon-50"
            >
              {dimensionsCollapsed ? (
                <ChevronDown className="w-4 h-4 text-moon-450" />
              ) : (
                <ChevronUp className="w-4 h-4 text-moon-450" />
              )}
              <Target className="w-5 h-5 text-gold" />
              Testing dimensions
              <span className="text-xs px-2 py-0.5 rounded ml-1 bg-moon-700 text-moon-450">
                {dimensions.length}
              </span>
            </button>
            <div className="flex gap-2 items-center">
              <div 
                className="relative"
                onMouseLeave={() => setShowImportHelp(false)}
              >
                <button
                  onClick={() => importDimensions(selectedAgent.id)}
                  disabled={loadingDimensions}
                  className="text-xs px-3 py-1.5 rounded transition-colors flex items-center gap-1.5 bg-moon-800 text-moon-450 border border-moon-700"
                >
                  {loadingDimensions ? "..." : "Import from AGENT_INFO"}
                  <span
                    className="cursor-help"
                    onMouseEnter={() => setShowImportHelp(true)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <HelpCircle className={`w-3.5 h-3.5 ${showImportHelp ? 'text-gold' : 'text-moon-450'}`} />
                  </span>
                </button>
                {/* Tooltip - stays visible when hovering over it */}
                {showImportHelp && (
                  <div 
                    className="absolute right-0 top-full mt-1 p-4 rounded-lg z-50 w-96 text-xs cursor-default bg-moon-800 border border-gold shadow-xl"
                    onMouseEnter={() => setShowImportHelp(true)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium text-gold">Expected AGENT_INFO format:</p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`## Testing Dimensions
- **personas**: first_time_user, power_user
- **complexity**: simple, multi_step
- **scenarios**: pricing_inquiry, refund`);
                        }}
                        className="text-xs px-2 py-1 rounded flex items-center gap-1 transition-colors hover:opacity-80 bg-moon-700 text-moon-450"
                      >
                        <Copy className="w-3 h-3" />
                        Copy template
                </button>
                    </div>
                    <pre 
                      className="p-3 rounded text-xs overflow-x-auto mb-3 select-all bg-moon-900 text-moon-50"
                    >{`## Testing Dimensions
- **personas**: first_time_user, power_user
- **complexity**: simple, multi_step
- **scenarios**: pricing_inquiry, refund`}</pre>
                    <p className="text-moon-450">
                      Add a <code className="px-1 rounded bg-moon-700">## Testing Dimensions</code> section 
                      with bullet points in the format <code className="px-1 rounded bg-moon-700">- **name**: value1, value2</code>
                    </p>
                  </div>
                )}
              </div>
              <button 
                onClick={() => setShowAddDimension(true)} 
                className="p-1.5 rounded transition-colors bg-gold text-moon-900"
              >
                <Plus className="w-4 h-4" />
              </button>
              </div>
            </div>

          {/* Collapsible content */}
          {!dimensionsCollapsed && (
            <div className="mt-4 flex-1 flex flex-col overflow-hidden">
          {/* Add Dimension Form */}
            {showAddDimension && (
            <div className="rounded-lg p-4 mb-4 bg-moon-800 border border-gold">
              <h4 className="text-sm font-medium mb-3 text-moon-50">Add new dimension</h4>
                <input
                  type="text"
                placeholder="Dimension name (e.g., user_mood)"
                  value={newDimensionName}
                  onChange={(e) => setNewDimensionName(e.target.value)}
                className="w-full px-3 py-2 rounded text-sm mb-2 bg-moon-900 border border-moon-700 text-moon-50"
                />
                <textarea
                placeholder="Values (comma-separated, e.g., happy, frustrated, confused)"
                  value={newDimensionValues}
                  onChange={(e) => setNewDimensionValues(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded text-sm mb-3 bg-moon-900 border border-moon-700 text-moon-50"
                />
                <div className="flex gap-2">
                <button 
                  onClick={handleAddDimension} 
                  className="text-xs px-4 py-2 rounded font-medium bg-gold text-moon-900"
                >
                  ADD
                </button>
                <button 
                  onClick={() => { setShowAddDimension(false); setNewDimensionName(""); setNewDimensionValues(""); }} 
                  className="text-xs px-4 py-2 rounded bg-moon-700 text-moon-450"
                >
                  CANCEL
                </button>
                </div>
              </div>
            )}

          {/* Dimensions List */}
          <div className="space-y-3 flex-1 overflow-y-auto pr-1">
            {dimensions.length > 0 ? (
              dimensions.map((dim) => (
                <div 
                  key={dim.id} 
                  className="rounded-lg p-3 bg-moon-800 border border-moon-700"
                >
                    <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-moon-50">{dim.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-moon-700 text-moon-450">
                        {dim.values?.length || 0}
                      </span>
                    </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditingDimension(editingDimension === dim.id ? null : dim.id)}
                        className={`p-1.5 rounded transition-colors hover:bg-opacity-80 ${
                          editingDimension === dim.id ? 'text-gold' : 'text-moon-450'
                        }`}
                        >
                        <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      <button 
                        onClick={() => handleDeleteDimension(dim.name)} 
                        className="p-1.5 rounded transition-colors text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {editingDimension === dim.id ? (
                      <textarea
                        defaultValue={dim.values.join(", ")}
                        rows={3}
                      className="w-full px-3 py-2 rounded text-sm bg-moon-900 border border-gold text-moon-50"
                        onBlur={(e) => {
                          const newValues = e.target.value.split(",").map((v) => v.trim()).filter(Boolean);
                          handleSaveDimension(dim.name, newValues);
                        }}
                      autoFocus
                      />
                    ) : (
                    <div className="flex flex-wrap gap-1.5">
                        {dim.values?.map((val, j) => (
                        <span 
                          key={j} 
                          className="text-xs px-2 py-1 rounded bg-moon-700 text-moon-50"
                        >
                          {val}
                        </span>
                        ))}
                      </div>
                    )}
                  </div>
              ))
            ) : (
              <div className="flex-1 flex items-center justify-center text-moon-450">
                <div className="text-center">
                  <Target className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm mb-2">No dimensions defined yet</p>
                  <p className="text-xs mb-3">Click &quot;Import from AGENT_INFO&quot; or add manually</p>
                  <p className="text-xs text-gold">
                    ⚠️ Define at least one dimension to generate queries
                  </p>
                </div>
              </div>
            )}
          </div>
            </div>
          )}
        </div>

          {/* RIGHT: Generated Batches */}
          <div 
            ref={batchesPanelRef}
            className={`rounded-lg p-4 flex flex-col overflow-hidden bg-ink-900 border border-moon-700 ${
              batchesCollapsed ? '' : 'resize-y'
            }`}
            style={{ 
              height: batchesCollapsed ? 'auto' : `${syncedPanelHeight}px`,
              minHeight: batchesCollapsed ? 'auto' : '200px',
              maxHeight: batchesCollapsed ? 'auto' : '600px',
            }}
          >
            <div className="flex items-center justify-between flex-shrink-0">
              <button
                onClick={() => setBatchesCollapsed(!batchesCollapsed)}
                className="font-display text-lg flex items-center gap-2 hover:opacity-80 transition-opacity text-moon-50"
              >
                {batchesCollapsed ? (
                  <ChevronDown className="w-4 h-4 text-moon-450" />
                ) : (
                  <ChevronUp className="w-4 h-4 text-moon-450" />
                )}
                <Zap className="w-5 h-5 text-gold" />
                Generated batches
                <span className="text-xs px-2 py-0.5 rounded bg-moon-700 text-moon-450">
                  {syntheticBatches.length}
                </span>
              </button>
              <div className="flex items-center gap-2">
                {executingBatch && (
                  <span className="text-xs flex items-center gap-1 text-teal">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Running...
                  </span>
                )}
                {selectedBatchIds.size > 0 && (
                  <>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs text-moon-450">
                      <input
                        type="checkbox"
                        checked={selectedBatchIds.size === syntheticBatches.length}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedBatchIds(new Set(syntheticBatches.map(b => b.id)));
                          else setSelectedBatchIds(new Set());
                        }}
                        className="w-3.5 h-3.5 rounded accent-gold"
                      />
                      All
                    </label>
                    <button
                      onClick={handleDeleteSelectedBatches}
                      className="text-xs px-2 py-1 rounded flex items-center gap-1 text-red-400 bg-red-500/10"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete {selectedBatchIds.size}
                    </button>
                  </>
                )}
              </div>
            </div>
            
            {!batchesCollapsed && (
              <div className="mt-3 flex-1 flex flex-col overflow-hidden">
            {syntheticBatches.length > 0 ? (
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {syntheticBatches.map((batch) => {
                  const isReady = batch.status === "ready" || batch.status === "pending";
                  const isRunning = batch.status === "running" || executingBatchId === batch.id;
                  const isCompleted = batch.status === "completed";
                  const isFailed = batch.status === "failed";
                  
                  return (
                  <div
                    key={batch.id}
                    className={`rounded-lg p-3 transition-all border ${
                      selectedBatchIds.has(batch.id) || selectedBatch?.id === batch.id
                        ? 'bg-teal/10 border-teal/30'
                        : isRunning
                          ? 'bg-gold/5 border-gold/30'
                          : 'bg-moon-800 border-moon-700'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedBatchIds.has(batch.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          const newSet = new Set(selectedBatchIds);
                          if (e.target.checked) newSet.add(batch.id);
                          else newSet.delete(batch.id);
                          setSelectedBatchIds(newSet);
                        }}
                        className="w-4 h-4 mt-0.5 rounded flex-shrink-0 accent-teal"
                      />
                      <div className="flex-1">
                        <div 
                          className="cursor-pointer"
                          onClick={() => {
                            // Toggle: clicking again deselects
                            if (selectedBatch?.id === batch.id) {
                              setSelectedBatch(null);
                            } else {
                              fetchBatchDetail(batch.id);
                            }
                          }}
                        >
                            <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span 
                                className="text-sm font-medium truncate text-gold"
                                title={batch.name}
                              >
                                {batch.name}
                              </span>
                              {isRunning && (
                                <RefreshCw className="w-3 h-3 animate-spin flex-shrink-0 text-gold" />
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                onClick={(e) => { e.stopPropagation(); copyBatchId(batch.id); }}
                                className={`p-1 rounded transition-colors ${copiedBatchId === batch.id ? 'text-teal' : 'text-moon-450'}`}
                                title="Copy batch ID"
                              >
                                {copiedBatchId === batch.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteBatch(batch.id); }}
                                className="p-1 rounded text-red-400 hover:text-red-300"
                                title="Delete batch"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <StatusBadge status={batch.status} />
                            <span className="text-xs text-moon-450">{batch.query_count} queries</span>
                          </div>
                            <span className="text-xs text-moon-450">{formatRelativeTime(batch.created_at)}</span>
                          </div>
                        </div>
                        
                        {/* Run Controls - based on batch status */}
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-moon-700">
                          {isReady && (
                            <button
                              onClick={() => executeBatch(batch.id, batch.name, selectedAgent!.id)}
                              disabled={!!executingBatchId}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all disabled:opacity-50 bg-gold text-moon-900"
                            >
                              <Play className="w-3 h-3" />
                              Run
                            </button>
                          )}
                          {isRunning && executingBatchId === batch.id && (
                            <button
                              onClick={() => stopExecution()}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all bg-red-500/20 text-red-500"
                            >
                              <Square className="w-3 h-3 fill-current" />
                              Stop
                            </button>
                          )}
                          {(isCompleted || isFailed) && (
                            <>
                              <button
                                onClick={() => resetBatch(batch.id, selectedAgent!.id, false)}
                                disabled={!!executingBatchId}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-all disabled:opacity-50 bg-moon-700 text-moon-450"
                              >
                                <RefreshCw className="w-3 h-3" />
                                Re-run
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedBatch({ id: batch.id, name: batch.name, queries: [] });
                                  fetchBatchDetail(batch.id);
                                  setFilterBatchId(batch.id);
                                  setFilterBatchName(batch.name);
                                  setActiveTab("threads");
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-all text-teal"
                              >
                                <ExternalLink className="w-3 h-3" />
                                Review
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-moon-450">
                <div className="text-center">
                  <Zap className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No batches yet</p>
                  <p className="text-xs">Generate one using the button above</p>
                </div>
              </div>
            )}
              </div>
            )}
          </div>
        </div>

        {/* Generation Progress - below the two columns */}
        {generating && genProgress && (
          <div className="rounded-lg p-4 bg-gold/10 border border-gold/30">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-moon-50">
                {genProgress.percent === 0 ? 'Preparing...' : 'Generating queries...'}
              </span>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gold">{genProgress.completed} / {genProgress.total}</span>
                <button
                  onClick={stopGeneration}
                  className="p-1.5 rounded transition-colors hover:bg-red-500/20 text-red-500"
                  title="Stop generation"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              </div>
            </div>
            <div className="w-full rounded-full h-2 mb-2 overflow-hidden bg-moon-700">
              {genProgress.percent === 0 ? (
                <div className="h-2 rounded-full w-[30%] bg-gold animate-pulse" />
              ) : (
                <div
                  className="h-2 rounded-full transition-all duration-300 bg-gold"
                  style={{ width: `${genProgress.percent}%` }}
                />
              )}
            </div>
            {genProgress.currentQuery && (
              <p className="text-xs truncate text-moon-450">
                {genProgress.percent === 0 ? genProgress.currentQuery : `Latest: "${genProgress.currentQuery}"`}
              </p>
            )}
          </div>
        )}

        {/* ========== EXECUTION PROGRESS BAR (merged from RunsTab) ========== */}
        {executionProgress && (
          <div className="rounded-lg p-4 bg-teal/10 border border-teal/30">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {(executionProgress.status === 'running' || executionProgress.status === 'starting') && (
                  <RefreshCw className="w-4 h-4 animate-spin text-teal" />
                )}
                <span className="font-medium text-moon-50">
                  {executionProgress.status === 'completed' 
                    ? 'Execution complete!' 
                    : executionProgress.status === 'failed'
                    ? 'Execution failed'
                    : executionProgress.status === 'starting' || executionProgress.total_queries === 0
                    ? 'Starting execution...' 
                    : `Running queries... (${executionProgress.completed_queries}/${executionProgress.total_queries})`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono text-teal">
                  {executionProgress.completed_queries} / {executionProgress.total_queries || '?'}
                </span>
                {executingBatchId && (
                  <button
                    onClick={stopExecution}
                    className="p-1.5 rounded transition-colors hover:bg-red-500/20 text-red-500"
                    title="Stop execution"
                  >
                    <Square className="w-4 h-4 fill-current" />
                  </button>
                )}
              </div>
            </div>
            
            <div className="w-full rounded-full h-2 mb-2 overflow-hidden bg-moon-700">
              {(executionProgress.status === 'starting' || executionProgress.total_queries === 0) ? (
                <div className="h-2 rounded-full w-[30%] bg-gradient-to-r from-teal to-gold animate-pulse" />
              ) : (
                <div
                  className="h-2 rounded-full transition-all duration-300 bg-gradient-to-r from-teal to-gold"
                  style={{ width: `${Math.max(executionProgress.progress_percent, 2)}%` }}
                />
              )}
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1 text-teal">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>{executionProgress.success_count} success</span>
                </div>
                <div className="flex items-center gap-1 text-red-500">
                  <AlertTriangle className="w-3 h-3" />
                  <span>{executionProgress.failure_count} failed</span>
                </div>
                {executionProgress.estimated_remaining_seconds && executionProgress.status === 'running' && (
                  <div className="flex items-center gap-1 text-moon-450">
                    <Clock className="w-3 h-3" />
                    <span>~{executionProgress.estimated_remaining_seconds}s remaining</span>
                  </div>
                )}
              </div>
              {executionProgress.current_query_text && executionProgress.status === 'running' && (
                <p className="text-xs truncate max-w-md text-moon-450">
                  &quot;{executionProgress.current_query_text}&quot;
                </p>
              )}
            </div>
          </div>
        )}

        {/* TUPLES PREVIEW (shown when tuples are generated for review) */}
        {previewTuples.length > 0 && (
          <div className="rounded-lg p-4 mb-4 bg-ink-900 border-2 border-teal">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-lg flex items-center gap-2 text-moon-50">
                <Target className="w-5 h-5 text-teal" />
                Tuples Preview
                <span className="text-xs px-2 py-0.5 rounded ml-1 bg-teal text-moon-900">
                  Step 1: Review
                </span>
                <span className="text-xs px-2 py-0.5 rounded ml-1 bg-moon-700 text-moon-450">
                  {selectedTupleIds.size}/{previewTuples.length} selected
                </span>
              </h2>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs text-moon-450">
                  <input
                    type="checkbox"
                    checked={selectedTupleIds.size === previewTuples.length}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedTupleIds(new Set(previewTuples.map(t => t.id)));
                      else setSelectedTupleIds(new Set());
                    }}
                    className="w-3.5 h-3.5 rounded accent-teal"
                  />
                  Select all
                </label>
              </div>
            </div>
            
            <p className="text-xs mb-3 text-moon-450">
              Review the generated test case combinations below. Uncheck any you want to exclude, then click &quot;GENERATE QUERIES&quot; to create the batch.
            </p>
            
            <div className="grid gap-2 max-h-64 overflow-y-auto">
              {previewTuples.map((tuple, idx) => {
                const isSelected = selectedTupleIds.has(tuple.id);
                const isEditing = editingTupleId === tuple.id;
                const tags = Object.entries(tuple.values);
                
                return (
                  <div
                    key={tuple.id}
                    className={`flex items-center gap-3 p-2 rounded transition-colors border ${
                      isEditing 
                        ? 'bg-gold/10 border-gold' 
                        : isSelected 
                          ? 'bg-teal/10 border-teal' 
                          : 'bg-moon-900 border-moon-700'
                    } ${isSelected || isEditing ? 'opacity-100' : 'opacity-60'}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        const newSet = new Set(selectedTupleIds);
                        if (e.target.checked) newSet.add(tuple.id);
                        else newSet.delete(tuple.id);
                        setSelectedTupleIds(newSet);
                      }}
                      className="w-4 h-4 rounded flex-shrink-0 accent-teal"
                    />
                    <span className="text-xs flex-shrink-0 text-moon-450 min-w-[40px]">
                      #{idx + 1}
                    </span>
                    
                    {/* Editing mode: show inputs */}
                    {isEditing ? (
                      <div className="flex flex-wrap gap-2 flex-1">
                        {tags.map(([key, value]) => (
                          <div key={key} className="flex items-center gap-1">
                            <span className="text-xs text-moon-450">{key}:</span>
                            <input
                              type="text"
                              value={value}
                              onChange={(e) => updateTupleValue(tuple.id, key, e.target.value)}
                              className="text-xs px-2 py-0.5 rounded w-32 bg-moon-900 border border-gold text-moon-50"
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      /* Display mode: show tags */
                      <div className="flex flex-wrap gap-1.5 flex-1">
                        {tags.map(([key, value]) => (
                          <span
                            key={key}
                            className="text-xs px-2 py-0.5 rounded bg-moon-700 text-teal"
                            title={`${key}: ${value}`}
                          >
                            {value}
                          </span>
                        ))}
                      </div>
                    )}
                    
                    {/* Edit/Done button */}
                    <button
                      onClick={() => setEditingTupleId(isEditing ? null : tuple.id)}
                      className={`p-1 rounded transition-colors flex-shrink-0 ${isEditing ? 'bg-teal/20' : 'bg-transparent'}`}
                      title={isEditing ? "Done editing" : "Edit tuple"}
                    >
                      {isEditing ? (
                        <Check className="w-3.5 h-3.5 text-teal" />
                      ) : (
                        <Edit3 className="w-3.5 h-3.5 text-moon-450" />
                      )}
                    </button>
                    
                    <button
                      onClick={() => deleteTupleFromPreview(tuple.id)}
                      className="p-1 rounded hover:bg-red-500/20 transition-colors flex-shrink-0"
                      title="Remove this tuple"
                    >
                      <Trash2 className="w-3.5 h-3.5" style={{ color: '#EF4444' }} />
                    </button>
                  </div>
                );
              })}
            </div>
            
            {genProgress && generatingQueries && (
              <div className="mt-3 pt-3 border-t border-moon-700">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-moon-450">Generating queries...</span>
                  <span className="text-teal">{genProgress.completed}/{genProgress.total}</span>
                </div>
                <div className="h-1.5 rounded-full bg-moon-700">
                  <div 
                    className="h-full rounded-full transition-all bg-teal"
                    style={{ width: `${genProgress.percent}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* BOTTOM: Batch Data Preview (full width) */}
        <div 
          className="rounded-lg p-4 flex flex-col flex-1 bg-ink-900 border border-moon-700"
          style={{ 
            minHeight: '400px',
            maxHeight: dimensionsCollapsed && batchesCollapsed ? '70vh' : '500px'
          }}
        >
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <h2 className="font-display text-lg flex items-center gap-2 text-moon-50">
              <Eye className="w-5 h-5 text-teal" />
              Batch data preview
              {selectedBatch && (
                <span className="text-xs px-2 py-0.5 rounded ml-1 bg-moon-700 text-moon-450">
                  {selectedBatch.queries?.length || 0} items
                </span>
              )}
              {executingBatchId && selectedBatch?.id === executingBatchId && (
                <RefreshCw className="w-4 h-4 animate-spin ml-2 text-teal" />
              )}
            </h2>
            <div className="flex items-center gap-3">
              {/* View in Threads - show when batch has executed queries */}
              {selectedBatch && selectedBatch.queries && selectedBatch.queries.length > 0 && 
               selectedBatch.queries.some(q => q.response_text || q.execution_status === 'success') && (
                <button
                  onClick={viewInThreads}
                  className="flex items-center gap-2 text-sm transition-all hover:opacity-80 text-teal"
                >
                  <ExternalLink className="w-4 h-4" />
                  View in Threads
                </button>
              )}
            {/* Actions bar - shows Select All when 1+ selected */}
            {selectedBatch && selectedBatch.queries && selectedBatch.queries.length > 0 && selectedQueryIds.size > 0 && (
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs text-moon-450">
                  <input
                    type="checkbox"
                    checked={selectedQueryIds.size === selectedBatch.queries.length}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedQueryIds(new Set(selectedBatch.queries.map((q) => q.id)));
                      else setSelectedQueryIds(new Set());
                    }}
                    className="w-3.5 h-3.5 rounded accent-gold"
                  />
                  Select all
                </label>
                <div className="w-px h-4 bg-moon-700" />
                <button
                  onClick={copySelectedQueries}
                  className={`text-xs px-2 py-1 rounded flex items-center gap-1 transition-colors text-teal ${
                    copiedAllSelected ? 'bg-teal/15' : 'bg-teal/10'
                  }`}
                >
                  {copiedAllSelected ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedAllSelected ? 'Copied!' : `Copy ${selectedQueryIds.size}`}
                </button>
                <button
                  onClick={handleDeleteSelectedQueries}
                  className="text-xs px-2 py-1 rounded flex items-center gap-1 text-red-400 bg-red-500/10"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete {selectedQueryIds.size}
                </button>
              </div>
            )}
            </div>
          </div>

          {selectedBatch && selectedBatch.queries && selectedBatch.queries.length > 0 ? (
            <div className="flex-1 overflow-y-auto pr-2">
              {selectedBatch.queries.map((query, idx) => {
                const isExecuted = query.execution_status === 'success' || query.execution_status === 'error';
                const isExpanded = expandedQueryIds.has(query.id);
                const tags = Object.entries(query.tuple_values || {});
                
                const toggleExpanded = () => {
                  const newSet = new Set(expandedQueryIds);
                  if (isExpanded) newSet.delete(query.id);
                  else newSet.add(query.id);
                  setExpandedQueryIds(newSet);
                };
                
                return (
                <div
                  key={query.id}
                  className="border-b transition-colors border-moon-700"
                >
                  {/* Collapsed Row Header - Always visible */}
                  <button
                    onClick={toggleExpanded}
                    className="w-full grid gap-4 px-4 py-3 text-left transition-colors hover:bg-white/5 items-center grid-cols-[24px_60px_80px_1fr_auto]"
                  >
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={selectedQueryIds.has(query.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        const newSet = new Set(selectedQueryIds);
                        if (e.target.checked) newSet.add(query.id);
                        else newSet.delete(query.id);
                        setSelectedQueryIds(newSet);
                      }}
                      className="w-4 h-4 rounded accent-gold"
                    />
                    
                    {/* Index */}
                    <span className="text-xs font-mono px-2 py-1 rounded text-center bg-moon-700 text-moon-450">
                      {idx + 1}/{selectedBatch.queries.length}
                    </span>
                    
                    {/* Status */}
                    <div className="flex items-center gap-1">
                      {query.execution_status === "running" && (
                        <RefreshCw className="w-3 h-3 animate-spin text-gold" />
                      )}
                      <StatusBadge status={query.execution_status || 'pending'} />
                    </div>
                    
                    {/* Query Preview */}
                    <div className="min-w-0 flex items-center gap-2">
                      <ChevronDown 
                        className={`w-4 h-4 flex-shrink-0 transition-transform text-moon-450 ${isExpanded ? 'rotate-180' : ''}`}
                      />
                      <span className="text-sm truncate text-moon-50">
                        {query.query_text.slice(0, 100)}{query.query_text.length > 100 ? "..." : ""}
                      </span>
                    </div>
                    
                    {/* Tags */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {tags.slice(0, 3).map(([key, val]) => (
                        <span 
                          key={key} 
                          className="text-xs px-2 py-0.5 rounded bg-teal/15 text-teal"
                        >
                          {val}
                        </span>
                      ))}
                      {tags.length > 3 && (
                        <span className="text-xs text-moon-450">+{tags.length - 3}</span>
                      )}
                    </div>
                  </button>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-4 bg-moon-900/50">
                      {/* Full Query */}
                      {editingQueryId === query.id ? (
                        <div className="space-y-2">
                          <textarea
                            defaultValue={query.query_text}
                            id={`textarea-${query.id}`}
                            rows={4}
                            autoFocus
                            className="w-full px-3 py-2 rounded text-sm bg-moon-900 border border-gold text-moon-50"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                const textarea = document.getElementById(`textarea-${query.id}`) as HTMLTextAreaElement;
                                handleUpdateQuery(query.id, textarea?.value || query.query_text);
                              }}
                              className="text-xs px-3 py-1.5 rounded font-medium bg-gold text-moon-900"
                            >
                              SAVE
                            </button>
                            <button 
                              onClick={() => setEditingQueryId(null)} 
                              className="text-xs px-3 py-1.5 rounded bg-moon-700 text-moon-450"
                            >
                              CANCEL
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div 
                          className={`p-4 rounded-lg bg-moon-900 border border-moon-700 ${!isExecuted ? 'cursor-pointer group' : ''}`}
                          onClick={() => !isExecuted && setEditingQueryId(query.id)}
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded flex items-center justify-center bg-moon-700">
                                <span className="text-xs text-moon-50">Q</span>
                              </div>
                              <span className="text-xs font-medium uppercase tracking-wider text-moon-450">User Query</span>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); copyQueryText(query.id, query.query_text); }}
                              className={`p-1.5 rounded transition-colors hover:bg-white/10 ${copiedQueryId === query.id ? 'text-teal' : 'text-moon-450'}`}
                              title="Copy query text"
                            >
                              {copiedQueryId === query.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </button>
                          </div>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap text-moon-50">
                            {query.query_text}
                          </p>
                          {!isExecuted && (
                            <span className="text-xs opacity-0 group-hover:opacity-100 transition-opacity mt-2 inline-block text-moon-450">
                              Click to edit
                            </span>
                          )}
                        </div>
                      )}

                      {/* Call Metrics Indicator - Shows what happened between query and response */}
                      {isExecuted && query.call_count && query.call_count > 1 && (
                        <button
                          onClick={async () => {
                            if (query.session_id) {
                              // Navigate to threads tab and auto-open this specific session
                              setFilterBatchId(selectedBatch?.id || null);
                              setFilterBatchName(selectedBatch?.name || null);
                              setActiveTab("threads");
                              // Fetch and select the specific session to show its details
                              await fetchSessionDetail(query.session_id);
                            }
                          }}
                          className="flex items-center justify-center gap-3 py-2 px-4 rounded-lg transition-all hover:bg-white/5 group/metrics bg-gold/5 border border-dashed border-gold/30"
                        >
                          <div className="flex items-center gap-2">
                            <Zap className="w-3.5 h-3.5 text-gold" />
                            <span className="text-xs text-gold">
                              {query.call_count} calls
                            </span>
                          </div>
                          {query.total_latency_ms && (
                            <>
                              <span className="text-moon-700">•</span>
                              <span className="text-xs text-moon-450">
                                {query.total_latency_ms >= 1000 
                                  ? `${(query.total_latency_ms / 1000).toFixed(1)}s`
                                  : `${Math.round(query.total_latency_ms)}ms`
                                }
                              </span>
                            </>
                          )}
                          <span className="text-xs opacity-0 group-hover/metrics:opacity-100 transition-opacity flex items-center gap-1 text-teal">
                            View details <ExternalLink className="w-3 h-3" />
                          </span>
                        </button>
                      )}

                      {/* Full Response */}
                      {query.response_text && (
                        <div className="p-4 rounded-lg bg-moon-900 border border-teal/30">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-6 h-6 rounded flex items-center justify-center bg-teal/20">
                              <Bot className="w-3.5 h-3.5 text-teal" />
                            </div>
                            <span className="text-xs font-medium uppercase tracking-wider text-teal">Agent Response</span>
                          </div>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap text-moon-50">
                            {query.response_text}
                          </p>
                        </div>
                      )}

                      {/* Error Message */}
                      {query.error_message && (
                        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-6 h-6 rounded flex items-center justify-center bg-red-500/20">
                              <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                            </div>
                            <span className="text-xs font-medium uppercase tracking-wider text-red-500">Error</span>
                          </div>
                          <p className="text-sm leading-relaxed text-red-300">
                            {query.error_message}
                          </p>
                        </div>
                      )}

                      {/* All Tags */}
                      {tags.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap pt-2">
                          <span className="text-xs uppercase tracking-wider text-moon-450">Tags:</span>
                          {tags.map(([key, val]) => (
                            <span 
                              key={key} 
                              className="text-xs px-2 py-1 rounded flex items-center gap-1 bg-teal/15 text-teal"
                            >
                              <Tag className="w-3 h-3 opacity-50" />
                              <span className="text-moon-450">{key}:</span> {val}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-moon-450">
              <div className="text-center">
                <Eye className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg mb-2 text-moon-50">Select a batch to preview</p>
                <p className="text-sm">Choose a batch from the &quot;Generated batches&quot; section above to review and edit its data.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
