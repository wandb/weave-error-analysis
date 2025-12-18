"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
  Tag,
  Eye,
  MoreVertical,
  GitMerge,
  Edit3,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import {
  formatRelativeTime,
  getSeverityColor,
  getSeverityBorder,
  formatTaxonomyForCopy,
  formatSingleModeForCopy,
  getStatusColor,
  getStatusLabel,
  getStatusIcon,
  calculateDistributionPercent,
} from "../../utils/formatters";
import { Panel, PanelHeader, Badge, ProgressBar, Modal, StatusBadge, ConfirmDialog } from "../ui";
import { EditPromptButton } from "../PromptEditDrawer";
import { BatchSaturationCharts } from "../BatchSaturationCharts";
import type { TaxonomyNote, AISuggestion, FailureMode, FailureModeStatus } from "../../types";
import * as api from "../../lib/api";

// Status filter options
const STATUS_OPTIONS: { value: FailureModeStatus | "all"; label: string; icon: string }[] = [
  { value: "all", label: "All", icon: "●" },
  { value: "active", label: "Active", icon: "🔴" },
  { value: "investigating", label: "Investigating", icon: "🔧" },
  { value: "resolved", label: "Resolved", icon: "✅" },
  { value: "wont_fix", label: "Won't Fix", icon: "⊘" },
];

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
    setActiveTab,
    fetchSessionDetail,
  } = useApp();

  // Local UI state
  const [expandedModes, setExpandedModes] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newModeName, setNewModeName] = useState("");
  const [newModeDescription, setNewModeDescription] = useState("");
  const [newModeSeverity, setNewModeSeverity] = useState("medium");
  const [copiedTaxonomy, setCopiedTaxonomy] = useState(false);
  const [copiedModeId, setCopiedModeId] = useState<string | null>(null);
  
  // Delete confirmation state
  const [deletingModeId, setDeletingModeId] = useState<string | null>(null);

  // Status filter
  const [statusFilter, setStatusFilter] = useState<FailureModeStatus | "all">("all");

  // Note selection state
  const [selectedNote, setSelectedNote] = useState<TaxonomyNote | null>(null);
  const [noteSuggestion, setNoteSuggestion] = useState<AISuggestion | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);

  // Batch categorization state
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchSuggestions, setBatchSuggestions] = useState<api.BatchSuggestion[]>([]);
  const [loadingBatchSuggestions, setLoadingBatchSuggestions] = useState(false);
  const [batchAssignments, setBatchAssignments] = useState<Map<string, api.BatchApplyAssignment>>(new Map());
  const [applyingBatch, setApplyingBatch] = useState(false);

  // Merge modal state
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [mergeName, setMergeName] = useState("");
  const [merging, setMerging] = useState(false);

  // Inline edit state
  const [editingModeId, setEditingModeId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSeverity, setEditSeverity] = useState("");
  const [editStatus, setEditStatus] = useState<FailureModeStatus>("active");
  const [editSuggestedFix, setEditSuggestedFix] = useState("");
  const [saving, setSaving] = useState(false);

  // Calculate total notes for distribution percentages
  const totalCategorizedNotes = useMemo(() => {
    return taxonomy?.failure_modes.reduce((sum, m) => sum + m.times_seen, 0) || 0;
  }, [taxonomy]);

  // Filter failure modes by status
  const filteredFailureModes = useMemo(() => {
    if (!taxonomy) return [];
    if (statusFilter === "all") return taxonomy.failure_modes;
    return taxonomy.failure_modes.filter((m) => m.status === statusFilter);
  }, [taxonomy, statusFilter]);

  // Count by status
  const statusCounts = useMemo(() => {
    if (!taxonomy) return { all: 0, active: 0, investigating: 0, resolved: 0, wont_fix: 0 };
    const counts = { all: taxonomy.failure_modes.length, active: 0, investigating: 0, resolved: 0, wont_fix: 0 };
    taxonomy.failure_modes.forEach((m) => {
      if (m.status in counts) {
        counts[m.status as keyof typeof counts]++;
      }
    });
    return counts;
  }, [taxonomy]);

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

  // Navigate to Threads tab and show the session for a note
  const handleViewSession = async (sessionId: string) => {
    await fetchSessionDetail(sessionId);
    setActiveTab("threads");
  };

  // Status update handler
  const handleStatusUpdate = async (modeId: string, newStatus: FailureModeStatus) => {
    try {
      await api.updateFailureModeStatus(modeId, newStatus);
      await fetchTaxonomy();
    } catch (error) {
      console.error("Failed to update status:", error);
    }
  };

  // Inline edit handlers
  const startEditing = (mode: FailureMode) => {
    setEditingModeId(mode.id);
    setEditName(mode.name);
    setEditDescription(mode.description);
    setEditSeverity(mode.severity);
    setEditStatus(mode.status);
    setEditSuggestedFix(mode.suggested_fix || "");
  };

  const cancelEditing = () => {
    setEditingModeId(null);
    setEditName("");
    setEditDescription("");
    setEditSeverity("");
    setEditStatus("active");
    setEditSuggestedFix("");
  };

  const saveEditing = async () => {
    if (!editingModeId || !editName.trim()) return;
    setSaving(true);
    try {
      await api.updateFailureMode(editingModeId, {
        name: editName,
        description: editDescription,
        severity: editSeverity,
        status: editStatus,
        suggested_fix: editSuggestedFix || undefined,
      });
      await fetchTaxonomy();
      cancelEditing();
    } catch (error) {
      console.error("Failed to save:", error);
    } finally {
      setSaving(false);
    }
  };

  // Merge handlers
  const openMergeModal = (sourceId: string) => {
    setMergeSourceId(sourceId);
    setMergeTargetId(null);
    const sourceMode = taxonomy?.failure_modes.find((m) => m.id === sourceId);
    setMergeName(sourceMode?.name || "");
    setShowMergeModal(true);
  };

  const handleMerge = async () => {
    if (!mergeSourceId || !mergeTargetId) return;
    setMerging(true);
    try {
      await api.mergeFailureModes(mergeSourceId, mergeTargetId, mergeName || undefined);
      await fetchTaxonomy();
      setShowMergeModal(false);
      setMergeSourceId(null);
      setMergeTargetId(null);
      setMergeName("");
    } catch (error) {
      console.error("Failed to merge:", error);
    } finally {
      setMerging(false);
    }
  };

  // Batch categorization handlers
  const startBatchCategorization = async () => {
    setShowBatchModal(true);
    setLoadingBatchSuggestions(true);
    setBatchSuggestions([]);
    setBatchAssignments(new Map());
    
    try {
      const result = await api.batchSuggestCategories();
      setBatchSuggestions(result.suggestions);
      
      // Initialize assignments with AI suggestions
      const initialAssignments = new Map<string, api.BatchApplyAssignment>();
      for (const suggestion of result.suggestions) {
        const s = suggestion.suggestion;
        if (s.match_type === "existing" && s.existing_mode_id) {
          initialAssignments.set(suggestion.note_id, {
            note_id: suggestion.note_id,
            action: "existing",
            failure_mode_id: s.existing_mode_id,
          });
        } else if (s.match_type === "new" && s.new_category) {
          initialAssignments.set(suggestion.note_id, {
            note_id: suggestion.note_id,
            action: "new",
            new_category: s.new_category,
          });
        } else {
          initialAssignments.set(suggestion.note_id, {
            note_id: suggestion.note_id,
            action: "skip",
          });
        }
      }
      setBatchAssignments(initialAssignments);
    } catch (error) {
      console.error("Failed to get batch suggestions:", error);
    } finally {
      setLoadingBatchSuggestions(false);
    }
  };

  const updateBatchAssignment = (noteId: string, assignment: api.BatchApplyAssignment) => {
    setBatchAssignments((prev) => {
      const next = new Map(prev);
      next.set(noteId, assignment);
      return next;
    });
  };

  const applyBatchCategorization = async () => {
    setApplyingBatch(true);
    try {
      const assignments = Array.from(batchAssignments.values());
      await api.batchApplyCategories(assignments);
      setShowBatchModal(false);
      fetchTaxonomy();
    } catch (error) {
      console.error("Failed to apply batch categorization:", error);
    } finally {
      setApplyingBatch(false);
    }
  };

  const getBatchStats = () => {
    let confirmed = 0;
    let newModes = 0;
    let skipped = 0;
    
    batchAssignments.forEach((a) => {
      if (a.action === "existing") confirmed++;
      else if (a.action === "new") newModes++;
      else skipped++;
    });
    
    return { confirmed, newModes, skipped, total: batchAssignments.size };
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

  const copySingleModeToClipboard = async (mode: FailureMode) => {
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

  return (
    <div className="space-y-4">
      {/* ========================================================================= */}
      {/* Hero Stats Bar - Compact overview at the top */}
      {/* ========================================================================= */}
      <div className="bg-moon-900/60 border border-moon-800 rounded-lg px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Left side: Key stats */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-coral" />
              <span className="text-2xl font-bold text-moon-50">{taxonomy?.stats.total_failure_modes || 0}</span>
              <span className="text-sm text-moon-500">failure modes</span>
            </div>
            <div className="w-px h-8 bg-moon-700" />
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal" />
              <span className="font-medium text-moon-200">{taxonomy?.stats.total_categorized || 0}</span>
              <span className="text-sm text-moon-500">categorized</span>
            </div>
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-amber-400" />
              <span className="font-medium text-moon-200">{taxonomy?.stats.total_uncategorized || 0}</span>
              <span className="text-sm text-moon-500">uncategorized</span>
            </div>
          </div>

        </div>
      </div>

      {/* ========================================================================= */}
      {/* Batch Saturation Charts (Collapsible) */}
      {/* ========================================================================= */}
      <BatchSaturationCharts onRefresh={fetchTaxonomy} />

      {/* ========================================================================= */}
      {/* Status Filter Bar */}
      {/* ========================================================================= */}
      <div className="flex items-center gap-2 px-1">
        <span className="text-xs text-moon-500 mr-2">Filter:</span>
        {STATUS_OPTIONS.map((opt) => {
          const count = statusCounts[opt.value as keyof typeof statusCounts] || 0;
          const isActive = statusFilter === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors flex items-center gap-1.5 ${
                isActive
                  ? "bg-gold/20 text-gold border border-gold/40"
                  : "bg-moon-900/60 text-moon-400 border border-moon-800 hover:border-moon-700 hover:text-moon-200"
              }`}
            >
              <span>{opt.icon}</span>
              <span>{opt.label}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-moon-800/50">{count}</span>
            </button>
          );
        })}
        </div>

      {/* ========================================================================= */}
      {/* Main Content: 9-col Failure Modes + 3-col Sidebar */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-12 gap-6">
        {/* Failure Modes (Main Area) */}
        <div className="col-span-9">
          <Panel className="h-full">
            <PanelHeader 
              icon={<AlertTriangle className="w-5 h-5 text-coral" />}
              title="Failure Modes"
              badge={<Badge variant="coral">{filteredFailureModes.length}</Badge>}
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

            <div className="space-y-3 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
              {filteredFailureModes.length ? (
                filteredFailureModes.map((mode) => (
                  <EnhancedFailureModeCard
                    key={mode.id}
                    mode={mode}
                    notes={taxonomy?.notes}
                    expanded={expandedModes.has(mode.id)}
                    copiedId={copiedModeId}
                    totalNotes={totalCategorizedNotes}
                    isEditing={editingModeId === mode.id}
                    editName={editName}
                    editDescription={editDescription}
                    editSeverity={editSeverity}
                    editStatus={editStatus}
                    editSuggestedFix={editSuggestedFix}
                    saving={saving}
                    onToggle={() => toggleModeExpanded(mode.id)}
                    onCopy={() => copySingleModeToClipboard(mode)}
                    onDelete={() => setDeletingModeId(mode.id)}
                    onStatusChange={(status) => handleStatusUpdate(mode.id, status)}
                    onStartEdit={() => startEditing(mode)}
                    onCancelEdit={cancelEditing}
                    onSaveEdit={saveEditing}
                    onEditNameChange={setEditName}
                    onEditDescriptionChange={setEditDescription}
                    onEditSeverityChange={setEditSeverity}
                    onEditStatusChange={setEditStatus}
                    onEditSuggestedFixChange={setEditSuggestedFix}
                    onMerge={() => openMergeModal(mode.id)}
                  />
                        ))
                      ) : (
                <div className="text-center py-16 text-moon-500">
                  <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p className="text-lg">
                    {statusFilter === "all" ? "No failure modes yet" : `No ${getStatusLabel(statusFilter)} failure modes`}
                  </p>
                  <p className="mt-2 max-w-md mx-auto text-sm">
                    {statusFilter === "all"
                      ? "Sync notes from Weave, then use Auto-Categorize to discover failure patterns automatically."
                      : "Try selecting a different status filter."}
                  </p>
                        </div>
                      )}
                    </div>
          </Panel>
            </div>

        {/* Sidebar: Actions + Uncategorized */}
        <div className="col-span-3 flex flex-col gap-4 h-[calc(100vh-320px)]">
          {/* Quick Actions */}
          <Panel className="flex-shrink-0">
            <PanelHeader icon={<Zap className="w-4 h-4 text-teal" />} title="Actions" />
            <div className="space-y-2">
                      <button
                onClick={syncNotesFromWeave}
                disabled={syncing}
                className="w-full btn-ghost text-sm flex items-center gap-2 justify-start px-3 py-2"
                      >
                <RefreshCw className={`w-4 h-4 text-teal ${syncing ? "animate-spin" : ""}`} />
                Sync from Weave
                      </button>
                      <div className="flex items-center gap-1">
                <button
                  onClick={autoCategorize}
                  disabled={categorizing || !taxonomy?.uncategorized_notes.length}
                  className="flex-1 btn-ghost text-sm flex items-center gap-2 justify-start px-3 py-2"
                >
                  {categorizing ? (
                    <RefreshCw className="w-4 h-4 text-gold animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 text-gold" />
                  )}
                  Auto-Categorize
                </button>
                <EditPromptButton
                  promptId="category_suggestion"
                  size="sm"
                  variant="ghost"
                />
              </div>
                  <button
                onClick={() => setShowCreateModal(true)}
                className="w-full btn-ghost text-sm flex items-center gap-2 justify-start px-3 py-2"
                  >
                <Plus className="w-4 h-4 text-emerald-400" />
                New Failure Mode
                  </button>
              <button
                onClick={fetchTaxonomy}
                disabled={loadingTaxonomy}
                className="w-full btn-ghost text-sm flex items-center gap-2 justify-start px-3 py-2"
              >
                <RefreshCw className={`w-4 h-4 text-moon-400 ${loadingTaxonomy ? "animate-spin" : ""}`} />
                Refresh
            </button>
          </div>
        </Panel>

          {/* Uncategorized Notes */}
          <Panel className="flex-1 flex flex-col min-h-0">
            <PanelHeader
              icon={<ClipboardList className="w-4 h-4 text-amber-400" />}
              title="Uncategorized"
              badge={<Badge variant="gold">{taxonomy?.uncategorized_notes.length || 0}</Badge>}
              actions={
                taxonomy?.uncategorized_notes.length ? (
                  <button
                    onClick={startBatchCategorization}
                    disabled={loadingBatchSuggestions}
                    className="btn-ghost text-[10px] flex items-center gap-1 px-1.5 py-0.5"
                  >
                    <Zap className="w-3 h-3" />
                    Batch
                  </button>
                ) : null
              }
            />

            <div className="space-y-2 flex-1 overflow-y-auto">
              {taxonomy?.uncategorized_notes.length ? (
                taxonomy.uncategorized_notes.map((note) => (
                  <InboxNoteCard
                    key={note.id}
                    note={note}
                    isSelected={selectedNote?.id === note.id}
                    failureModes={taxonomy?.failure_modes || []}
                    onSelect={() => {
                      setSelectedNote(note);
                      setNoteSuggestion(null);
                    }}
                    onAssign={(modeId) => assignNoteToMode(note.id, modeId)}
                    onViewSession={note.session_id ? () => handleViewSession(note.session_id!) : undefined}
                    onGetSuggestion={() => suggestCategoryForNote(note.id)}
                    suggestion={selectedNote?.id === note.id ? noteSuggestion : null}
                    loadingSuggestion={selectedNote?.id === note.id && loadingSuggestion}
                    onApplySuggestion={applySuggestion}
                    onCreateNew={() => setShowCreateModal(true)}
                  />
                ))
              ) : (
                <div className="text-center py-6 text-moon-500 text-sm">
                  <CheckCircle2 className="w-6 h-6 mx-auto mb-2 opacity-50" />
                  <p>All notes categorized!</p>
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

      {/* Merge Failure Modes Modal */}
      <Modal
        open={showMergeModal}
        onClose={() => setShowMergeModal(false)}
        title="Merge Failure Modes"
        footer={
          <>
            <button onClick={() => setShowMergeModal(false)} className="btn-ghost">
              Cancel
            </button>
            <button onClick={handleMerge} disabled={!mergeTargetId || merging} className="btn-primary flex items-center gap-2">
              {merging ? <RefreshCw className="w-4 h-4 animate-spin" /> : <GitMerge className="w-4 h-4" />}
              Merge
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-moon-450 mb-2">
              Merge{" "}
              <span className="text-moon-200 font-medium">
                {taxonomy?.failure_modes.find((m) => m.id === mergeSourceId)?.name || ""}
              </span>
            </label>
            <p className="text-xs text-moon-500 mb-3">
              {taxonomy?.failure_modes.find((m) => m.id === mergeSourceId)?.times_seen || 0} notes will be moved to the target.
            </p>
          </div>

          <div>
            <label className="block text-sm text-moon-450 mb-1">Into (target)</label>
            <select
              value={mergeTargetId || ""}
              onChange={(e) => {
                setMergeTargetId(e.target.value);
                const target = taxonomy?.failure_modes.find((m) => m.id === e.target.value);
                if (target) setMergeName(target.name);
              }}
              className="w-full"
            >
              <option value="">Select target...</option>
              {taxonomy?.failure_modes
                .filter((m) => m.id !== mergeSourceId)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.times_seen} notes)
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-moon-450 mb-1">New Name (optional)</label>
            <input
              type="text"
              value={mergeName}
              onChange={(e) => setMergeName(e.target.value)}
              placeholder="Leave blank to keep target name"
              className="w-full"
            />
          </div>
        </div>
      </Modal>

      {/* Batch Categorization Modal */}
      {showBatchModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-moon-800 rounded-lg border border-moon-700 p-6 w-full max-w-4xl max-h-[80vh] shadow-xl flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg text-moon-50">Batch Categorization Review</h3>
              <button onClick={() => setShowBatchModal(false)} className="text-moon-500 hover:text-moon-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            {loadingBatchSuggestions ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <RefreshCw className="w-8 h-8 animate-spin text-gold mx-auto mb-2" />
                  <p className="text-moon-400">Getting AI suggestions for {taxonomy?.uncategorized_notes.length || 0} notes...</p>
                  <p className="text-xs text-moon-500 mt-1">This may take a moment</p>
                </div>
              </div>
            ) : (
              <>
                {/* Stats Bar */}
                <div className="flex items-center gap-4 mb-4 p-3 bg-moon-900/60 rounded-lg">
                  {(() => {
                    const stats = getBatchStats();
                    return (
                      <>
                        <div className="text-sm">
                          <span className="text-moon-400">Total: </span>
                          <span className="text-moon-200 font-medium">{stats.total}</span>
                        </div>
                        <div className="text-sm">
                          <span className="text-accent-teal">✓ Confirmed: </span>
                          <span className="font-medium">{stats.confirmed}</span>
                        </div>
                        <div className="text-sm">
                          <span className="text-emerald-400">+ New: </span>
                          <span className="font-medium">{stats.newModes}</span>
                        </div>
                        <div className="text-sm">
                          <span className="text-moon-500">○ Skip: </span>
                          <span className="font-medium">{stats.skipped}</span>
                        </div>
                      </>
                    );
                  })()}
                </div>

                {/* Suggestions List */}
                <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
                  {batchSuggestions.map((item) => {
                    const assignment = batchAssignments.get(item.note_id);
                    const s = item.suggestion;
                    
                    return (
                      <div
                        key={item.note_id}
                        className={`p-3 rounded-lg border transition-colors ${
                          assignment?.action === "skip" ? "bg-moon-900/30 border-moon-800" : "bg-moon-900/60 border-moon-700"
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          {/* Note content */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-moon-300 line-clamp-2">{item.note_content}</p>
                            {item.source_type === "session_note" && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-accent-teal/20 text-accent-teal rounded mt-1 inline-block">
                                Session Note
                              </span>
                            )}
                          </div>
                          
                          {/* AI Suggestion */}
                          <div className="w-48 flex-shrink-0">
                            {s.match_type === "existing" ? (
                              <div className="text-xs">
                                <span className="text-moon-500">→ </span>
                                <span className="text-accent-teal">
                                  {taxonomy?.failure_modes.find((m) => m.id === s.existing_mode_id)?.name || "Unknown"}
                                </span>
                                <span className="text-moon-600 ml-1">({Math.round(s.confidence * 100)}%)</span>
                              </div>
                            ) : (
                              <div className="text-xs">
                                <span className="text-moon-500">+ </span>
                                <span className="text-emerald-400">{s.new_category?.name}</span>
                              </div>
                            )}
                          </div>
                          
                          {/* Action buttons */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => {
                                if (s.match_type === "existing" && s.existing_mode_id) {
                                  updateBatchAssignment(item.note_id, {
                                    note_id: item.note_id,
                                    action: "existing",
                                    failure_mode_id: s.existing_mode_id,
                                  });
                                } else if (s.match_type === "new" && s.new_category) {
                                  updateBatchAssignment(item.note_id, {
                                    note_id: item.note_id,
                                    action: "new",
                                    new_category: s.new_category,
                                  });
                                }
                              }}
                              className={`px-2 py-1 text-xs rounded ${
                                assignment?.action === "existing" || assignment?.action === "new"
                                  ? "bg-accent-teal text-moon-900"
                                  : "bg-moon-700 text-moon-300 hover:bg-moon-600"
                              }`}
                              title="Accept suggestion"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                updateBatchAssignment(item.note_id, {
                                  note_id: item.note_id,
                                  action: "skip",
                                });
                              }}
                              className={`px-2 py-1 text-xs rounded ${
                                assignment?.action === "skip"
                                  ? "bg-moon-600 text-moon-200"
                                  : "bg-moon-700 text-moon-400 hover:bg-moon-600"
                              }`}
                              title="Skip this note"
                            >
                              Skip
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer Actions */}
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-moon-700">
                  <div className="text-sm text-moon-500">Review suggestions and click Apply to categorize notes</div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setShowBatchModal(false)} className="btn-ghost">
                      Cancel
                    </button>
                    <button
                      onClick={applyBatchCategorization}
                      disabled={applyingBatch || getBatchStats().confirmed + getBatchStats().newModes === 0}
                      className="btn-primary flex items-center gap-2"
                    >
                      {applyingBatch ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Applying...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          Apply {getBatchStats().confirmed + getBatchStats().newModes} Categorizations
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      
      {/* Delete Failure Mode Confirmation Dialog */}
      <ConfirmDialog
        open={!!deletingModeId}
        onConfirm={() => {
          if (deletingModeId) {
            deleteFailureMode(deletingModeId);
            setDeletingModeId(null);
          }
        }}
        onCancel={() => setDeletingModeId(null)}
        title="Delete Failure Mode?"
        message="Are you sure you want to delete this failure mode? Notes will be moved to uncategorized. This action cannot be undone."
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}

// =============================================================================
// Enhanced Failure Mode Card with distribution bar, status, and inline editing
// =============================================================================

function EnhancedFailureModeCard({
  mode,
  notes,
  expanded,
  copiedId,
  totalNotes,
  isEditing,
  editName,
  editDescription,
  editSeverity,
  editStatus,
  editSuggestedFix,
  saving,
  onToggle,
  onCopy,
  onDelete,
  onStatusChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditNameChange,
  onEditDescriptionChange,
  onEditSeverityChange,
  onEditStatusChange,
  onEditSuggestedFixChange,
  onMerge,
}: {
  mode: FailureMode;
  notes?: Array<{ id: string; content: string; weave_url: string }>;
  expanded: boolean;
  copiedId: string | null;
  totalNotes: number;
  isEditing: boolean;
  editName: string;
  editDescription: string;
  editSeverity: string;
  editStatus: FailureModeStatus;
  editSuggestedFix: string;
  saving: boolean;
  onToggle: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onStatusChange: (status: FailureModeStatus) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditNameChange: (v: string) => void;
  onEditDescriptionChange: (v: string) => void;
  onEditSeverityChange: (v: string) => void;
  onEditStatusChange: (v: FailureModeStatus) => void;
  onEditSuggestedFixChange: (v: string) => void;
  onMerge: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const modeNotes = notes?.filter((n) => mode.note_ids.includes(n.id)) || [];
  const distributionPercent = calculateDistributionPercent(mode.times_seen, totalNotes);

  if (isEditing) {
  return (
      <div className={`bg-moon-900/60 rounded-lg border-2 border-gold p-4`}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-moon-500 mb-1 block">Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => onEditNameChange(e.target.value)}
                className="w-full text-sm"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-moon-500 mb-1 block">Severity</label>
                <select value={editSeverity} onChange={(e) => onEditSeverityChange(e.target.value)} className="w-full text-sm">
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-moon-500 mb-1 block">Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => onEditStatusChange(e.target.value as FailureModeStatus)}
                  className="w-full text-sm"
                >
                  <option value="active">Active</option>
                  <option value="investigating">Investigating</option>
                  <option value="resolved">Resolved</option>
                  <option value="wont_fix">Won't Fix</option>
                </select>
        </div>
      </div>
          </div>
          <div>
            <label className="text-xs text-moon-500 mb-1 block">Description</label>
            <textarea
              value={editDescription}
              onChange={(e) => onEditDescriptionChange(e.target.value)}
              rows={2}
              className="w-full text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-moon-500 mb-1 block">Suggested Fix</label>
            <textarea
              value={editSuggestedFix}
              onChange={(e) => onEditSuggestedFixChange(e.target.value)}
              rows={2}
              className="w-full text-sm"
              placeholder="How to fix this issue..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onCancelEdit} className="btn-ghost text-xs">
              Cancel
    </button>
            <button onClick={onSaveEdit} disabled={saving || !editName.trim()} className="btn-primary text-xs flex items-center gap-1">
              {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-moon-900/60 rounded-lg border-l-4 ${getSeverityBorder(mode.severity)} hover:bg-moon-900/80 transition-colors`}>
      <div className="p-4 cursor-pointer" onClick={onToggle}>
        {/* Header Row */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Status + Severity badges */}
              <span className={`text-xs px-1.5 py-0.5 rounded ${getStatusColor(mode.status)}`}>
                {getStatusIcon(mode.status)} {getStatusLabel(mode.status)}
              </span>
              <span className={`badge text-xs ${getSeverityColor(mode.severity)}`}>{mode.severity}</span>
              <h3 className="font-semibold text-moon-100">{mode.name}</h3>
          </div>
            <p className="text-sm text-moon-450 mt-1 line-clamp-1">{mode.description}</p>
        </div>

          <div className="flex items-center gap-2 ml-4">
            <Badge variant="plum" className="text-xs">
              {mode.times_seen} note{mode.times_seen !== 1 ? "s" : ""}
            </Badge>

            {/* Menu */}
            <div className="relative">
          <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(!showMenu);
                }}
                className="p-1 hover:bg-moon-700 rounded"
              >
                <MoreVertical className="w-4 h-4 text-moon-500" />
          </button>

              {showMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 bg-moon-800 border border-moon-700 rounded-lg shadow-xl z-20 py-1 min-w-[140px]">
        <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(false);
                        onStartEdit();
                      }}
                      className="w-full px-3 py-2 text-left text-xs hover:bg-moon-700 flex items-center gap-2"
                    >
                      <Edit3 className="w-3 h-3" /> Edit
        </button>
            <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(false);
                        onCopy();
                      }}
                      className="w-full px-3 py-2 text-left text-xs hover:bg-moon-700 flex items-center gap-2"
                    >
                      <Copy className="w-3 h-3" /> Copy
            </button>
              <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(false);
                        onMerge();
                      }}
                      className="w-full px-3 py-2 text-left text-xs hover:bg-moon-700 flex items-center gap-2"
                    >
                      <GitMerge className="w-3 h-3" /> Merge
                    </button>
                    <hr className="my-1 border-moon-700" />
                    <div className="px-3 py-1 text-[10px] text-moon-500">Status</div>
                    {(["active", "investigating", "resolved", "wont_fix"] as FailureModeStatus[]).map((s) => (
                      <button
                        key={s}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowMenu(false);
                          onStatusChange(s);
                        }}
                        className={`w-full px-3 py-1.5 text-left text-xs hover:bg-moon-700 flex items-center gap-2 ${
                          mode.status === s ? "text-gold" : ""
                        }`}
                      >
                        {getStatusIcon(s)} {getStatusLabel(s)}
              </button>
            ))}
                    <hr className="my-1 border-moon-700" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(false);
                        onDelete();
                      }}
                      className="w-full px-3 py-2 text-left text-xs hover:bg-red-900/30 text-red-400 flex items-center gap-2"
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
          </div>
                </>
              )}
        </div>

            {expanded ? <ChevronUp className="w-4 h-4 text-moon-500" /> : <ChevronDown className="w-4 h-4 text-moon-500" />}
      </div>
    </div>

        {/* Distribution Bar */}
        <div className="mt-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="flex-1 h-1.5 bg-moon-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${getSeverityBorder(mode.severity).replace("border-l-", "bg-")}`}
                style={{ width: `${distributionPercent}%` }}
              />
            </div>
            <span className="text-xs text-moon-500 w-12 text-right">{distributionPercent}%</span>
          </div>
          </div>

        {/* Timestamps */}
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
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Inbox Note Card with inline quick assign
// =============================================================================

function InboxNoteCard({
  note,
  isSelected,
  failureModes,
  onSelect,
  onAssign,
  onViewSession,
  onGetSuggestion,
  suggestion,
  loadingSuggestion,
  onApplySuggestion,
  onCreateNew,
}: {
  note: TaxonomyNote;
  isSelected: boolean;
  failureModes: FailureMode[];
  onSelect: () => void;
  onAssign: (modeId: string) => void;
  onViewSession?: () => void;
  onGetSuggestion: () => void;
  suggestion: AISuggestion | null;
  loadingSuggestion: boolean;
  onApplySuggestion: () => void;
  onCreateNew: () => void;
}) {
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);

  return (
    <div
      className={`bg-moon-900/60 rounded-xl p-4 border transition-colors ${
        isSelected ? "border-gold bg-moon-900" : "border-moon-700/50 hover:bg-moon-900/80 hover:border-moon-600"
      }`}
    >
      <p className="text-sm text-moon-200 leading-relaxed mb-3">{note.content}</p>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {note.source_type === "session_note" && (
            <span className="text-xs px-2 py-1 bg-accent-teal/20 text-accent-teal rounded-md font-medium">Session</span>
          )}
          <span className="text-xs text-moon-500">{formatRelativeTime(note.created_at)}</span>
        </div>

        <div className="flex items-center gap-2">
          {onViewSession && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onViewSession();
              }}
              className="p-2 hover:bg-moon-700 rounded-lg text-accent-teal transition-colors"
              title="View Session"
            >
              <Eye className="w-4 h-4" />
            </button>
          )}

          {/* Quick Assign */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowAssignDropdown(!showAssignDropdown);
              }}
              className="p-2 bg-gold/20 hover:bg-gold/40 border border-gold/50 rounded-lg text-gold transition-colors"
              title="Assign to category"
            >
              <ArrowRight className="w-4 h-4" />
            </button>

            {showAssignDropdown && (
              <>
                <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setShowAssignDropdown(false)} />
                <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-moon-900 border border-moon-600 rounded-xl shadow-2xl z-50 w-72 overflow-hidden">
                  <div className="px-4 py-3 border-b border-moon-700 bg-moon-800">
                    <h4 className="text-sm font-medium text-moon-100">Assign Note</h4>
                    <p className="text-xs text-moon-500 mt-0.5 line-clamp-1">{note.content}</p>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowAssignDropdown(false);
                        onSelect();
                        onGetSuggestion();
                      }}
                      className="w-full px-4 py-3 text-left text-sm hover:bg-gold/10 flex items-center gap-3 text-gold font-medium border-b border-moon-800"
                    >
                      <Sparkles className="w-4 h-4" /> 
                      <span>Get AI Suggestion</span>
                    </button>
                    {failureModes.length > 0 && (
                      <div className="px-4 py-2 text-[10px] text-moon-500 uppercase tracking-wide bg-moon-850">
                        Existing Categories
                      </div>
                    )}
                    {failureModes.map((fm) => (
                      <button
                        key={fm.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAssignDropdown(false);
                          onAssign(fm.id);
                        }}
                        className="w-full px-4 py-2.5 text-left text-sm text-moon-300 hover:bg-moon-800 hover:text-moon-50 truncate flex items-center gap-2"
                      >
                        <Tag className="w-3 h-3 text-moon-500" />
                        {fm.name}
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-moon-700 bg-moon-800">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowAssignDropdown(false);
                        onCreateNew();
                      }}
                      className="w-full px-4 py-3 text-left text-sm hover:bg-emerald-500/10 flex items-center gap-3 text-emerald-400 font-medium"
                    >
                      <Plus className="w-4 h-4" /> Create New Category
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* AI Suggestion (inline) */}
      {isSelected && (suggestion || loadingSuggestion) && (
        <div className="mt-2 pt-2 border-t border-moon-700">
          {loadingSuggestion ? (
            <div className="flex items-center gap-2 text-xs text-moon-400">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Getting suggestion...
            </div>
          ) : suggestion ? (
            <div className="space-y-2">
              <div className="text-xs">
                {suggestion.match_type === "existing" ? (
                  <span className="text-moon-300">
                    AI: <span className="text-teal font-medium">{failureModes.find((m) => m.id === suggestion.existing_mode_id)?.name}</span>
                    <span className="text-moon-500 ml-1">({Math.round(suggestion.confidence * 100)}%)</span>
                  </span>
                ) : (
                  <span className="text-moon-300">
                    AI: New category <span className="text-emerald-400 font-medium">{suggestion.new_category?.name}</span>
                  </span>
                )}
              </div>
              <button onClick={onApplySuggestion} className="w-full btn-ghost text-xs py-1.5 flex items-center justify-center gap-1 border border-gold/30">
                <Check className="w-3 h-3" /> Apply
            </button>
          </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

