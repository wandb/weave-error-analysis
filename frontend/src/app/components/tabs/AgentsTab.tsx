"use client";

import { useState, useRef } from "react";
import {
  Cpu,
  Plus,
  ChevronDown,
  RefreshCw,
  Wifi,
  WifiOff,
  Circle,
  X,
  Check,
  Edit3,
  Trash2,
  Play,
  Send,
  Bot,
  Link,
  CheckCircle2,
  AlertTriangle,
  Target,
  Zap,
  Layers,
  FileText,
  MessageSquare,
  BarChart3,
  TrendingUp,
  Clock,
  ArrowRight,
  Wrench,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { Panel, Badge, NoAgentsRegistered, SelectPrompt } from "../ui";
import type { AgentStats } from "../../types";
import * as api from "../../lib/api";

export function AgentsTab() {
  const {
    agents,
    selectedAgent,
    setSelectedAgent,
    agentStats,
    loadingAgents,
    loadingAgentStats,
    connectionResult,
    fetchAgents,
    fetchAgentDetail,
    fetchAgentStats,
    testAgentConnection,
    createAgent,
    updateAgent,
    deleteAgent,
    setActiveTab,
  } = useApp();

  // Dropdown state
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Form state
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [agentFormMode, setAgentFormMode] = useState<"create" | "edit">("create");
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentEndpoint, setNewAgentEndpoint] = useState("");
  const [newAgentInfo, setNewAgentInfo] = useState("");
  const [testingConnection, setTestingConnection] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);

  // Playground state
  const [showPlayground, setShowPlayground] = useState(false);
  const [playgroundMessage, setPlaygroundMessage] = useState("");
  const playgroundInputRef = useRef<HTMLInputElement>(null);
  const [playgroundRunning, setPlaygroundRunning] = useState(false);
  const [playgroundResponse, setPlaygroundResponse] = useState("");
  const [playgroundError, setPlaygroundError] = useState<string | null>(null);

  const resetAgentForm = () => {
    setShowAgentForm(false);
    setAgentFormMode("create");
    setNewAgentName("");
    setNewAgentEndpoint("");
    setNewAgentInfo("");
  };

  const getAgentInfoTemplate = async () => {
    try {
      const template = await api.getAgentInfoTemplate(newAgentName || "My Agent");
      setNewAgentInfo(template);
    } catch (error) {
      console.error("Error fetching template:", error);
    }
  };

  const handleCreateAgent = async () => {
    if (!newAgentName || !newAgentEndpoint || !newAgentInfo) return;
    setSavingAgent(true);
    try {
      await createAgent(newAgentName, newAgentEndpoint, newAgentInfo);
      resetAgentForm();
    } catch (error) {
      console.error("Error creating agent:", error);
      alert(error instanceof Error ? error.message : "Failed to create agent");
    } finally {
      setSavingAgent(false);
    }
  };

  const handleUpdateAgent = async () => {
    if (!selectedAgent) return;
    setSavingAgent(true);
    try {
      await updateAgent(selectedAgent.id, newAgentName, newAgentEndpoint, newAgentInfo);
      resetAgentForm();
    } catch (error) {
      console.error("Error updating agent:", error);
      alert(error instanceof Error ? error.message : "Failed to update agent");
    } finally {
      setSavingAgent(false);
    }
  };

  const handleTestConnection = async () => {
    if (!selectedAgent) return;
    setTestingConnection(true);
    try {
      await testAgentConnection(selectedAgent.id);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleDeleteAgent = async () => {
    if (!selectedAgent) return;
    if (!confirm("Are you sure you want to delete this agent?")) return;
    await deleteAgent(selectedAgent.id);
  };

  const resetPlayground = () => {
    setPlaygroundResponse("");
    setPlaygroundError(null);
  };

  const runAgentQuery = async (message: string) => {
    if (!message.trim() || playgroundRunning || !selectedAgent) return;

    setPlaygroundRunning(true);
    resetPlayground();

    try {
      const response = await fetch(`/api/agents/${selectedAgent.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.error) {
        setPlaygroundError(data.error);
      } else {
        setPlaygroundResponse(data.response || "");
      }
    } catch (error) {
      setPlaygroundError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setPlaygroundRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Agent Selector Header */}
      <Panel>
        <div className="flex items-center justify-between gap-4">
          {/* Agent Dropdown */}
          <div className="flex-1 max-w-md relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full flex items-center justify-between gap-3 p-3 rounded-lg border border-ink-700 bg-ink-800/50 hover:border-ink-600 transition-all"
            >
              {loadingAgents ? (
                <span className="text-ink-400">Loading agents...</span>
              ) : selectedAgent ? (
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Cpu className="w-5 h-5 text-accent-teal flex-shrink-0" />
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sand-100 truncate">{selectedAgent.name}</span>
                      <span className="text-xs text-ink-400">v{selectedAgent.version}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <ConnectionStatusIcon status={selectedAgent.connection_status} />
                    </div>
                  </div>
                </div>
              ) : agents.length === 0 ? (
                <span className="text-ink-400">No agents registered</span>
              ) : (
                <span className="text-ink-400">Select an agent...</span>
              )}
              <ChevronDown className={`w-4 h-4 text-ink-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Menu */}
            {dropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-ink-900 border border-ink-700 rounded-lg shadow-xl z-50 max-h-64 overflow-y-auto">
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => {
                      fetchAgentDetail(agent.id);
                      setDropdownOpen(false);
                    }}
                    className={`w-full text-left p-3 hover:bg-ink-800 transition-colors first:rounded-t-lg last:rounded-b-lg ${
                      selectedAgent?.id === agent.id ? 'bg-accent-teal/10' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Cpu className="w-4 h-4 text-accent-teal flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sand-100 truncate">{agent.name}</span>
                          <span className="text-xs text-ink-400">v{agent.version}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <ConnectionStatusIcon status={agent.connection_status} />
                          {agent.testing_dimensions_count > 0 && (
                            <span className="text-xs text-ink-500">{agent.testing_dimensions_count} dimensions</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
                {agents.length === 0 && (
                  <div className="p-4 text-center text-ink-400 text-sm">
                    No agents registered yet
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setAgentFormMode("create");
                setShowAgentForm(true);
              }}
              className="btn-primary text-sm flex items-center gap-1"
            >
              <Plus className="w-4 h-4" />
              Register Agent
            </button>
          </div>
        </div>
      </Panel>

      {/* Click outside to close dropdown */}
      {dropdownOpen && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setDropdownOpen(false)}
        />
      )}

      {/* Agent Form Modal */}
      {showAgentForm ? (
        <AgentForm
          mode={agentFormMode}
          name={newAgentName}
          endpoint={newAgentEndpoint}
          info={newAgentInfo}
          saving={savingAgent}
          onNameChange={setNewAgentName}
          onEndpointChange={setNewAgentEndpoint}
          onInfoChange={setNewAgentInfo}
          onLoadTemplate={getAgentInfoTemplate}
          onSave={agentFormMode === "create" ? handleCreateAgent : handleUpdateAgent}
          onCancel={resetAgentForm}
        />
      ) : selectedAgent ? (
        <>
          {/* Agent Status Snapshot */}
          <AgentStatusSnapshot 
            stats={agentStats} 
            loading={loadingAgentStats}
            onRefresh={() => fetchAgentStats(selectedAgent.id)}
            onNavigate={(tab) => setActiveTab(tab)}
          />

          {/* Agent Details */}
          <AgentDetailView
            agent={selectedAgent}
            connectionResult={connectionResult}
            testingConnection={testingConnection}
            showPlayground={showPlayground}
            playgroundMessage={playgroundMessage}
            playgroundInputRef={playgroundInputRef}
            playgroundRunning={playgroundRunning}
            playgroundResponse={playgroundResponse}
            playgroundError={playgroundError}
            onTogglePlayground={() => {
              setShowPlayground(!showPlayground);
              if (!showPlayground) resetPlayground();
            }}
            onTestConnection={handleTestConnection}
            onEdit={() => {
              setAgentFormMode("edit");
              setNewAgentName(selectedAgent.name);
              setNewAgentEndpoint(selectedAgent.endpoint_url);
              setNewAgentInfo(selectedAgent.agent_info_raw);
              setShowAgentForm(true);
            }}
            onDelete={handleDeleteAgent}
            onClose={() => setSelectedAgent(null)}
            onPlaygroundMessageChange={setPlaygroundMessage}
            onRunQuery={runAgentQuery}
            onGoToSynthetic={() => setActiveTab("synthetic")}
          />
        </>
      ) : (
        <Panel>
          {agents.length === 0 ? (
            <NoAgentsRegistered
              onRegister={() => {
                setAgentFormMode("create");
                setShowAgentForm(true);
              }}
            />
          ) : (
            <>
              <SelectPrompt
                icon={<Cpu className="w-16 h-16" />}
                title="Select an Agent"
                description="Use the dropdown above to select an agent to view its details and statistics."
              />
            </>
          )}
        </Panel>
      )}
    </div>
  );
}

// Sub-components

function ConnectionStatusIcon({ status }: { status: string }) {
  const colorClass =
    status === "connected" ? "text-emerald-400" : status === "error" ? "text-red-400" : "text-ink-400";
  const Icon = status === "connected" ? Wifi : status === "error" ? WifiOff : Circle;

  return (
    <span className={`flex items-center gap-1 ${colorClass}`}>
      <Icon className="w-3 h-3" />
      {status}
    </span>
  );
}

// Agent Status Snapshot Component
function AgentStatusSnapshot({
  stats,
  loading,
  onRefresh,
  onNavigate,
}: {
  stats: AgentStats | null;
  loading: boolean;
  onRefresh: () => void;
  onNavigate: (tab: "synthetic" | "threads" | "taxonomy") => void;
}) {
  if (loading) {
    return (
      <Panel>
        <div className="flex items-center justify-center py-8 text-ink-400">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
          Loading stats...
        </div>
      </Panel>
    );
  }

  if (!stats) {
    return (
      <Panel>
        <div className="text-center py-6 text-ink-400">
          <p>No statistics available yet.</p>
          <p className="text-sm mt-1">Generate some synthetic data to see agent stats.</p>
        </div>
      </Panel>
    );
  }

  const saturationColorClass = 
    stats.saturation_status === "saturated" ? "text-emerald-400" :
    stats.saturation_status === "approaching" ? "text-amber-400" : "text-accent-teal";

  return (
    <Panel>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-accent-teal" />
          Agent Status Snapshot
        </h3>
        <button 
          onClick={onRefresh}
          className="btn-ghost text-sm flex items-center gap-1"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {/* Batches */}
        <div className="bg-ink-800/50 rounded-lg p-4 border border-ink-700">
          <div className="flex items-center gap-2 text-ink-400 mb-2">
            <Layers className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wide">Batches</span>
          </div>
          <div className="text-2xl font-display text-sand-100">{stats.total_batches}</div>
          <div className="text-xs text-ink-400 mt-1">
            {stats.completed_batches} completed · {stats.pending_batches} pending
          </div>
        </div>

        {/* Queries */}
        <div className="bg-ink-800/50 rounded-lg p-4 border border-ink-700">
          <div className="flex items-center gap-2 text-ink-400 mb-2">
            <FileText className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wide">Queries</span>
          </div>
          <div className="text-2xl font-display text-sand-100">{stats.total_queries}</div>
          <div className="text-xs text-ink-400 mt-1">
            <span className="text-emerald-400">{stats.success_queries} ✓</span>
            {stats.failed_queries > 0 && <span className="text-red-400 ml-2">{stats.failed_queries} ✗</span>}
          </div>
        </div>

        {/* Reviewed */}
        <div className="bg-ink-800/50 rounded-lg p-4 border border-ink-700">
          <div className="flex items-center gap-2 text-ink-400 mb-2">
            <MessageSquare className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wide">Reviewed</span>
          </div>
          <div className="text-2xl font-display text-sand-100">
            {stats.reviewed_threads}
            <span className="text-lg text-ink-400">/{stats.total_threads}</span>
          </div>
          <div className="text-xs text-ink-400 mt-1">
            {stats.review_progress_percent.toFixed(0)}% complete
          </div>
        </div>

        {/* Failure Modes */}
        <div className="bg-ink-800/50 rounded-lg p-4 border border-ink-700">
          <div className="flex items-center gap-2 text-ink-400 mb-2">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wide">Failures</span>
          </div>
          <div className="text-2xl font-display text-sand-100">{stats.total_failure_modes}</div>
          <div className="text-xs text-ink-400 mt-1">
            {stats.total_categorized_notes} notes categorized
          </div>
        </div>
      </div>

      {/* Progress Bars */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Review Progress */}
        <div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-ink-400">Review Progress</span>
            <span className="text-sand-200">{stats.review_progress_percent.toFixed(0)}%</span>
          </div>
          <div className="h-2 bg-ink-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-accent-teal rounded-full transition-all"
              style={{ width: `${Math.min(stats.review_progress_percent, 100)}%` }}
            />
          </div>
        </div>

        {/* Saturation */}
        <div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-ink-400">Saturation</span>
            <span className={saturationColorClass}>
              {stats.saturation_score.toFixed(0)}% ({stats.saturation_status})
            </span>
          </div>
          <div className="h-2 bg-ink-800 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all ${
                stats.saturation_status === "saturated" ? "bg-emerald-500" :
                stats.saturation_status === "approaching" ? "bg-amber-500" : "bg-accent-teal"
              }`}
              style={{ width: `${Math.min(stats.saturation_score, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Activity & Top Failure */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Latest Batch */}
        {stats.latest_batch_name && (
          <div className="flex items-start gap-3 text-sm">
            <Clock className="w-4 h-4 text-ink-400 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-ink-400">Latest Batch: </span>
              <span className="text-sand-200">{stats.latest_batch_name}</span>
              {stats.latest_batch_completed_at && (
                <span className="text-ink-500 ml-1">
                  ({formatTimeAgo(stats.latest_batch_completed_at)})
                </span>
              )}
            </div>
          </div>
        )}

        {/* Top Failure Mode */}
        {stats.top_failure_mode && (
          <div className="flex items-start gap-3 text-sm">
            <TrendingUp className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-ink-400">Top Failure: </span>
              <span className="text-sand-200">{stats.top_failure_mode}</span>
              {stats.top_failure_mode_percent && (
                <span className="text-red-400 ml-1">
                  ({stats.top_failure_mode_percent}%)
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="flex items-center gap-3 pt-4 border-t border-ink-700">
        <button 
          onClick={() => onNavigate("synthetic")}
          className="text-sm text-accent-amber hover:text-accent-amber/80 flex items-center gap-1"
        >
          <Zap className="w-4 h-4" />
          View Synthetic Data
          <ArrowRight className="w-3 h-3" />
        </button>
        <span className="text-ink-600">|</span>
        <button 
          onClick={() => onNavigate("threads")}
          className="text-sm text-accent-teal hover:text-accent-teal/80 flex items-center gap-1"
        >
          <MessageSquare className="w-4 h-4" />
          View Threads
          <ArrowRight className="w-3 h-3" />
        </button>
        <span className="text-ink-600">|</span>
        <button 
          onClick={() => onNavigate("taxonomy")}
          className="text-sm text-accent-plum hover:text-accent-plum/80 flex items-center gap-1"
        >
          <BarChart3 className="w-4 h-4" />
          View Taxonomy
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </Panel>
  );
}

// Helper function to format time ago
function formatTimeAgo(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function AgentForm({
  mode,
  name,
  endpoint,
  info,
  saving,
  onNameChange,
  onEndpointChange,
  onInfoChange,
  onLoadTemplate,
  onSave,
  onCancel,
}: {
  mode: "create" | "edit";
  name: string;
  endpoint: string;
  info: string;
  saving: boolean;
  onNameChange: (v: string) => void;
  onEndpointChange: (v: string) => void;
  onInfoChange: (v: string) => void;
  onLoadTemplate: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Panel>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg">{mode === "create" ? "Register New Agent" : "Edit Agent"}</h2>
        <button onClick={onCancel} className="text-ink-400 hover:text-sand-200">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-ink-400 mb-1">Agent Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g., Customer Support Agent"
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm text-ink-400 mb-1">Agent Query Endpoint *</label>
          <input
            type="text"
            value={endpoint}
            onChange={(e) => onEndpointChange(e.target.value)}
            placeholder="e.g., http://localhost:9000/query"
            className="w-full"
          />
          <p className="text-xs text-ink-500 mt-1">Full URL where queries are sent via POST. Must accept {`{query, thread_id}`} and return {`{response, thread_id, error}`}</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm text-ink-400">AGENT_INFO.md Content *</label>
            <button onClick={onLoadTemplate} className="text-xs text-accent-teal hover:text-accent-teal/80">
              Load Template
            </button>
          </div>
          <textarea
            value={info}
            onChange={(e) => onInfoChange(e.target.value)}
            placeholder="Paste your AGENT_INFO.md content here..."
            rows={15}
            className="w-full font-mono text-sm"
          />
          <p className="text-xs text-ink-500 mt-1">
            Document your agent&apos;s purpose, capabilities, tools, and testing dimensions
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-ink-800">
          <button onClick={onCancel} className="btn-ghost">
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!name || !endpoint || !info || saving}
            className="btn-primary flex items-center gap-2"
          >
            {saving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                {mode === "create" ? "Register Agent" : "Save Changes"}
              </>
            )}
          </button>
        </div>
      </div>
    </Panel>
  );
}

function AgentDetailView({
  agent,
  connectionResult,
  testingConnection,
  showPlayground,
  playgroundMessage,
  playgroundInputRef,
  playgroundRunning,
  playgroundResponse,
  playgroundError,
  onTogglePlayground,
  onTestConnection,
  onEdit,
  onDelete,
  onClose,
  onPlaygroundMessageChange,
  onRunQuery,
  onGoToSynthetic,
}: {
  agent: NonNullable<ReturnType<typeof useApp>["selectedAgent"]>;
  connectionResult: ReturnType<typeof useApp>["connectionResult"];
  testingConnection: boolean;
  showPlayground: boolean;
  playgroundMessage: string;
  playgroundInputRef: React.RefObject<HTMLInputElement>;
  playgroundRunning: boolean;
  playgroundResponse: string;
  playgroundError: string | null;
  onTogglePlayground: () => void;
  onTestConnection: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  onPlaygroundMessageChange: (v: string) => void;
  onRunQuery: (message: string) => void;
  onGoToSynthetic: () => void;
}) {
  return (
    <Panel>
      {/* Agent Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="font-display text-xl text-sand-100">{agent.name}</h2>
          <p className="text-sm text-ink-400 mt-1">{agent.purpose}</p>
          <div className="flex items-center gap-4 mt-2 text-xs">
            <span className="text-ink-500">v{agent.version}</span>
            {agent.framework && <Badge variant="plum">{agent.framework}</Badge>}
            {agent.agent_type && <Badge variant="gold">{agent.agent_type}</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onTogglePlayground}
            className={`btn-primary text-sm flex items-center gap-1 ${showPlayground ? "bg-accent-teal" : ""}`}
          >
            <Play className="w-4 h-4" />
            {showPlayground ? "Hide Playground" : "Try Playground"}
          </button>
          <button onClick={onTestConnection} disabled={testingConnection} className="btn-secondary text-sm flex items-center gap-1">
            {testingConnection ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
            Test
          </button>
          <button onClick={onEdit} className="btn-ghost text-sm flex items-center gap-1">
            <Edit3 className="w-4 h-4" />
          </button>
          <button onClick={onDelete} className="btn-ghost text-sm text-red-400 hover:text-red-300">
            <Trash2 className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="btn-ghost text-sm text-ink-400 hover:text-sand-200" title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Connection Status */}
      {connectionResult && (
        <div
          className={`p-4 rounded-lg mb-6 ${
            connectionResult.success ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-red-500/10 border border-red-500/20"
          }`}
        >
          <div className="flex items-center gap-2">
            {connectionResult.success ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-red-400" />
            )}
            <span className={connectionResult.success ? "text-emerald-400" : "text-red-400"}>
              {connectionResult.success ? "Connection successful" : "Connection failed"}
            </span>
          </div>
          {connectionResult.response_time_ms && (
            <p className="text-sm text-ink-400 mt-1">Response time: {connectionResult.response_time_ms}ms</p>
          )}
          {connectionResult.error && <p className="text-sm text-red-400 mt-1">{connectionResult.error}</p>}
        </div>
      )}

      {/* Playground Panel */}
      {showPlayground && (
        <PlaygroundPanel
          message={playgroundMessage}
          inputRef={playgroundInputRef}
          running={playgroundRunning}
          response={playgroundResponse}
          error={playgroundError}
          onMessageChange={onPlaygroundMessageChange}
          onRun={onRunQuery}
        />
      )}

      {/* Endpoint */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-ink-400 mb-2">Endpoint</h3>
        <div className="flex items-center gap-2 bg-ink-800/50 rounded-lg p-3">
          <Link className="w-4 h-4 text-ink-500" />
          <code className="text-sm text-sand-200 flex-1">{agent.endpoint_url}</code>
          <ConnectionStatusIcon status={agent.connection_status} />
        </div>
      </div>

      {/* Capabilities */}
      {agent.capabilities?.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-ink-400 mb-2">Capabilities</h3>
          <ul className="space-y-1">
            {agent.capabilities.map((cap, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-sand-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                {cap}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Limitations */}
      {agent.limitations?.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-ink-400 mb-2">Limitations</h3>
          <ul className="space-y-1">
            {agent.limitations.map((lim, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-sand-300">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                {lim}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tools */}
      {agent.tools?.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-ink-400 mb-2">Tools ({agent.tools.length})</h3>
          <div className="space-y-2">
            {agent.tools.map((tool, i) => (
              <div key={i} className="bg-ink-800/50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Wrench className="w-4 h-4 text-accent-plum" />
                  <span className="font-mono text-sm text-sand-200">{tool.name}</span>
                </div>
                <p className="text-sm text-ink-400">{tool.purpose}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Testing Dimensions */}
      {agent.testing_dimensions?.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-ink-400 mb-2">Testing Dimensions ({agent.testing_dimensions.length})</h3>
          <div className="space-y-3">
            {agent.testing_dimensions.map((dim, i) => (
              <div key={i} className="bg-ink-800/50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-4 h-4 text-accent-teal" />
                  <span className="font-medium text-sand-200">{dim.name}</span>
                  <span className="text-xs text-ink-400">({dim.values?.length || 0} values)</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {dim.values?.map((val, j) => (
                    <Badge key={j} variant="plum" className="text-xs">
                      {val}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Success Criteria */}
      {agent.success_criteria?.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-ink-400 mb-2">Success Criteria</h3>
          <ol className="space-y-1 list-decimal list-inside">
            {agent.success_criteria.map((crit, i) => (
              <li key={i} className="text-sm text-sand-300">
                {crit}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Link to Synthetic Tab */}
      <div className="border-t border-ink-700 pt-4 mt-4">
        <button onClick={onGoToSynthetic} className="flex items-center gap-2 text-sm text-accent-amber hover:text-accent-amber/80">
          <Zap className="w-4 h-4" />
          Go to Synthetic Data Generation →
        </button>
      </div>
    </Panel>
  );
}

function PlaygroundPanel({
  message,
  inputRef,
  running,
  response,
  error,
  onMessageChange,
  onRun,
}: {
  message: string;
  inputRef: React.RefObject<HTMLInputElement>;
  running: boolean;
  response: string;
  error: string | null;
  onMessageChange: (v: string) => void;
  onRun: (message: string) => void;
}) {
  return (
    <div className="mb-6 bg-ink-800/50 rounded-lg border border-ink-700 overflow-hidden">
      <div className="p-4 border-b border-ink-700 bg-ink-900/50">
        <h3 className="text-sm font-medium text-sand-200 flex items-center gap-2">
          <Play className="w-4 h-4 text-accent-teal" />
          Agent Playground
        </h3>
        <p className="text-xs text-ink-400 mt-1">Test your agent with real queries</p>
      </div>

      {/* Input */}
      <div className="p-4 border-b border-ink-700">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onRun(message);
              }
            }}
            placeholder="Type a message to test the agent..."
            className="flex-1"
            disabled={running}
          />
          <button onClick={() => onRun(message)} disabled={!message.trim() || running} className="btn-primary flex items-center gap-2">
            {running ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Send
              </>
            )}
          </button>
        </div>
      </div>

      {/* Response */}
      <div className="p-4">
        <h4 className="text-xs font-medium text-ink-400 mb-2 flex items-center gap-2">
          <Bot className="w-3 h-3" />
          Response
        </h4>
        {error ? (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : response ? (
          <div className="bg-ink-900/50 rounded-lg p-3">
            <p className="text-sm text-sand-200 whitespace-pre-wrap">{response}</p>
          </div>
        ) : running ? (
          <div className="text-sm text-ink-400 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Waiting for response...
          </div>
        ) : (
          <p className="text-sm text-ink-500 italic">Send a message to see the agent&apos;s response</p>
        )}
      </div>
    </div>
  );
}

