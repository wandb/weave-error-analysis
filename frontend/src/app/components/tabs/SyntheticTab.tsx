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
  Settings2,
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
  // LLM-guided is the only strategy now (cross product removed)
  const [model, setModel] = useState("gpt-5.1");
  const [temperature, setTemperature] = useState(0.7);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  
  // Custom prompts (only used in llm_guided mode)
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [customTuplePrompt, setCustomTuplePrompt] = useState(`You are generating test case combinations for testing an AI agent.

Agent: {agent_name}
Purpose: {agent_purpose}

Available testing dimensions:
{dimensions}
{focus_instruction}

Generate {count} diverse and realistic combinations. Each combination should represent 
a plausible user interaction. Include a mix of:
- Common/typical cases
- Edge cases
- Challenging scenarios

Return as JSON array of objects, each with keys matching the dimension names.
Example: [{"persona": "frustrated_customer", "scenario": "refund_request", "complexity": "multi_step"}]

Return ONLY the JSON array, no other text.`);
  const [customQueryPrompt, setCustomQueryPrompt] = useState(`You are generating a realistic user message for testing an AI agent.

Agent: {agent_name}
Purpose: {agent_purpose}
Capabilities: {agent_capabilities}

Generate a user message matching these characteristics:
{dimension_values}

Guidelines:
- Sound natural and conversational, not formulaic
- Match the persona's communication style
- Reflect the scenario's topic and urgency
- Include relevant details that the persona would provide
- For multi_step complexity, may require multiple pieces of information or actions
- For edge_case complexity, present unusual or boundary conditions
- For adversarial, try to get something outside normal policy

Return ONLY the user message, nothing else. No quotes around it.`);
  
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
          custom_query_prompt: customQueryPrompt,
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
          model,
          temperature,
          custom_tuple_prompt: customTuplePrompt,
          custom_query_prompt: customQueryPrompt,
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
        <div className="text-center" style={{ color: '#8F949E' }}>
          <Cpu className="w-16 h-16 mx-auto mb-4 opacity-40" />
          <h2 className="text-xl font-display mb-2" style={{ color: '#FDFDFD' }}>Select an agent to get started</h2>
          <p className="mb-4">
            {agents.length === 0 
              ? "Register an agent first to generate synthetic test data."
              : "Select an agent from the Agents tab to generate synthetic test data."
            }
          </p>
          <button 
            onClick={() => setActiveTab("agents")} 
            className="inline-flex items-center gap-2 px-6 py-3 rounded-md font-medium transition-all"
            style={{ backgroundColor: '#FCBC32', color: '#171A1F' }}
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
      <div 
        className="rounded-lg p-4 flex flex-wrap items-center gap-4"
        style={{ backgroundColor: '#252830', border: '1px solid #333333' }}
      >
        {/* Agent Dropdown */}
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4" style={{ color: '#8F949E' }} />
          <select
            value={selectedAgent?.id || ""}
            onChange={(e) => {
              const agent = agents.find(a => a.id === e.target.value);
              if (agent) fetchAgentDetail(agent.id);
            }}
            className="px-3 py-2 rounded-md text-sm min-w-[200px]"
            style={{ backgroundColor: '#171A1F', border: '1px solid #333333', color: '#FDFDFD' }}
          >
              {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} ({agent.connection_status})
              </option>
            ))}
          </select>
        </div>

        {/* Divider */}
        <div className="h-8 w-px" style={{ backgroundColor: '#333333' }} />

        {/* Quick Settings */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Hash className="w-4 h-4" style={{ color: '#8F949E' }} />
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
              className="w-16 px-2 py-1.5 rounded text-sm text-center"
              style={{ backgroundColor: '#171A1F', border: '1px solid #333333', color: '#FDFDFD' }}
            />
            <span className="text-xs" style={{ color: '#8F949E' }}>queries</span>
          </div>

          {/* Dimension mode selector */}
          {(
            <div className="relative">
              <button
                onClick={() => setShowDimensionSelector(!showDimensionSelector)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors"
                style={{ 
                  backgroundColor: showDimensionSelector ? 'rgba(16, 191, 204, 0.15)' : '#171A1F', 
                  border: '1px solid #333333', 
                  color: showDimensionSelector ? '#10BFCC' : '#FDFDFD' 
                }}
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
                <div 
                  className="absolute top-full left-0 mt-1 p-3 rounded-lg z-50 min-w-[320px]"
                  style={{ backgroundColor: '#252830', border: '1px solid #10BFCC', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}
                >
                  {/* Mode Toggle */}
                  <div className="flex gap-1 p-1 rounded-lg mb-3" style={{ backgroundColor: '#171A1F' }}>
                    <button
                      onClick={() => setUseDimensions(true)}
                      className="flex-1 px-3 py-1.5 rounded text-xs font-medium transition-all"
                      style={{ 
                        backgroundColor: useDimensions ? '#10BFCC' : 'transparent',
                        color: useDimensions ? '#171A1F' : '#8F949E'
                      }}
                    >
                      Use Dimensions
                    </button>
                    <button
                      onClick={() => setUseDimensions(false)}
                      className="flex-1 px-3 py-1.5 rounded text-xs font-medium transition-all"
                      style={{ 
                        backgroundColor: !useDimensions ? '#FCBC32' : 'transparent',
                        color: !useDimensions ? '#171A1F' : '#8F949E'
                      }}
                    >
                      LLM Decides
                    </button>
                  </div>
                  
                  {useDimensions ? (
                    <>
                      {/* Dimensions selection */}
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium" style={{ color: '#10BFCC' }}>Select dimensions to use</span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setSelectedDimensionIds(new Set(dimensions.map(d => d.id)))}
                            className="text-xs px-2 py-0.5 rounded"
                            style={{ backgroundColor: '#333333', color: '#8F949E' }}
                          >
                            All
                          </button>
                          <button
                            onClick={() => setSelectedDimensionIds(new Set())}
                            className="text-xs px-2 py-0.5 rounded"
                            style={{ backgroundColor: '#333333', color: '#8F949E' }}
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
                              className="flex items-start gap-2 cursor-pointer p-2 rounded transition-colors hover:bg-opacity-50"
                              style={{ backgroundColor: selectedDimensionIds.has(dim.id) ? 'rgba(16, 191, 204, 0.1)' : 'transparent' }}
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
                                className="w-4 h-4 mt-0.5 rounded"
                                style={{ accentColor: '#10BFCC' }}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm" style={{ color: '#FDFDFD' }}>{dim.name}</div>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {dim.values?.slice(0, 4).map((val, i) => (
                                    <span key={i} className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#333333', color: '#8F949E' }}>
                                      {val}
                                    </span>
                                  ))}
                                  {dim.values?.length > 4 && (
                                    <span className="text-xs" style={{ color: '#8F949E' }}>+{dim.values.length - 4} more</span>
                                  )}
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-center py-4" style={{ color: '#8F949E' }}>
                          No dimensions defined. Add them in the Testing Dimensions panel or use "LLM Decides" mode.
                        </p>
                      )}
                      
                      {dimensions.length > 0 && selectedDimensionIds.size === 0 && (
                        <p className="text-xs mt-2 text-center" style={{ color: '#FCBC32' }}>
                          ⚠️ Select at least one dimension
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-3">
                      <p className="text-sm mb-2" style={{ color: '#FDFDFD' }}>
                        LLM will generate test case combinations freely
                      </p>
                      <p className="text-xs" style={{ color: '#8F949E' }}>
                        The LLM will create diverse tuples based on the agent's purpose without being constrained to predefined dimension values.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Advanced Settings Toggle */}
                <button
          onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
          className="flex items-center gap-1 px-3 py-1.5 rounded text-sm transition-colors"
          style={{ color: showAdvancedSettings ? '#FCBC32' : '#8F949E' }}
                >
          <Settings2 className="w-4 h-4" />
          <span>Advanced</span>
          {showAdvancedSettings ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

        {/* Edit Prompt Buttons - for customizing LLM prompts */}
        <div className="flex items-center gap-1 border-l border-moon-700 pl-2 ml-1">
          <EditPromptButton
            promptId={useDimensions ? "tuple_generation" : "tuple_generation_free"}
            label="Tuples"
            size="sm"
            variant="ghost"
          />
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
              className="flex items-center gap-2 px-6 py-2.5 rounded-md font-medium transition-all disabled:opacity-50"
              style={{ 
                backgroundColor: generating ? '#333333' : '#FCBC32', 
                color: generating ? '#8F949E' : '#171A1F' 
              }}
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
              className="flex items-center gap-2 px-4 py-2.5 rounded-md font-medium transition-all disabled:opacity-50"
              style={{ 
                backgroundColor: generatingTuples ? '#333333' : '#10BFCC', 
                color: generatingTuples ? '#8F949E' : '#171A1F' 
              }}
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
                className="flex items-center gap-2 px-3 py-2.5 rounded-md font-medium transition-all disabled:opacity-50"
                style={{ 
                  backgroundColor: '#333333', 
                  color: '#8F949E' 
                }}
                title="Clear tuples and start over"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                onClick={generateQueriesFromTuples}
                disabled={generatingQueries || selectedTupleIds.size === 0}
                className="flex items-center gap-2 px-6 py-2.5 rounded-md font-medium transition-all disabled:opacity-50"
                style={{ 
                  backgroundColor: generatingQueries ? '#333333' : '#FCBC32', 
                  color: generatingQueries ? '#8F949E' : '#171A1F' 
                }}
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

      {/* Advanced Settings Panel */}
      {showAdvancedSettings && (
        <div 
          className="rounded-lg p-4 space-y-4"
          style={{ backgroundColor: '#1C1E24', border: '1px solid #333333' }}
        >
          {/* Basic Settings Row */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs mb-1 block" style={{ color: '#8F949E' }}>Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 rounded text-sm"
                style={{ backgroundColor: '#171A1F', border: '1px solid #333333', color: '#FDFDFD' }}
              >
                <option value="gpt-4.1">gpt-5.1</option>
                <option value="gpt-4.1-mini">gpt-5.1-mini</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4-turbo">gpt-4-turbo</option>
                <option value="claude-3-sonnet">claude-3-sonnet</option>
                <option value="claude-3-haiku">claude-3-haiku</option>
              </select>
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: '#8F949E' }}>
                Temperature: {temperature}
              </label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="w-full accent-gold"
                style={{ accentColor: '#FCBC32' }}
              />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: '#8F949E' }}>API Key (optional override)</label>
              <input
                type="password"
                placeholder="Uses default from Settings"
                className="w-full px-3 py-2 rounded text-sm"
                style={{ backgroundColor: '#171A1F', border: '1px solid #333333', color: '#FDFDFD' }}
              />
            </div>
          </div>
          
          {/* Prompt Editor Toggle */}
          {(
            <div className="border-t pt-4" style={{ borderColor: '#333333' }}>
              <button
                onClick={() => setShowPromptEditor(!showPromptEditor)}
                className="flex items-center gap-2 text-sm mb-3"
                style={{ color: showPromptEditor ? '#FCBC32' : '#8F949E' }}
              >
                <Edit3 className="w-4 h-4" />
                <span>Customize Generation Prompts</span>
                {showPromptEditor ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              
              {showPromptEditor && (
                <div className="space-y-4">
                  {/* Info Box */}
                  <div 
                    className="p-3 rounded-lg text-xs"
                    style={{ backgroundColor: 'rgba(252, 188, 50, 0.1)', border: '1px solid rgba(252, 188, 50, 0.3)' }}
                  >
                    <p style={{ color: '#FCBC32' }}>
                      <strong>Available placeholders:</strong>
                    </p>
                    <p className="mt-1" style={{ color: '#8F949E' }}>
                      Tuple prompt: <code className="px-1 rounded" style={{ backgroundColor: '#333333' }}>{'{agent_name}'}</code>, <code className="px-1 rounded" style={{ backgroundColor: '#333333' }}>{'{agent_purpose}'}</code>, <code className="px-1 rounded" style={{ backgroundColor: '#333333' }}>{'{dimensions}'}</code>, <code className="px-1 rounded" style={{ backgroundColor: '#333333' }}>{'{count}'}</code>, <code className="px-1 rounded" style={{ backgroundColor: '#333333' }}>{'{focus_instruction}'}</code>
                    </p>
                    <p className="mt-1" style={{ color: '#8F949E' }}>
                      Query prompt: <code className="px-1 rounded" style={{ backgroundColor: '#333333' }}>{'{agent_name}'}</code>, <code className="px-1 rounded" style={{ backgroundColor: '#333333' }}>{'{agent_purpose}'}</code>, <code className="px-1 rounded" style={{ backgroundColor: '#333333' }}>{'{agent_capabilities}'}</code>, <code className="px-1 rounded" style={{ backgroundColor: '#333333' }}>{'{dimension_values}'}</code>
                    </p>
                  </div>
                  
                  {/* Tuple Generation Prompt */}
                  <div>
                    <label className="text-xs mb-1 block font-medium" style={{ color: '#10BFCC' }}>
                      1. Tuple Generation Prompt
                      <span className="font-normal ml-2" style={{ color: '#8F949E' }}>
                        (Generates combinations of test dimensions)
                      </span>
                    </label>
                    <textarea
                      value={customTuplePrompt}
                      onChange={(e) => setCustomTuplePrompt(e.target.value)}
                      rows={8}
                      className="w-full px-3 py-2 rounded text-sm font-mono"
                      style={{ 
                        backgroundColor: '#171A1F', 
                        border: '1px solid #333333', 
                        color: '#FDFDFD',
                        resize: 'vertical',
                        minHeight: '150px'
                      }}
                    />
                  </div>
                  
                  {/* Query Generation Prompt */}
                  <div>
                    <label className="text-xs mb-1 block font-medium" style={{ color: '#FCBC32' }}>
                      2. Query Generation Prompt
                      <span className="font-normal ml-2" style={{ color: '#8F949E' }}>
                        (Converts each tuple into a realistic user message)
                      </span>
                    </label>
                    <textarea
                      value={customQueryPrompt}
                      onChange={(e) => setCustomQueryPrompt(e.target.value)}
                      rows={10}
                      className="w-full px-3 py-2 rounded text-sm font-mono"
                      style={{ 
                        backgroundColor: '#171A1F', 
                        border: '1px solid #333333', 
                        color: '#FDFDFD',
                        resize: 'vertical',
                        minHeight: '200px'
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========== MAIN CONTENT ========== */}
      <div className="flex flex-col gap-4">
        {/* TOP ROW: Testing Dimensions + Generated Batches (side by side) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* LEFT: Testing Dimensions */}
          <div 
            ref={dimensionsPanelRef}
            className="rounded-lg p-4 flex flex-col overflow-hidden"
            style={{ 
              backgroundColor: '#1C1E24', 
              border: '1px solid #333333', 
              height: dimensionsCollapsed ? 'auto' : `${syncedPanelHeight}px`,
              minHeight: dimensionsCollapsed ? 'auto' : '200px',
              maxHeight: dimensionsCollapsed ? 'auto' : '600px',
              resize: dimensionsCollapsed ? 'none' : 'vertical',
            }}
          >
          <div className="flex items-center justify-between flex-shrink-0">
            <button
              onClick={() => setDimensionsCollapsed(!dimensionsCollapsed)}
              className="font-display text-lg flex items-center gap-2 hover:opacity-80 transition-opacity"
              style={{ color: '#FDFDFD' }}
            >
              {dimensionsCollapsed ? (
                <ChevronDown className="w-4 h-4" style={{ color: '#8F949E' }} />
              ) : (
                <ChevronUp className="w-4 h-4" style={{ color: '#8F949E' }} />
              )}
              <Target className="w-5 h-5" style={{ color: '#FCBC32' }} />
              Testing dimensions
              <span className="text-xs px-2 py-0.5 rounded ml-1" style={{ backgroundColor: '#333333', color: '#8F949E' }}>
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
                  className="text-xs px-3 py-1.5 rounded transition-colors flex items-center gap-1.5"
                  style={{ backgroundColor: '#252830', color: '#8F949E', border: '1px solid #333333' }}
                >
                  {loadingDimensions ? "..." : "Import from AGENT_INFO"}
                  <span
                    className="cursor-help"
                    onMouseEnter={() => setShowImportHelp(true)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <HelpCircle className="w-3.5 h-3.5" style={{ color: showImportHelp ? '#FCBC32' : '#8F949E' }} />
                  </span>
                </button>
                {/* Tooltip - stays visible when hovering over it */}
                {showImportHelp && (
                  <div 
                    className="absolute right-0 top-full mt-1 p-4 rounded-lg z-50 w-96 text-xs cursor-default"
                    style={{ backgroundColor: '#252830', border: '1px solid #FCBC32', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}
                    onMouseEnter={() => setShowImportHelp(true)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium" style={{ color: '#FCBC32' }}>Expected AGENT_INFO format:</p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`## Testing Dimensions
- **personas**: first_time_user, power_user
- **complexity**: simple, multi_step
- **scenarios**: pricing_inquiry, refund`);
                        }}
                        className="text-xs px-2 py-1 rounded flex items-center gap-1 transition-colors hover:opacity-80"
                        style={{ backgroundColor: '#333333', color: '#8F949E' }}
                      >
                        <Copy className="w-3 h-3" />
                        Copy template
                </button>
                    </div>
                    <pre 
                      className="p-3 rounded text-xs overflow-x-auto mb-3 select-all"
                      style={{ backgroundColor: '#171A1F', color: '#FDFDFD', userSelect: 'all' }}
                    >{`## Testing Dimensions
- **personas**: first_time_user, power_user
- **complexity**: simple, multi_step
- **scenarios**: pricing_inquiry, refund`}</pre>
                    <p style={{ color: '#8F949E' }}>
                      Add a <code className="px-1 rounded" style={{ backgroundColor: '#333333' }}>## Testing Dimensions</code> section 
                      with bullet points in the format <code className="px-1 rounded" style={{ backgroundColor: '#333333' }}>- **name**: value1, value2</code>
                    </p>
                  </div>
                )}
              </div>
              <button 
                onClick={() => setShowAddDimension(true)} 
                className="p-1.5 rounded transition-colors"
                style={{ backgroundColor: '#FCBC32', color: '#171A1F' }}
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
            <div 
              className="rounded-lg p-4 mb-4"
              style={{ backgroundColor: '#252830', border: '1px solid #FCBC32' }}
            >
              <h4 className="text-sm font-medium mb-3" style={{ color: '#FDFDFD' }}>Add new dimension</h4>
                <input
                  type="text"
                placeholder="Dimension name (e.g., user_mood)"
                  value={newDimensionName}
                  onChange={(e) => setNewDimensionName(e.target.value)}
                className="w-full px-3 py-2 rounded text-sm mb-2"
                style={{ backgroundColor: '#171A1F', border: '1px solid #333333', color: '#FDFDFD' }}
                />
                <textarea
                placeholder="Values (comma-separated, e.g., happy, frustrated, confused)"
                  value={newDimensionValues}
                  onChange={(e) => setNewDimensionValues(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded text-sm mb-3"
                style={{ backgroundColor: '#171A1F', border: '1px solid #333333', color: '#FDFDFD' }}
                />
                <div className="flex gap-2">
                <button 
                  onClick={handleAddDimension} 
                  className="text-xs px-4 py-2 rounded font-medium"
                  style={{ backgroundColor: '#FCBC32', color: '#171A1F' }}
                >
                  ADD
                </button>
                <button 
                  onClick={() => { setShowAddDimension(false); setNewDimensionName(""); setNewDimensionValues(""); }} 
                  className="text-xs px-4 py-2 rounded"
                  style={{ backgroundColor: '#333333', color: '#8F949E' }}
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
                  className="rounded-lg p-3"
                  style={{ backgroundColor: '#252830', border: '1px solid #333333' }}
                >
                    <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm" style={{ color: '#FDFDFD' }}>{dim.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: '#333333', color: '#8F949E' }}>
                        {dim.values?.length || 0}
                      </span>
                    </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditingDimension(editingDimension === dim.id ? null : dim.id)}
                        className="p-1.5 rounded transition-colors hover:bg-opacity-80"
                        style={{ color: editingDimension === dim.id ? '#FCBC32' : '#8F949E' }}
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
                      className="w-full px-3 py-2 rounded text-sm"
                      style={{ backgroundColor: '#171A1F', border: '1px solid #FCBC32', color: '#FDFDFD' }}
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
                          className="text-xs px-2 py-1 rounded"
                          style={{ backgroundColor: '#333333', color: '#FDFDFD' }}
                        >
                          {val}
                        </span>
                        ))}
                      </div>
                    )}
                  </div>
              ))
            ) : (
              <div className="flex-1 flex items-center justify-center" style={{ color: '#8F949E' }}>
                <div className="text-center">
                  <Target className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm mb-2">No dimensions defined yet</p>
                  <p className="text-xs mb-3">Click "Import from AGENT_INFO" or add manually</p>
                  <p className="text-xs" style={{ color: '#FCBC32' }}>
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
            className="rounded-lg p-4 flex flex-col overflow-hidden"
            style={{ 
              backgroundColor: '#1C1E24', 
              border: '1px solid #333333', 
              height: batchesCollapsed ? 'auto' : `${syncedPanelHeight}px`,
              minHeight: batchesCollapsed ? 'auto' : '200px',
              maxHeight: batchesCollapsed ? 'auto' : '600px',
              resize: batchesCollapsed ? 'none' : 'vertical',
            }}
          >
            <div className="flex items-center justify-between flex-shrink-0">
              <button
                onClick={() => setBatchesCollapsed(!batchesCollapsed)}
                className="font-display text-lg flex items-center gap-2 hover:opacity-80 transition-opacity"
                style={{ color: '#FDFDFD' }}
              >
                {batchesCollapsed ? (
                  <ChevronDown className="w-4 h-4" style={{ color: '#8F949E' }} />
                ) : (
                  <ChevronUp className="w-4 h-4" style={{ color: '#8F949E' }} />
                )}
                <Zap className="w-5 h-5" style={{ color: '#FCBC32' }} />
                Generated batches
                <span 
                  className="text-xs px-2 py-0.5 rounded"
                  style={{ backgroundColor: '#333333', color: '#8F949E' }}
                >
                  {syntheticBatches.length}
                </span>
              </button>
              <div className="flex items-center gap-2">
                {executingBatch && (
                  <span className="text-xs flex items-center gap-1" style={{ color: '#10BFCC' }}>
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Running...
                  </span>
                )}
                {selectedBatchIds.size > 0 && (
                  <>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs" style={{ color: '#8F949E' }}>
                      <input
                        type="checkbox"
                        checked={selectedBatchIds.size === syntheticBatches.length}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedBatchIds(new Set(syntheticBatches.map(b => b.id)));
                          else setSelectedBatchIds(new Set());
                        }}
                        className="w-3.5 h-3.5 rounded"
                        style={{ accentColor: '#FCBC32' }}
                      />
                      All
                    </label>
                    <button
                      onClick={handleDeleteSelectedBatches}
                      className="text-xs px-2 py-1 rounded flex items-center gap-1 text-red-400"
                      style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
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
                    className="rounded-lg p-3 transition-all"
                    style={{ 
                      backgroundColor: selectedBatchIds.has(batch.id)
                        ? 'rgba(16, 191, 204, 0.1)'
                        : selectedBatch?.id === batch.id 
                          ? 'rgba(16, 191, 204, 0.1)' 
                          : isRunning
                          ? 'rgba(252, 188, 50, 0.05)'
                          : '#252830',
                      border: selectedBatchIds.has(batch.id)
                        ? '1px solid rgba(16, 191, 204, 0.3)'
                        : selectedBatch?.id === batch.id 
                          ? '1px solid rgba(16, 191, 204, 0.4)' 
                          : isRunning
                          ? '1px solid rgba(252, 188, 50, 0.3)'
                          : '1px solid #333333'
                    }}
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
                        className="w-4 h-4 mt-0.5 rounded flex-shrink-0"
                        style={{ accentColor: '#10BFCC' }}
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
                                className="text-sm font-medium truncate"
                                style={{ color: '#FCBC32' }}
                                title={batch.name}
                              >
                                {batch.name}
                              </span>
                              {isRunning && (
                                <RefreshCw className="w-3 h-3 animate-spin flex-shrink-0" style={{ color: '#FCBC32' }} />
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                onClick={(e) => { e.stopPropagation(); copyBatchId(batch.id); }}
                                className="p-1 rounded transition-colors"
                                style={{ color: copiedBatchId === batch.id ? '#10BFCC' : '#8F949E' }}
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
                              <span className="text-xs" style={{ color: '#8F949E' }}>{batch.query_count} queries</span>
                            </div>
                            <span className="text-xs" style={{ color: '#8F949E' }}>{formatRelativeTime(batch.created_at)}</span>
                          </div>
                        </div>
                        
                        {/* Run Controls - based on batch status */}
                        <div className="flex items-center gap-2 mt-2 pt-2" style={{ borderTop: '1px solid #333333' }}>
                          {isReady && (
                            <button
                              onClick={() => executeBatch(batch.id, batch.name, selectedAgent!.id)}
                              disabled={!!executingBatchId}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all disabled:opacity-50"
                              style={{ backgroundColor: '#FCBC32', color: '#171A1F' }}
                            >
                              <Play className="w-3 h-3" />
                              Run
                            </button>
                          )}
                          {isRunning && executingBatchId === batch.id && (
                            <button
                              onClick={() => stopExecution()}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all"
                              style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#EF4444' }}
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
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-all disabled:opacity-50"
                                style={{ backgroundColor: '#333333', color: '#8F949E' }}
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
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-all"
                                style={{ color: '#10BFCC' }}
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
              <div className="flex-1 flex items-center justify-center" style={{ color: '#8F949E' }}>
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
          <div 
            className="rounded-lg p-4"
            style={{ backgroundColor: 'rgba(252, 188, 50, 0.1)', border: '1px solid rgba(252, 188, 50, 0.3)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium" style={{ color: '#FDFDFD' }}>
                {genProgress.percent === 0 ? 'Preparing...' : 'Generating queries...'}
              </span>
              <div className="flex items-center gap-3">
                <span className="text-sm" style={{ color: '#FCBC32' }}>{genProgress.completed} / {genProgress.total}</span>
                <button
                  onClick={stopGeneration}
                  className="p-1.5 rounded transition-colors hover:bg-red-500/20"
                  style={{ color: '#EF4444' }}
                  title="Stop generation"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              </div>
            </div>
            <div className="w-full rounded-full h-2 mb-2 overflow-hidden" style={{ backgroundColor: '#333333' }}>
              {genProgress.percent === 0 ? (
                <div 
                  className="h-2 rounded-full"
                  style={{ 
                    width: '30%', 
                    backgroundColor: '#FCBC32',
                    animation: 'indeterminate 1.5s ease-in-out infinite'
                  }}
                />
              ) : (
                <div
                  className="h-2 rounded-full transition-all duration-300"
                  style={{ width: `${genProgress.percent}%`, backgroundColor: '#FCBC32' }}
                />
              )}
            </div>
            {genProgress.currentQuery && (
              <p className="text-xs truncate" style={{ color: '#8F949E' }}>
                {genProgress.percent === 0 ? genProgress.currentQuery : `Latest: "${genProgress.currentQuery}"`}
              </p>
            )}
          </div>
        )}

        {/* ========== EXECUTION PROGRESS BAR (merged from RunsTab) ========== */}
        {executionProgress && (
          <div 
            className="rounded-lg p-4"
            style={{ backgroundColor: 'rgba(16, 191, 204, 0.1)', border: '1px solid rgba(16, 191, 204, 0.3)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {(executionProgress.status === 'running' || executionProgress.status === 'starting') && (
                  <RefreshCw className="w-4 h-4 animate-spin" style={{ color: '#10BFCC' }} />
                )}
                <span className="font-medium" style={{ color: '#FDFDFD' }}>
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
                <span className="text-sm font-mono" style={{ color: '#10BFCC' }}>
                  {executionProgress.completed_queries} / {executionProgress.total_queries || '?'}
                </span>
                {executingBatchId && (
                  <button
                    onClick={stopExecution}
                    className="p-1.5 rounded transition-colors hover:bg-red-500/20"
                    style={{ color: '#EF4444' }}
                    title="Stop execution"
                  >
                    <Square className="w-4 h-4 fill-current" />
                  </button>
                )}
              </div>
            </div>
            
            <div className="w-full rounded-full h-2 mb-2 overflow-hidden" style={{ backgroundColor: '#333333' }}>
              {(executionProgress.status === 'starting' || executionProgress.total_queries === 0) ? (
                <div 
                  className="h-2 rounded-full"
                  style={{ 
                    width: '30%', 
                    background: 'linear-gradient(to right, #10BFCC, #FCBC32)',
                    animation: 'indeterminate 1.5s ease-in-out infinite'
                  }}
                />
              ) : (
                <div
                  className="h-2 rounded-full transition-all duration-300"
                  style={{ 
                    width: `${Math.max(executionProgress.progress_percent, 2)}%`, 
                    background: 'linear-gradient(to right, #10BFCC, #FCBC32)' 
                  }}
                />
              )}
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1" style={{ color: '#10BFCC' }}>
                  <CheckCircle2 className="w-3 h-3" />
                  <span>{executionProgress.success_count} success</span>
                </div>
                <div className="flex items-center gap-1" style={{ color: '#EF4444' }}>
                  <AlertTriangle className="w-3 h-3" />
                  <span>{executionProgress.failure_count} failed</span>
                </div>
                {executionProgress.estimated_remaining_seconds && executionProgress.status === 'running' && (
                  <div className="flex items-center gap-1" style={{ color: '#8F949E' }}>
                    <Clock className="w-3 h-3" />
                    <span>~{executionProgress.estimated_remaining_seconds}s remaining</span>
                  </div>
                )}
              </div>
              {executionProgress.current_query_text && executionProgress.status === 'running' && (
                <p className="text-xs truncate max-w-md" style={{ color: '#8F949E' }}>
                  &quot;{executionProgress.current_query_text}&quot;
                </p>
              )}
            </div>
          </div>
        )}

        {/* TUPLES PREVIEW (shown when tuples are generated for review) */}
        {previewTuples.length > 0 && (
          <div 
            className="rounded-lg p-4 mb-4"
            style={{ 
              backgroundColor: '#1C1E24', 
              border: '2px solid #10BFCC',
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-lg flex items-center gap-2" style={{ color: '#FDFDFD' }}>
                <Target className="w-5 h-5" style={{ color: '#10BFCC' }} />
                Tuples Preview
                <span className="text-xs px-2 py-0.5 rounded ml-1" style={{ backgroundColor: '#10BFCC', color: '#171A1F' }}>
                  Step 1: Review
                </span>
                <span className="text-xs px-2 py-0.5 rounded ml-1" style={{ backgroundColor: '#333333', color: '#8F949E' }}>
                  {selectedTupleIds.size}/{previewTuples.length} selected
                </span>
              </h2>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs" style={{ color: '#8F949E' }}>
                  <input
                    type="checkbox"
                    checked={selectedTupleIds.size === previewTuples.length}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedTupleIds(new Set(previewTuples.map(t => t.id)));
                      else setSelectedTupleIds(new Set());
                    }}
                    className="w-3.5 h-3.5 rounded"
                    style={{ accentColor: '#10BFCC' }}
                  />
                  Select all
                </label>
              </div>
            </div>
            
            <p className="text-xs mb-3" style={{ color: '#8F949E' }}>
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
                    className="flex items-center gap-3 p-2 rounded transition-colors"
                    style={{ 
                      backgroundColor: isEditing ? 'rgba(252, 188, 50, 0.1)' : isSelected ? 'rgba(16, 191, 204, 0.1)' : '#171A1F',
                      border: `1px solid ${isEditing ? '#FCBC32' : isSelected ? '#10BFCC' : '#333333'}`,
                      opacity: isSelected || isEditing ? 1 : 0.6
                    }}
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
                      className="w-4 h-4 rounded flex-shrink-0"
                      style={{ accentColor: '#10BFCC' }}
                    />
                    <span className="text-xs flex-shrink-0" style={{ color: '#8F949E', minWidth: '40px' }}>
                      #{idx + 1}
                    </span>
                    
                    {/* Editing mode: show inputs */}
                    {isEditing ? (
                      <div className="flex flex-wrap gap-2 flex-1">
                        {tags.map(([key, value]) => (
                          <div key={key} className="flex items-center gap-1">
                            <span className="text-xs" style={{ color: '#8F949E' }}>{key}:</span>
                            <input
                              type="text"
                              value={value}
                              onChange={(e) => updateTupleValue(tuple.id, key, e.target.value)}
                              className="text-xs px-2 py-0.5 rounded w-32"
                              style={{ 
                                backgroundColor: '#171A1F', 
                                border: '1px solid #FCBC32', 
                                color: '#FDFDFD' 
                              }}
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
                            className="text-xs px-2 py-0.5 rounded"
                            style={{ backgroundColor: '#333333', color: '#10BFCC' }}
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
                      className="p-1 rounded transition-colors flex-shrink-0"
                      style={{ 
                        backgroundColor: isEditing ? 'rgba(16, 191, 204, 0.2)' : 'transparent',
                      }}
                      title={isEditing ? "Done editing" : "Edit tuple"}
                    >
                      {isEditing ? (
                        <Check className="w-3.5 h-3.5" style={{ color: '#10BFCC' }} />
                      ) : (
                        <Edit3 className="w-3.5 h-3.5" style={{ color: '#8F949E' }} />
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
              <div className="mt-3 pt-3 border-t" style={{ borderColor: '#333333' }}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span style={{ color: '#8F949E' }}>Generating queries...</span>
                  <span style={{ color: '#10BFCC' }}>{genProgress.completed}/{genProgress.total}</span>
                </div>
                <div className="h-1.5 rounded-full" style={{ backgroundColor: '#333333' }}>
                  <div 
                    className="h-full rounded-full transition-all"
                    style={{ 
                      width: `${genProgress.percent}%`, 
                      backgroundColor: '#10BFCC' 
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* BOTTOM: Batch Data Preview (full width) */}
        <div 
          className="rounded-lg p-4 flex flex-col flex-1"
          style={{ 
            backgroundColor: '#1C1E24', 
            border: '1px solid #333333', 
            minHeight: '400px',
            maxHeight: dimensionsCollapsed && batchesCollapsed ? '70vh' : '500px'
          }}
        >
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <h2 className="font-display text-lg flex items-center gap-2" style={{ color: '#FDFDFD' }}>
              <Eye className="w-5 h-5" style={{ color: '#10BFCC' }} />
              Batch data preview
              {selectedBatch && (
                <span className="text-xs px-2 py-0.5 rounded ml-1" style={{ backgroundColor: '#333333', color: '#8F949E' }}>
                  {selectedBatch.queries?.length || 0} items
                </span>
              )}
              {executingBatchId && selectedBatch?.id === executingBatchId && (
                <RefreshCw className="w-4 h-4 animate-spin ml-2" style={{ color: '#10BFCC' }} />
              )}
            </h2>
            <div className="flex items-center gap-3">
              {/* View in Threads - show when batch has executed queries */}
              {selectedBatch && selectedBatch.queries && selectedBatch.queries.length > 0 && 
               selectedBatch.queries.some(q => q.response_text || q.execution_status === 'success') && (
                <button
                  onClick={viewInThreads}
                  className="flex items-center gap-2 text-sm transition-all hover:opacity-80"
                  style={{ color: '#10BFCC' }}
                >
                  <ExternalLink className="w-4 h-4" />
                  View in Threads
                </button>
              )}
            {/* Actions bar - shows Select All when 1+ selected */}
            {selectedBatch && selectedBatch.queries && selectedBatch.queries.length > 0 && selectedQueryIds.size > 0 && (
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs" style={{ color: '#8F949E' }}>
                  <input
                    type="checkbox"
                    checked={selectedQueryIds.size === selectedBatch.queries.length}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedQueryIds(new Set(selectedBatch.queries.map((q) => q.id)));
                      else setSelectedQueryIds(new Set());
                    }}
                    className="w-3.5 h-3.5 rounded"
                    style={{ accentColor: '#FCBC32' }}
                  />
                  Select all
                </label>
                <div className="w-px h-4" style={{ backgroundColor: '#333333' }} />
                <button
                  onClick={copySelectedQueries}
                  className="text-xs px-2 py-1 rounded flex items-center gap-1 transition-colors"
                  style={{ 
                    backgroundColor: copiedAllSelected ? 'rgba(16, 191, 204, 0.15)' : 'rgba(16, 191, 204, 0.1)', 
                    color: '#10BFCC' 
                  }}
                >
                  {copiedAllSelected ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedAllSelected ? 'Copied!' : `Copy ${selectedQueryIds.size}`}
                </button>
                <button
                  onClick={handleDeleteSelectedQueries}
                  className="text-xs px-2 py-1 rounded flex items-center gap-1 text-red-400"
                  style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
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
                  className="border-b transition-colors"
                  style={{ borderColor: '#333333' }}
                >
                  {/* Collapsed Row Header - Always visible */}
                  <button
                    onClick={toggleExpanded}
                    className="w-full grid gap-4 px-4 py-3 text-left transition-colors hover:bg-white/5 items-center"
                    style={{ gridTemplateColumns: '24px 60px 80px 1fr auto' }}
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
                      className="w-4 h-4 rounded"
                      style={{ accentColor: '#FCBC32' }}
                    />
                    
                    {/* Index */}
                    <span 
                      className="text-xs font-mono px-2 py-1 rounded text-center"
                      style={{ backgroundColor: '#333333', color: '#8F949E' }}
                    >
                      {idx + 1}/{selectedBatch.queries.length}
                    </span>
                    
                    {/* Status */}
                    <div className="flex items-center gap-1">
                      {query.execution_status === "running" && (
                        <RefreshCw className="w-3 h-3 animate-spin" style={{ color: '#FCBC32' }} />
                      )}
                      <StatusBadge status={query.execution_status || 'pending'} />
                    </div>
                    
                    {/* Query Preview */}
                    <div className="min-w-0 flex items-center gap-2">
                      <ChevronDown 
                        className={`w-4 h-4 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
                        style={{ color: '#8F949E' }} 
                      />
                      <span 
                        className="text-sm truncate"
                        style={{ color: '#FDFDFD' }}
                      >
                        {query.query_text.slice(0, 100)}{query.query_text.length > 100 ? "..." : ""}
                      </span>
                    </div>
                    
                    {/* Tags */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {tags.slice(0, 3).map(([key, val]) => (
                        <span 
                          key={key} 
                          className="text-xs px-2 py-0.5 rounded"
                          style={{ backgroundColor: 'rgba(16, 191, 204, 0.15)', color: '#10BFCC' }}
                        >
                          {val}
                        </span>
                      ))}
                      {tags.length > 3 && (
                        <span className="text-xs" style={{ color: '#8F949E' }}>+{tags.length - 3}</span>
                      )}
                    </div>
                  </button>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div 
                      className="px-4 pb-4 space-y-4"
                      style={{ backgroundColor: 'rgba(23, 26, 31, 0.5)' }}
                    >
                      {/* Full Query */}
                      {editingQueryId === query.id ? (
                        <div className="space-y-2">
                          <textarea
                            defaultValue={query.query_text}
                            id={`textarea-${query.id}`}
                            rows={4}
                            autoFocus
                            className="w-full px-3 py-2 rounded text-sm"
                            style={{ backgroundColor: '#171A1F', border: '1px solid #FCBC32', color: '#FDFDFD' }}
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                const textarea = document.getElementById(`textarea-${query.id}`) as HTMLTextAreaElement;
                                handleUpdateQuery(query.id, textarea?.value || query.query_text);
                              }}
                              className="text-xs px-3 py-1.5 rounded font-medium"
                              style={{ backgroundColor: '#FCBC32', color: '#171A1F' }}
                            >
                              SAVE
                            </button>
                            <button 
                              onClick={() => setEditingQueryId(null)} 
                              className="text-xs px-3 py-1.5 rounded"
                              style={{ backgroundColor: '#333333', color: '#8F949E' }}
                            >
                              CANCEL
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div 
                          className={`p-4 rounded-lg ${!isExecuted ? 'cursor-pointer group' : ''}`}
                          style={{ backgroundColor: '#171A1F', border: '1px solid #333333' }}
                          onClick={() => !isExecuted && setEditingQueryId(query.id)}
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <div 
                                className="w-6 h-6 rounded flex items-center justify-center"
                                style={{ backgroundColor: '#333333' }}
                              >
                                <span className="text-xs" style={{ color: '#FDFDFD' }}>Q</span>
                              </div>
                              <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#8F949E' }}>User Query</span>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); copyQueryText(query.id, query.query_text); }}
                              className="p-1.5 rounded transition-colors hover:bg-white/10"
                              style={{ color: copiedQueryId === query.id ? '#10BFCC' : '#8F949E' }}
                              title="Copy query text"
                            >
                              {copiedQueryId === query.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </button>
                          </div>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: '#FDFDFD' }}>
                            {query.query_text}
                          </p>
                          {!isExecuted && (
                            <span 
                              className="text-xs opacity-0 group-hover:opacity-100 transition-opacity mt-2 inline-block"
                              style={{ color: '#8F949E' }}
                            >
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
                          className="flex items-center justify-center gap-3 py-2 px-4 rounded-lg transition-all hover:bg-white/5 group/metrics"
                          style={{ 
                            backgroundColor: 'rgba(252, 188, 50, 0.05)', 
                            border: '1px dashed rgba(252, 188, 50, 0.3)' 
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <Zap className="w-3.5 h-3.5" style={{ color: '#FCBC32' }} />
                            <span className="text-xs" style={{ color: '#FCBC32' }}>
                              {query.call_count} calls
                            </span>
                          </div>
                          {query.total_latency_ms && (
                            <>
                              <span style={{ color: '#333' }}>•</span>
                              <span className="text-xs" style={{ color: '#8F949E' }}>
                                {query.total_latency_ms >= 1000 
                                  ? `${(query.total_latency_ms / 1000).toFixed(1)}s`
                                  : `${Math.round(query.total_latency_ms)}ms`
                                }
                              </span>
                            </>
                          )}
                          <span 
                            className="text-xs opacity-0 group-hover/metrics:opacity-100 transition-opacity flex items-center gap-1"
                            style={{ color: '#10BFCC' }}
                          >
                            View details <ExternalLink className="w-3 h-3" />
                          </span>
                        </button>
                      )}

                      {/* Full Response */}
                      {query.response_text && (
                        <div 
                          className="p-4 rounded-lg"
                          style={{ backgroundColor: '#171A1F', border: '1px solid rgba(16, 191, 204, 0.3)' }}
                        >
                          <div className="flex items-center gap-2 mb-3">
                            <div 
                              className="w-6 h-6 rounded flex items-center justify-center"
                              style={{ backgroundColor: 'rgba(16, 191, 204, 0.2)' }}
                            >
                              <Bot className="w-3.5 h-3.5" style={{ color: '#10BFCC' }} />
                            </div>
                            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#10BFCC' }}>Agent Response</span>
                          </div>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: '#FDFDFD' }}>
                            {query.response_text}
                          </p>
                        </div>
                      )}

                      {/* Error Message */}
                      {query.error_message && (
                        <div 
                          className="p-4 rounded-lg"
                          style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)' }}
                        >
                          <div className="flex items-center gap-2 mb-3">
                            <div 
                              className="w-6 h-6 rounded flex items-center justify-center"
                              style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)' }}
                            >
                              <AlertTriangle className="w-3.5 h-3.5" style={{ color: '#EF4444' }} />
                            </div>
                            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#EF4444' }}>Error</span>
                          </div>
                          <p className="text-sm leading-relaxed" style={{ color: '#FCA5A5' }}>
                            {query.error_message}
                          </p>
                        </div>
                      )}

                      {/* All Tags */}
                      {tags.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap pt-2">
                          <span className="text-xs uppercase tracking-wider" style={{ color: '#8F949E' }}>Tags:</span>
                          {tags.map(([key, val]) => (
                            <span 
                              key={key} 
                              className="text-xs px-2 py-1 rounded flex items-center gap-1"
                              style={{ backgroundColor: 'rgba(16, 191, 204, 0.15)', color: '#10BFCC' }}
                            >
                              <Tag className="w-3 h-3 opacity-50" />
                              <span style={{ color: '#8F949E' }}>{key}:</span> {val}
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
            <div className="flex-1 flex items-center justify-center" style={{ color: '#8F949E' }}>
              <div className="text-center">
                <Eye className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg mb-2" style={{ color: '#FDFDFD' }}>Select a batch to preview</p>
                <p className="text-sm">Choose a batch from the "Generated batches" section above to review and edit its data.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
