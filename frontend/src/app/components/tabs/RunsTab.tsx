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
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { formatRelativeTime, calculateETA } from "../../utils/formatters";
import { Panel, PanelHeader, Badge, StatusBadge, SelectPrompt, ProgressBar } from "../ui";
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

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-6">
      <div className="grid grid-cols-12 gap-6">
        {/* Left Panel - Agent Selection */}
        <div className="col-span-3 space-y-4">
          <Panel>
            <PanelHeader icon={<Cpu className="w-5 h-5 text-accent-teal" />} title="Select Agent" />
            {agents.length > 0 ? (
              <div className="space-y-2">
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={async () => {
                      setSelectedAgent(agent as any);
                      await fetchBatches(agent.id);
                    }}
                    className={`w-full text-left p-3 rounded-lg transition-all ${
                      selectedAgent?.id === agent.id
                        ? "bg-accent-teal/20 border border-accent-teal/50"
                        : "bg-ink-800/50 hover:bg-ink-800 border border-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sand-200 font-medium">{agent.name}</span>
                      <StatusBadge status={agent.connection_status} />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-ink-400">
                <Cpu className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No agents registered.</p>
                <button onClick={() => setActiveTab("agents")} className="mt-2 text-xs text-accent-teal hover:underline">
                  Register an agent →
                </button>
              </div>
            )}
          </Panel>
        </div>

        {/* Middle Panel - Batch Execution */}
        <div className="col-span-5 space-y-4">
          {/* Active Execution */}
          {executingBatch && executionProgress && (
            <div className="bg-gradient-to-r from-accent-teal/10 to-accent-plum/10 rounded-xl border border-accent-teal/30 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-accent-teal/20 flex items-center justify-center">
                  <RefreshCw className="w-5 h-5 text-accent-teal animate-spin" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-sand-100">Executing Batch</h3>
                  <p className="text-sm text-ink-400">{selectedBatch?.name || "Running..."}</p>
                </div>
              </div>

              <ProgressBar
                value={executionProgress.progress_percent}
                label={`Query ${executionProgress.completed_queries} of ${executionProgress.total_queries}`}
                sublabel={`${Math.round(executionProgress.progress_percent)}%`}
                gradientFrom="from-accent-teal"
                gradientTo="to-accent-plum"
                className="mb-4"
              />

              <div className="flex items-center gap-6 text-sm">
                <div className="flex items-center gap-2 text-green-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{executionProgress.success_count} success</span>
                </div>
                <div className="flex items-center gap-2 text-red-400">
                  <AlertTriangle className="w-4 h-4" />
                  <span>{executionProgress.failure_count} failed</span>
                </div>
                {executionProgress.start_time &&
                  executionProgress.completed_queries > 0 &&
                  executionProgress.completed_queries < executionProgress.total_queries && (
                    <div className="flex items-center gap-2 text-ink-400">
                      <Clock className="w-4 h-4" />
                      <span>~{calculateETA(executionProgress.start_time, executionProgress.completed_queries, executionProgress.total_queries)}s remaining</span>
                    </div>
                  )}
              </div>

              {executionProgress.current_query_text && (
                <div className="mt-4 p-3 bg-ink-900/50 rounded-lg">
                  <p className="text-xs text-ink-500 mb-1">Currently processing:</p>
                  <p className="text-sm text-sand-300 italic">&quot;{executionProgress.current_query_text}&quot;</p>
                </div>
              )}
            </div>
          )}

          {/* Pending Runs */}
          <Panel>
            <PanelHeader
              icon={<Clock className="w-5 h-5 text-accent-amber" />}
              title="Pending Runs"
              badge={pendingBatches.length > 0 ? <span className="text-xs text-ink-400">({pendingBatches.length})</span> : null}
            />

            {selectedAgent ? (
              pendingBatches.length > 0 ? (
                <div className="space-y-3">
                  {pendingBatches.map((batch) => (
                    <div key={batch.id} className="p-4 bg-ink-800/50 rounded-lg border border-ink-700 hover:border-ink-600">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sand-200 font-medium">{batch.name}</span>
                        <Badge variant="amber" className="text-xs">{batch.query_count} queries</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-ink-500">Created {formatRelativeTime(batch.created_at)}</span>
                        <button
                          onClick={() => {
                            setSelectedBatch({ id: batch.id, name: batch.name, queries: [] });
                            executeBatch(batch.id, selectedAgent.id);
                          }}
                          disabled={executingBatch}
                          className="btn-primary py-1.5 px-4 text-sm flex items-center gap-2"
                        >
                          <Play className="w-4 h-4" />
                          Run
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-ink-400">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No pending batches.</p>
                  <button onClick={() => setActiveTab("synthetic")} className="mt-2 text-xs text-accent-amber hover:underline">
                    Generate synthetic data →
                  </button>
                </div>
              )
            ) : (
              <SelectPrompt icon={<Cpu className="w-8 h-8" />} title="Select an agent to view runs" description="" />
            )}
          </Panel>

          {/* Completed Runs */}
          <Panel>
            <PanelHeader
              icon={<CheckCircle2 className="w-5 h-5 text-green-400" />}
              title="Completed Runs"
              badge={completedBatches.length > 0 ? <span className="text-xs text-ink-400">({completedBatches.length})</span> : null}
            />

            {selectedAgent && completedBatches.length > 0 ? (
              <div className="space-y-3">
                {completedBatches.map((batch) => (
                  <div
                    key={batch.id}
                    className={`p-4 rounded-lg border transition-all cursor-pointer ${
                      selectedBatch?.id === batch.id
                        ? "bg-accent-teal/10 border-accent-teal/30"
                        : "bg-ink-800/50 border-ink-700 hover:border-ink-600"
                    }`}
                    onClick={() => fetchBatchDetail(batch.id)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sand-200 font-medium">{batch.name}</span>
                      <StatusBadge status={batch.status} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-ink-500">{batch.query_count} queries • {formatRelativeTime(batch.created_at)}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          resetBatch(batch.id, selectedAgent.id, false);
                        }}
                        className="text-xs text-ink-400 hover:text-sand-200 flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Re-run
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-ink-400">
                <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No completed runs yet.</p>
              </div>
            )}
          </Panel>
        </div>

        {/* Right Panel - Run Details */}
        <div className="col-span-4">
          <Panel className="sticky top-24">
            <div className="flex items-center justify-between mb-4">
              <PanelHeader icon={<Eye className="w-5 h-5 text-accent-plum" />} title="Run Results" />
              {selectedBatch && (
                <button onClick={viewInSessions} className="text-xs text-accent-teal hover:underline flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" />
                  View in Sessions
                </button>
              )}
            </div>

            {selectedBatch && selectedBatch.queries && selectedBatch.queries.length > 0 ? (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {selectedBatch.queries.map((query, idx) => (
                  <QueryResultCard key={query.id} query={query} index={idx} total={selectedBatch.queries.length} />
                ))}
              </div>
            ) : (
              <SelectPrompt icon={<Eye className="w-8 h-8" />} title="Select a completed run to view results" description="" />
            )}
          </Panel>
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
  const borderClass =
    query.execution_status === "success"
      ? "bg-green-900/10 border-green-900/30"
      : query.execution_status === "error"
      ? "bg-red-900/10 border-red-900/30"
      : "bg-ink-800/50 border-ink-700";

  return (
    <div className={`p-3 rounded-lg border ${borderClass}`}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs text-ink-500">{index + 1}/{total}</span>
        {query.execution_status && <StatusBadge status={query.execution_status} />}
        {Object.entries(query.tuple_values || {}).slice(0, 2).map(([key, val]) => (
          <Badge key={key} variant="plum" className="text-xs">{val}</Badge>
        ))}
      </div>

      <p className="text-sm text-sand-300 mb-2">
        &quot;{query.query_text.slice(0, 100)}{query.query_text.length > 100 ? "..." : ""}&quot;
      </p>

      {query.response_text && (
        <div className="p-2 bg-ink-900/50 rounded border border-ink-700">
          <div className="flex items-center gap-1 mb-1">
            <Bot className="w-3 h-3 text-accent-teal" />
            <span className="text-xs text-ink-500">Response</span>
          </div>
          <p className="text-xs text-sand-400 line-clamp-3">
            {query.response_text.slice(0, 200)}{query.response_text.length > 200 ? "..." : ""}
          </p>
        </div>
      )}

      {query.error_message && (
        <div className="p-2 bg-red-900/20 rounded border border-red-900/30 mt-2">
          <p className="text-xs text-red-300">{query.error_message}</p>
        </div>
      )}
    </div>
  );
}

