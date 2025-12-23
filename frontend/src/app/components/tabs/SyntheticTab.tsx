"use client";

/**
 * SyntheticTab - Synthetic data generation and batch execution
 *
 * Refactored to use extracted sub-components and hooks:
 * - DimensionsPanel: Testing dimensions management (with AI-assisted design)
 * - BatchesPanel: Batch list with run controls
 * - QueryPreviewCard: Expandable query cards
 * - useBatchGeneration: SSE streaming for generation (heuristic tuples + LLM queries)
 * - useBatchExecution: SSE streaming for execution
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Cpu,
  Target,
  Zap,
  RefreshCw,
  Hash,
  ChevronDown,
  ChevronUp,
  Square,
  Eye,
  ExternalLink,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Trash2,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { Panel, StatusBadge, SelectPrompt, ConfirmDialog, useConfirm } from "../ui";
import { EditPromptButton } from "../PromptEditDrawer";
import * as api from "../../lib/api";
import { useBatchGeneration } from "../../lib/useBatchGeneration";
import { useBatchExecution } from "../../lib/useBatchExecution";
import { createLogger } from "../../lib/logger";

const logger = createLogger("SyntheticTab");

// Sub-components
import {
  DimensionsPanel,
  BatchesPanel,
  QueryPreviewCard,
} from "./SyntheticTab/index";

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
    fetchBatches,
    fetchBatchDetail,
    setSelectedBatch,
    deleteBatch,
    setActiveTab,
  } = useApp();

  // ========== LOCAL STATE ==========

  // Generation settings
  const [batchSize, setBatchSize] = useState(20);

  // Dimension selection for generation
  const [selectedDimensionIds, setSelectedDimensionIds] = useState<Set<string>>(new Set());
  const [showDimensionSelector, setShowDimensionSelector] = useState(false);

  // Heuristic sampling settings
  const [variety, setVariety] = useState(0.5); // 0.0 = predictable, 1.0 = surprising
  const [noDuplicates, setNoDuplicates] = useState(true);
  const [favorites, setFavorites] = useState<Record<string, string[]>>({}); // dim_name -> favorite values

  // Collapsible sections
  const [dimensionsCollapsed, setDimensionsCollapsed] = useState(false);
  const [batchesCollapsed, setBatchesCollapsed] = useState(false);

  // Synced panel height
  const [syncedPanelHeight, setSyncedPanelHeight] = useState(280);
  const dimensionsPanelRef = useRef<HTMLDivElement>(null);
  const batchesPanelRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);

  // Query editing and expansion
  const [selectedQueryIds, setSelectedQueryIds] = useState<Set<string>>(new Set());
  const [expandedQueryIds, setExpandedQueryIds] = useState<Set<string>>(new Set());
  const [copiedQueryId, setCopiedQueryId] = useState<string | null>(null);
  const [copiedAllSelected, setCopiedAllSelected] = useState(false);

  // Confirmation dialogs
  const { confirm: confirmDeleteQueries, ConfirmDialogComponent: DeleteQueriesDialog } = useConfirm({
    title: "Delete Selected Queries?",
    message: "This action cannot be undone.",
    confirmText: "Delete",
    variant: "danger",
  });

  // ========== HOOKS ==========

  // Batch generation hook
  const generation = useBatchGeneration({
    agentId: selectedAgent?.id || null,
    dimensions,
    selectedDimensionIds,
    // Heuristic sampling parameters
    variety,
    favorites: Object.keys(favorites).length > 0 ? favorites : undefined,
    noDuplicates,
    onBatchCreated: (batchId, batchName) => {
      setSelectedBatch({ id: batchId, name: batchName, queries: [] });
    },
    onBatchComplete: async (batch) => {
      if (selectedAgent) {
        await fetchBatches(selectedAgent.id);
      }
      setSelectedBatch({ id: batch.id, name: batch.name, queries: batch.queries });
    },
    onQueryGenerated: () => {
      // Update selected batch queries every 10 queries for UI responsiveness
      if (generation.streamingQueries.length % 10 === 0) {
        setSelectedBatch((prev) =>
          prev ? { ...prev, queries: [...generation.streamingQueries] } : null
        );
      }
    },
  });

  // Compute seenCounts as a derived value from the current queries
  // This is computed from either streaming queries (during generation) or selected batch queries
  const seenCounts = useMemo(() => {
    const counts: Record<string, Record<string, number>> = {};
    
    // Use streaming queries during active generation, otherwise use selected batch queries
    const queries = generation.generating 
      ? generation.streamingQueries 
      : selectedBatch?.queries || [];
    
    for (const query of queries) {
      const tupleValues = query.tuple_values as Record<string, string> | undefined;
      if (tupleValues) {
        for (const [dimName, value] of Object.entries(tupleValues)) {
          if (!counts[dimName]) counts[dimName] = {};
          counts[dimName][value] = (counts[dimName][value] || 0) + 1;
        }
      }
    }
    
    return counts;
  }, [generation.generating, generation.streamingQueries, selectedBatch?.queries]);

  // Batch execution hook
  const execution = useBatchExecution({
    onExecutionStart: (batchId) => {
      if (selectedAgent) {
        fetchBatches(selectedAgent.id);
      }
    },
    onProgressUpdate: (batchId, completedQueries) => {
      fetchBatchDetail(batchId);
    },
    onExecutionComplete: async (batchId, status) => {
      if (selectedAgent) {
        await fetchBatches(selectedAgent.id);
        await fetchBatchDetail(batchId);
      }
    },
  });

  // ========== EFFECTS ==========
  
  // Initialize selected dimensions when dimensions load
  useEffect(() => {
    if (dimensions.length > 0 && selectedDimensionIds.size === 0) {
      setSelectedDimensionIds(new Set(dimensions.map((d) => d.id)));
    }
  }, [dimensions, selectedDimensionIds.size]);

  // ResizeObserver to sync panel heights
  useEffect(() => {
    const dimensionsPanel = dimensionsPanelRef.current;
    const batchesPanel = batchesPanelRef.current;
    
    if (!dimensionsPanel || !batchesPanel) return;

    const observer = new ResizeObserver((entries) => {
      if (isResizingRef.current) return;
      
      for (const entry of entries) {
        const newHeight = entry.contentRect.height + 32;
        if (Math.abs(newHeight - syncedPanelHeight) > 5) {
          isResizingRef.current = true;
          setSyncedPanelHeight(newHeight);
          setTimeout(() => {
            isResizingRef.current = false;
          }, 50);
        }
      }
    });

    observer.observe(dimensionsPanel);
    observer.observe(batchesPanel);

    return () => observer.disconnect();
  }, [syncedPanelHeight]);

  // ========== HANDLERS ==========

  const handleDimensionsChanged = useCallback(
    async (agentId: string) => {
      await fetchDimensions(agentId);
    },
    [fetchDimensions]
  );

  const handleSelectBatch = useCallback(
    (batchId: string) => {
      fetchBatchDetail(batchId);
    },
    [fetchBatchDetail]
  );

  const handleDeselectBatch = useCallback(() => {
    setSelectedBatch(null);
  }, [setSelectedBatch]);

  const handleExecuteBatch = useCallback(
    (batchId: string, batchName: string) => {
      if (!selectedAgent) return;
      // Select batch to show results as they come in
    setSelectedBatch({ id: batchId, name: batchName, queries: [] });
      execution.executeBatch(batchId, batchName, selectedAgent.id);
    },
    [selectedAgent, setSelectedBatch, execution]
  );

  const handleResetBatch = useCallback(
    async (batchId: string, onlyFailed: boolean) => {
      if (!selectedAgent) return;
      await execution.resetBatch(batchId, selectedAgent.id, onlyFailed);
      await fetchBatches(selectedAgent.id);
                await fetchBatchDetail(batchId);
    },
    [selectedAgent, execution, fetchBatches, fetchBatchDetail]
  );

  const handleDeleteBatch = useCallback(
    async (batchId: string) => {
      if (!selectedAgent) return;
      await deleteBatch(batchId, selectedAgent.id);
      if (selectedBatch?.id === batchId) {
        setSelectedBatch(null);
      }
    },
    [selectedAgent, deleteBatch, selectedBatch, setSelectedBatch]
  );

  // Note: handleViewInThreads removed - users review traces in Weave UI directly
  // via "Review in Weave" button in BatchCard

  const handleUpdateQuery = useCallback(
    async (queryId: string, newText: string) => {
      try {
        await api.updateQuery(queryId, newText);
                  setSelectedBatch((prev) =>
          prev
            ? {
                ...prev,
                queries: prev.queries.map((q) =>
                  q.id === queryId ? { ...q, query_text: newText } : q
                ),
              }
            : null
        );
    } catch (error) {
        logger.error("Error updating query", { error: String(error) });
      }
    },
    [setSelectedBatch]
  );

  const handleDeleteSelectedQueries = useCallback(async () => {
    if (!selectedAgent || selectedQueryIds.size === 0) return;

    const confirmed = await confirmDeleteQueries();
    if (!confirmed) return;

    try {
      await api.bulkDeleteQueries(Array.from(selectedQueryIds));
      setSelectedBatch((prev) =>
        prev
          ? { ...prev, queries: prev.queries.filter((q) => !selectedQueryIds.has(q.id)) }
          : null
      );
      setSelectedQueryIds(new Set());
      await fetchBatches(selectedAgent.id);
    } catch (error) {
      logger.error("Error deleting queries", { error: String(error) });
    }
  }, [selectedAgent, selectedQueryIds, confirmDeleteQueries, setSelectedBatch, fetchBatches]);

  // Note: handleQueryViewInThreads removed - review via Weave URL

  const copyQueryText = (queryId: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedQueryId(queryId);
    setTimeout(() => setCopiedQueryId(null), 2000);
  };

  const copySelectedQueries = () => {
    if (!selectedBatch?.queries || selectedQueryIds.size === 0) return;
    const selectedTexts = selectedBatch.queries
      .filter((q) => selectedQueryIds.has(q.id))
      .map((q) => q.query_text)
      .join("\n\n---\n\n");
    navigator.clipboard.writeText(selectedTexts);
    setCopiedAllSelected(true);
    setTimeout(() => setCopiedAllSelected(false), 2000);
  };

  // ========== RENDER: No Agent Selected ==========

  if (!selectedAgent) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <div className="text-center text-moon-450">
          <Cpu className="w-16 h-16 mx-auto mb-4 opacity-40" />
          <h2 className="text-xl font-display mb-2 text-moon-50">
            Select an agent to get started
          </h2>
          <p className="mb-4">
            {agents.length === 0 
              ? "Register an agent first to generate synthetic test data."
              : "Select an agent from the Agents tab to generate synthetic test data."}
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

  // ========== RENDER: Main Content ==========

  return (
    <div className="space-y-4">
      {/* Confirmation Dialogs */}
      <DeleteQueriesDialog />

      {/* ========== TOP CONTROL BAR ========== */}
      <div className="rounded-lg p-4 flex flex-wrap items-center gap-4 bg-moon-800 border border-moon-700">
        {/* Agent Dropdown */}
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-moon-450" />
          <select
            value={selectedAgent?.id || ""}
            onChange={(e) => {
              const agent = agents.find((a) => a.id === e.target.value);
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
                if (val === "") {
                  setBatchSize("" as unknown as number);
                  return;
                }
                if (/^\d+$/.test(val)) {
                  const num = parseInt(val, 10);
                  setBatchSize(Math.min(100, num));
                }
              }}
              onBlur={(e) => {
                const val = e.target.value;
                if (val === "" || parseInt(val, 10) < 1) {
                  setBatchSize(1);
                }
              }}
              className="w-16 px-2 py-1.5 rounded text-sm text-center bg-moon-900 border border-moon-700 text-moon-50"
            />
            <span className="text-xs text-moon-450">queries</span>
          </div>

          {/* Dimension selector */}
          <DimensionSelector
            dimensions={dimensions}
            selectedDimensionIds={selectedDimensionIds}
            setSelectedDimensionIds={setSelectedDimensionIds}
            showSelector={showDimensionSelector}
            setShowSelector={setShowDimensionSelector}
          />
        </div>

        {/* Variety Controls (shown when dimensions are selected) */}
        {selectedDimensionIds.size > 0 && (
          <VarietyControls
            variety={variety}
            setVariety={setVariety}
            noDuplicates={noDuplicates}
            setNoDuplicates={setNoDuplicates}
          />
        )}

        {/* Edit Prompt Button */}
        <div className="flex items-center gap-1 border-l border-moon-700 pl-2 ml-1">
          <EditPromptButton
            promptId="query_generation"
            label="Queries"
            size="sm"
            variant="ghost"
          />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Generate Button */}
        <button
          onClick={() => generation.generateBatch(batchSize)}
          disabled={generation.generating || selectedDimensionIds.size === 0}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-md font-medium transition-all disabled:opacity-50 ${
            generation.generating ? "bg-moon-700 text-moon-450" : "bg-gold text-moon-900"
          }`}
          title={selectedDimensionIds.size === 0 ? "Select at least one dimension" : undefined}
        >
          {generation.generating ? (
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
      </div>

      {/* Click-away listener for dimension selector */}
      {showDimensionSelector && (
        <div className="fixed inset-0 z-40" onClick={() => setShowDimensionSelector(false)} />
      )}

      {/* ========== MAIN CONTENT ========== */}
      <div className="flex flex-col gap-4">
        {/* TOP ROW: Testing Dimensions + Generated Batches (side by side) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* LEFT: Testing Dimensions */}
          <div ref={dimensionsPanelRef}>
            <DimensionsPanel
              agentId={selectedAgent.id}
              dimensions={dimensions}
              loadingDimensions={loadingDimensions}
              collapsed={dimensionsCollapsed}
              panelHeight={syncedPanelHeight}
              onToggleCollapsed={() => setDimensionsCollapsed(!dimensionsCollapsed)}
              onDimensionsChanged={handleDimensionsChanged}
              favorites={favorites}
              onFavoritesChange={setFavorites}
              seenCounts={seenCounts}
              isGenerating={generation.generating}
            />
          </div>

          {/* RIGHT: Generated Batches */}
          <div ref={batchesPanelRef}>
            <BatchesPanel
              batches={syntheticBatches}
              selectedBatch={selectedBatch}
              executingBatchId={execution.executingBatchId}
              collapsed={batchesCollapsed}
              panelHeight={syncedPanelHeight}
              onToggleCollapsed={() => setBatchesCollapsed(!batchesCollapsed)}
              onSelectBatch={handleSelectBatch}
              onDeselectBatch={handleDeselectBatch}
              onExecuteBatch={handleExecuteBatch}
              onStopExecution={execution.stopExecution}
              onResetBatch={handleResetBatch}
              onDeleteBatch={handleDeleteBatch}
            />
          </div>
        </div>

        {/* Generation Progress */}
        {generation.generating && generation.genProgress && (
          <GenerationProgress
            progress={generation.genProgress}
            onStop={generation.stopGeneration}
          />
        )}

        {/* Execution Progress */}
        {execution.executionProgress && (
          <ExecutionProgress
            progress={execution.executionProgress}
            executingBatchId={execution.executingBatchId}
            onStop={execution.stopExecution}
          />
        )}


        {/* BOTTOM: Batch Data Preview */}
        <BatchDataPreview
          selectedBatch={selectedBatch}
          executingBatchId={execution.executingBatchId}
          selectedQueryIds={selectedQueryIds}
          expandedQueryIds={expandedQueryIds}
          copiedQueryId={copiedQueryId}
          copiedAllSelected={copiedAllSelected}
          onToggleQuerySelect={(queryId, selected) => {
            setSelectedQueryIds((prev) => {
              const newSet = new Set(prev);
              if (selected) newSet.add(queryId);
              else newSet.delete(queryId);
              return newSet;
            });
          }}
          onToggleQueryExpand={(queryId) => {
            setExpandedQueryIds((prev) => {
              const newSet = new Set(prev);
              if (newSet.has(queryId)) newSet.delete(queryId);
              else newSet.add(queryId);
              return newSet;
            });
          }}
          onSelectAllQueries={() =>
            setSelectedQueryIds(new Set(selectedBatch?.queries.map((q) => q.id) || []))
          }
          onDeselectAllQueries={() => setSelectedQueryIds(new Set())}
          onCopySelected={copySelectedQueries}
          onDeleteSelected={handleDeleteSelectedQueries}
          onUpdateQuery={handleUpdateQuery}
          dimensionsCollapsed={dimensionsCollapsed}
          batchesCollapsed={batchesCollapsed}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Helper Components (extracted from the main component for clarity)
// ============================================================================

interface DimensionSelectorProps {
  dimensions: { id: string; name: string; values: string[] }[];
  selectedDimensionIds: Set<string>;
  setSelectedDimensionIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  showSelector: boolean;
  setShowSelector: (value: boolean) => void;
}

function DimensionSelector({
  dimensions,
  selectedDimensionIds,
  setSelectedDimensionIds,
  showSelector,
  setShowSelector,
}: DimensionSelectorProps) {
  return (
    <div className="relative">
      <button
        onClick={() => setShowSelector(!showSelector)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors border border-moon-700 ${
          showSelector ? "bg-teal/15 text-teal" : "bg-moon-900 text-moon-50"
        }`}
      >
        <Target className="w-3.5 h-3.5" />
        <span>
          {`${selectedDimensionIds.size}/${dimensions.length} dimensions`}
        </span>
        {showSelector ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      
      {showSelector && (
        <div className="absolute top-full left-0 mt-1 p-3 rounded-lg z-50 min-w-[320px] bg-moon-800 border border-teal shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-teal">Select dimensions to use</span>
            <div className="flex gap-1">
              <button
                onClick={() => setSelectedDimensionIds(new Set(dimensions.map((d) => d.id)))}
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
              {dimensions.map((dim) => (
                <label 
                  key={dim.id} 
                  className={`flex items-start gap-2 cursor-pointer p-2 rounded transition-colors hover:bg-opacity-50 ${
                    selectedDimensionIds.has(dim.id) ? "bg-teal/10" : "bg-transparent"
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
                        <span
                          key={i}
                          className="text-xs px-1.5 py-0.5 rounded bg-moon-700 text-moon-450"
                        >
                          {val}
                        </span>
                      ))}
                      {dim.values?.length > 4 && (
                        <span className="text-xs text-moon-450">
                          +{dim.values.length - 4} more
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-xs text-center py-4 text-moon-450">
              No dimensions defined. Add them in the Testing Dimensions panel.
            </p>
          )}
          
          {dimensions.length > 0 && selectedDimensionIds.size === 0 && (
            <p className="text-xs mt-2 text-center text-gold">⚠️ Select at least one dimension</p>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Variety Controls Component
// ============================================================================

interface VarietyControlsProps {
  variety: number;
  setVariety: (value: number) => void;
  noDuplicates: boolean;
  setNoDuplicates: (value: boolean) => void;
}

function VarietyControls({
  variety,
  setVariety,
  noDuplicates,
  setNoDuplicates,
}: VarietyControlsProps) {
  const varietyPercent = Math.round(variety * 100);
  
  // Preset values for quick selection
  const presets = [0, 0.25, 0.5, 0.75, 1.0];
  
  return (
    <div className="flex items-center gap-5 border-l border-moon-700 pl-4 ml-2">
      {/* Variety Slider - Clean style matching prompt drawer */}
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-moon-50 whitespace-nowrap">
          Variety
          <span className="ml-2 font-mono text-gold">{varietyPercent}%</span>
        </label>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-moon-450">Predictable</span>
          <input
            type="range"
            min="0"
            max="100"
            value={varietyPercent}
            onChange={(e) => setVariety(parseInt(e.target.value) / 100)}
            className="w-28"
            style={{
              background: `linear-gradient(to right, #FCBC32 0%, #FCBC32 ${varietyPercent}%, #333333 ${varietyPercent}%, #333333 100%)`,
            }}
          />
          <span className="text-[10px] text-moon-450">Surprising</span>
        </div>
        {/* Quick presets */}
        <div className="flex gap-1 ml-1">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => setVariety(p)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-all ${
                variety === p ? "ring-1 ring-gold" : ""
              }`}
              style={{
                backgroundColor: variety === p 
                  ? "rgba(252, 188, 50, 0.2)" 
                  : "rgba(37, 40, 48, 0.5)",
                color: variety === p ? "#FCBC32" : "#8F949E",
              }}
            >
              {Math.round(p * 100)}
            </button>
          ))}
        </div>
      </div>
      
      {/* No Duplicates Toggle - Clean checkbox style */}
      <label className="flex items-center gap-2 cursor-pointer select-none group">
        <button
          onClick={() => setNoDuplicates(!noDuplicates)}
          className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
            noDuplicates 
              ? "bg-teal border-teal" 
              : "bg-transparent border-moon-450 group-hover:border-moon-50"
          }`}
          title={noDuplicates ? "Unique combinations only" : "Allow duplicate combinations"}
        >
          {noDuplicates && (
            <svg className="w-2.5 h-2.5 text-moon-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
        <span className="text-xs text-moon-450 group-hover:text-moon-50 transition-colors">
          Unique only
        </span>
      </label>
    </div>
  );
}


interface GenerationProgressProps {
  progress: { total: number; completed: number; percent: number; currentQuery?: string };
  onStop: () => void;
}

function GenerationProgress({ progress, onStop }: GenerationProgressProps) {
  return (
          <div className="rounded-lg p-4 bg-gold/10 border border-gold/30">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-moon-50">
          {progress.percent === 0 ? "Preparing..." : "Generating queries..."}
              </span>
              <div className="flex items-center gap-3">
          <span className="text-sm text-gold">
            {progress.completed} / {progress.total}
          </span>
                <button
            onClick={onStop}
                  className="p-1.5 rounded transition-colors hover:bg-red-500/20 text-red-500"
                  title="Stop generation"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              </div>
            </div>
            <div className="w-full rounded-full h-2 mb-2 overflow-hidden bg-moon-700">
        {progress.percent === 0 ? (
                <div className="h-2 rounded-full w-[30%] bg-gold animate-pulse" />
              ) : (
                <div
                  className="h-2 rounded-full transition-all duration-300 bg-gold"
            style={{ width: `${progress.percent}%` }}
                />
              )}
            </div>
      {progress.currentQuery && (
              <p className="text-xs truncate text-moon-450">
          {progress.percent === 0
            ? progress.currentQuery
            : `Latest: "${progress.currentQuery}"`}
              </p>
            )}
          </div>
  );
}

interface ExecutionProgressProps {
  progress: {
    status: string;
    total_queries: number;
    completed_queries: number;
    success_count: number;
    failure_count: number;
    progress_percent: number;
    current_query_text?: string;
    estimated_remaining_seconds?: number;
  };
  executingBatchId: string | null;
  onStop: () => void;
}

function ExecutionProgress({ progress, executingBatchId, onStop }: ExecutionProgressProps) {
  return (
          <div className="rounded-lg p-4 bg-teal/10 border border-teal/30">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
          {(progress.status === "running" || progress.status === "starting") && (
                  <RefreshCw className="w-4 h-4 animate-spin text-teal" />
                )}
                <span className="font-medium text-moon-50">
            {progress.status === "completed"
              ? "Execution complete!"
              : progress.status === "failed"
              ? "Execution failed"
              : progress.status === "starting" || progress.total_queries === 0
              ? "Starting execution..."
              : `Running queries... (${progress.completed_queries}/${progress.total_queries})`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono text-teal">
            {progress.completed_queries} / {progress.total_queries || "?"}
                </span>
                {executingBatchId && (
                  <button
              onClick={onStop}
                    className="p-1.5 rounded transition-colors hover:bg-red-500/20 text-red-500"
                    title="Stop execution"
                  >
                    <Square className="w-4 h-4 fill-current" />
                  </button>
                )}
              </div>
            </div>
            
            <div className="w-full rounded-full h-2 mb-2 overflow-hidden bg-moon-700">
        {progress.status === "starting" || progress.total_queries === 0 ? (
                <div className="h-2 rounded-full w-[30%] bg-gradient-to-r from-teal to-gold animate-pulse" />
              ) : (
                <div
                  className="h-2 rounded-full transition-all duration-300 bg-gradient-to-r from-teal to-gold"
            style={{ width: `${Math.max(progress.progress_percent, 2)}%` }}
                />
              )}
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1 text-teal">
                  <CheckCircle2 className="w-3 h-3" />
            <span>{progress.success_count} success</span>
                </div>
                <div className="flex items-center gap-1 text-red-500">
                  <AlertTriangle className="w-3 h-3" />
            <span>{progress.failure_count} failed</span>
                </div>
          {progress.estimated_remaining_seconds && progress.status === "running" && (
                  <div className="flex items-center gap-1 text-moon-450">
                    <Clock className="w-3 h-3" />
              <span>~{progress.estimated_remaining_seconds}s remaining</span>
                  </div>
                )}
              </div>
        {progress.current_query_text && progress.status === "running" && (
                <p className="text-xs truncate max-w-md text-moon-450">
            &quot;{progress.current_query_text}&quot;
                </p>
              )}
            </div>
          </div>
  );
}

interface BatchDataPreviewProps {
  selectedBatch: { id: string; name: string; queries: any[] } | null;
  executingBatchId: string | null;
  selectedQueryIds: Set<string>;
  expandedQueryIds: Set<string>;
  copiedQueryId: string | null;
  copiedAllSelected: boolean;
  onToggleQuerySelect: (queryId: string, selected: boolean) => void;
  onToggleQueryExpand: (queryId: string) => void;
  onSelectAllQueries: () => void;
  onDeselectAllQueries: () => void;
  onCopySelected: () => void;
  onDeleteSelected: () => void;
  onUpdateQuery: (queryId: string, newText: string) => void;
  dimensionsCollapsed: boolean;
  batchesCollapsed: boolean;
}

function BatchDataPreview({
  selectedBatch,
  executingBatchId,
  selectedQueryIds,
  expandedQueryIds,
  copiedQueryId,
  copiedAllSelected,
  onToggleQuerySelect,
  onToggleQueryExpand,
  onSelectAllQueries,
  onDeselectAllQueries,
  onCopySelected,
  onDeleteSelected,
  onUpdateQuery,
  dimensionsCollapsed,
  batchesCollapsed,
}: BatchDataPreviewProps) {
                return (
        <div 
          className="rounded-lg p-4 flex flex-col flex-1 bg-ink-900 border border-moon-700"
          style={{ 
        minHeight: "400px",
        maxHeight: dimensionsCollapsed && batchesCollapsed ? "70vh" : "500px",
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
          {/* Selection actions */}
          {selectedBatch && selectedBatch.queries && selectedBatch.queries.length > 0 && selectedQueryIds.size > 0 && (
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs text-moon-450">
                  <input
                    type="checkbox"
                    checked={selectedQueryIds.size === selectedBatch.queries.length}
                    onChange={(e) => {
                    if (e.target.checked) onSelectAllQueries();
                    else onDeselectAllQueries();
                    }}
                    className="w-3.5 h-3.5 rounded accent-gold"
                  />
                  Select all
                </label>
                <div className="w-px h-4 bg-moon-700" />
                <button
                onClick={onCopySelected}
                  className={`text-xs px-2 py-1 rounded flex items-center gap-1 transition-colors text-teal ${
                  copiedAllSelected ? "bg-teal/15" : "bg-teal/10"
                  }`}
                >
                  {copiedAllSelected ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedAllSelected ? "Copied!" : `Copy ${selectedQueryIds.size}`}
                </button>
                <button
                onClick={onDeleteSelected}
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
          {selectedBatch.queries.map((query, idx) => (
            <QueryPreviewCard
                  key={query.id}
              query={query}
              index={idx}
              totalCount={selectedBatch.queries.length}
              isSelected={selectedQueryIds.has(query.id)}
              isExpanded={expandedQueryIds.has(query.id)}
              onToggleSelect={(selected) => onToggleQuerySelect(query.id, selected)}
              onToggleExpand={() => onToggleQueryExpand(query.id)}
              onEdit={(newText) => onUpdateQuery(query.id, newText)}
            />
          ))}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-moon-450">
              <div className="text-center">
                <Eye className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg mb-2 text-moon-50">Select a batch to preview</p>
            <p className="text-sm">
              Choose a batch from the &quot;Generated batches&quot; section above to review and
              edit its data.
            </p>
              </div>
            </div>
          )}
    </div>
  );
}
