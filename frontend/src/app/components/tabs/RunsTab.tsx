"use client";

import { useState } from "react";
import {
  Cpu,
  Clock,
  CheckCircle2,
  RefreshCw,
  Play,
  Eye,
  ExternalLink,
  AlertTriangle,
  ClipboardList,
  Bot,
  ChevronDown,
  ChevronUp,
  Tag,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { formatRelativeTime, calculateETA } from "../../utils/formatters";
import { StatusBadge } from "../ui";
import type { ExecutionProgress, BatchDetail } from "../../types";
import * as api from "../../lib/api";

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
  const [executingBatch, setExecutingBatch] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<ExecutionProgress | null>(null);
  
  // Dropdown state
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);

  // Collapsible sections
  const [pendingCollapsed, setPendingCollapsed] = useState(false);
  const [completedCollapsed, setCompletedCollapsed] = useState(false);

  const pendingBatches = syntheticBatches.filter((b) => b.status === "ready" || b.status === "pending");
  const completedBatches = syntheticBatches.filter((b) => b.status === "completed" || b.status === "failed");

  const executeBatch = async (batchId: string, agentId: string) => {
    setExecutingBatch(true);
    const startTime = Date.now();
    setExecutionProgress(null);

    try {
      const response = await fetch(`/api/synthetic/batches/${batchId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeout_per_query: 60.0 }),
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              setExecutionProgress({ ...data, start_time: startTime });

              if (data.status === "completed" || data.status === "failed" || data.status === "cancelled") {
                await fetchBatches(agentId);
                await fetchBatchDetail(batchId);
              }
            } catch {
              // Skip malformed events
            }
          }
        }
      }
    } catch (error) {
      console.error("Error executing batch:", error);
    } finally {
      setExecutingBatch(false);
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
              style={{ backgroundColor: completedBatches.length > 0 ? 'rgba(16, 191, 204, 0.15)' : '#333333', color: completedBatches.length > 0 ? '#10BFCC' : '#8F949E' }}
            >
              {completedBatches.length}
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

      {/* Execution Progress */}
      {executingBatch && executionProgress && (
        <div 
          className="rounded-lg p-4"
          style={{ backgroundColor: 'rgba(16, 191, 204, 0.1)', border: '1px solid rgba(16, 191, 204, 0.3)' }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <RefreshCw className="w-5 h-5 animate-spin" style={{ color: '#10BFCC' }} />
              <div>
                <span className="font-medium" style={{ color: '#FDFDFD' }}>Executing Batch</span>
                <span className="text-sm ml-2" style={{ color: '#8F949E' }}>{selectedBatch?.name}</span>
              </div>
            </div>
            <span className="text-sm" style={{ color: '#10BFCC' }}>
              {executionProgress.completed_queries} / {executionProgress.total_queries}
            </span>
          </div>

          <div className="w-full rounded-full h-2 mb-3 overflow-hidden" style={{ backgroundColor: '#333333' }}>
            <div
              className="h-2 rounded-full transition-all duration-300"
              style={{ width: `${executionProgress.progress_percent}%`, background: 'linear-gradient(to right, #10BFCC, #FCBC32)' }}
            />
          </div>

          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2" style={{ color: '#10BFCC' }}>
              <CheckCircle2 className="w-4 h-4" />
              <span>{executionProgress.success_count} success</span>
            </div>
            <div className="flex items-center gap-2" style={{ color: '#EF4444' }}>
              <AlertTriangle className="w-4 h-4" />
              <span>{executionProgress.failure_count} failed</span>
            </div>
            {executionProgress.start_time &&
              executionProgress.completed_queries > 0 &&
              executionProgress.completed_queries < executionProgress.total_queries && (
                <div className="flex items-center gap-2" style={{ color: '#8F949E' }}>
                  <Clock className="w-4 h-4" />
                  <span>~{calculateETA(executionProgress.start_time, executionProgress.completed_queries, executionProgress.total_queries)}s remaining</span>
                </div>
              )}
          </div>

          {executionProgress.current_query_text && (
            <div 
              className="mt-3 p-3 rounded-lg"
              style={{ backgroundColor: '#171A1F' }}
            >
              <p className="text-xs mb-1" style={{ color: '#8F949E' }}>Currently processing:</p>
              <p className="text-sm italic" style={{ color: '#FDFDFD' }}>&quot;{executionProgress.current_query_text}&quot;</p>
            </div>
          )}
        </div>
      )}

      {/* ========== MAIN CONTENT ========== */}
      <div className="flex flex-col gap-4">
        {/* TOP ROW: Pending + Completed Runs (side by side) */}
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
                              setSelectedBatch({ id: batch.id, name: batch.name, queries: [] });
                              executeBatch(batch.id, selectedAgent.id);
                            }}
                            disabled={executingBatch}
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

          {/* RIGHT: Completed Runs */}
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
                Completed runs
                <span 
                  className="text-xs px-2 py-0.5 rounded ml-1"
                  style={{ backgroundColor: completedBatches.length > 0 ? 'rgba(16, 191, 204, 0.15)' : '#333333', color: completedBatches.length > 0 ? '#10BFCC' : '#8F949E' }}
                >
                  {completedBatches.length}
                </span>
              </button>
            </div>

            {!completedCollapsed && (
              <div className="mt-4 flex-1 flex flex-col overflow-hidden">
                {completedBatches.length > 0 ? (
                  <div className="space-y-3 flex-1 overflow-y-auto pr-1">
                    {completedBatches.map((batch) => (
                      <div
                        key={batch.id}
                        className="rounded-lg p-4 transition-all cursor-pointer"
                        style={{ 
                          backgroundColor: selectedBatch?.id === batch.id ? 'rgba(16, 191, 204, 0.1)' : '#252830',
                          border: selectedBatch?.id === batch.id ? '1px solid rgba(16, 191, 204, 0.4)' : '1px solid #333333'
                        }}
                        onClick={() => fetchBatchDetail(batch.id)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium" style={{ color: '#FDFDFD' }}>{batch.name}</span>
                          <StatusBadge status={batch.status} />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs" style={{ color: '#8F949E' }}>{batch.query_count} queries • {formatRelativeTime(batch.created_at)}</span>
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
              {selectedBatch?.queries?.length && (
                <span className="text-xs px-2 py-0.5 rounded ml-1" style={{ backgroundColor: '#333333', color: '#8F949E' }}>
                  {selectedBatch.queries.length} queries
                </span>
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
            <div className="grid grid-cols-2 gap-4 flex-1 overflow-y-auto pr-2">
              {selectedBatch.queries.map((query, idx) => (
                <QueryResultCard key={query.id} query={query} index={idx} total={selectedBatch.queries.length} />
              ))}
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

function QueryResultCard({
  query,
  index,
  total,
}: {
  query: BatchDetail["queries"][0];
  index: number;
  total: number;
}) {
  const borderColor =
    query.execution_status === "success"
      ? '#10B981'
      : query.execution_status === "error"
      ? '#EF4444'
      : '#333333';

  const bgColor =
    query.execution_status === "success"
      ? 'rgba(16, 185, 129, 0.05)'
      : query.execution_status === "error"
      ? 'rgba(239, 68, 68, 0.05)'
      : '#252830';

  return (
    <div 
      className="rounded-lg p-4"
      style={{ 
        backgroundColor: bgColor, 
        border: '1px solid #333333',
        borderLeftWidth: '4px',
        borderLeftColor: borderColor
      }}
    >
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span 
          className="text-xs font-mono px-1.5 py-0.5 rounded"
          style={{ backgroundColor: '#333333', color: '#8F949E' }}
        >
          {index + 1}/{total}
        </span>
        {query.execution_status && <StatusBadge status={query.execution_status} />}
        {Object.entries(query.tuple_values || {}).slice(0, 3).map(([key, val]) => (
          <span 
            key={key} 
            className="text-xs px-2 py-0.5 rounded flex items-center gap-1"
            style={{ backgroundColor: 'rgba(16, 191, 204, 0.15)', color: '#10BFCC' }}
          >
            <Tag className="w-3 h-3 opacity-50" />{val}
          </span>
        ))}
      </div>

      <p className="text-sm mb-3 leading-relaxed" style={{ color: '#FDFDFD' }}>
        &quot;{query.query_text.slice(0, 150)}{query.query_text.length > 150 ? "..." : ""}&quot;
      </p>

      {query.response_text && (
        <div 
          className="p-3 rounded-lg"
          style={{ backgroundColor: '#171A1F', border: '1px solid #333333' }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <Bot className="w-3.5 h-3.5" style={{ color: '#10BFCC' }} />
            <span className="text-xs font-medium" style={{ color: '#10BFCC' }}>Response</span>
          </div>
          <p className="text-xs line-clamp-4 leading-relaxed" style={{ color: '#8F949E' }}>
            {query.response_text.slice(0, 300)}{query.response_text.length > 300 ? "..." : ""}
          </p>
        </div>
      )}

      {query.error_message && (
        <div 
          className="p-3 rounded-lg mt-3"
          style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)' }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3.5 h-3.5" style={{ color: '#EF4444' }} />
            <span className="text-xs font-medium" style={{ color: '#EF4444' }}>Error</span>
          </div>
          <p className="text-xs" style={{ color: '#FCA5A5' }}>{query.error_message}</p>
        </div>
      )}
    </div>
  );
}
