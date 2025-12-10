"use client";

import { useState, useEffect, useRef } from "react";
import {
  Search,
  MessageCircle,
  MessageSquare,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  SortDesc,
  Clock,
  CheckSquare,
  Square,
  Send,
  StickyNote,
  Filter,
  X,
  Target,
  Zap,
  DollarSign,
  Cpu,
  Cloud,
  CheckCircle,
  AlertCircle,
  Layers,
  ChevronDown,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { formatRelativeTime } from "../../utils/formatters";
import { ConversationMessage } from "../ConversationMessage";
import { Panel, PanelHeader, Badge, ProgressBar, LoadingCards, NoThreadsFound, SelectPrompt, DualRangeSlider } from "../ui";
import * as api from "../../lib/api";

// =============================================================================
// Batch Filter Dropdown Types
// =============================================================================

interface BatchOption {
  id: string;
  name: string;
}

// =============================================================================
// Sync Status Indicator Component
// =============================================================================

function SyncStatusIndicator() {
  const { syncStatus, triggerSync, refreshSyncStatus } = useApp();
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await triggerSync(false);
    } finally {
      // Will be updated by polling
      setTimeout(() => setSyncing(false), 1000);
    }
  };

  useEffect(() => {
    // Refresh sync status on mount
    refreshSyncStatus();
  }, [refreshSyncStatus]);

  const isSyncing = syncStatus?.is_syncing || syncing;
  const lastSyncTime = syncStatus?.last_sync_completed_at;
  const hasError = syncStatus?.status === "error";

  return (
    <div className="flex items-center gap-3 text-xs">
      {/* Status indicator */}
      <div className="flex items-center gap-1.5">
        {isSyncing ? (
          <>
            <Cloud className="w-3.5 h-3.5 text-accent-teal animate-pulse" />
            <span className="text-accent-teal">Syncing...</span>
          </>
        ) : hasError ? (
          <>
            <AlertCircle className="w-3.5 h-3.5 text-red-400" />
            <span className="text-red-400">Sync error</span>
          </>
        ) : (
          <>
            <CheckCircle className="w-3.5 h-3.5 text-accent-teal" />
            <span className="text-ink-400">
              {lastSyncTime ? `Synced ${formatRelativeTime(lastSyncTime)}` : "Ready"}
            </span>
          </>
        )}
      </div>

      {/* Sync button */}
      <button
        onClick={handleSync}
        disabled={isSyncing}
        className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-ink-700 bg-ink-950 hover:bg-ink-900 transition-colors disabled:opacity-50"
        title="Sync threads from Weave"
      >
        <RefreshCw className={`w-3 h-3 ${isSyncing ? "animate-spin" : ""}`} />
        Sync
      </button>
    </div>
  );
}

// =============================================================================
// Thread Card Component (with metrics)
// =============================================================================

interface ThreadCardProps {
  session: {
    id: string;
    turn_count: number;
    total_latency_ms: number;
    total_tokens: number;
    estimated_cost_usd: number;
    has_error: boolean;
    is_reviewed: boolean;
    started_at: string | null;
    primary_model: string | null;
    batch_name: string | null;
  };
  selected: boolean;
  onClick: () => void;
}

