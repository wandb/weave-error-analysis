"use client";

import { useState, useEffect, useCallback } from "react";
import { 
  Search, 
  MessageSquare, 
  ThumbsUp, 
  ThumbsDown,
  ChevronRight,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  ExternalLink,
  User,
  Bot,
  Wrench,
  Layers,
  MessageCircle,
  Hash,
  ClipboardList,
  BarChart3,
  Plus,
  Trash2,
  ArrowRight,
  GitMerge,
  TrendingUp,
  CheckCircle2,
  Circle,
  Zap,
  Target,
  ChevronDown,
  ChevronUp,
  Edit3,
  X,
  Copy,
  Check
} from "lucide-react";
import { format, parseISO, formatDistanceToNow } from "date-fns";

// ============================================================================
// Types
// ============================================================================

interface Thread {
  thread_id: string;
  turn_count: number;
  start_time: string | null;
  last_updated: string | null;
}

interface ConversationMessage {
  type: "user" | "assistant" | "tool_call" | "system";
  content?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  call_id: string;
  timestamp: string;
}

interface ThreadDetail {
  thread_id: string;
  calls: Array<{
    id: string;
    op_name: string;
    started_at: string;
    ended_at: string;
    inputs: Record<string, unknown>;
    output: unknown;
  }>;
  conversation: ConversationMessage[];
  feedback: Record<string, Array<{ type: string; payload: unknown }>>;
  total_calls: number;
}

interface FeedbackSummary {
  thumbs_up: number;
  thumbs_down: number;
  notes: Array<{ 
    note: string; 
    call_id: string; 
    weave_ref: string;
    weave_url: string;
    created_at: string;
  }>;
  total_notes: number;
}

interface FailureMode {
  id: string;
  name: string;
  description: string;
  severity: string;
  suggested_fix: string | null;
  created_at: string;
  last_seen_at: string;
  times_seen: number;
  note_ids: string[];
}

interface TaxonomyNote {
  id: string;
  content: string;
  trace_id: string;
  weave_ref: string;
  weave_url: string;
  failure_mode_id: string | null;
  assignment_method: string | null;
  created_at: string;
  assigned_at: string | null;
}

interface SaturationStats {
  status: string;
  message: string;
  saturation_score: number;
  total_failure_modes: number;
  total_notes: number;
  window_new_modes: number;
  window_matched: number;
  recent_events: Array<{
    timestamp: string;
    notes: number;
    new_modes: number;
    matched: number;
  }>;
}

interface Taxonomy {
  failure_modes: FailureMode[];
  uncategorized_notes: TaxonomyNote[];
  saturation: SaturationStats;
  stats: {
    total_failure_modes: number;
    total_uncategorized: number;
    total_categorized: number;
  };
}

interface AISuggestion {
  match_type: "existing" | "new";
  existing_mode_id: string | null;
  confidence: number;
  reasoning: string;
  new_category?: {
    name: string;
    description: string;
    severity: string;
    suggested_fix: string;
  };
}

type TabType = "sessions" | "taxonomy";

