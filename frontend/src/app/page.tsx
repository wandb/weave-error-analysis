"use client";

import { useState, useEffect, useCallback } from "react";
import { 
  Search, 
  Clock, 
  MessageSquare, 
  ThumbsUp, 
  ThumbsDown,
  ChevronRight,
  Filter,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Calendar,
  Layers
} from "lucide-react";
import { format, subDays, parseISO } from "date-fns";

interface Trace {
  id: string;
  op_name: string;
  started_at: string | null;
  ended_at: string | null;
  status: string;
  inputs_preview: Record<string, unknown>;
  has_exception: boolean;
}

interface TraceDetail {
  id: string;
  op_name: string;
  started_at: string | null;
  ended_at: string | null;
  inputs: Record<string, unknown>;
  output: unknown;
  status: string;
  exception: string | null;
  feedback: Array<{ type: string; value: unknown; created_at: string }>;
  attributes: Record<string, unknown>;
  children: Array<{
    id: string;
    op_name: string;
    started_at: string | null;
    ended_at: string | null;
    inputs_preview: Record<string, unknown>;
    output_preview: unknown;
  }>;
}

interface FeedbackSummary {
  thumbs_up: number;
  thumbs_down: number;
  notes: Array<{ trace_id: string; note: string; op_name: string }>;
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

export default function Home() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<TraceDetail | null>(null);
  const [feedbackSummary, setFeedbackSummary] = useState<FeedbackSummary | null>(null);
  const [categories, setCategories] = useState<CategorizeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  
  // Filters
  const [timeRange, setTimeRange] = useState("7d");
  const [opNameFilter, setOpNameFilter] = useState("");
  const [opNames, setOpNames] = useState<string[]>([]);
  
  // Notes
  const [newNote, setNewNote] = useState("");

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

  const fetchTraces = useCallback(async () => {
    setLoading(true);
    try {
      const timeFilter = getTimeFilter();
      const params = new URLSearchParams({
        start_time: timeFilter.start_time,
        end_time: timeFilter.end_time,
        ...(opNameFilter && { op_name: opNameFilter })
      });
      
      const response = await fetch(`/api/traces?${params}`);
      const data = await response.json();
      setTraces(data.traces || []);
    } catch (error) {
      console.error("Error fetching traces:", error);
    } finally {
      setLoading(false);
    }
  }, [getTimeFilter, opNameFilter]);

  const fetchOpNames = async () => {
    try {
      const response = await fetch("/api/op-names");
      const data = await response.json();
      setOpNames(data.op_names || []);
    } catch (error) {
      console.error("Error fetching op names:", error);
    }
  };

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

  const fetchTraceDetail = async (traceId: string) => {
    setLoadingDetail(true);
    try {
      const response = await fetch(`/api/traces/${traceId}`);
      const data = await response.json();
      setSelectedTrace(data);
    } catch (error) {
      console.error("Error fetching trace detail:", error);
    } finally {
      setLoadingDetail(false);
    }
  };

