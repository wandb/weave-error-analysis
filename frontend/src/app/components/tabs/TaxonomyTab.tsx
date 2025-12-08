"use client";

import { useState, useEffect } from "react";
import {
  RefreshCw,
  Sparkles,
  Plus,
  TrendingUp,
  Zap,
  ClipboardList,
  AlertTriangle,
  ExternalLink,
  X,
  Target,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Copy,
  Check,
  Trash2,
  CheckCircle2,
  FileText,
  Tag,
  Play,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { formatRelativeTime, getSeverityColor, getSeverityBorder, formatTaxonomyForCopy, formatSingleModeForCopy } from "../../utils/formatters";
import { Panel, PanelHeader, Badge, ProgressBar, Modal, StatusBadge } from "../ui";
import type { TaxonomyNote, AISuggestion, AutoReview, SyntheticBatch } from "../../types";
import * as api from "../../lib/api";

export function TaxonomyTab() {
  const {
    taxonomy,
    loadingTaxonomy,
    syncing,
    categorizing,
    fetchTaxonomy,
    syncNotesFromWeave,
    autoCategorize,
    createFailureMode,
    deleteFailureMode,
    syntheticBatches,
    selectedAgent,
    fetchBatches,
  } = useApp();

  // Local UI state
  const [expandedModes, setExpandedModes] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newModeName, setNewModeName] = useState("");
  const [newModeDescription, setNewModeDescription] = useState("");
  const [newModeSeverity, setNewModeSeverity] = useState("medium");
  const [copiedTaxonomy, setCopiedTaxonomy] = useState(false);
  const [copiedModeId, setCopiedModeId] = useState<string | null>(null);

  // Note selection state
  const [selectedNote, setSelectedNote] = useState<TaxonomyNote | null>(null);
  const [noteSuggestion, setNoteSuggestion] = useState<AISuggestion | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);

  // AI Review state
  const [selectedBatchForReview, setSelectedBatchForReview] = useState<SyntheticBatch | null>(null);
  const [runningAutoReview, setRunningAutoReview] = useState(false);
  const [autoReview, setAutoReview] = useState<AutoReview | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [showReviewReport, setShowReviewReport] = useState(false);
  const [batchDropdownOpen, setBatchDropdownOpen] = useState(false);

  // Get completed batches for AI review
  const completedBatches = syntheticBatches.filter((b) => b.status === "completed");

  // Load batches if we have an agent selected
  useEffect(() => {
    if (selectedAgent && syntheticBatches.length === 0) {
      fetchBatches(selectedAgent.id);
    }
  }, [selectedAgent, syntheticBatches.length, fetchBatches]);

  const toggleModeExpanded = (modeId: string) => {
    const newExpanded = new Set(expandedModes);
    if (newExpanded.has(modeId)) {
      newExpanded.delete(modeId);
    } else {
      newExpanded.add(modeId);
    }
    setExpandedModes(newExpanded);
  };

  const toggleReviewCategory = (categoryName: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryName)) {
        next.delete(categoryName);
      } else {
        next.add(categoryName);
      }
      return next;
    });
  };

  const copyTaxonomyToClipboard = async () => {
    const text = formatTaxonomyForCopy(taxonomy);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTaxonomy(true);
      setTimeout(() => setCopiedTaxonomy(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const copySingleModeToClipboard = async (mode: typeof taxonomy.failure_modes[0]) => {
    const text = formatSingleModeForCopy(mode, taxonomy);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedModeId(mode.id);
      setTimeout(() => setCopiedModeId(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleCreateMode = async () => {
    if (!newModeName.trim()) return;
    try {
      const result = await createFailureMode(newModeName, newModeDescription, newModeSeverity);
      setShowCreateModal(false);
      setNewModeName("");
      setNewModeDescription("");
      setNewModeSeverity("medium");
      
      if (selectedNote) {
        await api.assignNoteToMode(selectedNote.id, result.id, "manual");
        setSelectedNote(null);
        await fetchTaxonomy();
      }
    } catch (error) {
      console.error("Error creating failure mode:", error);
    }
  };

  const suggestCategoryForNote = async (noteId: string) => {
    setLoadingSuggestion(true);
    try {
      const data = await api.suggestCategoryForNote(noteId);
      setNoteSuggestion(data);
    } catch (error) {
      console.error("Error getting suggestion:", error);
    } finally {
      setLoadingSuggestion(false);
    }
  };

  const assignNoteToMode = async (noteId: string, modeId: string, method: string = "manual") => {
    try {
      await api.assignNoteToMode(noteId, modeId, method);
      setSelectedNote(null);
      setNoteSuggestion(null);
      await fetchTaxonomy();
    } catch (error) {
      console.error("Error assigning note:", error);
    }
  };

  const applySuggestion = async () => {
    if (!selectedNote || !noteSuggestion) return;

    if (noteSuggestion.match_type === "existing" && noteSuggestion.existing_mode_id) {
      await assignNoteToMode(selectedNote.id, noteSuggestion.existing_mode_id, "ai_suggested");
    } else if (noteSuggestion.match_type === "new" && noteSuggestion.new_category) {
      const result = await createFailureMode(
        noteSuggestion.new_category.name,
        noteSuggestion.new_category.description,
        noteSuggestion.new_category.severity
      );
      await assignNoteToMode(selectedNote.id, result.id, "ai_suggested");
    }
  };

  // AI Review functions
  const runAutoReview = async (batchId: string) => {
    setRunningAutoReview(true);
    setAutoReview(null);
    
    try {
      const result = await api.runAutoReview(batchId);
      setAutoReview(result);
    } catch (error) {
      console.error("Error running auto-review:", error);
    } finally {
      setRunningAutoReview(false);
    }
  };

  const fetchExistingReview = async (batchId: string) => {
    try {
      const review = await api.fetchLatestReview(batchId);
      if (review) {
        setAutoReview(review);
      }
    } catch (error) {
      console.error("Error fetching review:", error);
    }
  };

  // Load existing review when batch is selected
  useEffect(() => {
    if (selectedBatchForReview) {
      fetchExistingReview(selectedBatchForReview.id);
    } else {
      setAutoReview(null);
    }
  }, [selectedBatchForReview]);

  return (
    <div className="space-y-6">
      {/* Header with Stats and Actions */}
      <div className="grid grid-cols-12 gap-6">
        {/* Saturation Card */}
        <div className="col-span-4">
          <Panel>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-semibold text-moon-50 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-teal" />
                Saturation Tracking
              </h2>
              {taxonomy?.saturation.status === "saturated" && (
                <Badge className="bg-emerald-500/20 text-emerald-400">Saturated</Badge>
              )}
              {taxonomy?.saturation.status === "approaching_saturation" && (
                <Badge className="bg-amber-500/20 text-amber-400">Approaching</Badge>
              )}
              {taxonomy?.saturation.status === "discovering" && (
                <Badge className="bg-blue-500/20 text-blue-400">Discovering</Badge>
              )}
            </div>

            {taxonomy?.saturation ? (
              <div className="space-y-4">
                <p className="text-sm text-moon-450">{taxonomy.saturation.message}</p>
                <ProgressBar
                  value={taxonomy.saturation.saturation_score * 100}
                  label="Saturation Score"
                  sublabel={`${Math.round(taxonomy.saturation.saturation_score * 100)}%`}
                />
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-moon-900/60 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-gold">
                      {taxonomy.stats.total_failure_modes}
                    </div>
                    <div className="text-xs text-moon-500">Failure Modes</div>
                  </div>
                  <div className="bg-moon-900/60 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-amber-400">
                      {taxonomy.stats.total_uncategorized}
                    </div>
                    <div className="text-xs text-moon-500">Uncategorized</div>
                  </div>
                  <div className="bg-moon-900/60 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-teal">
                      {taxonomy.stats.total_categorized}
                    </div>
                    <div className="text-xs text-moon-500">Categorized</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-32 shimmer rounded" />
            )}
          </Panel>
        </div>

        {/* AI Review Card */}
        <div className="col-span-4">
          <Panel>
            <PanelHeader 
              icon={<Sparkles className="w-5 h-5 text-gold" />} 
              title="AI Review" 
            />
            
            {/* Batch Selector */}
            <div className="mb-4">
              <label className="block text-xs text-moon-500 mb-2">Select a completed batch to analyze</label>
              <div className="relative">
                <button
                  onClick={() => setBatchDropdownOpen(!batchDropdownOpen)}
                  className="w-full flex items-center justify-between gap-2 bg-moon-900/60 border border-moon-700 hover:border-moon-600 rounded-lg px-3 py-2.5 text-left transition-colors"
                >
                  {selectedBatchForReview ? (
                    <span className="text-moon-100 truncate">{selectedBatchForReview.name}</span>
                  ) : (
                    <span className="text-moon-500">Choose a batch...</span>
                  )}
                  <ChevronDown className={`w-4 h-4 text-moon-450 transition-transform ${batchDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {batchDropdownOpen && (
                  <>
                    <div 
                      className="fixed inset-0 z-10" 
                      onClick={() => setBatchDropdownOpen(false)} 
                    />
                    <div className="absolute top-full left-0 right-0 mt-1 bg-moon-800 border border-moon-700 rounded-lg shadow-xl z-20 max-h-48 overflow-y-auto">
                      {completedBatches.length > 0 ? (
                        completedBatches.map((batch) => (
                          <button
                            key={batch.id}
                            onClick={() => {
                              setSelectedBatchForReview(batch);
                              setBatchDropdownOpen(false);
                            }}
                            className={`w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors ${
                              selectedBatchForReview?.id === batch.id
                                ? "bg-gold/10 border-l-2 border-l-gold"
                                : "hover:bg-moon-700/50 border-l-2 border-l-transparent"
                            }`}
                          >
                            <div className="min-w-0">
                              <span className="text-moon-200 text-sm block truncate">{batch.name}</span>
                              <span className="text-xs text-moon-500">{batch.query_count} queries</span>
                            </div>
                            {selectedBatchForReview?.id === batch.id && (
                              <CheckCircle2 className="w-4 h-4 text-gold flex-shrink-0" />
                            )}
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-4 text-center text-moon-500 text-sm">
                          No completed batches available
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Review Status / Actions */}
            {selectedBatchForReview ? (
              <div className="space-y-3">
                {runningAutoReview ? (
                  <div className="text-center py-4">
                    <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-gold/20 flex items-center justify-center">
                      <RefreshCw className="w-5 h-5 text-gold animate-spin" />
                    </div>
                    <p className="text-moon-200 text-sm font-medium">Analyzing traces...</p>
                    <p className="text-xs text-moon-500 mt-1">This may take a few minutes</p>
                  </div>
                ) : autoReview ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-moon-900/50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${
                          autoReview.status === "completed" ? "bg-emerald-400" : 
                          autoReview.status === "failed" ? "bg-red-400" : "bg-amber-400"
                        }`} />
                        <span className="text-sm text-moon-200">
                          {autoReview.failure_categories.filter(c => c.count > 0).length} categories found
                        </span>
                      </div>
                      <span className="text-xs text-moon-500">
                        {autoReview.total_traces} traces
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => runAutoReview(selectedBatchForReview.id)}
                        className="flex-1 btn-ghost text-sm flex items-center justify-center gap-2"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Re-run
                      </button>
                      <button
                        onClick={() => setShowReviewReport(!showReviewReport)}
                        className="flex-1 btn-ghost text-sm flex items-center justify-center gap-2"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        {showReviewReport ? "Hide" : "Show"} Report
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => runAutoReview(selectedBatchForReview.id)}
                    className="w-full btn-primary py-2.5 flex items-center justify-center gap-2"
                  >
                    <Play className="w-4 h-4" />
                    Run AI Review
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center py-4 text-moon-500">
                <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Select a batch to discover failure patterns with AI</p>
              </div>
            )}
          </Panel>
        </div>

        {/* Actions Card */}
        <div className="col-span-4">
          <Panel>
            <PanelHeader icon={<Zap className="w-5 h-5 text-teal" />} title="Quick Actions" />
            <div className="grid grid-cols-2 gap-3">
              <ActionCard
                icon={<RefreshCw className={`w-4 h-4 text-teal ${syncing ? "animate-spin" : ""}`} />}
                title="Sync from Weave"
                onClick={syncNotesFromWeave}
                disabled={syncing}
                iconBg="bg-teal/20"
              />
              <ActionCard
                icon={categorizing ? <RefreshCw className="w-4 h-4 text-gold animate-spin" /> : <Sparkles className="w-4 h-4 text-gold" />}
                title="Auto-Categorize"
                onClick={autoCategorize}
                disabled={categorizing || !taxonomy?.uncategorized_notes.length}
                iconBg="bg-gold/20"
              />
              <ActionCard
                icon={<Plus className="w-4 h-4 text-emerald-400" />}
                title="New Failure Mode"
                onClick={() => setShowCreateModal(true)}
                iconBg="bg-emerald-500/20"
              />
              <ActionCard
                icon={<RefreshCw className={`w-4 h-4 text-moon-400 ${loadingTaxonomy ? "animate-spin" : ""}`} />}
                title="Refresh"
                onClick={fetchTaxonomy}
                disabled={loadingTaxonomy}
                iconBg="bg-moon-700"
              />
            </div>
          </Panel>
        </div>
      </div>

      {/* AI Review Results (when expanded) */}
      {autoReview && showReviewReport && (
        <Panel>
          <div className="flex items-center justify-between mb-4">
            <PanelHeader 
              icon={<Sparkles className="w-5 h-5 text-gold" />} 
              title="AI Review Results"
              badge={<Badge variant="gold">{autoReview.failure_categories.filter(c => c.count > 0).length} categories</Badge>}
            />
            <button
              onClick={() => setShowReviewReport(false)}
              className="btn-ghost p-1.5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          
          <AutoReviewResults
            review={autoReview}
            expandedCategories={expandedCategories}
            toggleCategory={toggleReviewCategory}
          />
        </Panel>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-12 gap-6">
        {/* Uncategorized Notes */}
        <div className="col-span-4">
          <Panel>
            <PanelHeader
              icon={<ClipboardList className="w-5 h-5 text-amber-400" />}
              title="Uncategorized"
              badge={<Badge variant="gold">{taxonomy?.uncategorized_notes.length || 0}</Badge>}
            />

            <div className="space-y-2 max-h-[calc(100vh-480px)] overflow-y-auto">
              {taxonomy?.uncategorized_notes.length ? (
                taxonomy.uncategorized_notes.map((note) => (
                  <div
                    key={note.id}
                    onClick={() => {
                      setSelectedNote(note);
                      setNoteSuggestion(null);
                    }}
                    className={`bg-moon-900/60 rounded-lg p-3 cursor-pointer hover:bg-moon-900 transition-colors border ${
                      selectedNote?.id === note.id ? "border-gold" : "border-transparent"
                    }`}
                  >
                    <p className="text-sm text-moon-300 line-clamp-3">{note.content}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-moon-600">{formatRelativeTime(note.created_at)}</span>
                      {note.weave_url && (
                        <a
                          href={note.weave_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-gold hover:text-gold/80 flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-moon-500 text-sm">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>All notes categorized!</p>
                  <p className="text-xs mt-1">Sync to pull new notes from Weave</p>
                </div>
              )}
            </div>

            {/* Note Assignment Panel */}
            {selectedNote && (
              <NoteAssignmentPanel
                note={selectedNote}
                suggestion={noteSuggestion}
                loadingSuggestion={loadingSuggestion}
                failureModes={taxonomy?.failure_modes || []}
                onClose={() => {
                  setSelectedNote(null);
                  setNoteSuggestion(null);
                }}
                onSuggest={() => suggestCategoryForNote(selectedNote.id)}
                onAssign={(modeId) => assignNoteToMode(selectedNote.id, modeId)}
                onApplySuggestion={applySuggestion}
              />
            )}
          </Panel>
        </div>

        {/* Failure Modes */}
        <div className="col-span-8">
          <Panel>
            <PanelHeader
              icon={<AlertTriangle className="w-5 h-5 text-red-400" />}
              title="Failure Modes"
              badge={<Badge variant="coral">{taxonomy?.failure_modes.length || 0}</Badge>}
              actions={
                taxonomy?.failure_modes.length ? (
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
                ) : null
              }
            />

            <div className="space-y-3 max-h-[calc(100vh-400px)] overflow-y-auto">
              {taxonomy?.failure_modes.length ? (
                taxonomy.failure_modes.map((mode) => (
                  <FailureModeCard
                    key={mode.id}
                    mode={mode}
                    notes={taxonomy.notes}
                    expanded={expandedModes.has(mode.id)}
                    copiedId={copiedModeId}
                    onToggle={() => toggleModeExpanded(mode.id)}
                    onCopy={() => copySingleModeToClipboard(mode)}
                    onDelete={() => {
                      if (confirm("Delete this failure mode? Notes will be moved to uncategorized.")) {
                        deleteFailureMode(mode.id);
                      }
                    }}
                  />
                ))
              ) : (
                <div className="text-center py-16 text-moon-500">
                  <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p className="text-lg">No failure modes yet</p>
                  <p className="mt-2 max-w-md mx-auto text-sm">
                    Sync notes from Weave, then use Auto-Categorize to discover failure patterns automatically.
                  </p>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>

      {/* Create Failure Mode Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Failure Mode"
        footer={
          <>
            <button onClick={() => setShowCreateModal(false)} className="btn-ghost">
              Cancel
            </button>
            <button onClick={handleCreateMode} disabled={!newModeName.trim()} className="btn-primary">
              Create
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-moon-450 mb-1">Name</label>
            <input
              type="text"
              value={newModeName}
              onChange={(e) => setNewModeName(e.target.value)}
              placeholder="e.g., Hallucination"
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-sm text-moon-450 mb-1">Description</label>
            <textarea
              value={newModeDescription}
              onChange={(e) => setNewModeDescription(e.target.value)}
              placeholder="Describe this failure pattern..."
              rows={3}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-sm text-moon-450 mb-1">Severity</label>
            <select value={newModeSeverity} onChange={(e) => setNewModeSeverity(e.target.value)} className="w-full">
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// Sub-components

function ActionCard({
  icon,
  title,
  onClick,
  disabled,
  iconBg,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  iconBg: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="bg-moon-900/60 hover:bg-moon-900 rounded-lg p-3 border border-moon-800 hover:border-moon-700 transition-colors text-left group disabled:opacity-50"
    >
      <div className="flex items-center gap-2.5">
        <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
          {icon}
        </div>
        <span className="text-sm font-medium text-moon-200">{title}</span>
      </div>
    </button>
  );
}

function NoteAssignmentPanel({
  note,
  suggestion,
  loadingSuggestion,
  failureModes,
  onClose,
  onSuggest,
  onAssign,
  onApplySuggestion,
}: {
  note: TaxonomyNote;
  suggestion: AISuggestion | null;
  loadingSuggestion: boolean;
  failureModes: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSuggest: () => void;
  onAssign: (modeId: string) => void;
  onApplySuggestion: () => void;
}) {
  return (
    <div className="mt-4 pt-4 border-t border-moon-800">
      <div className="bg-moon-900/60 rounded-lg p-3 border border-gold/30">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gold">Selected Note</span>
          <button onClick={onClose} className="text-moon-500 hover:text-moon-300">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-moon-300 mb-3 line-clamp-2">{note.content}</p>

        <button
          onClick={onSuggest}
          disabled={loadingSuggestion}
          className="w-full btn-primary text-sm flex items-center justify-center gap-2 mb-2"
        >
          {loadingSuggestion ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Get AI Suggestion
        </button>

        {suggestion && (
          <div className="mt-3 p-3 bg-moon-900 rounded-lg border border-moon-700">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-gold" />
              <span className="text-xs font-medium text-gold">AI Suggestion</span>
            </div>

            {suggestion.match_type === "existing" ? (
              <div>
                <p className="text-sm text-moon-300">
                  Matches existing:{" "}
                  <strong className="text-teal">
                    {failureModes.find((m) => m.id === suggestion.existing_mode_id)?.name}
                  </strong>
                </p>
                <p className="text-xs text-moon-500 mt-1">Confidence: {Math.round(suggestion.confidence * 100)}%</p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-moon-300">
                  New category: <strong className="text-emerald-400">{suggestion.new_category?.name}</strong>
                </p>
                <p className="text-xs text-moon-500 mt-1">{suggestion.new_category?.description}</p>
              </div>
            )}

            <p className="text-xs text-moon-500 mt-2 italic">{suggestion.reasoning}</p>

            <button
              onClick={onApplySuggestion}
              className="w-full mt-3 btn-ghost text-sm flex items-center justify-center gap-2 border border-gold/30 hover:bg-gold/10"
            >
              <CheckCircle2 className="w-4 h-4" />
              Apply Suggestion
            </button>
          </div>
        )}

        <div className="mt-3">
          <span className="text-xs text-moon-500 block mb-2">Or assign manually:</span>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {failureModes.map((mode) => (
              <button
                key={mode.id}
                onClick={() => onAssign(mode.id)}
                className="w-full text-left text-xs px-2 py-1.5 rounded bg-moon-900 hover:bg-moon-800 text-moon-300 flex items-center justify-between"
              >
                <span className="truncate">{mode.name}</span>
                <ArrowRight className="w-3 h-3 text-moon-500" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FailureModeCard({
  mode,
  notes,
  expanded,
  copiedId,
  onToggle,
  onCopy,
  onDelete,
}: {
  mode: {
    id: string;
    name: string;
    description: string;
    severity: string;
    suggested_fix: string | null;
    created_at: string;
    last_seen_at: string;
    times_seen: number;
    note_ids: string[];
  };
  notes?: Array<{ id: string; content: string; weave_url: string }>;
  expanded: boolean;
  copiedId: string | null;
  onToggle: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const modeNotes = notes?.filter((n) => mode.note_ids.includes(n.id)) || [];

  return (
    <div className={`bg-moon-900/60 rounded-lg border-l-4 ${getSeverityBorder(mode.severity)} hover:bg-moon-900/80 transition-colors`}>
      <div className="p-4 cursor-pointer" onClick={onToggle}>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-moon-100">{mode.name}</h3>
              <span className={`badge text-xs ${getSeverityColor(mode.severity)}`}>{mode.severity}</span>
            </div>
            <p className="text-sm text-moon-450 mt-1 line-clamp-2">{mode.description}</p>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <Badge variant="plum" className="text-xs">
              {mode.times_seen} note{mode.times_seen !== 1 ? "s" : ""}
            </Badge>
            {expanded ? <ChevronUp className="w-4 h-4 text-moon-500" /> : <ChevronDown className="w-4 h-4 text-moon-500" />}
          </div>
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs text-moon-500">
          <span>Created {formatRelativeTime(mode.created_at)}</span>
          <span>Last seen {formatRelativeTime(mode.last_seen_at)}</span>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-moon-800 pt-3 space-y-3">
          {mode.suggested_fix && (
            <div className="flex items-start gap-2 p-2 bg-moon-900 rounded-lg">
              <Sparkles className="w-4 h-4 text-teal flex-shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-medium text-teal">Suggested Fix</span>
                <p className="text-sm text-moon-300 mt-1">{mode.suggested_fix}</p>
              </div>
            </div>
          )}

          {modeNotes.length > 0 && (
            <div>
              <span className="text-xs font-medium text-moon-450 block mb-2">Notes ({mode.note_ids.length})</span>
              <div className="space-y-1">
                {modeNotes.slice(0, 3).map((note) => (
                  <div key={note.id} className="text-xs text-moon-400 bg-moon-900 rounded p-2 flex items-center justify-between">
                    <span className="truncate flex-1">{note.content}</span>
                    {note.weave_url && (
                      <a href={note.weave_url} target="_blank" rel="noopener noreferrer" className="text-gold ml-2">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                ))}
                {mode.note_ids.length > 3 && <p className="text-xs text-moon-500 pl-2">+{mode.note_ids.length - 3} more notes</p>}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button onClick={(e) => { e.stopPropagation(); onCopy(); }} className="btn-ghost text-xs flex items-center">
              {copiedId === mode.id ? (
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
            <button onClick={onDelete} className="btn-ghost text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10">
              <Trash2 className="w-3 h-3 mr-1" />
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Auto Review Results Component
// =============================================================================

function AutoReviewResults({
  review,
  expandedCategories,
  toggleCategory,
}: {
  review: AutoReview;
  expandedCategories: Set<string>;
  toggleCategory: (name: string) => void;
}) {
  const [showReport, setShowReport] = useState(false);
  
  // Sort categories by count
  const sortedCategories = [...review.failure_categories]
    .filter(c => c.count > 0)
    .sort((a, b) => b.count - a.count);
  
  // Calculate percentages
  const total = review.classifications.length;

  return (
    <div className="space-y-4">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusBadge status={review.status} />
          <span className="text-sm text-moon-450">
            {total} traces analyzed
          </span>
        </div>
        <button
          onClick={() => setShowReport(!showReport)}
          className="text-sm text-moon-450 hover:text-moon-200 flex items-center gap-1.5"
        >
          <FileText className="w-4 h-4" />
          {showReport ? "Hide" : "Show"} Markdown Report
        </button>
      </div>

      {/* Failure Categories */}
      {sortedCategories.length > 0 ? (
        <div className="grid grid-cols-2 gap-4">
          {sortedCategories.map((category) => {
            const percentage = total > 0 ? (category.count / total * 100).toFixed(1) : 0;
            const isExpanded = expandedCategories.has(category.name);
            const categoryTraces = review.classifications.filter(
              c => c.failure_category === category.name
            );

            return (
              <div key={category.name} className="border border-moon-700 rounded-lg overflow-hidden">
                {/* Category Header */}
                <button
                  onClick={() => toggleCategory(category.name)}
                  className="w-full p-3 bg-moon-800/50 hover:bg-moon-800 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-moon-500" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-moon-500" />
                    )}
                    <div className="text-left">
                      <span className="text-sm font-medium text-moon-100">
                        {category.name.replace(/_/g, " ")}
                      </span>
                      <p className="text-xs text-moon-500 mt-0.5 line-clamp-1">
                        {category.definition}
                      </p>
                    </div>
                  </div>
                  <Badge variant="amber" className="text-xs">
                    {category.count} ({percentage}%)
                  </Badge>
                </button>

                {/* Category Details */}
                {isExpanded && (
                  <div className="p-3 border-t border-moon-700 bg-moon-900/30 space-y-3">
                    {category.notes && (
                      <p className="text-xs text-moon-450">{category.notes}</p>
                    )}
                    
                    {/* Traces in this category */}
                    <div className="space-y-2">
                      {categoryTraces.slice(0, 3).map((trace, idx) => (
                        <div
                          key={trace.trace_id}
                          className="p-2 bg-moon-800/50 rounded border border-moon-700"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <Tag className="w-3 h-3 text-moon-500" />
                            <span className="text-xs text-moon-500">Trace {idx + 1}</span>
                          </div>
                          {trace.query_text && (
                            <p className="text-xs text-moon-300 mb-1 line-clamp-2">
                              &quot;{trace.query_text}&quot;
                            </p>
                          )}
                          <p className="text-xs text-moon-450">
                            {trace.categorization_reason}
                          </p>
                        </div>
                      ))}
                      {categoryTraces.length > 3 && (
                        <p className="text-xs text-moon-500 text-center">
                          +{categoryTraces.length - 3} more traces
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-8 text-moon-450">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">No failure categories identified</p>
          <p className="text-xs text-moon-500 mt-1">All traces passed review</p>
        </div>
      )}

      {/* Markdown Report */}
      {showReport && review.report_markdown && (
        <div className="mt-4 p-4 bg-moon-900/50 rounded-lg border border-moon-700 max-h-96 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-moon-100">Full Report</h4>
            <button
              onClick={() => {
                navigator.clipboard.writeText(review.report_markdown || "");
              }}
              className="text-xs text-teal hover:underline"
            >
              Copy to clipboard
            </button>
          </div>
          <pre className="text-xs text-moon-400 whitespace-pre-wrap font-mono">
            {review.report_markdown}
          </pre>
        </div>
      )}

      {/* Error message */}
      {review.error_message && (
        <div className="p-3 bg-red-900/20 rounded-lg border border-red-900/30">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-sm text-red-300">Review Error</span>
          </div>
          <p className="text-xs text-red-400">{review.error_message}</p>
        </div>
      )}
    </div>
  );
}
