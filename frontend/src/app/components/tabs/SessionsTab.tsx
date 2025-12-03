"use client";

import { useState } from "react";
import {
  Search,
  MessageCircle,
  MessageSquare,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  SortDesc,
  Shuffle,
  Clock,
  CheckSquare,
  Square,
  Send,
  StickyNote,
  Filter,
  X,
  Target,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { formatTime, formatRelativeTime } from "../../utils/formatters";
import { ConversationMessage } from "../ConversationMessage";
import { Panel, PanelHeader, Badge, ProgressBar, LoadingCards, NoSessionsFound, SelectPrompt } from "../ui";

export function SessionsTab() {
  const {
    threads,
    selectedThread,
    annotationProgress,
    loadingThreads,
    loadingDetail,
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
    filterMinTurns,
    setFilterMinTurns,
    filterReviewed,
    setFilterReviewed,
    filterBatchId,
    setFilterBatchId,
    filterBatchName,
    setFilterBatchName,
    fetchThreadDetail,
    fetchRandomSample,
    markThreadReviewed,
    unmarkThreadReviewed,
    addNoteToThread,
  } = useApp();

  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [markingReviewed, setMarkingReviewed] = useState(false);

  const filteredThreads = threads.filter((thread) => {
    if (!searchQuery) return true;
    return thread.thread_id.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const handleAddNote = async () => {
    if (!selectedThread || !newNote.trim()) return;
    setAddingNote(true);
    try {
      await addNoteToThread(selectedThread.thread_id, newNote);
      setNewNote("");
    } finally {
      setAddingNote(false);
    }
  };

  const handleToggleReviewed = async () => {
    if (!selectedThread) return;
    setMarkingReviewed(true);
    try {
      if (selectedThread.is_reviewed) {
        await unmarkThreadReviewed(selectedThread.thread_id);
      } else {
        await markThreadReviewed(selectedThread.thread_id);
      }
    } finally {
      setMarkingReviewed(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Batch Filter Indicator */}
      {filterBatchId && (
        <div className="bg-accent-coral/10 border border-accent-coral/30 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-accent-coral" />
            <span className="text-sm text-sand-200">
              Filtered by batch: <strong className="text-accent-coral">{filterBatchName || filterBatchId}</strong>
            </span>
          </div>
          <button
            onClick={() => {
              setFilterBatchId(null);
              setFilterBatchName(null);
            }}
            className="text-xs text-ink-400 hover:text-sand-200 flex items-center gap-1"
          >
            <X className="w-3 h-3" />
            Clear Filter
          </button>
        </div>
      )}

      {/* Annotation Progress Bar */}
      {annotationProgress && (
        <Panel>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display text-sm font-semibold text-sand-100 flex items-center gap-2">
              <Target className="w-4 h-4 text-accent-teal" />
              Review Progress
            </h3>
            <span className="text-xs text-ink-400">
              {annotationProgress.reviewed_count} / {annotationProgress.target} reviewed
            </span>
          </div>
          <ProgressBar value={annotationProgress.progress_percent} />
          <div className="flex items-center justify-between mt-2 text-xs text-ink-500">
            <span>{annotationProgress.remaining} remaining</span>
            <span>{annotationProgress.recent_reviews_24h} reviewed today</span>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* Left Panel - Thread List */}
        <div className="col-span-4 space-y-4 min-w-0">
          <Panel className="overflow-hidden">
            <PanelHeader
              icon={<MessageCircle className="w-5 h-5 text-accent-coral" />}
              title="Sessions"
              badge={<Badge variant="coral">{threads.length}</Badge>}
            />

            {/* Search */}
            <div className="mb-3">
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

            {/* Sort & Filter Controls */}
            <div className="mb-3 space-y-2">
              <div className="flex items-center gap-2">
                <SortDesc className="w-4 h-4 text-ink-500" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="flex-1 text-xs bg-ink-950 border border-ink-700 rounded px-2 py-1"
                >
                  <option value="last_updated">Last Updated</option>
                  <option value="turn_count">Turn Count</option>
                </select>
                <button
                  onClick={() => setSortDirection((d) => (d === "desc" ? "asc" : "desc"))}
                  className="p-1 bg-ink-950 border border-ink-700 rounded text-xs"
                  title={sortDirection === "desc" ? "Descending" : "Ascending"}
                >
                  {sortDirection === "desc" ? "↓" : "↑"}
                </button>
              </div>

              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => setFilterMinTurns(filterMinTurns === 5 ? null : 5)}
                  className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                    filterMinTurns === 5
                      ? "bg-accent-coral/20 border-accent-coral text-accent-coral"
                      : "bg-ink-950 border-ink-700 text-ink-400 hover:border-ink-600"
                  }`}
                >
                  5+ turns
                </button>
                <button
                  onClick={() => setFilterReviewed(filterReviewed === false ? null : false)}
                  className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                    filterReviewed === false
                      ? "bg-accent-gold/20 border-accent-gold text-accent-gold"
                      : "bg-ink-950 border-ink-700 text-ink-400 hover:border-ink-600"
                  }`}
                >
                  Not Reviewed
                </button>
                <button
                  onClick={() => setFilterReviewed(filterReviewed === true ? null : true)}
                  className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                    filterReviewed === true
                      ? "bg-accent-teal/20 border-accent-teal text-accent-teal"
                      : "bg-ink-950 border-ink-700 text-ink-400 hover:border-ink-600"
                  }`}
                >
                  Reviewed
                </button>
                <button
                  onClick={() => fetchRandomSample(20)}
                  className="px-2 py-0.5 text-xs rounded-full border bg-ink-950 border-ink-700 text-ink-400 hover:border-accent-plum hover:text-accent-plum transition-colors flex items-center gap-1"
                >
                  <Shuffle className="w-3 h-3" />
                  Random 20
                </button>
              </div>
            </div>

            {/* Thread List */}
            <div className="space-y-2 max-h-[calc(100vh-480px)] overflow-y-auto">
              {loadingThreads ? (
                <LoadingCards count={5} />
              ) : filteredThreads.length === 0 ? (
                <NoSessionsFound />
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
                          {thread.is_reviewed ? (
                            <CheckSquare className="w-3 h-3 text-accent-teal" />
                          ) : (
                            <Square className="w-3 h-3 text-ink-600" />
                          )}
                          <p className="font-mono text-sm text-sand-200 truncate">{thread.thread_id}</p>
                        </div>
                        <div className="flex items-center gap-3 mt-2">
                          <Badge variant="teal" className="text-xs">
                            {thread.turn_count} turn{thread.turn_count !== 1 ? "s" : ""}
                          </Badge>
                          <span className="text-xs text-ink-500">{formatRelativeTime(thread.last_updated)}</span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-ink-600 flex-shrink-0" />
                    </div>
                  </button>
                ))
              )}
            </div>
          </Panel>
        </div>

        {/* Right Panel - Conversation View */}
        <div className="col-span-8 space-y-4">
          <Panel>
            <PanelHeader
              icon={<MessageSquare className="w-5 h-5 text-accent-teal" />}
              title="Conversation"
            />

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
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-accent-coral text-sm">{selectedThread.thread_id}</p>
                      {selectedThread.is_reviewed && (
                        <Badge variant="teal" className="text-xs">
                          Reviewed
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-ink-500">
                        {selectedThread.total_calls} calls · {selectedThread.conversation.length} messages
                      </span>
                      {selectedThread.metrics && (
                        <>
                          <span className="text-xs text-ink-500">
                            <Clock className="w-3 h-3 inline mr-1" />
                            {Math.round(selectedThread.metrics.total_latency_ms)}ms
                          </span>
                          {selectedThread.metrics.has_error && (
                            <span className="text-xs text-red-400">
                              <AlertTriangle className="w-3 h-3 inline mr-1" />
                              Has errors
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleToggleReviewed}
                      disabled={markingReviewed}
                      className={`btn-ghost text-xs flex items-center gap-1 ${
                        selectedThread.is_reviewed ? "text-accent-teal" : "text-ink-400 hover:text-accent-teal"
                      }`}
                    >
                      {markingReviewed ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : selectedThread.is_reviewed ? (
                        <CheckSquare className="w-3 h-3" />
                      ) : (
                        <Square className="w-3 h-3" />
                      )}
                      {selectedThread.is_reviewed ? "Reviewed" : "Mark Reviewed"}
                    </button>
                    <a
                      href={`https://wandb.ai/ayut/error-analysis-demo/weave/threads/${selectedThread.thread_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-ghost flex items-center gap-1 text-xs"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Weave
                    </a>
                  </div>
                </div>

                {/* Conversation Messages */}
                <div className="space-y-4 max-h-[calc(100vh-580px)] overflow-y-auto pr-2">
                  {selectedThread.conversation.length > 0 ? (
                    selectedThread.conversation.map((msg, idx) => (
                      <ConversationMessage key={`${msg.call_id}-${idx}`} message={msg} index={idx} />
                    ))
                  ) : (
                    <SelectPrompt
                      icon={<MessageSquare className="w-8 h-8" />}
                      title="No conversation data extracted"
                      description={`Raw calls available: ${selectedThread.total_calls}`}
                    />
                  )}
                </div>

                {/* Inline Note-Taking */}
                <div className="border-t border-ink-800 pt-4 mt-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent-gold/20 flex items-center justify-center">
                      <StickyNote className="w-4 h-4 text-accent-gold" />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs font-medium text-accent-gold mb-1 block">Add Note</label>
                      <textarea
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder="Document any issues, observations, or failure patterns you notice..."
                        rows={2}
                        className="w-full text-sm bg-ink-950 border border-ink-700 rounded-lg p-2 resize-none focus:border-accent-gold focus:ring-1 focus:ring-accent-gold"
                      />
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-xs text-ink-500">Notes are saved to Weave and synced to Taxonomy</p>
                        <button
                          onClick={handleAddNote}
                          disabled={!newNote.trim() || addingNote}
                          className="btn-primary text-xs flex items-center gap-1 px-3 py-1.5 disabled:opacity-50"
                        >
                          {addingNote ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                          Add Note
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <SelectPrompt
                icon={<MessageSquare className="w-12 h-12" />}
                title="Select a session to view conversation"
                description="Click on a session from the list"
              />
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