  const addFeedback = async (traceId: string, feedbackType: string, value?: string) => {
    try {
      await fetch(`/api/traces/${traceId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trace_id: traceId, feedback_type: feedbackType, value })
      });
      // Refresh data
      fetchFeedbackSummary();
      if (selectedTrace?.id === traceId) {
        fetchTraceDetail(traceId);
      }
    } catch (error) {
      console.error("Error adding feedback:", error);
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
    fetchTraces();
    fetchOpNames();
    fetchFeedbackSummary();
  }, [fetchTraces, fetchFeedbackSummary]);

  const formatTime = (isoString: string | null) => {
    if (!isoString) return "—";
    try {
      return format(parseISO(isoString), "MMM d, HH:mm:ss");
    } catch {
      return isoString;
    }
  };

  const getStatusColor = (trace: Trace) => {
    if (trace.has_exception) return "status-error";
    if (trace.status === "success") return "status-success";
    return "status-pending";
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-ink-800 bg-ink-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1800px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-coral to-accent-gold flex items-center justify-center">
                  <Layers className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="font-display text-xl font-semibold text-sand-100">Error Analysis</h1>
                  <p className="text-xs text-ink-400">Bottom-up failure mode discovery</p>
                </div>
              </div>
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
                  fetchTraces();
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
        <div className="grid grid-cols-12 gap-6">
          
          {/* Left Panel - Trace List */}
          <div className="col-span-4 space-y-4">
            <div className="bg-ink-900/50 rounded-xl border border-ink-800 p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-lg font-semibold text-sand-100 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-accent-coral" />
                  Traces
                </h2>
                <span className="badge badge-coral">{traces.length}</span>
              </div>
              
              {/* Filters */}
              <div className="flex gap-2 mb-4">
                <div className="flex-1 relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
                  <input
                    type="text"
                    placeholder="Search traces..."
                    className="w-full pl-10 text-sm"
                  />
                </div>
                <select
                  value={opNameFilter}
                  onChange={(e) => setOpNameFilter(e.target.value)}
                  className="text-sm"
                >
                  <option value="">All operations</option>
                  {opNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>

              {/* Trace List */}
              <div className="space-y-2 max-h-[calc(100vh-320px)] overflow-y-auto">
                {loading ? (
                  <div className="space-y-2">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="h-20 shimmer rounded-lg" />
                    ))}
                  </div>
                ) : traces.length === 0 ? (
                  <div className="text-center py-8 text-ink-500">
                    <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
                    <p>No traces found</p>
                    <p className="text-sm">Try adjusting the time filter</p>
                  </div>
                ) : (
                  traces.map((trace) => (
                    <button
                      key={trace.id}
                      onClick={() => fetchTraceDetail(trace.id)}
                      className={`w-full text-left trace-card rounded-lg p-3 ${
                        selectedTrace?.id === trace.id ? "ring-2 ring-accent-coral" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-sm text-sand-200 truncate">
                            {trace.op_name}
                          </p>
                          <p className="text-xs text-ink-500 mt-1">
                            {formatTime(trace.started_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`badge text-xs ${getStatusColor(trace)}`}>
                            {trace.has_exception ? (
                              <XCircle className="w-3 h-3" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3" />
                            )}
                          </span>
                          <ChevronRight className="w-4 h-4 text-ink-600" />
                        </div>
                      </div>
                      {trace.inputs_preview && Object.keys(trace.inputs_preview).length > 0 && (
                        <div className="mt-2 text-xs text-ink-500 truncate">
                          {JSON.stringify(trace.inputs_preview).slice(0, 60)}...
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Center Panel - Trace Detail & Open Coding */}
          <div className="col-span-5 space-y-4">
            <div className="bg-ink-900/50 rounded-xl border border-ink-800 p-4">
              <h2 className="font-display text-lg font-semibold text-sand-100 flex items-center gap-2 mb-4">
                <MessageSquare className="w-5 h-5 text-accent-teal" />
                Trace Detail
              </h2>

              {loadingDetail ? (
                <div className="space-y-4">
                  <div className="h-8 shimmer rounded w-1/3" />
                  <div className="h-40 shimmer rounded" />
                </div>
              ) : selectedTrace ? (
                <div className="space-y-4 animate-fade-in">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-mono text-accent-coral text-sm">{selectedTrace.op_name}</p>
                      <p className="text-xs text-ink-500 mt-1">
                        ID: {selectedTrace.id.slice(0, 16)}...
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => addFeedback(selectedTrace.id, "thumbs_up")}
                        className="btn-ghost flex items-center gap-1"
                      >
                        <ThumbsUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => addFeedback(selectedTrace.id, "thumbs_down")}
                        className="btn-ghost flex items-center gap-1"
                      >
                        <ThumbsDown className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Timing */}
                  <div className="flex gap-4 text-sm">
                    <div>
                      <span className="text-ink-500">Started:</span>{" "}
                      <span className="text-sand-300">{formatTime(selectedTrace.started_at)}</span>
                    </div>
                    <div>
                      <span className="text-ink-500">Ended:</span>{" "}
                      <span className="text-sand-300">{formatTime(selectedTrace.ended_at)}</span>
                    </div>
                  </div>

                  {/* Inputs */}
                  <div>
                    <h3 className="text-sm font-semibold text-sand-300 mb-2">Inputs</h3>
                    <div className="code-block">
                      <pre className="text-xs text-sand-400 whitespace-pre-wrap">
                        {JSON.stringify(selectedTrace.inputs, null, 2)}
                      </pre>
                    </div>
                  </div>

                  {/* Output */}
                  <div>
                    <h3 className="text-sm font-semibold text-sand-300 mb-2">Output</h3>
                    <div className="code-block max-h-48 overflow-y-auto">
                      <pre className="text-xs text-sand-400 whitespace-pre-wrap">
                        {JSON.stringify(selectedTrace.output, null, 2)}
                      </pre>
                    </div>
                  </div>

                  {/* Exception */}
                  {selectedTrace.exception && (
                    <div>
                      <h3 className="text-sm font-semibold text-accent-coral mb-2 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        Exception
                      </h3>
                      <div className="code-block border-accent-coral/30">
                        <pre className="text-xs text-accent-coral whitespace-pre-wrap">
                          {selectedTrace.exception}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Child Calls */}
                  {selectedTrace.children && selectedTrace.children.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-sand-300 mb-2">
                        Child Calls ({selectedTrace.children.length})
                      </h3>
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {selectedTrace.children.map((child) => (
                          <div key={child.id} className="bg-ink-950 rounded-lg p-2 text-xs">
                            <p className="font-mono text-accent-teal">{child.op_name}</p>
                            <p className="text-ink-500 mt-1 truncate">
                              {JSON.stringify(child.inputs_preview)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Existing Feedback */}
                  {selectedTrace.feedback && selectedTrace.feedback.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-sand-300 mb-2">Feedback</h3>
                      <div className="space-y-2">
                        {selectedTrace.feedback.map((fb, idx) => (
                          <div key={idx} className="bg-ink-950 rounded-lg p-2 text-xs">
                            <span className="badge badge-gold mr-2">{fb.type}</span>
                            <span className="text-sand-400">{JSON.stringify(fb.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Add Note (Open Coding) */}
                  <div className="border-t border-ink-800 pt-4">
                    <h3 className="text-sm font-semibold text-sand-300 mb-2 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-accent-gold" />
                      Open Coding — Add Note
                    </h3>
                    <p className="text-xs text-ink-500 mb-2">
                      Describe any problems, surprises, or incorrect behaviors you observe.
                    </p>
                    <div className="flex gap-2">
                      <textarea
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder="e.g., Agent failed to understand date format..."
                        className="flex-1 text-sm min-h-[80px]"
                      />
                    </div>
                    <button
                      onClick={() => {
                        if (newNote.trim()) {
                          addFeedback(selectedTrace.id, "note", newNote);
                          setNewNote("");
                        }
                      }}
                      disabled={!newNote.trim()}
                      className="btn-primary mt-2 w-full disabled:opacity-50"
                    >
                      Add Note
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-ink-500">
                  <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>Select a trace to view details</p>
                  <p className="text-sm mt-1">Click on a trace from the list</p>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Failure Modes */}
          <div className="col-span-3 space-y-4">
            {/* Summary Stats */}
            <div className="bg-ink-900/50 rounded-xl border border-ink-800 p-4">
              <h2 className="font-display text-lg font-semibold text-sand-100 mb-4">
                Feedback Summary
              </h2>
              
              {feedbackSummary ? (
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-accent-teal">
                      {feedbackSummary.thumbs_up}
                    </div>
                    <div className="text-xs text-ink-500 flex items-center justify-center gap-1">
                      <ThumbsUp className="w-3 h-3" /> Good
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-accent-coral">
                      {feedbackSummary.thumbs_down}
                    </div>
                    <div className="text-xs text-ink-500 flex items-center justify-center gap-1">
                      <ThumbsDown className="w-3 h-3" /> Bad
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-accent-gold">
                      {feedbackSummary.total_notes}
                    </div>
                    <div className="text-xs text-ink-500 flex items-center justify-center gap-1">
                      <MessageSquare className="w-3 h-3" /> Notes
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-16 shimmer rounded" />
              )}
            </div>

            {/* Notes List */}
            <div className="bg-ink-900/50 rounded-xl border border-ink-800 p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-lg font-semibold text-sand-100">
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

              <div className="space-y-2 max-h-48 overflow-y-auto">
                {feedbackSummary?.notes?.length ? (
                  feedbackSummary.notes.map((note, idx) => (
                    <div key={idx} className="bg-ink-950 rounded-lg p-3 text-sm">
                      <p className="text-sand-300">{note.note}</p>
                      <p className="text-xs text-ink-500 mt-1 font-mono">
                        {note.op_name}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-6 text-ink-500 text-sm">
                    <p>No notes yet</p>
                    <p className="text-xs mt-1">Add notes to traces for analysis</p>
                  </div>
                )}
              </div>
            </div>

            {/* Failure Mode Categories */}
            <div className="bg-ink-900/50 rounded-xl border border-ink-800 p-4">
              <h2 className="font-display text-lg font-semibold text-sand-100 mb-4 flex items-center gap-2">
                <Filter className="w-5 h-5 text-accent-plum" />
                Failure Modes
              </h2>

              {categories ? (
                <div className="space-y-4 animate-fade-in">
                  <p className="text-sm text-sand-400 bg-ink-950 rounded-lg p-3">
                    {categories.summary}
                  </p>
                  
                  <div className="space-y-3">
                    {categories.categories.map((cat, idx) => (
                      <div 
                        key={idx} 
                        className="bg-ink-950 rounded-lg p-3 border-l-2"
                        style={{
                          borderColor: cat.severity === 'high' 
                            ? 'var(--color-error)' 
                            : cat.severity === 'medium'
                            ? 'var(--color-warning)'
                            : 'var(--color-success)'
                        }}
                      >
                        <div className="flex items-start justify-between">
                          <h3 className="font-semibold text-sand-200 text-sm">
                            {cat.name}
                          </h3>
                          <span className={`badge text-xs ${
                            cat.severity === 'high' 
                              ? 'badge-coral' 
                              : cat.severity === 'medium'
                              ? 'badge-gold'
                              : 'badge-teal'
                          }`}>
                            {cat.severity}
                          </span>
                        </div>
                        <p className="text-xs text-ink-400 mt-1">
                          {cat.description}
                        </p>
                        <p className="text-xs text-accent-teal mt-2">
                          💡 {cat.suggested_fix}
                        </p>
                        <p className="text-xs text-ink-600 mt-1">
                          {cat.note_indices.length} note(s) in this category
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-ink-500 text-sm">
                  <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>Click "Categorize" to analyze notes</p>
                  <p className="text-xs mt-1">
                    LLM will cluster similar issues into failure modes
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

