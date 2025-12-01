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
  BarChart3
} from "lucide-react";
import { format, subDays, parseISO, formatDistanceToNow } from "date-fns";

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

interface FailureCategory {
  name: string;
  description: string;
  note_indices: number[];
  severity: string;
  suggested_fix: string;
}

interface CategorizeResponse {
  categories: FailureCategory[];
  summary: string;
}

type TabType = "sessions" | "analysis";

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>("sessions");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<ThreadDetail | null>(null);
  const [feedbackSummary, setFeedbackSummary] = useState<FeedbackSummary | null>(null);
  const [categories, setCategories] = useState<CategorizeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  
  // Filters
  const [timeRange, setTimeRange] = useState("7d");
  const [searchQuery, setSearchQuery] = useState("");

  const getTimeFilter = useCallback(() => {
    const now = new Date();
    let startTime: Date;
    
    switch (timeRange) {
      case "1h":
        startTime = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case "24h":
        startTime = subDays(now, 1);
        break;
      case "7d":
        startTime = subDays(now, 7);
        break;
      case "30d":
        startTime = subDays(now, 30);
        break;
      default:
        startTime = subDays(now, 7);
    }
    
    return {
      start_time: startTime.toISOString(),
      end_time: now.toISOString()
    };
  }, [timeRange]);

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
      const timeFilter = getTimeFilter();
      const params = new URLSearchParams({
        start_time: timeFilter.start_time,
        end_time: timeFilter.end_time
      });
      
      const response = await fetch(`/api/feedback-summary?${params}`);
      const data = await response.json();
      setFeedbackSummary(data);
    } catch (error) {
      console.error("Error fetching feedback summary:", error);
    }
  }, [getTimeFilter]);

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

  const categorizeNotes = async () => {
    if (!feedbackSummary?.notes.length) return;
    
    setCategorizing(true);
    try {
      const response = await fetch("/api/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: feedbackSummary.notes.map(n => n.note) })
      });
      const data = await response.json();
      setCategories(data);
    } catch (error) {
      console.error("Error categorizing:", error);
    } finally {
      setCategorizing(false);
    }
  };

  useEffect(() => {
    fetchThreads();
    fetchFeedbackSummary();
  }, [fetchThreads, fetchFeedbackSummary]);

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

  // Sessions Tab Content
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

  // Analysis Tab Content
  const AnalysisTab = () => (
    <div className="grid grid-cols-12 gap-6">
      {/* Left Panel - Feedback Summary & Notes */}
      <div className="col-span-5 space-y-4">
        {/* Summary Stats */}
        <div className="bg-ink-900/50 rounded-xl border border-ink-800 p-4">
          <h2 className="font-display text-lg font-semibold text-sand-100 mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-accent-teal" />
            Feedback Summary
          </h2>
          
          {feedbackSummary ? (
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-ink-950 rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-accent-teal">
                  {feedbackSummary.thumbs_up}
                </div>
                <div className="text-xs text-ink-500 flex items-center justify-center gap-1 mt-1">
                  <ThumbsUp className="w-3 h-3" /> Good
                </div>
              </div>
              <div className="bg-ink-950 rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-accent-coral">
                  {feedbackSummary.thumbs_down}
                </div>
                <div className="text-xs text-ink-500 flex items-center justify-center gap-1 mt-1">
                  <ThumbsDown className="w-3 h-3" /> Bad
                </div>
              </div>
              <div className="bg-ink-950 rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-accent-gold">
                  {feedbackSummary.total_notes}
                </div>
                <div className="text-xs text-ink-500 flex items-center justify-center gap-1 mt-1">
                  <MessageSquare className="w-3 h-3" /> Notes
                </div>
              </div>
            </div>
          ) : (
            <div className="h-20 shimmer rounded" />
          )}
        </div>

        {/* Notes List */}
        <div className="bg-ink-900/50 rounded-xl border border-ink-800 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-semibold text-sand-100 flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-accent-gold" />
              Collected Notes
            </h2>
            <button
              onClick={categorizeNotes}
              disabled={!feedbackSummary?.notes?.length || categorizing}
              className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {categorizing ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Categorize
            </button>
          </div>

          <div className="space-y-2 max-h-[calc(100vh-420px)] overflow-y-auto">
            {feedbackSummary?.notes?.length ? (
              feedbackSummary.notes.map((note, idx) => (
                <div key={idx} className="bg-ink-950 rounded-lg p-3 text-sm group hover:border-ink-700 border border-transparent transition-colors">
                  <p className="text-sand-300">{note.note}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-ink-600">
                      {formatRelativeTime(note.created_at)}
                    </span>
                    {note.weave_url && (
                      <a
                        href={note.weave_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-accent-coral hover:text-accent-coral/80 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View trace
                      </a>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-ink-500 text-sm">
                <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No notes yet</p>
                <p className="text-xs mt-1">Add notes in Weave UI to see them here</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Panel - Failure Mode Categories */}
      <div className="col-span-7 space-y-4">
        <div className="bg-ink-900/50 rounded-xl border border-ink-800 p-4 min-h-[calc(100vh-220px)]">
          <h2 className="font-display text-lg font-semibold text-sand-100 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-accent-plum" />
            Failure Modes
          </h2>

          {categories ? (
            <div className="space-y-4 animate-fade-in">
              <div className="bg-gradient-to-r from-ink-950 to-ink-900 rounded-lg p-4 border border-ink-800">
                <h3 className="text-xs font-medium text-ink-400 uppercase tracking-wide mb-2">Summary</h3>
                <p className="text-sm text-sand-300">
                  {categories.summary}
                </p>
              </div>
              
              <div className="grid gap-4">
                {categories.categories.map((cat, idx) => (
                  <div 
                    key={idx} 
                    className="bg-ink-950 rounded-lg p-4 border-l-4 hover:bg-ink-900/50 transition-colors"
                    style={{
                      borderColor: cat.severity === 'high' 
                        ? 'var(--color-error)' 
                        : cat.severity === 'medium'
                        ? 'var(--color-warning)'
                        : 'var(--color-success)'
                    }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <h3 className="font-semibold text-sand-200">
                          {cat.name}
                        </h3>
                        <p className="text-sm text-ink-400 mt-1">
                          {cat.description}
                        </p>
                      </div>
                      <span className={`badge text-xs flex-shrink-0 ${
                        cat.severity === 'high' 
                          ? 'badge-coral' 
                          : cat.severity === 'medium'
                          ? 'badge-gold'
                          : 'badge-teal'
                      }`}>
                        {cat.severity}
                      </span>
                    </div>
                    
                    <div className="mt-3 pt-3 border-t border-ink-800">
                      <div className="flex items-start gap-2">
                        <Sparkles className="w-4 h-4 text-accent-teal flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-accent-teal">
                          {cat.suggested_fix}
                        </p>
                      </div>
                    </div>
                    
                    <div className="mt-3 flex items-center gap-2">
                      <span className="badge badge-plum text-xs">
                        {cat.note_indices.length} note{cat.note_indices.length !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-ink-600">
                        in this category
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-16 text-ink-500 text-sm">
              <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-lg">Ready to analyze</p>
              <p className="mt-2 max-w-md mx-auto">
                Collect notes from your Weave traces, then click "Categorize" to have the LLM cluster similar issues into failure modes.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

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
                  onClick={() => setActiveTab("analysis")}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeTab === "analysis"
                      ? "bg-accent-plum text-white shadow-lg shadow-accent-plum/20"
                      : "text-ink-400 hover:text-sand-200 hover:bg-ink-800"
                  }`}
                >
                  <BarChart3 className="w-4 h-4" />
                  Analysis
                  {feedbackSummary && feedbackSummary.total_notes > 0 && (
                    <span className="badge badge-gold text-xs ml-1">
                      {feedbackSummary.total_notes}
                    </span>
                  )}
                </button>
              </nav>
            </div>
            
            <div className="flex items-center gap-4">
              {/* Time Range Filter */}
              <div className="flex items-center gap-2 bg-ink-900 rounded-lg p-1">
                {["1h", "24h", "7d", "30d"].map((range) => (
                  <button
                    key={range}
                    onClick={() => setTimeRange(range)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      timeRange === range 
                        ? "bg-accent-coral text-white" 
                        : "text-ink-400 hover:text-sand-200"
                    }`}
                  >
                    {range}
                  </button>
                ))}
              </div>
              
              {/* Refresh */}
              <button 
                onClick={() => {
                  fetchThreads();
                  fetchFeedbackSummary();
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
        {activeTab === "sessions" ? <SessionsTab /> : <AnalysisTab />}
      </main>
    </div>
  );
}
