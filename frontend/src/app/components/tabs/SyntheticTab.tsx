"use client";

import { useState } from "react";
import {
  Cpu,
  Target,
  Plus,
  Zap,
  ClipboardList,
  MessageSquare,
  RefreshCw,
  Play,
  Trash2,
  Edit3,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { formatRelativeTime } from "../../utils/formatters";
import { Panel, PanelHeader, Badge, StatusBadge, SelectPrompt } from "../ui";
import * as api from "../../lib/api";

export function SyntheticTab() {
  const {
    agents,
    selectedAgent,
    dimensions,
    loadingDimensions,
    syntheticBatches,
    selectedBatch,
    generatingBatch,
    generationProgress,
    executingBatch,
    fetchAgentDetail,
    fetchDimensions,
    importDimensions,
    fetchBatches,
    fetchBatchDetail,
    setSelectedBatch,
    deleteBatch,
    setActiveTab,
  } = useApp();

  // Local state
  const [batchSize, setBatchSize] = useState(20);
  const [batchStrategy, setBatchStrategy] = useState<"cross_product" | "llm_guided">("cross_product");
  const [selectedQueryIds, setSelectedQueryIds] = useState<Set<string>>(new Set());
  const [editingQueryId, setEditingQueryId] = useState<string | null>(null);

  // Dimension editing
  const [editingDimension, setEditingDimension] = useState<string | null>(null);
  const [newDimensionName, setNewDimensionName] = useState("");
  const [newDimensionValues, setNewDimensionValues] = useState("");
  const [showAddDimension, setShowAddDimension] = useState(false);

  // Generation state (local since context doesn't handle streaming)
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<{ completed: number; total: number; percent: number; currentQuery?: string } | null>(null);

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
    try {
      await api.deleteDimension(selectedAgent.id, dimName);
      await fetchDimensions(selectedAgent.id);
    } catch (error) {
      console.error("Error deleting dimension:", error);
    }
  };

  const generateBatch = async () => {
    if (!selectedAgent) return;
    
    setGenerating(true);
    setGenProgress({ total: batchSize, completed: 0, percent: 0 });

    const streamingBatch = { id: "", name: `Batch ${new Date().toLocaleDateString()}`, queries: [] as typeof selectedBatch["queries"] };

    try {
      const response = await fetch("/api/synthetic/batches/generate-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: selectedAgent.id,
          name: `Batch ${new Date().toLocaleDateString()}`,
          count: batchSize,
          strategy: batchStrategy,
        }),
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
                streamingBatch.id = event.batch_id;
                streamingBatch.name = event.name;
                setSelectedBatch({ id: event.batch_id, name: event.name, queries: [] });
              } else if (event.type === "query_generated") {
                streamingBatch.queries.push(event.query);
                setGenProgress({
                  total: event.total,
                  completed: event.completed,
                  percent: event.progress_percent,
                  currentQuery: event.query.query_text.slice(0, 50) + "...",
                });
                setSelectedBatch((prev) =>
                  prev ? { ...prev, queries: [...(prev.queries || []), event.query] } : null
                );
              } else if (event.type === "batch_complete") {
                await fetchBatches(selectedAgent.id);
                setSelectedBatch({ id: event.batch_id, name: event.name, queries: event.queries });
              }
            } catch {
              // Skip malformed events
            }
          }
        }
      }
    } catch (error) {
      console.error("Error generating batch:", error);
    } finally {
      setGenerating(false);
      setGenProgress(null);
    }
  };

  const handleDeleteSelectedQueries = async () => {
    if (!selectedAgent || selectedQueryIds.size === 0) return;
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

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* Left Panel: Agent Selection & Dimensions */}
      <div className="col-span-4 space-y-4">
        {/* Agent Selection */}
        <Panel>
          <PanelHeader icon={<Cpu className="w-5 h-5 text-accent-teal" />} title="Select Agent" />
          {agents.length > 0 ? (
            <div className="space-y-2">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => fetchAgentDetail(agent.id)}
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
            <p className="text-ink-400 text-sm">No agents registered. Go to the Agents tab to register one.</p>
          )}
        </Panel>

        {/* Testing Dimensions */}
        {selectedAgent && (
          <Panel>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-sand-100 flex items-center gap-2">
                <Target className="w-5 h-5 text-accent-plum" />
                Testing Dimensions
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => importDimensions(selectedAgent.id)}
                  disabled={loadingDimensions}
                  className="text-xs btn-secondary py-1 px-2"
                >
                  {loadingDimensions ? "..." : "Import from AGENT_INFO"}
                </button>
                <button onClick={() => setShowAddDimension(true)} className="text-xs btn-primary py-1 px-2">
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>

            {showAddDimension && (
              <div className="bg-ink-800 rounded-lg p-3 mb-4 border border-ink-700">
                <h4 className="text-sm font-medium text-sand-200 mb-2">Add New Dimension</h4>
                <input
                  type="text"
                  placeholder="Dimension name"
                  value={newDimensionName}
                  onChange={(e) => setNewDimensionName(e.target.value)}
                  className="w-full bg-ink-900 border border-ink-600 rounded px-3 py-2 text-sm text-sand-200 mb-2"
                />
                <textarea
                  placeholder="Values (comma-separated)"
                  value={newDimensionValues}
                  onChange={(e) => setNewDimensionValues(e.target.value)}
                  rows={3}
                  className="w-full bg-ink-900 border border-ink-600 rounded px-3 py-2 text-sm text-sand-200 mb-2"
                />
                <div className="flex gap-2">
                  <button onClick={handleAddDimension} className="text-xs btn-primary py-1 px-3">Add</button>
                  <button onClick={() => { setShowAddDimension(false); setNewDimensionName(""); setNewDimensionValues(""); }} className="text-xs btn-secondary py-1 px-3">Cancel</button>
                </div>
              </div>
            )}

            {dimensions.length > 0 ? (
              <div className="space-y-3">
                {dimensions.map((dim) => (
                  <div key={dim.id} className="bg-ink-800/50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-sand-200 flex items-center gap-2">
                        {dim.name}
                        <span className="text-xs text-ink-400">({dim.values?.length || 0})</span>
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditingDimension(editingDimension === dim.id ? null : dim.id)}
                          className="text-xs text-ink-400 hover:text-sand-200 p-1"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                        <button onClick={() => handleDeleteDimension(dim.name)} className="text-xs text-red-400 hover:text-red-300 p-1">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    {editingDimension === dim.id ? (
                      <textarea
                        defaultValue={dim.values.join(", ")}
                        rows={3}
                        className="w-full bg-ink-900 border border-ink-600 rounded px-2 py-1 text-xs text-sand-200"
                        onBlur={(e) => {
                          const newValues = e.target.value.split(",").map((v) => v.trim()).filter(Boolean);
                          handleSaveDimension(dim.name, newValues);
                        }}
                      />
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {dim.values?.map((val, j) => (
                          <span key={j} className="text-xs bg-ink-700 text-ink-300 px-2 py-1 rounded">{val}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-ink-400">
                <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No dimensions defined yet.</p>
              </div>
            )}
          </Panel>
        )}
      </div>

      {/* Middle Panel: Batch Generation & List */}
      <div className="col-span-4 space-y-4">
        {selectedAgent ? (
          <>
            {/* Generate Batch */}
            <Panel>
              <PanelHeader icon={<Zap className="w-5 h-5 text-accent-amber" />} title="Generate Synthetic Batch" />
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-ink-400 block mb-1">Number of Queries</label>
                  <input
                    type="number"
                    value={batchSize}
                    onChange={(e) => setBatchSize(Number(e.target.value))}
                    min={1}
                    max={100}
                    className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-2 text-sand-200"
                  />
                </div>
                <div>
                  <label className="text-sm text-ink-400 block mb-1">Generation Strategy</label>
                  <select
                    value={batchStrategy}
                    onChange={(e) => setBatchStrategy(e.target.value as "cross_product" | "llm_guided")}
                    className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-2 text-sand-200"
                  >
                    <option value="cross_product">Cross Product (Template-based)</option>
                    <option value="llm_guided">LLM Guided</option>
                  </select>
                </div>

                {generating && genProgress && (
                  <div className="p-4 bg-ink-800/50 rounded-lg border border-accent-amber/30">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-sand-200">Generating Queries</span>
                      <span className="text-xs text-accent-amber">{genProgress.completed} / {genProgress.total}</span>
                    </div>
                    <div className="w-full bg-ink-700 rounded-full h-2 mb-2">
                      <div
                        className="bg-gradient-to-r from-accent-amber to-accent-gold h-2 rounded-full transition-all"
                        style={{ width: `${genProgress.percent}%` }}
                      />
                    </div>
                    {genProgress.currentQuery && <p className="text-xs text-ink-400 truncate">Latest: &quot;{genProgress.currentQuery}&quot;</p>}
                  </div>
                )}

                <button
                  onClick={generateBatch}
                  disabled={generating || dimensions.length === 0}
                  className="w-full btn-primary py-3 flex items-center justify-center gap-2"
                >
                  {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  <span>{generating ? `Generating ${genProgress?.completed || 0}/${batchSize}...` : `Generate ${batchSize} Queries`}</span>
                </button>

                {dimensions.length === 0 && <p className="text-xs text-amber-400 text-center">⚠️ Define dimensions first</p>}
              </div>
            </Panel>

            {/* Batches List */}
            <Panel>
              <PanelHeader
                icon={<ClipboardList className="w-5 h-5 text-accent-coral" />}
                title="Generated Batches"
                badge={syntheticBatches.length > 0 ? <span className="text-xs text-ink-400">({syntheticBatches.length})</span> : null}
              />
              {syntheticBatches.length > 0 ? (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {syntheticBatches.map((batch) => (
                    <div
                      key={batch.id}
                      className={`p-3 rounded-lg transition-all ${
                        selectedBatch?.id === batch.id
                          ? "bg-accent-amber/20 border border-accent-amber/50"
                          : "bg-ink-800/50 hover:bg-ink-800 border border-transparent"
                      }`}
                    >
                      <button onClick={() => fetchBatchDetail(batch.id)} className="w-full text-left">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sand-200 font-medium">{batch.name}</span>
                          <span className="text-xs text-ink-400">{batch.query_count} queries</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={batch.status} />
                          <span className="text-xs text-ink-500">{formatRelativeTime(batch.created_at)}</span>
                        </div>
                      </button>
                      {selectedBatch?.id === batch.id && (batch.status === "ready" || batch.status === "pending") && (
                        <div className="mt-3 pt-3 border-t border-ink-700 flex items-center justify-between">
                          <span className="text-xs text-ink-500">Ready to run</span>
                          <button onClick={() => setActiveTab("runs")} className="text-xs text-accent-coral hover:underline flex items-center gap-1">
                            <Play className="w-3 h-3" />
                            Go to Runs →
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-ink-400">
                  <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No batches generated yet.</p>
                </div>
              )}

              {executingBatch && (
                <div className="mt-4 p-4 bg-accent-coral/10 rounded-lg border border-accent-coral/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-accent-coral animate-spin" />
                      <span className="text-sm text-sand-200">Batch execution in progress...</span>
                    </div>
                    <button onClick={() => setActiveTab("runs")} className="text-xs text-accent-coral hover:underline">
                      View Progress →
                    </button>
                  </div>
                </div>
              )}
            </Panel>
          </>
        ) : (
          <Panel>
            <SelectPrompt icon={<Cpu className="w-12 h-12" />} title="Select an Agent" description="Choose an agent from the left panel to generate synthetic data." />
          </Panel>
        )}
      </div>

      {/* Right Panel: Query Preview */}
      <div className="col-span-4">
        <Panel>
          <div className="flex items-center justify-between mb-4">
            <PanelHeader icon={<MessageSquare className="w-5 h-5 text-accent-teal" />} title="Query Preview" />
            {selectedBatch && (
              <button
                onClick={() => selectedAgent && deleteBatch(selectedBatch.id, selectedAgent.id)}
                className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                Delete Batch
              </button>
            )}
          </div>

          {selectedBatch && selectedBatch.queries ? (
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {/* Select All */}
              <div className="flex items-center justify-between bg-ink-800/30 rounded-lg p-2 sticky top-0 z-10">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedQueryIds.size === selectedBatch.queries.length && selectedBatch.queries.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedQueryIds(new Set(selectedBatch.queries.map((q) => q.id)));
                      else setSelectedQueryIds(new Set());
                    }}
                    className="w-4 h-4 rounded border-ink-600 bg-ink-800"
                  />
                  <span className="text-sm text-ink-300">Select All</span>
                </label>
                {selectedQueryIds.size > 0 && (
                  <button
                    onClick={handleDeleteSelectedQueries}
                    className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 bg-red-900/20 px-2 py-1 rounded"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete Selected ({selectedQueryIds.size})
                  </button>
                )}
              </div>

              {selectedBatch.queries.map((query, idx) => (
                <div
                  key={query.id}
                  className={`rounded-lg p-4 transition-all ${
                    selectedQueryIds.has(query.id) ? "bg-accent-teal/10 border border-accent-teal/30" : "bg-ink-800/50 border border-transparent"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedQueryIds.has(query.id)}
                      onChange={(e) => {
                        const newSet = new Set(selectedQueryIds);
                        if (e.target.checked) newSet.add(query.id);
                        else newSet.delete(query.id);
                        setSelectedQueryIds(newSet);
                      }}
                      className="w-4 h-4 mt-1 rounded border-ink-600 bg-ink-800"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="text-xs text-ink-500 font-medium">{idx + 1} of {selectedBatch.queries.length}</span>
                        <span className="text-ink-600">•</span>
                        {Object.entries(query.tuple_values || {}).map(([key, val]) => (
                          <Badge key={key} variant="plum" className="text-xs">{val}</Badge>
                        ))}
                      </div>
                      {editingQueryId === query.id ? (
                        <div className="space-y-2">
                          <textarea
                            defaultValue={query.query_text}
                            id={`textarea-${query.id}`}
                            rows={3}
                            autoFocus
                            className="w-full bg-ink-900 border border-ink-600 rounded-lg px-3 py-2 text-sand-200 text-sm"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                const textarea = document.getElementById(`textarea-${query.id}`) as HTMLTextAreaElement;
                                handleUpdateQuery(query.id, textarea?.value || query.query_text);
                              }}
                              className="text-xs btn-primary py-1 px-3"
                            >Save</button>
                            <button onClick={() => setEditingQueryId(null)} className="text-xs btn-secondary py-1 px-3">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="group cursor-pointer" onClick={() => setEditingQueryId(query.id)}>
                          <p className="text-sand-300 leading-relaxed">&quot;{query.query_text}&quot;</p>
                          <span className="text-xs text-ink-500 opacity-0 group-hover:opacity-100">Click to edit</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <SelectPrompt icon={<MessageSquare className="w-8 h-8" />} title="Select a batch to preview its queries" description="" />
          )}
        </Panel>
      </div>
    </div>
  );
}

