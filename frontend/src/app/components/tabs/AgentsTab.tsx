"use client";

import { useState, useRef, useEffect } from "react";
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
  Layers,
  FileText,
  MessageSquare,
  BarChart3,
  TrendingUp,
  Clock,
  Square,
  Settings,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { Panel, SelectPrompt, ConfirmDialog } from "../ui";
import type { Agent, AgentStats } from "../../types";
import * as api from "../../lib/api";

// Helper to determine if the example agent banner should be shown
// Show when: no agents exist OR only example agents exist
// Hide when: user has their own (non-example) agents registered
function shouldShowExampleBanner(agents: Agent[]): boolean {
  if (agents.length === 0) return true;
  const hasUserAgents = agents.some(a => !a.is_example);
  return !hasUserAgents;
}

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
  const [newAgentWeaveProject, setNewAgentWeaveProject] = useState("");
  const [newAgentContext, setNewAgentContext] = useState("");
  const [testingConnection, setTestingConnection] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);

  // Playground state
  const [showPlayground, setShowPlayground] = useState(false);
  const [playgroundMessage, setPlaygroundMessage] = useState("");
  const playgroundInputRef = useRef<HTMLInputElement>(null);
  const [playgroundRunning, setPlaygroundRunning] = useState(false);
  const [playgroundResponse, setPlaygroundResponse] = useState("");
  const [playgroundError, setPlaygroundError] = useState<string | null>(null);

  // Delete confirmation dialog state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingAgent, setDeletingAgent] = useState(false);

  const resetAgentForm = () => {
    setShowAgentForm(false);
    setAgentFormMode("create");
    setNewAgentName("");
    setNewAgentEndpoint("");
    setNewAgentWeaveProject("");
    setNewAgentContext("");
  };

  const handleCreateAgent = async () => {
    if (!newAgentName || !newAgentEndpoint) return;
    setSavingAgent(true);
    try {
      await createAgent(newAgentName, newAgentEndpoint, newAgentContext, newAgentWeaveProject || undefined);
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
      await updateAgent(selectedAgent.id, newAgentName, newAgentEndpoint, newAgentContext, newAgentWeaveProject || undefined);
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
    setDeletingAgent(true);
    try {
      await deleteAgent(selectedAgent.id);
      setDeleteConfirmOpen(false);
    } finally {
      setDeletingAgent(false);
    }
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
                    <span className="font-medium text-sand-100 truncate">{selectedAgent.name}</span>
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
                        <span className="font-medium text-sand-100 truncate">{agent.name}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <ConnectionStatusIcon status={agent.connection_status} />
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

      {/* Example Agent Banner - always shown but compact when user has own agents */}
      {!showAgentForm && (
        <ExampleAgentBanner 
          onGoToSettings={() => setActiveTab("settings")} 
          compact={!shouldShowExampleBanner(agents)}
        />
      )}

      {/* Agent Form Modal */}
      {showAgentForm ? (
        <AgentForm
          mode={agentFormMode}
          name={newAgentName}
          endpoint={newAgentEndpoint}
          weaveProject={newAgentWeaveProject}
          agentContext={newAgentContext}
          saving={savingAgent}
          onNameChange={setNewAgentName}
          onEndpointChange={setNewAgentEndpoint}
          onWeaveProjectChange={setNewAgentWeaveProject}
          onAgentContextChange={setNewAgentContext}
          onSave={agentFormMode === "create" ? handleCreateAgent : handleUpdateAgent}
          onCancel={resetAgentForm}
        />
      ) : selectedAgent ? (
        <>
          {/* Agent Status Snapshot - Collapsible */}
          <AgentStatusSnapshot 
            stats={agentStats} 
            loading={loadingAgentStats}
            onRefresh={() => fetchAgentStats(selectedAgent.id)}
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
              setNewAgentWeaveProject(selectedAgent.weave_project || "");
              setNewAgentContext(selectedAgent.agent_context || "");
              setShowAgentForm(true);
            }}
            onDelete={() => setDeleteConfirmOpen(true)}
            onClose={() => setSelectedAgent(null)}
            onPlaygroundMessageChange={setPlaygroundMessage}
            onRunQuery={runAgentQuery}
          />
        </>
      ) : (
        <Panel>
          {agents.length === 0 ? (
            <EnhancedEmptyState
              onRegister={() => {
                setAgentFormMode("create");
                setShowAgentForm(true);
              }}
              onGoToSettings={() => setActiveTab("settings")}
            />
          ) : (
              <SelectPrompt
                icon={<Cpu className="w-16 h-16" />}
                title="Select an Agent"
                description="Use the dropdown above to select an agent to view its details and statistics."
              />
          )}
        </Panel>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onConfirm={handleDeleteAgent}
        onCancel={() => setDeleteConfirmOpen(false)}
        title="Delete Agent?"
        message={`Are you sure you want to delete "${selectedAgent?.name || "this agent"}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        loading={deletingAgent}
      />
    </div>
  );
}

// Sub-components

// ============================================================================
// Example Agent Banner
// ============================================================================
// Prompts users to start the example agent after configuring their API key.
// This allows new users to try the full workflow without their own agent.

function ExampleAgentBanner({ onGoToSettings, compact = false }: { onGoToSettings: () => void; compact?: boolean }) {
  const [status, setStatus] = useState<'unknown' | 'stopped' | 'running' | 'starting' | 'stopping'>('unknown');
  const [requiresApiKey, setRequiresApiKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkStatus();
    // Poll for status while component is mounted
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const checkStatus = async () => {
    try {
      const data = await api.getExampleAgentStatus();
      setStatus(data.running ? 'running' : 'stopped');
      setRequiresApiKey(data.requires_api_key);
    } catch {
      setStatus('stopped');
    }
  };

  const startAgent = async () => {
    setStatus('starting');
    setError(null);
    try {
      await api.startExampleAgent(9000);
      setStatus('running');
    } catch (err) {
      setStatus('stopped');
      setError(err instanceof Error ? err.message : 'Failed to start agent');
    }
  };

  const stopAgent = async () => {
    setStatus('stopping');
    try {
      await api.stopExampleAgent();
      setStatus('stopped');
    } catch {
      // Refresh status to get actual state
      await checkStatus();
    }
  };

  // Running state - always show when running (compact or not)
  if (status === 'running') {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
              <Bot className="w-5 h-5 text-emerald-400" />
              <div className="flex items-center gap-2">
                <span className="font-medium text-emerald-400">Example Agent Running</span>
                <span className="text-xs text-emerald-500">localhost:9000</span>
            </div>
          </div>
          <button 
            onClick={stopAgent}
            disabled={status === 'stopping'}
            className="btn-ghost text-sm flex items-center gap-1 text-red-400 hover:text-red-300"
          >
            <Square className="w-4 h-4" />
            {status === 'stopping' ? 'Stopping...' : 'Stop'}
          </button>
        </div>
      </div>
    );
  }

  // Compact mode for users with their own agents - single line
  if (compact) {
    if (requiresApiKey) {
      return (
        <div className="bg-ink-800/50 border border-ink-700 rounded-lg p-3 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-ink-400">
              <Bot className="w-4 h-4" />
              <span>Example Agent</span>
              <span className="text-amber-400 text-xs">(needs API key)</span>
            </div>
            <button 
              onClick={onGoToSettings}
              className="btn-ghost text-xs flex items-center gap-1"
            >
              <Settings className="w-3 h-3" />
              Settings
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="bg-ink-800/50 border border-ink-700 rounded-lg p-3 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-ink-400">
            <Bot className="w-4 h-4" />
            <span>Example Agent</span>
            <span className="text-xs">(TaskFlow Support)</span>
          </div>
          <button 
            onClick={startAgent}
            disabled={status === 'starting'}
            className="btn-secondary text-xs flex items-center gap-1"
          >
            {status === 'starting' ? (
              <><RefreshCw className="w-3 h-3 animate-spin" /> Starting...</>
            ) : (
              <><Play className="w-3 h-3" /> Start</>
            )}
          </button>
        </div>
        {error && (
          <div className="mt-2 text-xs text-red-400">{error}</div>
        )}
      </div>
    );
  }

  // Full mode - Needs API key
  if (requiresApiKey) {
    return (
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
            <Bot className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-amber-400 mb-1">Try the Example Agent</h3>
            <p className="text-sm text-ink-400 mb-3">
              We've included a TaskFlow Support Agent so you can experience the full workflow.
              Configure your OpenAI API key first, then start the agent.
            </p>
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="text-sm text-amber-400">OpenAI API key required</span>
              <button 
                onClick={onGoToSettings}
                className="btn-primary text-sm flex items-center gap-1"
              >
                <Settings className="w-4 h-4" />
                Go to Settings
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Full mode - Ready to start
  return (
    <div className="bg-accent-teal/10 border border-accent-teal/20 rounded-lg p-4 mb-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-accent-teal/20 flex items-center justify-center flex-shrink-0">
          <Bot className="w-5 h-5 text-accent-teal" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-sand-100 mb-1">Try the Example Agent</h3>
          <p className="text-sm text-ink-400 mb-3">
            The TaskFlow Support Agent lets you experience the full workflow.
            Start it to test queries, generate synthetic data, and analyze failure modes.
          </p>
          
          {error && (
            <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-400">
              {error}
            </div>
          )}
          
          <button 
            onClick={startAgent}
            disabled={status === 'starting'}
            className="btn-primary flex items-center gap-2"
          >
            {status === 'starting' ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Starting...</>
            ) : (
              <><Play className="w-4 h-4" /> Start Example Agent</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}


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

// Agent Status Snapshot Component - Collapsible stats section
function AgentStatusSnapshot({
  stats,
  loading,
  onRefresh,
}: {
  stats: AgentStats | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  // Default to expanded if agent has data, collapsed if empty
  const hasData = stats && (stats.total_batches > 0 || stats.total_queries > 0);
  const [collapsed, setCollapsed] = useState(!hasData);
  
  if (loading) {
    return (
      <Panel>
        <div className="flex items-center justify-center py-6 text-ink-400">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
          Loading stats...
        </div>
      </Panel>
    );
  }

  // Empty state - show minimal collapsed section
  if (!stats || (stats.total_batches === 0 && stats.total_queries === 0)) {
    return (
      <Panel>
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base flex items-center gap-2 text-ink-400">
            <BarChart3 className="w-4 h-4" />
            Quick Stats
          </h3>
          <span className="text-sm text-ink-500">No data yet</span>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      {/* Collapsible Header */}
      <div className="flex items-center justify-between">
        <button 
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 text-left flex-1"
        >
          <ChevronDown className={`w-4 h-4 text-ink-400 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
          <h3 className="font-display text-base flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-accent-teal" />
            Quick Stats
        </h3>
          {/* Inline summary when collapsed */}
          {collapsed && (
            <span className="text-sm text-ink-400 ml-2">
              {stats.total_batches} batches · {stats.total_queries} queries · {stats.total_failure_modes} failures
            </span>
          )}
        </button>
        <button 
          onClick={(e) => { e.stopPropagation(); onRefresh(); }}
          className="btn-ghost text-sm flex items-center gap-1"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Collapsible Content */}
      {!collapsed && (
        <div className="mt-4 animate-in slide-in-from-top-2 duration-200">
      {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-4 mb-4">
        {/* Batches */}
            <div className="bg-ink-800/50 rounded-lg p-3 border border-ink-700">
              <div className="flex items-center gap-2 text-ink-400 mb-1">
                <Layers className="w-3.5 h-3.5" />
            <span className="text-xs uppercase tracking-wide">Batches</span>
          </div>
              <div className="text-xl font-display text-sand-100">{stats.total_batches}</div>
              <div className="text-xs text-ink-400 mt-0.5">
                {stats.completed_batches} complete
          </div>
        </div>

        {/* Queries */}
            <div className="bg-ink-800/50 rounded-lg p-3 border border-ink-700">
              <div className="flex items-center gap-2 text-ink-400 mb-1">
                <FileText className="w-3.5 h-3.5" />
            <span className="text-xs uppercase tracking-wide">Queries</span>
          </div>
              <div className="text-xl font-display text-sand-100">{stats.total_queries}</div>
              <div className="text-xs text-ink-400 mt-0.5">
            <span className="text-emerald-400">{stats.success_queries} ✓</span>
                {stats.failed_queries > 0 && <span className="text-red-400 ml-1">{stats.failed_queries} ✗</span>}
          </div>
        </div>

        {/* Reviewed */}
            <div className="bg-ink-800/50 rounded-lg p-3 border border-ink-700">
              <div className="flex items-center gap-2 text-ink-400 mb-1">
                <MessageSquare className="w-3.5 h-3.5" />
            <span className="text-xs uppercase tracking-wide">Reviewed</span>
          </div>
              <div className="text-xl font-display text-sand-100">
            {stats.reviewed_traces}
                <span className="text-base text-ink-400">/{stats.total_traces}</span>
          </div>
              <div className="text-xs text-ink-400 mt-0.5">
                {stats.review_progress_percent.toFixed(0)}% done
          </div>
        </div>

        {/* Failure Modes */}
            <div className="bg-ink-800/50 rounded-lg p-3 border border-ink-700">
              <div className="flex items-center gap-2 text-ink-400 mb-1">
                <AlertTriangle className="w-3.5 h-3.5" />
            <span className="text-xs uppercase tracking-wide">Failures</span>
          </div>
              <div className="text-xl font-display text-sand-100">{stats.total_failure_modes}</div>
              <div className="text-xs text-ink-400 mt-0.5">
                {stats.total_categorized_notes} categorized
          </div>
        </div>
      </div>

          {/* Activity Summary */}
          {(stats.latest_batch_name || stats.top_failure_mode) && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm pt-2 border-t border-ink-700/50">
        {stats.latest_batch_name && (
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-ink-400" />
                  <span className="text-ink-400">Latest:</span>
              <span className="text-sand-200">{stats.latest_batch_name}</span>
              {stats.latest_batch_completed_at && (
                    <span className="text-ink-500">({formatTimeAgo(stats.latest_batch_completed_at)})</span>
              )}
          </div>
        )}
        {stats.top_failure_mode && (
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-red-400" />
                  <span className="text-ink-400">Top failure:</span>
              <span className="text-sand-200">{stats.top_failure_mode}</span>
              {stats.top_failure_mode_percent && (
                    <span className="text-red-400">({stats.top_failure_mode_percent}%)</span>
              )}
            </div>
              )}
          </div>
        )}
      </div>
      )}
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
  weaveProject,
  agentContext,
  saving,
  onNameChange,
  onEndpointChange,
  onWeaveProjectChange,
  onAgentContextChange,
  onSave,
  onCancel,
}: {
  mode: "create" | "edit";
  name: string;
  endpoint: string;
  weaveProject: string;
  agentContext: string;
  saving: boolean;
  onNameChange: (v: string) => void;
  onEndpointChange: (v: string) => void;
  onWeaveProjectChange: (v: string) => void;
  onAgentContextChange: (v: string) => void;
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
          <label className="block text-sm text-ink-400 mb-1">Weave Project</label>
          <input
            type="text"
            value={weaveProject}
            onChange={(e) => onWeaveProjectChange(e.target.value)}
            placeholder="e.g., my-chatbot-traces"
            className="w-full"
          />
          <p className="text-xs text-ink-500 mt-1">
            The Weave project where this agent logs traces. Leave empty if not using Weave tracing.
          </p>
        </div>

        <div>
          <label className="block text-sm text-ink-400 mb-1">Agent Context</label>
          <textarea
            value={agentContext}
            onChange={(e) => onAgentContextChange(e.target.value)}
            placeholder="Describe what your agent does, its capabilities, and limitations. This context helps LLMs generate better queries and suggestions."
            rows={8}
            className="w-full text-sm"
          />
          <p className="text-xs text-ink-500 mt-1">
            Free-form description of your agent. This is optional but helps with context-aware generation.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-ink-800">
          <button onClick={onCancel} className="btn-ghost">
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!name || !endpoint || saving}
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
}) {
  const [contextExpanded, setContextExpanded] = useState(false);
  const contextTruncateLength = 200;
  const hasLongContext = agent.agent_context && agent.agent_context.length > contextTruncateLength;
  
  return (
    <Panel>
      {/* Agent Header - Name + Status prominently */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-2xl text-sand-100">{agent.name}</h2>
          <ConnectionStatusBadge status={agent.connection_status} />
        </div>
        <button onClick={onClose} className="btn-ghost text-sm text-ink-400 hover:text-sand-200" title="Close">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Endpoint and Weave - Secondary info */}
      <div className="text-sm text-ink-400 mb-4 space-y-1">
        <div className="flex items-center gap-2">
          <Link className="w-4 h-4 text-ink-500" />
          <code className="text-sand-300">{agent.endpoint_url}</code>
        </div>
          {agent.weave_project && (
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-ink-500" />
            <span>Weave: <span className="text-sand-300">{agent.weave_project}</span></span>
          </div>
          )}
        </div>

      {/* Agent Context - Prominently displayed with expand/collapse */}
      {agent.agent_context && (
        <div className="mb-6 bg-ink-800/30 rounded-lg border border-ink-700/50 p-4">
          <p className="text-sm text-sand-200 whitespace-pre-wrap leading-relaxed">
            {contextExpanded || !hasLongContext
              ? agent.agent_context
              : agent.agent_context.slice(0, contextTruncateLength) + "..."}
          </p>
          {hasLongContext && (
            <button
              onClick={() => setContextExpanded(!contextExpanded)}
              className="text-xs text-accent-teal hover:text-accent-teal/80 mt-2 flex items-center gap-1"
            >
              {contextExpanded ? "Show less" : "Show more"}
              <ChevronDown className={`w-3 h-3 transition-transform ${contextExpanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      )}

      {/* Action Toolbar */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
          <button
            onClick={onTogglePlayground}
          className={`btn-primary text-sm flex items-center gap-2 ${showPlayground ? "bg-accent-teal" : ""}`}
          >
            <Play className="w-4 h-4" />
          {showPlayground ? "Hide Playground" : "Playground"}
          </button>
        <button 
          onClick={onTestConnection} 
          disabled={testingConnection} 
          className="btn-secondary text-sm flex items-center gap-2"
        >
            {testingConnection ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
          Test Connection
          </button>
        <button onClick={onEdit} className="btn-ghost text-sm flex items-center gap-2">
            <Edit3 className="w-4 h-4" />
          Edit
          </button>
        <button onClick={onDelete} className="btn-ghost text-sm text-red-400 hover:text-red-300 flex items-center gap-2">
            <Trash2 className="w-4 h-4" />
          Delete
          </button>
      </div>

      {/* Connection Test Result */}
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

      {/* Playground Panel - Inline when toggled */}
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
    </Panel>
  );
}

// Connection status badge component
function ConnectionStatusBadge({ status }: { status: string }) {
  const config = {
    connected: { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "connected" },
    disconnected: { bg: "bg-ink-700", text: "text-ink-400", label: "disconnected" },
    error: { bg: "bg-red-500/15", text: "text-red-400", label: "error" },
    unknown: { bg: "bg-ink-700", text: "text-ink-400", label: "unknown" },
  }[status] || { bg: "bg-ink-700", text: "text-ink-400", label: status };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs ${config.bg} ${config.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-emerald-400' : status === 'error' ? 'bg-red-400' : 'bg-ink-400'}`} />
      {config.label}
    </span>
  );
}

// Enhanced Empty State - Beautiful first-run experience
function EnhancedEmptyState({ 
  onRegister, 
  onGoToSettings 
}: { 
  onRegister: () => void; 
  onGoToSettings: () => void;
}) {
  const [exampleAgentStatus, setExampleAgentStatus] = useState<'stopped' | 'starting' | 'running'>('stopped');
  const [requiresApiKey, setRequiresApiKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkExampleAgentStatus();
  }, []);

  const checkExampleAgentStatus = async () => {
    try {
      const data = await api.getExampleAgentStatus();
      setExampleAgentStatus(data.running ? 'running' : 'stopped');
      setRequiresApiKey(data.requires_api_key);
    } catch {
      setExampleAgentStatus('stopped');
    }
  };

  const startExampleAgent = async () => {
    setExampleAgentStatus('starting');
    setError(null);
    try {
      await api.startExampleAgent(9000);
      setExampleAgentStatus('running');
    } catch (err) {
      setExampleAgentStatus('stopped');
      setError(err instanceof Error ? err.message : 'Failed to start agent');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 px-8">
      {/* Icon */}
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent-teal/20 to-accent-amber/20 flex items-center justify-center mb-6">
        <Cpu className="w-10 h-10 text-accent-teal" />
        </div>

      {/* Title & Description */}
      <h2 className="font-display text-2xl text-sand-100 mb-3">No Agents Registered</h2>
      <p className="text-ink-400 text-center max-w-md mb-8 leading-relaxed">
        Register your agent to start testing and analysis. 
        Your agent needs a POST endpoint that accepts <code className="text-sand-300 bg-ink-800 px-1.5 py-0.5 rounded text-sm">{`{query, thread_id}`}</code> requests.
      </p>

      {/* Action Buttons */}
      <div className="flex items-center gap-4 flex-wrap justify-center">
        <button onClick={onRegister} className="btn-primary flex items-center gap-2 text-base px-6 py-3">
          <Plus className="w-5 h-5" />
          Register Agent
        </button>

        {requiresApiKey ? (
          <button 
            onClick={onGoToSettings}
            className="btn-secondary flex items-center gap-2 text-base px-6 py-3"
          >
            <Settings className="w-5 h-5" />
            Configure API Key First
          </button>
        ) : (
          <button 
            onClick={startExampleAgent}
            disabled={exampleAgentStatus === 'starting' || exampleAgentStatus === 'running'}
            className="btn-secondary flex items-center gap-2 text-base px-6 py-3"
          >
            {exampleAgentStatus === 'starting' ? (
              <><RefreshCw className="w-5 h-5 animate-spin" /> Starting...</>
            ) : exampleAgentStatus === 'running' ? (
              <><CheckCircle2 className="w-5 h-5 text-emerald-400" /> Example Running</>
            ) : (
              <><Play className="w-5 h-5" /> Start Example Agent</>
            )}
          </button>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 max-w-md text-center">
          {error}
        </div>
      )}

      {/* Hint when example is running */}
      {exampleAgentStatus === 'running' && (
        <p className="mt-4 text-sm text-emerald-400 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Example agent is running at localhost:9000. Refresh to see it in the list.
        </p>
      )}
    </div>
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