// ============================================================================
// Main Component
// ============================================================================

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>("sessions");
  
  // Sessions state
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<ThreadDetail | null>(null);
  const [feedbackSummary, setFeedbackSummary] = useState<FeedbackSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Taxonomy state
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [loadingTaxonomy, setLoadingTaxonomy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [selectedNote, setSelectedNote] = useState<TaxonomyNote | null>(null);
  const [noteSuggestion, setNoteSuggestion] = useState<AISuggestion | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  
  // UI state
  const [expandedModes, setExpandedModes] = useState<Set<string>>(new Set());
  const [editingMode, setEditingMode] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newModeName, setNewModeName] = useState("");
  const [newModeDescription, setNewModeDescription] = useState("");
  const [newModeSeverity, setNewModeSeverity] = useState("medium");
  const [copiedTaxonomy, setCopiedTaxonomy] = useState(false);
  const [copiedModeId, setCopiedModeId] = useState<string | null>(null);

  // ============================================================================
  // Copy Functions
  // ============================================================================

  const formatTaxonomyForCopy = () => {
    if (!taxonomy?.failure_modes.length) return "";
    
    const formatted = taxonomy.failure_modes.map((mode, idx) => {
      const notes = taxonomy.notes?.filter(n => mode.note_ids.includes(n.id)) || [];
      const notesList = notes.map(n => `    - "${n.content}"`).join("\n");
      
      return `## ${idx + 1}. ${mode.name} [${mode.severity.toUpperCase()}]

**Description:** ${mode.description}

**Suggested Fix:** ${mode.suggested_fix || "N/A"}

**Occurrences:** ${mode.times_seen} times (Last seen: ${mode.last_seen_at ? formatRelativeTime(mode.last_seen_at) : "N/A"})

**Example Notes:**
${notesList || "    No notes"}
`;
    }).join("\n---\n\n");

    return `# Failure Mode Taxonomy

**Total Failure Modes:** ${taxonomy.failure_modes.length}
**Saturation Score:** ${Math.round((taxonomy.saturation?.saturation_score || 0) * 100)}%
**Status:** ${taxonomy.saturation?.status || "Unknown"}

---

${formatted}

---
*Generated from Error Analysis Tool*`;
  };

  const formatSingleModeForCopy = (mode: FailureMode) => {
    const notes = taxonomy?.notes?.filter(n => mode.note_ids.includes(n.id)) || [];
    const notesList = notes.map(n => `- "${n.content}"`).join("\n");
    
    return `## ${mode.name} [${mode.severity.toUpperCase()}]

**Description:** ${mode.description}

**Suggested Fix:** ${mode.suggested_fix || "N/A"}

**Occurrences:** ${mode.times_seen} times

**Example Notes:**
${notesList || "No notes"}`;
  };

  const copyTaxonomyToClipboard = async () => {
    const text = formatTaxonomyForCopy();
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTaxonomy(true);
      setTimeout(() => setCopiedTaxonomy(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const copySingleModeToClipboard = async (mode: FailureMode) => {
    const text = formatSingleModeForCopy(mode);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedModeId(mode.id);
      setTimeout(() => setCopiedModeId(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // ============================================================================
  // Data Fetching
  // ============================================================================

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/threads?limit=100`);
      const data = await response.json();
      setThreads(data.threads || []);
    } catch (error) {
      console.error("Error fetching threads:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFeedbackSummary = useCallback(async () => {
    try {
      const response = await fetch(`/api/feedback-summary`);
      const data = await response.json();
      setFeedbackSummary(data);
    } catch (error) {
      console.error("Error fetching feedback summary:", error);
    }
  }, []);

  const fetchThreadDetail = async (threadId: string) => {
    setLoadingDetail(true);
    try {
      const response = await fetch(`/api/threads/${threadId}`);
      const data = await response.json();
      setSelectedThread(data);
    } catch (error) {
      console.error("Error fetching thread detail:", error);
    } finally {
      setLoadingDetail(false);
    }
  };

  const fetchTaxonomy = useCallback(async () => {
    setLoadingTaxonomy(true);
    try {
      const response = await fetch("/api/taxonomy");
      const data = await response.json();
      setTaxonomy(data);
    } catch (error) {
      console.error("Error fetching taxonomy:", error);
    } finally {
      setLoadingTaxonomy(false);
    }
  }, []);

  // ============================================================================
  // Taxonomy Actions
  // ============================================================================

  const syncNotesFromWeave = async () => {
    setSyncing(true);
    try {
      const response = await fetch("/api/taxonomy/notes/sync", { method: "POST" });
      const data = await response.json();
      console.log("Sync result:", data);
      await fetchTaxonomy();
    } catch (error) {
      console.error("Error syncing notes:", error);
    } finally {
      setSyncing(false);
    }
  };

  const autoCategorize = async () => {
    setCategorizing(true);
    try {
      const response = await fetch("/api/taxonomy/auto-categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await response.json();
      console.log("Categorization result:", data);
      await fetchTaxonomy();
    } catch (error) {
      console.error("Error categorizing:", error);
    } finally {
      setCategorizing(false);
    }
  };

  const suggestCategoryForNote = async (noteId: string) => {
    setLoadingSuggestion(true);
    try {
      const response = await fetch(`/api/taxonomy/notes/${noteId}/suggest`, {
        method: "POST"
      });
      const data = await response.json();
      setNoteSuggestion(data);
    } catch (error) {
      console.error("Error getting suggestion:", error);
    } finally {
      setLoadingSuggestion(false);
    }
  };

  const assignNoteToMode = async (noteId: string, modeId: string, method: string = "manual") => {
    try {
      await fetch("/api/taxonomy/notes/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note_id: noteId, failure_mode_id: modeId, method })
      });
      setSelectedNote(null);
      setNoteSuggestion(null);
      await fetchTaxonomy();
    } catch (error) {
      console.error("Error assigning note:", error);
    }
  };

  const createFailureMode = async () => {
    if (!newModeName.trim()) return;
    try {
      const response = await fetch("/api/taxonomy/failure-modes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newModeName,
          description: newModeDescription,
          severity: newModeSeverity
        })
      });
      const data = await response.json();
      setShowCreateModal(false);
      setNewModeName("");
      setNewModeDescription("");
      setNewModeSeverity("medium");
      await fetchTaxonomy();
      
      // If we had a selected note, assign it to the new mode
      if (selectedNote) {
        await assignNoteToMode(selectedNote.id, data.id, "manual");
      }
    } catch (error) {
      console.error("Error creating failure mode:", error);
    }
  };

  const deleteFailureMode = async (modeId: string) => {
    if (!confirm("Delete this failure mode? Notes will be moved to uncategorized.")) return;
    try {
      await fetch(`/api/taxonomy/failure-modes/${modeId}`, { method: "DELETE" });
      await fetchTaxonomy();
    } catch (error) {
      console.error("Error deleting failure mode:", error);
    }
  };

  const applySuggestion = async () => {
    if (!selectedNote || !noteSuggestion) return;
    
    if (noteSuggestion.match_type === "existing" && noteSuggestion.existing_mode_id) {
      await assignNoteToMode(selectedNote.id, noteSuggestion.existing_mode_id, "ai_suggested");
    } else if (noteSuggestion.match_type === "new" && noteSuggestion.new_category) {
      // Create the new mode first
      const response = await fetch("/api/taxonomy/failure-modes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: noteSuggestion.new_category.name,
          description: noteSuggestion.new_category.description,
          severity: noteSuggestion.new_category.severity,
          suggested_fix: noteSuggestion.new_category.suggested_fix
        })
      });
      const newMode = await response.json();
      await assignNoteToMode(selectedNote.id, newMode.id, "ai_suggested");
    }
  };

  // ============================================================================
  // Effects
  // ============================================================================

  useEffect(() => {
    fetchThreads();
    fetchFeedbackSummary();
  }, [fetchThreads, fetchFeedbackSummary]);

  useEffect(() => {
    if (activeTab === "taxonomy") {
      fetchTaxonomy();
    }
  }, [activeTab, fetchTaxonomy]);

  // ============================================================================
  // Helpers
  // ============================================================================

  const formatTime = (isoString: string | null) => {
    if (!isoString) return "—";
    try {
      return format(parseISO(isoString), "MMM d, HH:mm");
    } catch {
      return isoString;
    }
  };

  const formatRelativeTime = (isoString: string | null) => {
    if (!isoString) return "—";
    try {
      return formatDistanceToNow(parseISO(isoString), { addSuffix: true });
    } catch {
      return isoString;
    }
  };

  const filteredThreads = threads.filter(thread => {
    if (!searchQuery) return true;
    return thread.thread_id.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const toggleModeExpanded = (modeId: string) => {
    const newExpanded = new Set(expandedModes);
    if (newExpanded.has(modeId)) {
      newExpanded.delete(modeId);
    } else {
      newExpanded.add(modeId);
    }
    setExpandedModes(newExpanded);
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "high": return "bg-red-500/20 text-red-400 border-red-500/30";
      case "medium": return "bg-amber-500/20 text-amber-400 border-amber-500/30";
      case "low": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
      default: return "bg-ink-700 text-ink-300";
    }
  };

  const getSeverityBorder = (severity: string) => {
    switch (severity) {
      case "high": return "border-l-red-500";
      case "medium": return "border-l-amber-500";
      case "low": return "border-l-emerald-500";
      default: return "border-l-ink-600";
    }
  };

  // ============================================================================
  // Render Helpers
  // ============================================================================

  const renderConversationMessage = (msg: ConversationMessage, index: number) => {
    if (msg.type === "user") {
      return (
        <div key={`${msg.call_id}-${index}`} className="flex gap-3 animate-fade-in">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent-coral/20 flex items-center justify-center">
            <User className="w-4 h-4 text-accent-coral" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-accent-coral">User</span>
              <span className="text-xs text-ink-500">{formatTime(msg.timestamp)}</span>
            </div>
            <div className="bg-ink-900 rounded-lg rounded-tl-none p-3 border border-ink-800">
              <p className="text-sm text-sand-200 whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        </div>
      );
    }

    if (msg.type === "assistant") {
      return (
        <div key={`${msg.call_id}-${index}`} className="flex gap-3 animate-fade-in">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent-teal/20 flex items-center justify-center">
            <Bot className="w-4 h-4 text-accent-teal" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-accent-teal">Assistant</span>
              <span className="text-xs text-ink-500">{formatTime(msg.timestamp)}</span>
            </div>
            <div className="bg-ink-950 rounded-lg rounded-tl-none p-3 border border-ink-800">
              <p className="text-sm text-sand-300 whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        </div>
      );
    }

    if (msg.type === "tool_call") {
      return (
        <div key={`${msg.call_id}-${index}`} className="flex gap-3 animate-fade-in">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent-gold/20 flex items-center justify-center">
            <Wrench className="w-4 h-4 text-accent-gold" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-accent-gold">Tool: {msg.tool_name}</span>
              <span className="text-xs text-ink-500">{formatTime(msg.timestamp)}</span>
            </div>
            <div className="bg-ink-950 rounded-lg rounded-tl-none p-3 border border-accent-gold/30 space-y-2">
              {msg.tool_input && (
                <div>
                  <span className="text-xs text-ink-500">Input:</span>
                  <pre className="text-xs text-sand-400 mt-1 overflow-x-auto">
                    {JSON.stringify(msg.tool_input, null, 2)}
                  </pre>
                </div>
              )}
              {msg.tool_output && (
                <div className="border-t border-ink-800 pt-2 mt-2">
                  <span className="text-xs text-ink-500">Output:</span>
                  <pre className="text-xs text-accent-teal mt-1 overflow-x-auto max-h-32">
                    {typeof msg.tool_output === 'string' 
                      ? msg.tool_output.slice(0, 500) + (msg.tool_output.length > 500 ? '...' : '')
                      : JSON.stringify(msg.tool_output, null, 2).slice(0, 500)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  // ============================================================================
  // Sessions Tab
  // ============================================================================

  const SessionsTab = () => (
    <div className="grid grid-cols-12 gap-6">
      {/* Left Panel - Thread List */}
      <div className="col-span-4 space-y-4 min-w-0">
        <div className="bg-ink-900/50 rounded-xl border border-ink-800 p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-semibold text-sand-100 flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-accent-coral" />
              Sessions
            </h2>
            <span className="badge badge-coral">{threads.length}</span>
          </div>
          
          {/* Search */}
          <div className="mb-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
              <input
                type="text"
                placeholder="Search sessions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 text-sm"
              />
            </div>
          </div>

          {/* Thread List */}
          <div className="space-y-2 max-h-[calc(100vh-320px)] overflow-y-auto">
            {loading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-20 shimmer rounded-lg" />
                ))}
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="text-center py-8 text-ink-500">
                <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
                <p>No sessions found</p>
                <p className="text-sm">Generate some traces first</p>
              </div>
            ) : (
              filteredThreads.map((thread) => (
                <button
                  key={thread.thread_id}
                  onClick={() => fetchThreadDetail(thread.thread_id)}
                  className={`w-full text-left trace-card rounded-lg p-3 ${
                    selectedThread?.thread_id === thread.thread_id ? "ring-2 ring-accent-coral" : ""
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Hash className="w-3 h-3 text-ink-500" />
                        <p className="font-mono text-sm text-sand-200 truncate">
                          {thread.thread_id}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="badge badge-teal text-xs">
                          {thread.turn_count} turn{thread.turn_count !== 1 ? 's' : ''}
                        </span>
                        <span className="text-xs text-ink-500">
                          {formatRelativeTime(thread.last_updated)}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-ink-600 flex-shrink-0" />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Right Panel - Conversation View */}
      <div className="col-span-8 space-y-4">
        <div className="bg-ink-900/50 rounded-xl border border-ink-800 p-4">
          <h2 className="font-display text-lg font-semibold text-sand-100 flex items-center gap-2 mb-4">
            <MessageSquare className="w-5 h-5 text-accent-teal" />
            Conversation
          </h2>

          {loadingDetail ? (
            <div className="space-y-4">
              <div className="h-8 shimmer rounded w-1/3" />
              <div className="h-24 shimmer rounded" />
              <div className="h-24 shimmer rounded" />
            </div>
          ) : selectedThread ? (
            <div className="space-y-4 animate-fade-in">
              {/* Thread Info */}
              <div className="flex items-center justify-between bg-ink-950 rounded-lg p-3 border border-ink-800">
                <div>
                  <p className="font-mono text-accent-coral text-sm">
                    {selectedThread.thread_id}
                  </p>
                  <p className="text-xs text-ink-500 mt-1">
                    {selectedThread.total_calls} calls · {selectedThread.conversation.length} messages
                  </p>
                </div>
                <a
                  href={`https://wandb.ai/ayut/error-analysis-demo/weave/threads/${selectedThread.thread_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-ghost flex items-center gap-1 text-xs"
                >
                  <ExternalLink className="w-3 h-3" />
                  View in Weave
                </a>
              </div>

              {/* Conversation Messages */}
              <div className="space-y-4 max-h-[calc(100vh-380px)] overflow-y-auto pr-2">
                {selectedThread.conversation.length > 0 ? (
                  selectedThread.conversation.map((msg, idx) => 
                    renderConversationMessage(msg, idx)
                  )
                ) : (
                  <div className="text-center py-8 text-ink-500">
                    <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No conversation data extracted</p>
                    <p className="text-xs mt-1">
                      Raw calls available: {selectedThread.total_calls}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-16 text-ink-500">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Select a session to view conversation</p>
              <p className="text-sm mt-1">Click on a session from the list</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ============================================================================
  // Taxonomy Tab
  // ============================================================================

  const TaxonomyTab = () => (
    <div className="space-y-6">
      {/* Header with Stats and Actions */}
      <div className="grid grid-cols-12 gap-6">
        {/* Saturation Card */}
        <div className="col-span-5 bg-ink-900/50 rounded-xl border border-ink-800 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-semibold text-sand-100 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-accent-teal" />
              Saturation Tracking
            </h2>
            {taxonomy?.saturation.status === "saturated" && (
              <span className="badge bg-emerald-500/20 text-emerald-400">Saturated</span>
            )}
            {taxonomy?.saturation.status === "approaching_saturation" && (
              <span className="badge bg-amber-500/20 text-amber-400">Approaching</span>
            )}
            {taxonomy?.saturation.status === "discovering" && (
              <span className="badge bg-blue-500/20 text-blue-400">Discovering</span>
            )}
          </div>
          
          {taxonomy?.saturation ? (
            <div className="space-y-4">
              <p className="text-sm text-ink-400">{taxonomy.saturation.message}</p>
              
              {/* Saturation Progress Bar */}
              <div>
                <div className="flex justify-between text-xs text-ink-500 mb-1">
                  <span>Saturation Score</span>
                  <span>{Math.round(taxonomy.saturation.saturation_score * 100)}%</span>
                </div>
                <div className="h-2 bg-ink-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-accent-coral to-accent-teal transition-all duration-500"
                    style={{ width: `${taxonomy.saturation.saturation_score * 100}%` }}
                  />
                </div>
              </div>
              
              {/* Quick Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-ink-950 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-accent-coral">
                    {taxonomy.stats.total_failure_modes}
                  </div>
                  <div className="text-xs text-ink-500">Failure Modes</div>
                </div>
                <div className="bg-ink-950 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-accent-gold">
                    {taxonomy.stats.total_uncategorized}
                  </div>
                  <div className="text-xs text-ink-500">Uncategorized</div>
                </div>
                <div className="bg-ink-950 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-accent-teal">
                    {taxonomy.stats.total_categorized}
                  </div>
                  <div className="text-xs text-ink-500">Categorized</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-32 shimmer rounded" />
          )}
        </div>

        {/* Actions Card */}
        <div className="col-span-7 bg-ink-900/50 rounded-xl border border-ink-800 p-4">
          <h2 className="font-display text-lg font-semibold text-sand-100 flex items-center gap-2 mb-4">
            <Zap className="w-5 h-5 text-accent-gold" />
            Actions
          </h2>
          
          <div className="grid grid-cols-2 gap-4">
            {/* Sync Notes */}
            <button
              onClick={syncNotesFromWeave}
              disabled={syncing}
              className="bg-ink-950 hover:bg-ink-900 rounded-lg p-4 border border-ink-800 hover:border-ink-700 transition-colors text-left group"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-accent-teal/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  {syncing ? (
                    <RefreshCw className="w-5 h-5 text-accent-teal animate-spin" />
                  ) : (
                    <RefreshCw className="w-5 h-5 text-accent-teal" />
                  )}
                </div>
                <div>
                  <h3 className="font-medium text-sand-200">Sync from Weave</h3>
                  <p className="text-xs text-ink-500">Pull latest notes</p>
                </div>
              </div>
            </button>

            {/* Auto Categorize */}
            <button
              onClick={autoCategorize}
              disabled={categorizing || !taxonomy?.uncategorized_notes.length}
              className="bg-ink-950 hover:bg-ink-900 rounded-lg p-4 border border-ink-800 hover:border-ink-700 transition-colors text-left group disabled:opacity-50"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-accent-plum/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  {categorizing ? (
                    <RefreshCw className="w-5 h-5 text-accent-plum animate-spin" />
                  ) : (
                    <Sparkles className="w-5 h-5 text-accent-plum" />
                  )}
                </div>
                <div>
                  <h3 className="font-medium text-sand-200">Auto-Categorize</h3>
                  <p className="text-xs text-ink-500">AI assigns all notes</p>
                </div>
              </div>
            </button>

            {/* Create Failure Mode */}
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-ink-950 hover:bg-ink-900 rounded-lg p-4 border border-ink-800 hover:border-ink-700 transition-colors text-left group"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-accent-coral/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Plus className="w-5 h-5 text-accent-coral" />
                </div>
                <div>
                  <h3 className="font-medium text-sand-200">New Failure Mode</h3>
                  <p className="text-xs text-ink-500">Create manually</p>
                </div>
              </div>
            </button>

            {/* Refresh */}
            <button
              onClick={fetchTaxonomy}
              disabled={loadingTaxonomy}
              className="bg-ink-950 hover:bg-ink-900 rounded-lg p-4 border border-ink-800 hover:border-ink-700 transition-colors text-left group"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-ink-700 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <RefreshCw className={`w-5 h-5 text-ink-300 ${loadingTaxonomy ? 'animate-spin' : ''}`} />
                </div>
                <div>
                  <h3 className="font-medium text-sand-200">Refresh</h3>
                  <p className="text-xs text-ink-500">Reload taxonomy</p>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-12 gap-6">
        {/* Uncategorized Notes */}
        <div className="col-span-4 bg-ink-900/50 rounded-xl border border-ink-800 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-semibold text-sand-100 flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-accent-gold" />
              Uncategorized
            </h2>
            <span className="badge badge-gold">
              {taxonomy?.uncategorized_notes.length || 0}
            </span>
          </div>

          <div className="space-y-2 max-h-[calc(100vh-480px)] overflow-y-auto">
            {taxonomy?.uncategorized_notes.length ? (
              taxonomy.uncategorized_notes.map((note) => (
                <div
                  key={note.id}
                  onClick={() => {
                    setSelectedNote(note);
                    setNoteSuggestion(null);
                  }}
                  className={`bg-ink-950 rounded-lg p-3 cursor-pointer hover:bg-ink-900 transition-colors border ${
                    selectedNote?.id === note.id 
                      ? "border-accent-gold" 
                      : "border-transparent"
                  }`}
                >
                  <p className="text-sm text-sand-300 line-clamp-3">{note.content}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-ink-600">
                      {formatRelativeTime(note.created_at)}
                    </span>
                    {note.weave_url && (
                      <a
                        href={note.weave_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-accent-coral hover:text-accent-coral/80 flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-ink-500 text-sm">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>All notes categorized!</p>
                <p className="text-xs mt-1">Sync to pull new notes from Weave</p>
              </div>
            )}
          </div>

          {/* Note Assignment Panel */}
          {selectedNote && (
            <div className="mt-4 pt-4 border-t border-ink-800">
              <div className="bg-ink-950 rounded-lg p-3 border border-accent-gold/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-accent-gold">Selected Note</span>
                  <button
                    onClick={() => {
                      setSelectedNote(null);
                      setNoteSuggestion(null);
                    }}
                    className="text-ink-500 hover:text-ink-300"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm text-sand-300 mb-3 line-clamp-2">{selectedNote.content}</p>
                
                {/* AI Suggestion Button */}
                <button
                  onClick={() => suggestCategoryForNote(selectedNote.id)}
                  disabled={loadingSuggestion}
                  className="w-full btn-primary text-sm flex items-center justify-center gap-2 mb-2"
                >
                  {loadingSuggestion ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  Get AI Suggestion
                </button>

                {/* AI Suggestion Result */}
                {noteSuggestion && (
                  <div className="mt-3 p-3 bg-ink-900 rounded-lg border border-ink-700">
                    <div className="flex items-center gap-2 mb-2">
                      <Target className="w-4 h-4 text-accent-plum" />
                      <span className="text-xs font-medium text-accent-plum">AI Suggestion</span>
                    </div>
                    
                    {noteSuggestion.match_type === "existing" ? (
                      <div>
                        <p className="text-sm text-sand-300">
                          Matches existing: <strong className="text-accent-teal">
                            {taxonomy?.failure_modes.find(m => m.id === noteSuggestion.existing_mode_id)?.name}
                          </strong>
                        </p>
                        <p className="text-xs text-ink-500 mt-1">
                          Confidence: {Math.round(noteSuggestion.confidence * 100)}%
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm text-sand-300">
                          New category: <strong className="text-accent-coral">
                            {noteSuggestion.new_category?.name}
                          </strong>
                        </p>
                        <p className="text-xs text-ink-500 mt-1">
                          {noteSuggestion.new_category?.description}
                        </p>
                      </div>
                    )}
                    
                    <p className="text-xs text-ink-500 mt-2 italic">{noteSuggestion.reasoning}</p>
                    
                    <button
                      onClick={applySuggestion}
                      className="w-full mt-3 btn-ghost text-sm flex items-center justify-center gap-2 border border-accent-plum/30 hover:bg-accent-plum/10"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Apply Suggestion
                    </button>
                  </div>
                )}

                {/* Manual Assignment */}
                <div className="mt-3">
                  <span className="text-xs text-ink-500 block mb-2">Or assign manually:</span>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {taxonomy?.failure_modes.map((mode) => (
                      <button
                        key={mode.id}
                        onClick={() => assignNoteToMode(selectedNote.id, mode.id)}
                        className="w-full text-left text-xs px-2 py-1.5 rounded bg-ink-900 hover:bg-ink-800 text-sand-300 flex items-center justify-between"
                      >
                        <span className="truncate">{mode.name}</span>
                        <ArrowRight className="w-3 h-3 text-ink-500" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Failure Modes */}
        <div className="col-span-8 bg-ink-900/50 rounded-xl border border-ink-800 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-semibold text-sand-100 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-accent-coral" />
              Failure Modes
            </h2>
            <div className="flex items-center gap-2">
              {taxonomy?.failure_modes.length ? (
                <button
                  onClick={copyTaxonomyToClipboard}
                  className="btn-ghost text-xs flex items-center gap-1.5 px-2 py-1"
                  title="Copy all failure modes to clipboard"
                >
                  {copiedTaxonomy ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy All</span>
                    </>
                  )}
                </button>
              ) : null}
              <span className="badge badge-coral">
                {taxonomy?.failure_modes.length || 0}
              </span>
            </div>
          </div>

          <div className="space-y-3 max-h-[calc(100vh-400px)] overflow-y-auto">
            {taxonomy?.failure_modes.length ? (
              taxonomy.failure_modes.map((mode) => (
                <div
                  key={mode.id}
                  className={`bg-ink-950 rounded-lg border-l-4 ${getSeverityBorder(mode.severity)} hover:bg-ink-900/50 transition-colors`}
                >
                  {/* Header */}
                  <div 
                    className="p-4 cursor-pointer"
                    onClick={() => toggleModeExpanded(mode.id)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-sand-200">{mode.name}</h3>
                          <span className={`badge text-xs ${getSeverityColor(mode.severity)}`}>
                            {mode.severity}
                          </span>
                        </div>
                        <p className="text-sm text-ink-400 mt-1 line-clamp-2">
                          {mode.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <span className="badge badge-plum text-xs">
                          {mode.times_seen} note{mode.times_seen !== 1 ? 's' : ''}
                        </span>
                        {expandedModes.has(mode.id) ? (
                          <ChevronUp className="w-4 h-4 text-ink-500" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-ink-500" />
                        )}
                      </div>
                    </div>
                    
                    {/* Meta info */}
                    <div className="flex items-center gap-4 mt-2 text-xs text-ink-500">
                      <span>Created {formatRelativeTime(mode.created_at)}</span>
                      <span>Last seen {formatRelativeTime(mode.last_seen_at)}</span>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {expandedModes.has(mode.id) && (
                    <div className="px-4 pb-4 border-t border-ink-800 pt-3 space-y-3">
                      {/* Suggested Fix */}
                      {mode.suggested_fix && (
                        <div className="flex items-start gap-2 p-2 bg-ink-900 rounded-lg">
                          <Sparkles className="w-4 h-4 text-accent-teal flex-shrink-0 mt-0.5" />
                          <div>
                            <span className="text-xs font-medium text-accent-teal">Suggested Fix</span>
                            <p className="text-sm text-sand-300 mt-1">{mode.suggested_fix}</p>
                          </div>
                        </div>
                      )}

                      {/* Notes in this category */}
                      {mode.note_ids.length > 0 && (
                        <div>
                          <span className="text-xs font-medium text-ink-400 block mb-2">
                            Notes ({mode.note_ids.length})
                          </span>
                          <div className="space-y-1">
                            {taxonomy.notes?.filter(n => mode.note_ids.includes(n.id)).slice(0, 3).map((note) => (
                              <div key={note.id} className="text-xs text-sand-400 bg-ink-900 rounded p-2 flex items-center justify-between">
                                <span className="truncate flex-1">{note.content}</span>
                                {note.weave_url && (
                                  <a
                                    href={note.weave_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-accent-coral ml-2"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                            ))}
                            {mode.note_ids.length > 3 && (
                              <p className="text-xs text-ink-500 pl-2">
                                +{mode.note_ids.length - 3} more notes
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            copySingleModeToClipboard(mode);
                          }}
                          className="btn-ghost text-xs flex items-center"
                        >
                          {copiedModeId === mode.id ? (
                            <>
                              <Check className="w-3 h-3 mr-1 text-emerald-400" />
                              <span className="text-emerald-400">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 mr-1" />
                              Copy
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => deleteFailureMode(mode.id)}
                          className="btn-ghost text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        >
                          <Trash2 className="w-3 h-3 mr-1" />
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="text-center py-16 text-ink-500">
                <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-lg">No failure modes yet</p>
                <p className="mt-2 max-w-md mx-auto text-sm">
                  Sync notes from Weave, then use Auto-Categorize to discover failure patterns automatically.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create Failure Mode Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-ink-900 rounded-xl border border-ink-700 p-6 w-full max-w-md">
            <h3 className="font-display text-lg font-semibold text-sand-100 mb-4">
              Create Failure Mode
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-ink-400 mb-1">Name</label>
                <input
                  type="text"
                  value={newModeName}
                  onChange={(e) => setNewModeName(e.target.value)}
                  placeholder="e.g., Hallucination"
                  className="w-full"
                />
              </div>
              
              <div>
                <label className="block text-sm text-ink-400 mb-1">Description</label>
                <textarea
                  value={newModeDescription}
                  onChange={(e) => setNewModeDescription(e.target.value)}
                  placeholder="Describe this failure pattern..."
                  rows={3}
                  className="w-full"
                />
              </div>
              
              <div>
                <label className="block text-sm text-ink-400 mb-1">Severity</label>
                <select
                  value={newModeSeverity}
                  onChange={(e) => setNewModeSeverity(e.target.value)}
                  className="w-full"
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>
            
            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={createFailureMode}
                disabled={!newModeName.trim()}
                className="btn-primary"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ============================================================================
  // Main Render
  // ============================================================================

  return (
    <div className="min-h-screen bg-grid-pattern">
      {/* Header */}
      <header className="border-b border-ink-800 bg-ink-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1800px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-coral to-accent-gold flex items-center justify-center">
                  <Layers className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="font-display text-xl font-semibold text-sand-100">Error Analysis</h1>
                  <p className="text-xs text-ink-400">Bottom-up failure mode discovery</p>
                </div>
              </div>

              {/* Tab Navigation */}
              <nav className="flex items-center gap-1 bg-ink-900 rounded-lg p-1 ml-4">
                <button
                  onClick={() => setActiveTab("sessions")}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeTab === "sessions"
                      ? "bg-accent-coral text-white shadow-lg shadow-accent-coral/20"
                      : "text-ink-400 hover:text-sand-200 hover:bg-ink-800"
                  }`}
                >
                  <MessageCircle className="w-4 h-4" />
                  Sessions
                </button>
                <button
                  onClick={() => setActiveTab("taxonomy")}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeTab === "taxonomy"
                      ? "bg-accent-plum text-white shadow-lg shadow-accent-plum/20"
                      : "text-ink-400 hover:text-sand-200 hover:bg-ink-800"
                  }`}
                >
                  <BarChart3 className="w-4 h-4" />
                  Taxonomy
                  {taxonomy && taxonomy.stats.total_uncategorized > 0 && (
                    <span className="badge badge-gold text-xs ml-1">
                      {taxonomy.stats.total_uncategorized}
                    </span>
                  )}
                </button>
              </nav>
            </div>
            
            <div className="flex items-center gap-4">
              {/* Feedback Stats */}
              {feedbackSummary && (
                <div className="flex items-center gap-3 text-sm">
                  <div className="flex items-center gap-1 text-emerald-400">
                    <ThumbsUp className="w-4 h-4" />
                    <span>{feedbackSummary.thumbs_up}</span>
                  </div>
                  <div className="flex items-center gap-1 text-red-400">
                    <ThumbsDown className="w-4 h-4" />
                    <span>{feedbackSummary.thumbs_down}</span>
                  </div>
                </div>
              )}
              
              {/* Refresh */}
              <button 
                onClick={() => {
                  fetchThreads();
                  fetchFeedbackSummary();
                  if (activeTab === "taxonomy") {
                    fetchTaxonomy();
                  }
                }}
                className="btn-secondary flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1800px] mx-auto px-6 py-6">
        {activeTab === "sessions" ? <SessionsTab /> : <TaxonomyTab />}
      </main>
    </div>
  );
}
