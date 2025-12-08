"use client";

import { useState, useRef, useEffect } from "react";
import {
  Cpu,
  Clock,
  CheckCircle2,
  RefreshCw,
  Play,
  Eye,
  AlertTriangle,
  ClipboardList,
  Bot,
  ChevronDown,
  ChevronUp,
  Tag,
  ExternalLink,
  Square,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { formatRelativeTime } from "../../utils/formatters";
import { StatusBadge } from "../ui";
import type { ExecutionProgress, BatchDetail } from "../../types";
import * as api from "../../lib/api";
import { getBackendUrl } from "../../lib/api";

export function RunsTab() {
  const {
    agents,
    selectedAgent,
    syntheticBatches,
    selectedBatch,
    fetchBatches,
    fetchBatchDetail,
    setSelectedBatch,
    setFilterBatchId,
    setFilterBatchName,
    setActiveTab,
    setSelectedAgent,
  } = useApp();

  // Local execution state
  const [executingBatchId, setExecutingBatchId] = useState<string | null>(null);
  const [executionProgress, setExecutionProgress] = useState<ExecutionProgress | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastFetchedCountRef = useRef<number>(0);

  // Cleanup AbortController on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);
  
  // Dropdown state
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);

  // Collapsible sections
  const [pendingCollapsed, setPendingCollapsed] = useState(false);
  const [completedCollapsed, setCompletedCollapsed] = useState(false);

  // Include "running" status in completed/active batches so user can see progress
  const pendingBatches = syntheticBatches.filter((b) => b.status === "ready" || b.status === "pending");
  const activeBatches = syntheticBatches.filter((b) => b.status === "running" || b.status === "completed" || b.status === "failed");


  const stopExecution = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setExecutingBatchId(null);
    setExecutionProgress(null);
  };

  const executeBatch = async (batchId: string, batchName: string, agentId: string) => {
    // Create abort controller for this execution
    abortControllerRef.current = new AbortController();
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
        signal: abortControllerRef.current.signal,
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

  const viewInSessions = () => {
    if (!selectedBatch) return;
    setFilterBatchId(selectedBatch.id);
    setFilterBatchName(selectedBatch.name);
    setActiveTab("sessions");
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
              ? "Register an agent first to run batch executions."
              : "Select an agent from the Agents tab to run batch executions."
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
          <div className="relative">
            <button
              onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm min-w-[200px] text-left"
              style={{ backgroundColor: '#171A1F', border: '1px solid #333333', color: '#FDFDFD' }}
            >
              <div className="flex-1 truncate">
                {selectedAgent ? (
                  <span>{selectedAgent.name}</span>
                ) : (
                  <span style={{ color: '#8F949E' }}>Choose an agent...</span>
                )}
              </div>
              <ChevronDown className={`w-4 h-4 transition-transform ${agentDropdownOpen ? 'rotate-180' : ''}`} style={{ color: '#8F949E' }} />
            </button>

            {/* Dropdown Menu */}
            {agentDropdownOpen && (
              <>
                <div 
                  className="fixed inset-0 z-10" 
                  onClick={() => setAgentDropdownOpen(false)} 
                />
                <div 
                  className="absolute top-full left-0 right-0 mt-1 rounded-lg shadow-xl z-20 overflow-hidden"
                  style={{ backgroundColor: '#1C1E24', border: '1px solid #333333' }}
                >
                  {agents.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={async () => {
                        setSelectedAgent(agent as any);
                        await fetchBatches(agent.id);
                        setAgentDropdownOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
                      style={{ 
                        backgroundColor: selectedAgent?.id === agent.id ? 'rgba(252, 188, 50, 0.1)' : 'transparent',
                        borderLeft: selectedAgent?.id === agent.id ? '2px solid #FCBC32' : '2px solid transparent'
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="font-medium block truncate" style={{ color: '#FDFDFD' }}>{agent.name}</span>
                        <StatusBadge status={agent.connection_status} className="mt-0.5" />
                      </div>
                      {selectedAgent?.id === agent.id && (
                        <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: '#FCBC32' }} />
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="h-8 w-px" style={{ backgroundColor: '#333333' }} />

        {/* Status Info */}
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" style={{ color: '#FCBC32' }} />
            <span style={{ color: '#8F949E' }}>Pending:</span>
            <span 
              className="px-2 py-0.5 rounded text-xs font-medium"
              style={{ backgroundColor: pendingBatches.length > 0 ? 'rgba(252, 188, 50, 0.15)' : '#333333', color: pendingBatches.length > 0 ? '#FCBC32' : '#8F949E' }}
            >
              {pendingBatches.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" style={{ color: '#10BFCC' }} />
            <span style={{ color: '#8F949E' }}>Completed:</span>
            <span 
              className="px-2 py-0.5 rounded text-xs font-medium"
              style={{ backgroundColor: activeBatches.length > 0 ? 'rgba(16, 191, 204, 0.15)' : '#333333', color: activeBatches.length > 0 ? '#10BFCC' : '#8F949E' }}
            >
              {activeBatches.length}
            </span>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Go to Data Tab */}
        <button
          onClick={() => setActiveTab("synthetic")}
          className="flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors"
          style={{ backgroundColor: '#333333', color: '#8F949E' }}
        >
          <ExternalLink className="w-4 h-4" />
          <span>GENERATE DATA</span>
        </button>
      </div>

      {/* ========== EXECUTION PROGRESS BAR ========== */}
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

      {/* ========== MAIN CONTENT ========== */}
      <div className="flex flex-col gap-4">
        {/* TOP ROW: Pending + Active Runs (side by side) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* LEFT: Pending Runs */}
          <div 
            className="rounded-lg p-4 flex flex-col overflow-hidden transition-all duration-200"
            style={{ 
              backgroundColor: '#1C1E24', 
              border: '1px solid #333333', 
              height: pendingCollapsed ? 'auto' : '320px' 
            }}
          >
            <div className="flex items-center justify-between flex-shrink-0">
              <button
                onClick={() => setPendingCollapsed(!pendingCollapsed)}
                className="font-display text-lg flex items-center gap-2 hover:opacity-80 transition-opacity"
                style={{ color: '#FDFDFD' }}
              >
                {pendingCollapsed ? (
                  <ChevronDown className="w-4 h-4" style={{ color: '#8F949E' }} />
                ) : (
                  <ChevronUp className="w-4 h-4" style={{ color: '#8F949E' }} />
                )}
                <Clock className="w-5 h-5" style={{ color: '#FCBC32' }} />
                Pending runs
                <span 
                  className="text-xs px-2 py-0.5 rounded ml-1"
                  style={{ backgroundColor: pendingBatches.length > 0 ? 'rgba(252, 188, 50, 0.15)' : '#333333', color: pendingBatches.length > 0 ? '#FCBC32' : '#8F949E' }}
                >
                  {pendingBatches.length}
                </span>
              </button>
            </div>

            {!pendingCollapsed && (
              <div className="mt-4 flex-1 flex flex-col overflow-hidden">
                {pendingBatches.length > 0 ? (
                  <div className="space-y-3 flex-1 overflow-y-auto pr-1">
                    {pendingBatches.map((batch) => (
                      <div 
                        key={batch.id} 
                        className="rounded-lg p-4 transition-colors"
                        style={{ backgroundColor: '#252830', border: '1px solid #333333' }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium" style={{ color: '#FDFDFD' }}>{batch.name}</span>
                          <span 
                            className="text-xs px-2 py-0.5 rounded"
                            style={{ backgroundColor: 'rgba(252, 188, 50, 0.15)', color: '#FCBC32' }}
                          >
                            {batch.query_count} queries
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs" style={{ color: '#8F949E' }}>Created {formatRelativeTime(batch.created_at)}</span>
                          <button
                            onClick={() => {
                              executeBatch(batch.id, batch.name, selectedAgent.id);
                            }}
                            disabled={!!executingBatchId}
                            className="flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all disabled:opacity-50"
                            style={{ backgroundColor: '#FCBC32', color: '#171A1F' }}
                          >
                            <Play className="w-4 h-4" />
                            Run
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center" style={{ color: '#8F949E' }}>
                    <div className="text-center">
                      <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      <p className="text-sm font-medium">No pending batches</p>
                      <p className="text-xs mt-1" style={{ color: '#8F949E' }}>All batches have been executed</p>
                      <button 
                        onClick={() => setActiveTab("synthetic")} 
                        className="mt-3 text-xs hover:underline"
                        style={{ color: '#FCBC32' }}
                      >
                        Generate synthetic data →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT: Active/Completed Runs */}
          <div 
            className="rounded-lg p-4 flex flex-col overflow-hidden transition-all duration-200"
            style={{ 
              backgroundColor: '#1C1E24', 
              border: '1px solid #333333', 
              height: completedCollapsed ? 'auto' : '320px' 
            }}
          >
            <div className="flex items-center justify-between flex-shrink-0">
              <button
                onClick={() => setCompletedCollapsed(!completedCollapsed)}
                className="font-display text-lg flex items-center gap-2 hover:opacity-80 transition-opacity"
                style={{ color: '#FDFDFD' }}
              >
                {completedCollapsed ? (
                  <ChevronDown className="w-4 h-4" style={{ color: '#8F949E' }} />
                ) : (
                  <ChevronUp className="w-4 h-4" style={{ color: '#8F949E' }} />
                )}
                <CheckCircle2 className="w-5 h-5" style={{ color: '#10BFCC' }} />
                Active & Completed runs
                <span 
                  className="text-xs px-2 py-0.5 rounded ml-1"
                  style={{ backgroundColor: activeBatches.length > 0 ? 'rgba(16, 191, 204, 0.15)' : '#333333', color: activeBatches.length > 0 ? '#10BFCC' : '#8F949E' }}
                >
                  {activeBatches.length}
                </span>
              </button>
            </div>

            {!completedCollapsed && (
              <div className="mt-4 flex-1 flex flex-col overflow-hidden">
                {activeBatches.length > 0 ? (
                  <div className="space-y-3 flex-1 overflow-y-auto pr-1">
                    {activeBatches.map((batch) => (
                      <div
                        key={batch.id}
                        className="rounded-lg p-4 transition-all cursor-pointer"
                        style={{ 
                          backgroundColor: selectedBatch?.id === batch.id 
                            ? 'rgba(16, 191, 204, 0.1)' 
                            : batch.status === 'running' 
                            ? 'rgba(252, 188, 50, 0.05)'
                            : '#252830',
                          border: selectedBatch?.id === batch.id 
                            ? '1px solid rgba(16, 191, 204, 0.4)' 
                            : batch.status === 'running'
                            ? '1px solid rgba(252, 188, 50, 0.3)'
                            : '1px solid #333333'
                        }}
                        onClick={() => fetchBatchDetail(batch.id)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium" style={{ color: '#FDFDFD' }}>{batch.name}</span>
                            {batch.status === 'running' && (
                              <RefreshCw className="w-3 h-3 animate-spin" style={{ color: '#FCBC32' }} />
                            )}
                          </div>
                          <StatusBadge status={batch.status} />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs" style={{ color: '#8F949E' }}>{batch.query_count} queries • {formatRelativeTime(batch.created_at)}</span>
                          {batch.status !== 'running' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                resetBatch(batch.id, selectedAgent.id, false);
                              }}
                              className="text-xs flex items-center gap-1 hover:opacity-80"
                              style={{ color: '#8F949E' }}
                            >
                              <RefreshCw className="w-3 h-3" />
                              Re-run
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center" style={{ color: '#8F949E' }}>
                    <div className="text-center">
                      <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      <p className="text-sm font-medium">No completed runs yet</p>
                      <p className="text-xs mt-1">Execute a batch to see results</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* BOTTOM: Run Results (full width) */}
        <div 
          className="rounded-lg p-4 flex flex-col flex-1"
          style={{ 
            backgroundColor: '#1C1E24', 
            border: '1px solid #333333', 
            minHeight: '400px',
            maxHeight: pendingCollapsed && completedCollapsed ? '70vh' : '500px'
          }}
        >
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <h2 className="font-display text-lg flex items-center gap-2" style={{ color: '#FDFDFD' }}>
              <Eye className="w-5 h-5" style={{ color: '#FCBC32' }} />
              Run results
              {selectedBatch?.queries?.length ? (
                <span className="text-xs px-2 py-0.5 rounded ml-1" style={{ backgroundColor: '#333333', color: '#8F949E' }}>
                  {selectedBatch.queries.length} queries
                </span>
              ) : null}
              {executingBatchId && selectedBatch?.id === executingBatchId && (
                <RefreshCw className="w-4 h-4 animate-spin ml-2" style={{ color: '#10BFCC' }} />
              )}
            </h2>
            {selectedBatch && selectedBatch.queries && selectedBatch.queries.length > 0 && (
              <button 
                onClick={viewInSessions} 
                className="flex items-center gap-2 text-sm transition-colors hover:opacity-80"
                style={{ color: '#10BFCC' }}
              >
                <ExternalLink className="w-4 h-4" />
                View in Sessions
              </button>
            )}
          </div>

          {selectedBatch && selectedBatch.queries && selectedBatch.queries.length > 0 ? (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Table Header */}
              <div 
                className="grid gap-4 px-4 py-2 text-xs font-medium uppercase tracking-wider flex-shrink-0"
                style={{ 
                  gridTemplateColumns: '60px 80px 1fr auto',
                  color: '#8F949E',
                  borderBottom: '1px solid #333333'
                }}
              >
                <span>#</span>
                <span>Status</span>
                <span>Query</span>
                <span>Tags</span>
              </div>
              
              {/* Table Body */}
              <div className="flex flex-col flex-1 overflow-y-auto">
                {selectedBatch.queries.map((query, idx) => (
                  <QueryResultRow key={query.id} query={query} index={idx} total={selectedBatch.queries.length} />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center" style={{ color: '#8F949E' }}>
              <div className="text-center">
                <Eye className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg mb-2" style={{ color: '#FDFDFD' }}>No results to display</p>
                <p className="text-sm">
                  {selectedAgent 
                    ? "Select a completed run above to view its results" 
                    : "Select an agent and run a batch to see results here"}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QueryResultRow({
  query,
  index,
  total,
}: {
  query: BatchDetail["queries"][0];
  index: number;
  total: number;
}) {
  const [expanded, setExpanded] = useState(false);
  
  const statusColor =
    query.execution_status === "success"
      ? '#10B981'
      : query.execution_status === "error"
      ? '#EF4444'
      : query.execution_status === "running"
      ? '#FCBC32'
      : '#8F949E';

  const tags = Object.entries(query.tuple_values || {});

  return (
    <div 
      className="border-b transition-colors"
      style={{ borderColor: '#333333' }}
    >
      {/* Collapsed Row - Table-like layout */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full grid gap-4 px-4 py-3 text-left transition-colors hover:bg-white/5 items-center"
        style={{ gridTemplateColumns: '60px 80px 1fr auto' }}
      >
        {/* Index */}
        <span 
          className="text-xs font-mono px-2 py-1 rounded text-center"
          style={{ backgroundColor: '#333333', color: '#8F949E' }}
        >
          {index + 1}/{total}
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
            className={`w-4 h-4 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} 
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
      {expanded && (
        <div 
          className="px-4 pb-4 space-y-4"
          style={{ backgroundColor: 'rgba(23, 26, 31, 0.5)' }}
        >
          {/* Full Query */}
          <div 
            className="p-4 rounded-lg"
            style={{ backgroundColor: '#171A1F', border: '1px solid #333333' }}
          >
            <div className="flex items-center gap-2 mb-3">
              <div 
                className="w-6 h-6 rounded flex items-center justify-center"
                style={{ backgroundColor: '#333333' }}
              >
                <span className="text-xs" style={{ color: '#FDFDFD' }}>Q</span>
              </div>
              <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#8F949E' }}>User Query</span>
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: '#FDFDFD' }}>
              {query.query_text}
            </p>
          </div>

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
}
