"use client";

import { useState } from "react";
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
  Key,
  Thermometer,
  Hash,
  Copy,
  Check,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { formatRelativeTime } from "../../utils/formatters";
import { Panel, Badge, StatusBadge, SelectPrompt, ProgressBar } from "../ui";
import * as api from "../../lib/api";

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
  } = useApp();

  // Generation settings
  const [batchSize, setBatchSize] = useState(20);
  const [batchStrategy, setBatchStrategy] = useState<"cross_product" | "llm_guided">("cross_product");
  const [model, setModel] = useState("gpt-4o-mini");
  const [temperature, setTemperature] = useState(0.7);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  
  // Generation state
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<{ completed: number; total: number; percent: number; currentQuery?: string } | null>(null);

  // Query editing
  const [selectedQueryIds, setSelectedQueryIds] = useState<Set<string>>(new Set());
  const [editingQueryId, setEditingQueryId] = useState<string | null>(null);

  // Dimension editing
  const [editingDimension, setEditingDimension] = useState<string | null>(null);
  const [newDimensionName, setNewDimensionName] = useState("");
  const [newDimensionValues, setNewDimensionValues] = useState("");
  const [showAddDimension, setShowAddDimension] = useState(false);

  // Batches panel
  const [showBatches, setShowBatches] = useState(false);
  const [copiedBatchId, setCopiedBatchId] = useState<string | null>(null);

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

  const generateBatch = async () => {
    if (!selectedAgent) return;
    
    setGenerating(true);
    setGenProgress({ total: batchSize, completed: 0, percent: 0 });

    // Generate unique batch name with ID
    const batchId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const batchName = `Batch ${new Date().toLocaleDateString()} #${batchId}`;

    try {
      const response = await fetch("/api/synthetic/batches/generate-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: selectedAgent.id,
          name: batchName,
          count: batchSize,
          strategy: batchStrategy,
          model,
          temperature,
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
                setSelectedBatch({ id: event.batch_id, name: event.name, queries: [] });
              } else if (event.type === "query_generated") {
                setGenProgress({
                  total: event.total,
                  completed: event.completed,
                  percent: event.progress_percent,
                  currentQuery: event.query.query_text.slice(0, 60) + "...",
                });
                setSelectedBatch((prev) =>
                  prev ? { ...prev, queries: [...(prev.queries || []), event.query] } : null
                );
              } else if (event.type === "batch_complete") {
                await fetchBatches(selectedAgent.id);
                setSelectedBatch({ id: event.batch_id, name: event.name, queries: event.queries });
                setShowBatches(true);
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
  };

  const copyBatchId = (batchId: string) => {
    navigator.clipboard.writeText(batchId);
    setCopiedBatchId(batchId);
    setTimeout(() => setCopiedBatchId(null), 2000);
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
              type="number"
              value={batchSize}
              onChange={(e) => setBatchSize(Math.max(1, Math.min(100, Number(e.target.value))))}
              className="w-16 px-2 py-1.5 rounded text-sm text-center"
              style={{ backgroundColor: '#171A1F', border: '1px solid #333333', color: '#FDFDFD' }}
              min={1}
              max={100}
            />
            <span className="text-xs" style={{ color: '#8F949E' }}>queries</span>
          </div>

          <select
            value={batchStrategy}
            onChange={(e) => setBatchStrategy(e.target.value as "cross_product" | "llm_guided")}
            className="px-3 py-1.5 rounded text-sm"
            style={{ backgroundColor: '#171A1F', border: '1px solid #333333', color: '#FDFDFD' }}
          >
            <option value="cross_product">Cross Product</option>
            <option value="llm_guided">LLM Guided</option>
          </select>
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

        {/* Spacer */}
        <div className="flex-1" />

        {/* Generate Button */}
        <button
          onClick={generateBatch}
          disabled={generating || dimensions.length === 0}
          className="flex items-center gap-2 px-6 py-2.5 rounded-md font-medium transition-all disabled:opacity-50"
          style={{ 
            backgroundColor: generating ? '#333333' : '#FCBC32', 
            color: generating ? '#8F949E' : '#171A1F' 
          }}
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
      </div>

      {/* Advanced Settings Panel */}
      {showAdvancedSettings && (
        <div 
          className="rounded-lg p-4 grid grid-cols-3 gap-4"
          style={{ backgroundColor: '#1C1E24', border: '1px solid #333333' }}
        >
          <div>
            <label className="text-xs mb-1 block" style={{ color: '#8F949E' }}>Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 rounded text-sm"
              style={{ backgroundColor: '#171A1F', border: '1px solid #333333', color: '#FDFDFD' }}
            >
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
      )}

      {/* Generation Progress */}
      {generating && genProgress && (
        <div 
          className="rounded-lg p-4"
          style={{ backgroundColor: 'rgba(252, 188, 50, 0.1)', border: '1px solid rgba(252, 188, 50, 0.3)' }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium" style={{ color: '#FDFDFD' }}>Generating queries...</span>
            <span className="text-sm" style={{ color: '#FCBC32' }}>{genProgress.completed} / {genProgress.total}</span>
          </div>
          <div className="w-full rounded-full h-2 mb-2" style={{ backgroundColor: '#333333' }}>
            <div
              className="h-2 rounded-full transition-all duration-300"
              style={{ width: `${genProgress.percent}%`, backgroundColor: '#FCBC32' }}
            />
          </div>
          {genProgress.currentQuery && (
            <p className="text-xs truncate" style={{ color: '#8F949E' }}>
              Latest: "{genProgress.currentQuery}"
            </p>
          )}
        </div>
      )}

      {/* ========== MAIN CONTENT: Two Columns ========== */}
      <div className="grid grid-cols-2 gap-4">
        {/* LEFT: Testing Dimensions */}
        <div 
          className="rounded-lg p-4"
          style={{ backgroundColor: '#1C1E24', border: '1px solid #333333' }}
        >
            <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg flex items-center gap-2" style={{ color: '#FDFDFD' }}>
              <Target className="w-5 h-5" style={{ color: '#FCBC32' }} />
              Testing dimensions
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => importDimensions(selectedAgent.id)}
                  disabled={loadingDimensions}
                className="text-xs px-3 py-1.5 rounded transition-colors"
                style={{ backgroundColor: '#252830', color: '#8F949E', border: '1px solid #333333' }}
                >
                  {loadingDimensions ? "..." : "Import from AGENT_INFO"}
                </button>
              <button 
                onClick={() => setShowAddDimension(true)} 
                className="p-1.5 rounded transition-colors"
                style={{ backgroundColor: '#FCBC32', color: '#171A1F' }}
              >
                <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

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
          <div className="space-y-3 max-h-[calc(100vh-450px)] overflow-y-auto">
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
              <div className="text-center py-12" style={{ color: '#8F949E' }}>
                <Target className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm mb-2">No dimensions defined yet</p>
                <p className="text-xs">Click "Import from AGENT_INFO" or add manually</p>
              </div>
        )}
      </div>

          {dimensions.length === 0 && (
            <p className="text-xs text-center mt-4" style={{ color: '#FCBC32' }}>
              ⚠️ Define at least one dimension to generate queries
            </p>
        )}
      </div>

        {/* RIGHT: Query Preview */}
        <div 
          className="rounded-lg p-4"
          style={{ backgroundColor: '#1C1E24', border: '1px solid #333333' }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg flex items-center gap-2" style={{ color: '#FDFDFD' }}>
              <MessageSquare className="w-5 h-5" style={{ color: '#10BFCC' }} />
              Query preview
            {selectedBatch && (
                <span className="text-xs px-2 py-0.5 rounded ml-2" style={{ backgroundColor: '#333333', color: '#8F949E' }}>
                  {selectedBatch.queries?.length || 0} queries
                </span>
              )}
            </h2>
            {selectedBatch && selectedQueryIds.size > 0 && (
              <button
                onClick={handleDeleteSelectedQueries}
                className="text-xs px-3 py-1.5 rounded flex items-center gap-1 text-red-400"
                style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
              >
                <Trash2 className="w-3 h-3" />
                Delete {selectedQueryIds.size} selected
              </button>
            )}
          </div>

          {selectedBatch && selectedBatch.queries && selectedBatch.queries.length > 0 ? (
            <div className="space-y-2 max-h-[calc(100vh-450px)] overflow-y-auto">
              {/* Select All */}
              <label 
                className="flex items-center gap-2 p-2 rounded cursor-pointer sticky top-0 z-10"
                style={{ backgroundColor: '#252830' }}
              >
                  <input
                    type="checkbox"
                  checked={selectedQueryIds.size === selectedBatch.queries.length}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedQueryIds(new Set(selectedBatch.queries.map((q) => q.id)));
                      else setSelectedQueryIds(new Set());
                    }}
                  className="w-4 h-4 rounded"
                  style={{ accentColor: '#FCBC32' }}
                  />
                <span className="text-sm" style={{ color: '#8F949E' }}>Select all</span>
                </label>

              {/* Query Cards */}
              {selectedBatch.queries.map((query, idx) => (
                <div
                  key={query.id}
                  className="rounded-lg p-3 transition-all"
                  style={{ 
                    backgroundColor: selectedQueryIds.has(query.id) ? 'rgba(16, 191, 204, 0.1)' : '#252830',
                    border: selectedQueryIds.has(query.id) ? '1px solid rgba(16, 191, 204, 0.3)' : '1px solid transparent'
                  }}
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
                      className="w-4 h-4 mt-1 rounded"
                      style={{ accentColor: '#FCBC32' }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="text-xs" style={{ color: '#8F949E' }}>{idx + 1}</span>
                        {Object.entries(query.tuple_values || {}).map(([key, val]) => (
                          <span 
                            key={key} 
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: 'rgba(16, 191, 204, 0.15)', color: '#10BFCC' }}
                          >
                            {val}
                          </span>
                        ))}
                      </div>
                      {editingQueryId === query.id ? (
                        <div className="space-y-2">
                          <textarea
                            defaultValue={query.query_text}
                            id={`textarea-${query.id}`}
                            rows={3}
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
                          className="cursor-pointer group"
                          onClick={() => setEditingQueryId(query.id)}
                        >
                          <p className="text-sm leading-relaxed" style={{ color: '#FDFDFD' }}>
                            "{query.query_text}"
                          </p>
                          <span 
                            className="text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ color: '#8F949E' }}
                          >
                            Click to edit
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16" style={{ color: '#8F949E' }}>
              <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm mb-2">No queries yet</p>
              <p className="text-xs">Generate a batch to see queries here</p>
            </div>
          )}
        </div>
      </div>

      {/* ========== BATCHES PANEL (Collapsible) ========== */}
      <div 
        className="rounded-lg overflow-hidden"
        style={{ backgroundColor: '#1C1E24', border: '1px solid #333333' }}
      >
        <button
          onClick={() => setShowBatches(!showBatches)}
          className="w-full flex items-center justify-between p-4 transition-colors hover:bg-opacity-80"
          style={{ backgroundColor: '#252830' }}
        >
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5" style={{ color: '#FCBC32' }} />
            <span className="font-medium" style={{ color: '#FDFDFD' }}>Generated batches</span>
            <span 
              className="text-xs px-2 py-0.5 rounded"
              style={{ backgroundColor: '#333333', color: '#8F949E' }}
            >
              {syntheticBatches.length}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {executingBatch && (
              <span className="text-xs flex items-center gap-1" style={{ color: '#10BFCC' }}>
                <RefreshCw className="w-3 h-3 animate-spin" />
                Running...
              </span>
            )}
            {showBatches ? <ChevronUp className="w-4 h-4" style={{ color: '#8F949E' }} /> : <ChevronDown className="w-4 h-4" style={{ color: '#8F949E' }} />}
          </div>
        </button>

        {showBatches && (
          <div className="p-4 border-t" style={{ borderColor: '#333333' }}>
            {syntheticBatches.length > 0 ? (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {syntheticBatches.map((batch) => (
                  <div
                    key={batch.id}
                    className={`rounded-lg p-3 transition-all cursor-pointer ${
                      selectedBatch?.id === batch.id ? 'ring-2' : ''
                    }`}
                    style={{ 
                      backgroundColor: selectedBatch?.id === batch.id ? 'rgba(252, 188, 50, 0.1)' : '#252830',
                      border: '1px solid #333333',
                      ringColor: '#FCBC32'
                    }}
                    onClick={() => fetchBatchDetail(batch.id)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate" style={{ color: '#FDFDFD' }}>{batch.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); copyBatchId(batch.id); }}
                            className="text-xs flex items-center gap-1 hover:opacity-80"
                            style={{ color: '#8F949E' }}
                            title="Copy batch ID"
                          >
                            {copiedBatchId === batch.id ? (
                              <><Check className="w-3 h-3" style={{ color: '#10BFCC' }} /> Copied</>
                            ) : (
                              <><Copy className="w-3 h-3" /> {batch.id.slice(0, 8)}...</>
                            )}
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteBatch(batch.id); }}
                        className="p-1 rounded text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={batch.status} />
                        <span className="text-xs" style={{ color: '#8F949E' }}>{batch.query_count} queries</span>
                      </div>
                      <span className="text-xs" style={{ color: '#8F949E' }}>{formatRelativeTime(batch.created_at)}</span>
                    </div>
                    {(batch.status === "ready" || batch.status === "pending" || batch.status === "completed") && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setActiveTab("runs"); }}
                        className="w-full mt-3 text-xs py-1.5 rounded flex items-center justify-center gap-1 transition-colors"
                        style={{ backgroundColor: '#333333', color: '#FCBC32' }}
                      >
                        <Play className="w-3 h-3" />
                        Go to Runs
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-sm py-4" style={{ color: '#8F949E' }}>
                No batches generated yet
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
