"use client";

import { useState } from "react";
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
  Copy,
  Check,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { formatRelativeTime, getSeverityColor, getSeverityBorder, formatTaxonomyForCopy, formatSingleModeForCopy } from "../../utils/formatters";
import { Panel, PanelHeader, Badge, ProgressBar, Modal } from "../ui";
import type { TaxonomyNote, AISuggestion } from "../../types";
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

  const toggleModeExpanded = (modeId: string) => {
    const newExpanded = new Set(expandedModes);
    if (newExpanded.has(modeId)) {
      newExpanded.delete(modeId);
    } else {
      newExpanded.add(modeId);
    }
    setExpandedModes(newExpanded);
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

  return (
    <div className="space-y-6">
      {/* Header with Stats and Actions */}
      <div className="grid grid-cols-12 gap-6">
        {/* Saturation Card */}
        <div className="col-span-5">
          <Panel>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-semibold text-sand-100 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-accent-teal" />
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
                <p className="text-sm text-ink-400">{taxonomy.saturation.message}</p>
                <ProgressBar
                  value={taxonomy.saturation.saturation_score * 100}
                  label="Saturation Score"
                  sublabel={`${Math.round(taxonomy.saturation.saturation_score * 100)}%`}
                />
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
          </Panel>
        </div>

        {/* Actions Card */}
        <div className="col-span-7">
          <Panel>
            <PanelHeader icon={<Zap className="w-5 h-5 text-accent-gold" />} title="Actions" />
            <div className="grid grid-cols-2 gap-4">
              <ActionCard
                icon={<RefreshCw className={`w-5 h-5 text-accent-teal ${syncing ? "animate-spin" : ""}`} />}
                title="Sync from Weave"
                description="Pull latest notes"
                onClick={syncNotesFromWeave}
                disabled={syncing}
                iconBg="bg-accent-teal/20"
              />
              <ActionCard
                icon={categorizing ? <RefreshCw className="w-5 h-5 text-accent-plum animate-spin" /> : <Sparkles className="w-5 h-5 text-accent-plum" />}
                title="Auto-Categorize"
                description="AI assigns all notes"
                onClick={autoCategorize}
                disabled={categorizing || !taxonomy?.uncategorized_notes.length}
                iconBg="bg-accent-plum/20"
              />
              <ActionCard
                icon={<Plus className="w-5 h-5 text-accent-coral" />}
                title="New Failure Mode"
                description="Create manually"
                onClick={() => setShowCreateModal(true)}
                iconBg="bg-accent-coral/20"
              />
              <ActionCard
                icon={<RefreshCw className={`w-5 h-5 text-ink-300 ${loadingTaxonomy ? "animate-spin" : ""}`} />}
                title="Refresh"
                description="Reload taxonomy"
                onClick={fetchTaxonomy}
                disabled={loadingTaxonomy}
                iconBg="bg-ink-700"
              />
            </div>
          </Panel>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-12 gap-6">
        {/* Uncategorized Notes */}
        <div className="col-span-4">
          <Panel>
            <PanelHeader
              icon={<ClipboardList className="w-5 h-5 text-accent-gold" />}
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
                    className={`bg-ink-950 rounded-lg p-3 cursor-pointer hover:bg-ink-900 transition-colors border ${
                      selectedNote?.id === note.id ? "border-accent-gold" : "border-transparent"
                    }`}
                  >
                    <p className="text-sm text-sand-300 line-clamp-3">{note.content}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-ink-600">{formatRelativeTime(note.created_at)}</span>
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
              icon={<AlertTriangle className="w-5 h-5 text-accent-coral" />}
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
                <div className="text-center py-16 text-ink-500">
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
  description,
  onClick,
  disabled,
  iconBg,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  iconBg: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="bg-ink-950 hover:bg-ink-900 rounded-lg p-4 border border-ink-800 hover:border-ink-700 transition-colors text-left group disabled:opacity-50"
    >
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-10 h-10 rounded-lg ${iconBg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
          {icon}
        </div>
        <div>
          <h3 className="font-medium text-sand-200">{title}</h3>
          <p className="text-xs text-ink-500">{description}</p>
        </div>
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
    <div className="mt-4 pt-4 border-t border-ink-800">
      <div className="bg-ink-950 rounded-lg p-3 border border-accent-gold/30">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-accent-gold">Selected Note</span>
          <button onClick={onClose} className="text-ink-500 hover:text-ink-300">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-sand-300 mb-3 line-clamp-2">{note.content}</p>

        <button
          onClick={onSuggest}
          disabled={loadingSuggestion}
          className="w-full btn-primary text-sm flex items-center justify-center gap-2 mb-2"
        >
          {loadingSuggestion ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Get AI Suggestion
        </button>

        {suggestion && (
          <div className="mt-3 p-3 bg-ink-900 rounded-lg border border-ink-700">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-accent-plum" />
              <span className="text-xs font-medium text-accent-plum">AI Suggestion</span>
            </div>

            {suggestion.match_type === "existing" ? (
              <div>
                <p className="text-sm text-sand-300">
                  Matches existing:{" "}
                  <strong className="text-accent-teal">
                    {failureModes.find((m) => m.id === suggestion.existing_mode_id)?.name}
                  </strong>
                </p>
                <p className="text-xs text-ink-500 mt-1">Confidence: {Math.round(suggestion.confidence * 100)}%</p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-sand-300">
                  New category: <strong className="text-accent-coral">{suggestion.new_category?.name}</strong>
                </p>
                <p className="text-xs text-ink-500 mt-1">{suggestion.new_category?.description}</p>
              </div>
            )}

            <p className="text-xs text-ink-500 mt-2 italic">{suggestion.reasoning}</p>

            <button
              onClick={onApplySuggestion}
              className="w-full mt-3 btn-ghost text-sm flex items-center justify-center gap-2 border border-accent-plum/30 hover:bg-accent-plum/10"
            >
              <CheckCircle2 className="w-4 h-4" />
              Apply Suggestion
            </button>
          </div>
        )}

        <div className="mt-3">
          <span className="text-xs text-ink-500 block mb-2">Or assign manually:</span>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {failureModes.map((mode) => (
              <button
                key={mode.id}
                onClick={() => onAssign(mode.id)}
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
    <div className={`bg-ink-950 rounded-lg border-l-4 ${getSeverityBorder(mode.severity)} hover:bg-ink-900/50 transition-colors`}>
      <div className="p-4 cursor-pointer" onClick={onToggle}>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sand-200">{mode.name}</h3>
              <span className={`badge text-xs ${getSeverityColor(mode.severity)}`}>{mode.severity}</span>
            </div>
            <p className="text-sm text-ink-400 mt-1 line-clamp-2">{mode.description}</p>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <Badge variant="plum" className="text-xs">
              {mode.times_seen} note{mode.times_seen !== 1 ? "s" : ""}
            </Badge>
            {expanded ? <ChevronUp className="w-4 h-4 text-ink-500" /> : <ChevronDown className="w-4 h-4 text-ink-500" />}
          </div>
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs text-ink-500">
          <span>Created {formatRelativeTime(mode.created_at)}</span>
          <span>Last seen {formatRelativeTime(mode.last_seen_at)}</span>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-ink-800 pt-3 space-y-3">
          {mode.suggested_fix && (
            <div className="flex items-start gap-2 p-2 bg-ink-900 rounded-lg">
              <Sparkles className="w-4 h-4 text-accent-teal flex-shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-medium text-accent-teal">Suggested Fix</span>
                <p className="text-sm text-sand-300 mt-1">{mode.suggested_fix}</p>
              </div>
            </div>
          )}

          {modeNotes.length > 0 && (
            <div>
              <span className="text-xs font-medium text-ink-400 block mb-2">Notes ({mode.note_ids.length})</span>
              <div className="space-y-1">
                {modeNotes.slice(0, 3).map((note) => (
                  <div key={note.id} className="text-xs text-sand-400 bg-ink-900 rounded p-2 flex items-center justify-between">
                    <span className="truncate flex-1">{note.content}</span>
                    {note.weave_url && (
                      <a href={note.weave_url} target="_blank" rel="noopener noreferrer" className="text-accent-coral ml-2">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                ))}
                {mode.note_ids.length > 3 && <p className="text-xs text-ink-500 pl-2">+{mode.note_ids.length - 3} more notes</p>}
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