function ThreadCard({ session, selected, onClick }: ThreadCardProps) {
  const formatTokens = (tokens: number) => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return tokens.toString();
  };

  const formatCost = (cost: number) => {
    if (cost >= 1) return `$${cost.toFixed(2)}`;
    if (cost >= 0.01) return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(4)}`;
  };

  const formatLatency = (ms: number) => {
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms)}ms`;
  };

  return (
    <button
      onClick={onClick}
      className={`w-full text-left trace-card rounded-lg p-3 ${
        selected ? "ring-2 ring-accent-coral" : ""
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          {/* Header: ID + Review Status + Error */}
          <div className="flex items-center gap-2">
            {session.is_reviewed ? (
              <CheckSquare className="w-3 h-3 text-accent-teal flex-shrink-0" />
            ) : (
              <Square className="w-3 h-3 text-ink-600 flex-shrink-0" />
            )}
            <p className="font-mono text-sm text-sand-200 truncate">{session.id}</p>
            {session.has_error && (
              <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
            )}
          </div>

          {/* Metrics Row */}
          <div className="flex items-center flex-wrap gap-2 mt-2">
            <Badge variant="teal" className="text-xs">
              {session.turn_count} turn{session.turn_count !== 1 ? "s" : ""}
            </Badge>
            
            {session.total_latency_ms > 0 && (
              <span className="flex items-center gap-1 text-xs text-ink-500">
                <Clock className="w-3 h-3" />
                {formatLatency(session.total_latency_ms)}
              </span>
            )}
            
            {session.total_tokens > 0 && (
              <span className="flex items-center gap-1 text-xs text-ink-500">
                <Zap className="w-3 h-3" />
                {formatTokens(session.total_tokens)}
              </span>
            )}
            
            {session.estimated_cost_usd > 0 && (
              <span className="flex items-center gap-1 text-xs text-accent-gold">
                <DollarSign className="w-3 h-3" />
                {formatCost(session.estimated_cost_usd)}
              </span>
            )}
          </div>

          {/* Model & Batch Row */}
          <div className="flex items-center gap-2 mt-1.5">
            {session.primary_model && (
              <span className="flex items-center gap-1 text-xs text-ink-500">
                <Cpu className="w-3 h-3" />
                {session.primary_model.split("/").pop()}
              </span>
            )}
            {session.batch_name && (
              <span className="text-xs text-accent-coral truncate">
                {session.batch_name}
              </span>
            )}
          </div>

          {/* Timestamp */}
          <div className="mt-1 text-xs text-ink-600">
            {session.started_at ? formatRelativeTime(session.started_at) : ""}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-ink-600 flex-shrink-0 mt-1" />
      </div>
    </button>
  );
}

// =============================================================================
// Filter Pill Component
// =============================================================================

interface FilterPillProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  variant?: "coral" | "teal" | "gold" | "plum" | "red";
}

function FilterPill({ active, onClick, children, variant = "coral" }: FilterPillProps) {
  const variants = {
    coral: "bg-accent-coral/20 border-accent-coral text-accent-coral",
    teal: "bg-accent-teal/20 border-accent-teal text-accent-teal",
    gold: "bg-accent-gold/20 border-accent-gold text-accent-gold",
    plum: "bg-accent-plum/20 border-accent-plum text-accent-plum",
    red: "bg-red-500/20 border-red-400 text-red-400",
  };

  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
        active
          ? variants[variant]
          : "bg-ink-950 border-ink-700 text-ink-400 hover:border-ink-600"
      }`}
    >
      {children}
    </button>
  );
}

// =============================================================================
// Main Threads Tab
// =============================================================================

