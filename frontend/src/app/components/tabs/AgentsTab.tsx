"use client";

import { useState, useRef } from "react";
import {
  Cpu,
  Plus,
  ChevronRight,
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
  Wrench,
  Link,
  CheckCircle2,
  AlertTriangle,
  Target,
  Zap,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { Panel, PanelHeader, Badge, StatusBadge, NoAgentsRegistered, SelectPrompt } from "../ui";
import type { ToolCall, PlaygroundEvent } from "../../types";
import * as api from "../../lib/api";

export function AgentsTab() {
  const {
    agents,
    selectedAgent,
    loadingAgents,
    connectionResult,
    fetchAgents,
    fetchAgentDetail,
    testAgentConnection,
    createAgent,
    updateAgent,
    deleteAgent,
    setActiveTab,
  } = useApp();

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
  const [playgroundToolCalls, setPlaygroundToolCalls] = useState<ToolCall[]>([]);
  const [playgroundError, setPlaygroundError] = useState<string | null>(null);
  const [playgroundEvents, setPlaygroundEvents] = useState<PlaygroundEvent[]>([]);

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
    setPlaygroundToolCalls([]);
    setPlaygroundError(null);
    setPlaygroundEvents([]);
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

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let currentToolCall: { call_id: string; tool_name: string; tool_args: Record<string, unknown> } | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const event = JSON.parse(data);
            setPlaygroundEvents((prev) => [
              ...prev,
              { type: event.type, content: event.content || event.error, timestamp: event.timestamp || new Date().toISOString() },
            ]);

            switch (event.type) {
              case "text_chunk":
                if (event.content) setPlaygroundResponse((prev) => prev + event.content);
                break;
              case "tool_start":
                currentToolCall = { call_id: event.call_id || "", tool_name: event.tool_name || "unknown", tool_args: {} };
                setPlaygroundToolCalls((prev) => [...prev, { ...currentToolCall!, tool_result: null, status: "running" }]);
                break;
              case "tool_args":
                if (event.tool_args && currentToolCall) {
                  currentToolCall.tool_args = event.tool_args;
                  setPlaygroundToolCalls((prev) =>
                    prev.map((tc) => (tc.call_id === currentToolCall?.call_id ? { ...tc, tool_args: event.tool_args } : tc))
                  );
                }
                break;
              case "tool_end":
                if (currentToolCall) {
                  setPlaygroundToolCalls((prev) =>
                    prev.map((tc) => (tc.call_id === currentToolCall?.call_id ? { ...tc, tool_result: event.tool_result, status: "complete" } : tc))
                  );
                  currentToolCall = null;
                }
                break;
              case "error":
                setPlaygroundError(event.error || "Unknown error");
                break;
            }
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (error) {
      setPlaygroundError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setPlaygroundRunning(false);
    }
  };

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* Agent List */}
      <div className="col-span-4 space-y-4">
        <Panel>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg flex items-center gap-2">
              <Cpu className="w-5 h-5 text-accent-teal" />
              Registered Agents
              <Badge variant="teal" className="text-xs">
                {agents.length}
              </Badge>
            </h2>
            <button
              onClick={() => {
                setAgentFormMode("create");
                setShowAgentForm(true);
              }}
              className="btn-primary text-sm flex items-center gap-1"
            >
              <Plus className="w-4 h-4" />
              Add Agent
            </button>
          </div>

          {loadingAgents ? (
            <div className="text-center py-8 text-ink-400">Loading agents...</div>
          ) : agents.length === 0 ? (
            <NoAgentsRegistered
              onRegister={() => {
                setAgentFormMode("create");
                setShowAgentForm(true);
              }}
            />
          ) : (
            <div className="space-y-2">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => fetchAgentDetail(agent.id)}
                  className={`w-full text-left p-4 rounded-lg border transition-all ${
                    selectedAgent?.id === agent.id
                      ? "bg-accent-teal/10 border-accent-teal"
                      : "bg-ink-800/50 border-ink-700 hover:border-ink-600"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sand-100 truncate">{agent.name}</span>
                        <span className="text-xs text-ink-400">v{agent.version}</span>
                      </div>
                      <p className="text-sm text-ink-400 truncate mt-1">{agent.purpose || agent.endpoint_url}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs">
                        <ConnectionStatusIcon status={agent.connection_status} />
                        {agent.testing_dimensions_count > 0 && (
                          <span className="text-ink-400">{agent.testing_dimensions_count} dimensions</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-ink-500 flex-shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Agent Detail / Form */}
      <div className="col-span-8 space-y-4">
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
          <AgentDetailView
            agent={selectedAgent}
            connectionResult={connectionResult}
            testingConnection={testingConnection}
            showPlayground={showPlayground}
            playgroundMessage={playgroundMessage}
            playgroundInputRef={playgroundInputRef}
            playgroundRunning={playgroundRunning}
            playgroundResponse={playgroundResponse}
            playgroundToolCalls={playgroundToolCalls}
            playgroundError={playgroundError}
            playgroundEvents={playgroundEvents}
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
            onPlaygroundMessageChange={setPlaygroundMessage}
            onRunQuery={runAgentQuery}
            onGoToSynthetic={() => setActiveTab("synthetic")}
          />
        ) : (
          <Panel>
            <SelectPrompt
              icon={<Cpu className="w-16 h-16" />}
              title="Select an Agent"
              description="Choose an agent from the list to view details, or register a new one."
            />
            <div className="flex justify-center pb-6">
              <button
                onClick={() => {
                  setAgentFormMode("create");
                  setShowAgentForm(true);
                }}
                className="btn-primary flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>REGISTER NEW AGENT</span>
              </button>
            </div>
          </Panel>
        )}
      </div>
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
          <label className="block text-sm text-ink-400 mb-1">AG-UI Endpoint URL *</label>
          <input
            type="text"
            value={endpoint}
            onChange={(e) => onEndpointChange(e.target.value)}
            placeholder="e.g., http://localhost:8000"
            className="w-full"
          />
          <p className="text-xs text-ink-500 mt-1">The AG-UI compatible endpoint where your agent is hosted</p>
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
  playgroundToolCalls,
  playgroundError,
  playgroundEvents,
  onTogglePlayground,
  onTestConnection,
  onEdit,
  onDelete,
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
  playgroundToolCalls: ToolCall[];
  playgroundError: string | null;
  playgroundEvents: PlaygroundEvent[];
  onTogglePlayground: () => void;
  onTestConnection: () => void;
  onEdit: () => void;
  onDelete: () => void;
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
          toolCalls={playgroundToolCalls}
          error={playgroundError}
          events={playgroundEvents}
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
  toolCalls,
  error,
  events,
  onMessageChange,
  onRun,
}: {
  message: string;
  inputRef: React.RefObject<HTMLInputElement>;
  running: boolean;
  response: string;
  toolCalls: ToolCall[];
  error: string | null;
  events: PlaygroundEvent[];
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
        <p className="text-xs text-ink-400 mt-1">Test your agent with real queries using the AG-UI protocol</p>
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

      {/* Tool Calls */}
      {toolCalls.length > 0 && (
        <div className="p-4 border-b border-ink-700">
          <h4 className="text-xs font-medium text-ink-400 mb-2 flex items-center gap-2">
            <Wrench className="w-3 h-3" />
            Tool Calls ({toolCalls.length})
          </h4>
          <div className="space-y-2">
            {toolCalls.map((tc, i) => (
              <div key={i} className="bg-ink-900/50 rounded-lg p-3 text-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-accent-plum">{tc.tool_name}</span>
                  <span className={`text-xs ${tc.status === "running" ? "text-amber-400" : "text-emerald-400"}`}>
                    {tc.status === "running" ? "⏳ Running..." : "✓ Complete"}
                  </span>
                </div>
                {Object.keys(tc.tool_args).length > 0 && (
                  <div className="mb-2">
                    <span className="text-xs text-ink-500">Arguments:</span>
                    <pre className="text-xs text-ink-300 mt-1 overflow-x-auto">{JSON.stringify(tc.tool_args, null, 2)}</pre>
                  </div>
                )}
                {tc.tool_result !== null && tc.tool_result !== undefined && (
                  <div>
                    <span className="text-xs text-ink-500">Result:</span>
                    <pre className="text-xs text-ink-300 mt-1 overflow-x-auto max-h-32">
                      {typeof tc.tool_result === "string" ? tc.tool_result : JSON.stringify(tc.tool_result, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* Events Log */}
      {events.length > 0 && (
        <div className="p-4 border-t border-ink-700 bg-ink-900/30">
          <details>
            <summary className="text-xs text-ink-400 cursor-pointer hover:text-ink-300">
              Show event log ({events.length} events)
            </summary>
            <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
              {events.map((evt, i) => (
                <div key={i} className="text-xs font-mono">
                  <span className="text-ink-500">{new Date(evt.timestamp).toLocaleTimeString()}</span>{" "}
                  <span
                    className={
                      evt.type === "error"
                        ? "text-red-400"
                        : evt.type === "text_chunk"
                        ? "text-emerald-400"
                        : evt.type.includes("tool")
                        ? "text-accent-plum"
                        : "text-ink-400"
                    }
                  >
                    {evt.type}
                  </span>
                  {evt.content && (
                    <span className="text-ink-300">
                      {" "}
                      - {evt.content.slice(0, 50)}
                      {evt.content.length > 50 ? "..." : ""}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