export function ThreadsTab() {
  const {
    // Session state (using sessions for threads)
    sessions,
    selectedSession,
    syncStatus,
    batchReviewProgress,
    loadingSessions,
    loadingSessionDetail,
    
    // Filters
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
    filterMinTurns,
    setFilterMinTurns,
    filterMaxTurns,
    setFilterMaxTurns,
    filterMinTokens,
    setFilterMinTokens,
    filterMaxTokens,
    setFilterMaxTokens,
    filterMinCost,
    setFilterMinCost,
    filterMaxCost,
    setFilterMaxCost,
    filterMinLatency,
    setFilterMinLatency,
    filterMaxLatency,
    setFilterMaxLatency,
    filterReviewed,
    setFilterReviewed,
    filterHasError,
    setFilterHasError,
    filterBatchId,
    setFilterBatchId,
    filterBatchName,
    setFilterBatchName,
    filterRanges,
    loadingFilterRanges,
    fetchFilterRanges,

    // Actions
    fetchSessions,
    fetchSessionDetail,
    markSessionReviewed,
    unmarkSessionReviewed,
    addSessionNote,
  } = useApp();

  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [markingReviewed, setMarkingReviewed] = useState(false);
  const [activeRangeFilters, setActiveRangeFilters] = useState<Set<"turns" | "tokens" | "cost" | "latency">>(new Set());
  const [showAddFilter, setShowAddFilter] = useState(false);
  const addFilterRef = useRef<HTMLDivElement>(null);

  // Batch filter state
  const [batchOptions, setBatchOptions] = useState<BatchOption[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [showBatchDropdown, setShowBatchDropdown] = useState(false);
  const batchDropdownRef = useRef<HTMLDivElement>(null);

  // Fetch batch options on mount
  useEffect(() => {
    const fetchBatches = async () => {
      setLoadingBatches(true);
      try {
        const data = await api.fetchBatchOptions();
        setBatchOptions(data.batches || []);
      } catch (error) {
        console.error("Error fetching batch options:", error);
      } finally {
        setLoadingBatches(false);
      }
    };
    fetchBatches();
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (addFilterRef.current && !addFilterRef.current.contains(event.target as Node)) {
        setShowAddFilter(false);
      }
      if (batchDropdownRef.current && !batchDropdownRef.current.contains(event.target as Node)) {
        setShowBatchDropdown(false);
      }
    };
    if (showAddFilter || showBatchDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showAddFilter, showBatchDropdown]);

  // Filter threads by search query (client-side)
  const filteredSessions = sessions.filter((session) => {
    if (!searchQuery) return true;
    return session.id.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const handleAddNote = async () => {
    if (!selectedSession || !newNote.trim()) return;
    setAddingNote(true);
    try {
      await addSessionNote(selectedSession.id, newNote);
      setNewNote("");
    } finally {
      setAddingNote(false);
    }
  };

  const handleToggleReviewed = async () => {
    if (!selectedSession) return;
    setMarkingReviewed(true);
    try {
      if (selectedSession.is_reviewed) {
        await unmarkSessionReviewed(selectedSession.id);
      } else {
        await markSessionReviewed(selectedSession.id);
      }
    } finally {
      setMarkingReviewed(false);
    }
  };

  const handleBatchSelect = (batchId: string | null, batchName: string | null) => {
    setFilterBatchId(batchId);
    setFilterBatchName(batchName);
    setShowBatchDropdown(false);
  };

  const clearAllFilters = () => {
    setFilterMinTurns(null);
    setFilterMaxTurns(null);
    setFilterMinTokens(null);
    setFilterMaxTokens(null);
    setFilterMinCost(null);
    setFilterMaxCost(null);
    setFilterMinLatency(null);
    setFilterMaxLatency(null);
    setFilterReviewed(null);
    setFilterHasError(null);
    setFilterBatchId(null);
    setFilterBatchName(null);
    setSearchQuery("");
    setActiveRangeFilters(new Set());
    setShowAddFilter(false);
  };

  const hasActiveFilters = 
    filterMinTurns !== null || 
    filterMaxTurns !== null || 
    filterMinTokens !== null || 
    filterMaxTokens !== null || 
    filterMinCost !== null || 
    filterMaxCost !== null ||
    filterMinLatency !== null ||
    filterMaxLatency !== null ||
    filterReviewed !== null || 
    filterHasError !== null || 
    filterBatchId !== null;
    
  // Check if a range filter has been modified from default bounds
  const isRangeModified = (type: "turns" | "tokens" | "cost" | "latency") => {
    if (!filterRanges) return false;
    const ranges = filterRanges[type];
    switch (type) {
      case "turns":
        return (filterMinTurns !== null && filterMinTurns > ranges.min) || 
               (filterMaxTurns !== null && filterMaxTurns < ranges.max);
      case "tokens":
        return (filterMinTokens !== null && filterMinTokens > ranges.min) || 
               (filterMaxTokens !== null && filterMaxTokens < ranges.max);
      case "cost":
        return (filterMinCost !== null && filterMinCost > ranges.min) || 
               (filterMaxCost !== null && filterMaxCost < ranges.max);
      case "latency":
        return (filterMinLatency !== null && filterMinLatency > ranges.min) || 
               (filterMaxLatency !== null && filterMaxLatency < ranges.max);
    }
  };

  // Add a new range filter
  const addRangeFilter = (type: "turns" | "tokens" | "cost" | "latency") => {
    setActiveRangeFilters(prev => new Set(Array.from(prev).concat(type)));
    setShowAddFilter(false);
  };

  // Remove a range filter and reset its values
  const removeRangeFilter = (type: "turns" | "tokens" | "cost" | "latency") => {
    setActiveRangeFilters(prev => {
      const next = new Set(prev);
      next.delete(type);
      return next;
    });
    // Reset the filter values
    switch (type) {
      case "turns":
        setFilterMinTurns(null);
        setFilterMaxTurns(null);
        break;
      case "tokens":
        setFilterMinTokens(null);
        setFilterMaxTokens(null);
        break;
      case "cost":
        setFilterMinCost(null);
        setFilterMaxCost(null);
        break;
      case "latency":
        setFilterMinLatency(null);
        setFilterMaxLatency(null);
        break;
    }
  };

  // Get available filters (not yet added)
  const availableFilters = (["turns", "tokens", "cost", "latency"] as const).filter(
    f => !activeRangeFilters.has(f)
  );

  // Get display label for filter type
  const getFilterLabel = (type: "turns" | "tokens" | "cost" | "latency") => {
    switch (type) {
      case "turns": return "Turns";
      case "tokens": return "Tokens";
      case "cost": return "Cost ($)";
      case "latency": return "Latency";
    }
  };

  // Get the current batch display name
  const getCurrentBatchDisplay = () => {
    if (!filterBatchId) return "All Threads";
    if (filterBatchId === "__organic__") return "Organic (no batch)";
    return filterBatchName || filterBatchId;
  };

  return (
    <div className="space-y-4">
      {/* Batch Filter Indicator - shown when filtering by specific batch */}
      {filterBatchId && filterBatchId !== "__organic__" && (
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

      {/* Batch Review Progress (when filtering by batch) */}
      {batchReviewProgress && filterBatchId && filterBatchId !== "__organic__" && (
        <Panel>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display text-sm font-semibold text-sand-100 flex items-center gap-2">
              <Target className="w-4 h-4 text-accent-coral" />
              Reviewing: {batchReviewProgress.batch_name || "Batch"}
            </h3>
            <span className="text-xs text-ink-400">
              {batchReviewProgress.reviewed_sessions} / {batchReviewProgress.total_sessions} reviewed
            </span>
          </div>
          <ProgressBar 
            value={batchReviewProgress.progress_percent} 
            gradientFrom="from-accent-coral"
            gradientTo="to-accent-gold"
          />
          <div className="flex items-center justify-between mt-2 text-xs text-ink-500">
            <span>{batchReviewProgress.unreviewed_sessions} remaining</span>
            {batchReviewProgress.last_review_at && (
              <span>Last reviewed: {formatRelativeTime(batchReviewProgress.last_review_at)}</span>
            )}
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* Left Panel - Thread List */}
        <div className="col-span-4 space-y-4 min-w-0">
          <Panel className="overflow-hidden">
            {/* Header with Sync Status */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg text-sand-100 flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-accent-coral" />
                Threads
                <Badge variant="coral">{sessions.length}</Badge>
              </h2>
              <SyncStatusIndicator />
            </div>

            {/* Search */}
            <div className="mb-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
                <input
                  type="text"
                  placeholder="Search threads..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 text-sm"
                />
              </div>
            </div>

            {/* Sort & Filter Controls */}
            <div className="mb-3 space-y-2">
              {/* Batch Filter Dropdown */}
              <div className="relative" ref={batchDropdownRef}>
                <button
                  onClick={() => setShowBatchDropdown(!showBatchDropdown)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs bg-ink-950 border border-ink-700 rounded-lg hover:border-ink-600 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-accent-coral" />
                    <span className="text-sand-200">{getCurrentBatchDisplay()}</span>
                  </div>
                  <ChevronDown className={`w-3.5 h-3.5 text-ink-500 transition-transform ${showBatchDropdown ? 'rotate-180' : ''}`} />
                </button>

                {showBatchDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-ink-900 border border-ink-700 rounded-lg shadow-lg z-20 py-1 max-h-[280px] overflow-y-auto">
                    {/* All Threads option */}
                    <button
                      onClick={() => handleBatchSelect(null, null)}
                      className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2 ${
                        !filterBatchId 
                          ? 'bg-accent-coral/10 text-accent-coral' 
                          : 'text-sand-200 hover:bg-ink-800'
                      }`}
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      All Threads
                    </button>

                    {/* Organic option */}
                    <button
                      onClick={() => handleBatchSelect("__organic__", "Organic (no batch)")}
                      className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2 ${
                        filterBatchId === "__organic__" 
                          ? 'bg-accent-coral/10 text-accent-coral' 
                          : 'text-sand-200 hover:bg-ink-800'
                      }`}
                    >
                      <Target className="w-3.5 h-3.5" />
                      Organic (no batch)
                    </button>

                    {/* Divider */}
                    {batchOptions.length > 0 && (
                      <div className="border-t border-ink-700 my-1" />
                    )}

                    {/* Batch options */}
                    {loadingBatches ? (
                      <div className="px-3 py-2 text-xs text-ink-500">Loading batches...</div>
                    ) : batchOptions.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-ink-500">No batches found</div>
                    ) : (
                      batchOptions.map((batch) => (
                        <button
                          key={batch.id}
                          onClick={() => handleBatchSelect(batch.id, batch.name)}
                          className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2 ${
                            filterBatchId === batch.id 
                              ? 'bg-accent-coral/10 text-accent-coral' 
                              : 'text-sand-200 hover:bg-ink-800'
                          }`}
                        >
                          <Zap className="w-3.5 h-3.5" />
                          <span className="truncate">{batch.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Sort Controls */}
              <div className="flex items-center gap-2">
                <SortDesc className="w-4 h-4 text-ink-500" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="flex-1 text-xs bg-ink-950 border border-ink-700 rounded px-2 py-1"
                >
                  <option value="started_at">Time</option>
                  <option value="turn_count">Turns</option>
                  <option value="total_tokens">Tokens</option>
                  <option value="estimated_cost_usd">Cost</option>
                  <option value="total_latency_ms">Latency</option>
                </select>
                <button
                  onClick={() => setSortDirection((d) => (d === "desc" ? "asc" : "desc"))}
                  className="px-2 py-1 bg-ink-950 border border-ink-700 rounded text-xs flex items-center gap-1"
                  title={sortDirection === "desc" ? "Descending" : "Ascending"}
                >
                  {sortDirection === "desc" ? "↓ Desc" : "↑ Asc"}
                </button>
              </div>

              {/* Active Range Filters - Stacked Cards */}
              {filterRanges && activeRangeFilters.size > 0 && (
                <div className="space-y-2">
                  {activeRangeFilters.has("turns") && (
                    <div className="bg-ink-950 border border-ink-700 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-accent-teal">Turns</span>
                        <button
                          onClick={() => removeRangeFilter("turns")}
                          className="text-ink-500 hover:text-red-400 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <DualRangeSlider
                        min={filterRanges.turns.min}
                        max={filterRanges.turns.max}
                        valueMin={filterMinTurns ?? filterRanges.turns.min}
                        valueMax={filterMaxTurns ?? filterRanges.turns.max}
                        step={1}
                        onChange={(min, max) => {
                          setFilterMinTurns(min === filterRanges.turns.min ? null : min);
                          setFilterMaxTurns(max === filterRanges.turns.max ? null : max);
                        }}
                      />
                    </div>
                  )}
                  {activeRangeFilters.has("tokens") && (
                    <div className="bg-ink-950 border border-ink-700 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-accent-teal">Tokens</span>
                        <button
                          onClick={() => removeRangeFilter("tokens")}
                          className="text-ink-500 hover:text-red-400 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <DualRangeSlider
                        min={filterRanges.tokens.min}
                        max={filterRanges.tokens.max}
                        valueMin={filterMinTokens ?? filterRanges.tokens.min}
                        valueMax={filterMaxTokens ?? filterRanges.tokens.max}
                        step={100}
                        onChange={(min, max) => {
                          setFilterMinTokens(min === filterRanges.tokens.min ? null : min);
                          setFilterMaxTokens(max === filterRanges.tokens.max ? null : max);
                        }}
                      />
                    </div>
                  )}
                  {activeRangeFilters.has("cost") && (
                    <div className="bg-ink-950 border border-ink-700 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-accent-gold">Cost ($)</span>
                        <button
                          onClick={() => removeRangeFilter("cost")}
                          className="text-ink-500 hover:text-red-400 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <DualRangeSlider
                        min={filterRanges.cost.min}
                        max={filterRanges.cost.max}
                        valueMin={filterMinCost ?? filterRanges.cost.min}
                        valueMax={filterMaxCost ?? filterRanges.cost.max}
                        step={0.0001}
                        formatValue={(v) => `$${v.toFixed(4)}`}
                        onChange={(min, max) => {
                          setFilterMinCost(min === filterRanges.cost.min ? null : min);
                          setFilterMaxCost(max === filterRanges.cost.max ? null : max);
                        }}
                      />
                    </div>
                  )}
                  {activeRangeFilters.has("latency") && (
                    <div className="bg-ink-950 border border-ink-700 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-accent-coral">Latency</span>
                        <button
                          onClick={() => removeRangeFilter("latency")}
                          className="text-ink-500 hover:text-red-400 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <DualRangeSlider
                        min={filterRanges.latency.min}
                        max={filterRanges.latency.max}
                        valueMin={filterMinLatency ?? filterRanges.latency.min}
                        valueMax={filterMaxLatency ?? filterRanges.latency.max}
                        step={100}
                        formatValue={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`}
                        onChange={(min, max) => {
                          setFilterMinLatency(min === filterRanges.latency.min ? null : min);
                          setFilterMaxLatency(max === filterRanges.latency.max ? null : max);
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Add Filter Button & Dropdown */}
              {availableFilters.length > 0 && (
                <div className="relative" ref={addFilterRef}>
                  <button
                    onClick={() => setShowAddFilter(!showAddFilter)}
                    className="flex items-center gap-1.5 text-xs text-ink-400 hover:text-accent-teal transition-colors px-2 py-1 border border-dashed border-ink-700 hover:border-accent-teal/50 rounded"
                  >
                    <Filter className="w-3 h-3" />
                    Add Range Filter
                  </button>
                  {showAddFilter && (
                    <div className="absolute top-full left-0 mt-1 bg-ink-900 border border-ink-700 rounded-lg shadow-lg z-10 py-1 min-w-[140px]">
                      {availableFilters.map((filter) => (
                        <button
                          key={filter}
                          onClick={() => addRangeFilter(filter)}
                          className="w-full text-left px-3 py-1.5 text-xs text-sand-200 hover:bg-ink-800 transition-colors flex items-center gap-2"
                        >
                          {filter === "turns" && <MessageCircle className="w-3 h-3 text-accent-teal" />}
                          {filter === "tokens" && <Zap className="w-3 h-3 text-accent-teal" />}
                          {filter === "cost" && <DollarSign className="w-3 h-3 text-accent-gold" />}
                          {filter === "latency" && <Clock className="w-3 h-3 text-accent-coral" />}
                          {getFilterLabel(filter)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Quick Filter Pills */}
              <div className="flex flex-wrap gap-1">
                <FilterPill
                  active={filterReviewed === false}
                  onClick={() => setFilterReviewed(filterReviewed === false ? null : false)}
                  variant="gold"
                >
                  Not Reviewed
                </FilterPill>
                <FilterPill
                  active={filterReviewed === true}
                  onClick={() => setFilterReviewed(filterReviewed === true ? null : true)}
                  variant="teal"
                >
                  Reviewed
                </FilterPill>
                <FilterPill
                  active={filterHasError === true}
                  onClick={() => setFilterHasError(filterHasError === true ? null : true)}
                  variant="red"
                >
                  Has Errors
                </FilterPill>
              </div>

              {/* Clear filters */}
              {hasActiveFilters && (
                <button
                  onClick={clearAllFilters}
                  className="text-xs text-ink-400 hover:text-sand-200 flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  Clear all filters
                </button>
              )}
            </div>

            {/* Thread List */}
            <div className="space-y-2 max-h-[calc(100vh-520px)] overflow-y-auto">
              {loadingSessions ? (
                <LoadingCards count={5} />
              ) : filteredSessions.length === 0 ? (
                <NoThreadsFound />
              ) : (
                filteredSessions.map((session) => (
                  <ThreadCard
                    key={session.id}
                    session={session}
                    selected={selectedSession?.id === session.id}
                    onClick={() => fetchSessionDetail(session.id)}
                  />
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

            {loadingSessionDetail ? (
              <div className="space-y-4">
                <div className="h-8 shimmer rounded w-1/3" />
                <div className="h-24 shimmer rounded" />
                <div className="h-24 shimmer rounded" />
              </div>
            ) : selectedSession ? (
              <div className="space-y-4 animate-fade-in">
                {/* Thread Info Header */}
                <div className="flex items-center justify-between bg-ink-950 rounded-lg p-3 border border-ink-800">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-accent-coral text-sm">{selectedSession.id}</p>
                      {selectedSession.is_reviewed && (
                        <Badge variant="teal" className="text-xs">
                          Reviewed
                        </Badge>
                      )}
                      {selectedSession.has_error && (
                        <Badge variant="coral" className="text-xs">
                          Error
                        </Badge>
                      )}
                    </div>
                    {/* Metrics Row */}
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-ink-500">
                        {selectedSession.call_count} calls · {selectedSession.conversation.length} messages
                      </span>
                      <span className="text-xs text-ink-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {Math.round(selectedSession.total_latency_ms)}ms
                      </span>
                      {selectedSession.total_tokens > 0 && (
                        <span className="text-xs text-ink-500 flex items-center gap-1">
                          <Zap className="w-3 h-3" />
                          {selectedSession.total_tokens.toLocaleString()} tokens
                        </span>
                      )}
                      {selectedSession.estimated_cost_usd > 0 && (
                        <span className="text-xs text-accent-gold flex items-center gap-1">
                          <DollarSign className="w-3 h-3" />
                          ${selectedSession.estimated_cost_usd.toFixed(4)}
                        </span>
                      )}
                      {selectedSession.primary_model && (
                        <span className="text-xs text-ink-500 flex items-center gap-1">
                          <Cpu className="w-3 h-3" />
                          {selectedSession.primary_model}
                        </span>
                      )}
                    </div>
                    {/* Batch Context */}
                    {selectedSession.batch_name && (
                      <div className="mt-1 text-xs text-accent-coral">
                        From batch: {selectedSession.batch_name}
                      </div>
                    )}
                    {selectedSession.query_text && (
                      <div className="mt-1 text-xs text-ink-400 italic truncate max-w-md">
                        Query: {selectedSession.query_text}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleToggleReviewed}
                      disabled={markingReviewed}
                      className={`btn-ghost text-xs flex items-center gap-1 ${
                        selectedSession.is_reviewed ? "text-accent-teal" : "text-ink-400 hover:text-accent-teal"
                      }`}
                    >
                      {markingReviewed ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : selectedSession.is_reviewed ? (
                        <CheckSquare className="w-3 h-3" />
                      ) : (
                        <Square className="w-3 h-3" />
                      )}
                      {selectedSession.is_reviewed ? "Reviewed" : "Mark Reviewed"}
                    </button>
                  </div>
                </div>

                {/* Error Summary */}
                {selectedSession.error_summary && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-red-400 text-sm">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="font-medium">Error</span>
                    </div>
                    <p className="mt-1 text-xs text-red-300">{selectedSession.error_summary}</p>
                  </div>
                )}

                {/* Conversation Messages */}
                <div className="space-y-4 max-h-[calc(100vh-650px)] overflow-y-auto pr-2">
                  {selectedSession.conversation.length > 0 ? (
                    selectedSession.conversation.map((msg, idx) => (
                      <ConversationMessage key={`${msg.call_id}-${idx}`} message={msg} index={idx} />
                    ))
                  ) : (
                    <SelectPrompt
                      icon={<MessageSquare className="w-8 h-8" />}
                      title="No conversation data extracted"
                      description={`Raw calls available: ${selectedSession.call_count}`}
                    />
                  )}
                </div>

                {/* Existing Notes */}
                {selectedSession.notes && selectedSession.notes.length > 0 && (
                  <div className="border-t border-ink-800 pt-4">
                    <h4 className="text-xs font-medium text-ink-400 mb-2">Notes ({selectedSession.notes.length})</h4>
                    <div className="space-y-2">
                      {selectedSession.notes.map((note) => (
                        <div key={note.id} className="bg-accent-gold/10 border border-accent-gold/30 rounded-lg p-2">
                          <p className="text-sm text-sand-200">{note.content}</p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-ink-500">
                            <span className="capitalize">{note.note_type}</span>
                            <span>·</span>
                            <span>{formatRelativeTime(note.created_at)}</span>
                            {note.synced_to_weave && (
                              <>
                                <span>·</span>
                                <span className="text-accent-teal">Synced to Weave</span>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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
                        <p className="text-xs text-ink-500">Notes are saved locally and synced to Weave</p>
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
                title="Select a thread to view conversation"
                description="Click on a thread from the list"
              />
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

