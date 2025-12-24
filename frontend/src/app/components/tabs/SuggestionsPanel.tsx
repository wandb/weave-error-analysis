"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  X,
  RefreshCw,
  Lightbulb,
  GitMerge,
  Edit3,
  Target,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  CheckCircle2,
  GripVertical,
} from "lucide-react";
import type { TaxonomyImprovementSuggestion } from "../../lib/api";
import type { FailureMode } from "../../types";
import { LoadingSpinner } from "../ui";

interface SuggestionsPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  suggestions: TaxonomyImprovementSuggestion[];
  overallAssessment: string;
  loading: boolean;
  stale: boolean;
  failureModes: FailureMode[];
  dismissedIds: Set<string>;
  onApplyMerge: (suggestion: TaxonomyImprovementSuggestion, affectedModes: FailureMode[]) => void;
  onApplyRename: (suggestion: TaxonomyImprovementSuggestion, mode: FailureMode) => void;
  onApplySplit: (suggestion: TaxonomyImprovementSuggestion, mode: FailureMode) => void;
  onDismiss: (suggestionId: string) => void;
  onRefresh: () => void;
}

const MIN_WIDTH = 280;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 360;

export function SuggestionsPanel({
  isOpen,
  onToggle,
  suggestions,
  overallAssessment,
  loading,
  stale,
  failureModes,
  dismissedIds,
  onApplyMerge,
  onApplyRename,
  onApplySplit,
  onDismiss,
  onRefresh,
}: SuggestionsPanelProps) {
  const activeSuggestions = suggestions.filter((s) => !s.id || !dismissedIds.has(s.id));
  const activeCount = activeSuggestions.length;

  // Resizable width state
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Handle resize drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  // Collapsed state - just a toggle button
  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-40 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 hover:border-purple-500/60 rounded-l-xl px-2 py-4 transition-all group"
        title="Show improvement suggestions"
      >
        <div className="flex flex-col items-center gap-2">
          <Lightbulb className="w-5 h-5 text-purple-400" />
          {activeCount > 0 && (
            <span className="text-xs font-medium text-purple-300 bg-purple-500/30 px-1.5 py-0.5 rounded-full">
              {activeCount}
            </span>
          )}
          <ChevronLeft className="w-4 h-4 text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </button>
    );
  }

  return (
    <div 
      ref={panelRef}
      className="fixed right-0 top-0 h-full z-40 flex"
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize group flex items-center justify-center hover:bg-purple-500/20 transition-colors ${
          isResizing ? "bg-purple-500/30" : ""
        }`}
        title="Drag to resize"
      >
        <div className="w-1 h-12 rounded-full bg-moon-600 group-hover:bg-purple-400 transition-colors" />
      </div>

      {/* Collapse button */}
      <button
        onClick={onToggle}
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full bg-moon-800 border border-moon-700 hover:border-moon-600 rounded-l-lg p-1.5 transition-colors z-10"
        title="Collapse panel"
      >
        <ChevronRight className="w-4 h-4 text-moon-400" />
      </button>

      {/* Panel */}
      <div className="w-full h-full bg-moon-900 border-l border-moon-700 shadow-2xl flex flex-col ml-2">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-moon-700 bg-moon-800/50 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-purple-500/20 rounded-lg">
              <Lightbulb className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <h3 className="font-display text-sm text-moon-50">Improvements</h3>
              {stale && (
                <span className="text-[10px] text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Taxonomy changed
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onRefresh}
              disabled={loading}
              className="p-1.5 text-moon-400 hover:text-moon-200 hover:bg-moon-700 rounded-lg transition-colors disabled:opacity-50"
              title="Refresh suggestions"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={onToggle}
              className="p-1.5 text-moon-400 hover:text-moon-200 hover:bg-moon-700 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-moon-400">
              <LoadingSpinner size={6} className="mb-3 text-purple-400" />
              <p className="text-sm font-medium">Analyzing taxonomy...</p>
              <p className="text-xs text-moon-500 mt-1">This may take 15-30s</p>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
              <p className="text-moon-200 text-sm font-medium">Taxonomy looks great!</p>
              <p className="text-xs text-moon-500 mt-1">No improvements needed</p>
            </div>
          ) : activeCount === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
              <p className="text-moon-200 text-sm font-medium">All done!</p>
              <p className="text-xs text-moon-500 mt-1">All suggestions addressed</p>
              <button
                onClick={onRefresh}
                className="mt-4 text-xs text-purple-400 hover:text-purple-300 transition-colors"
              >
                Get fresh suggestions
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Overall Assessment */}
              {overallAssessment && (
                <div className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/20 mb-4">
                  <p className="text-sm text-moon-300 leading-relaxed">{overallAssessment}</p>
                </div>
              )}

              {/* Suggestions */}
              {suggestions.map((suggestion, idx) => {
                // Skip if dismissed (by ID if available, or fallback shouldn't happen with persisted suggestions)
                if (suggestion.id && dismissedIds.has(suggestion.id)) return null;

                const affectedModes = suggestion.mode_ids
                  .map((id) => failureModes.find((m) => m.id === id))
                  .filter((m): m is FailureMode => m !== undefined);

                const canMerge = suggestion.type === "merge" && affectedModes.length >= 2;
                const canRename = suggestion.type === "rename" && affectedModes.length === 1;
                const canSplit = suggestion.type === "split" && affectedModes.length === 1;

                return (
                  <SuggestionCard
                    key={suggestion.id || idx}
                    suggestion={suggestion}
                    affectedModes={affectedModes}
                    canMerge={canMerge}
                    canRename={canRename}
                    canSplit={canSplit}
                    onApply={() => {
                      if (canMerge) {
                        onApplyMerge(suggestion, affectedModes);
                      } else if (canRename) {
                        onApplyRename(suggestion, affectedModes[0]);
                      } else if (canSplit) {
                        onApplySplit(suggestion, affectedModes[0]);
                      }
                    }}
                    onDismiss={() => suggestion.id && onDismiss(suggestion.id)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with count and actions */}
        {!loading && (
          <div className="px-4 py-3 border-t border-moon-700 bg-moon-800 flex-shrink-0">
            <div className="flex items-center justify-between gap-3">
              {suggestions.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-500/20 border border-purple-500/30">
                    <span className="text-sm font-bold text-purple-300">{activeCount}</span>
                  </div>
                  <div className="text-xs text-moon-400">
                    <span className="text-moon-200">of {suggestions.length}</span> remaining
                  </div>
                </div>
              )}
              <button
                onClick={onRefresh}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-300 bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 rounded-lg transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                New Suggestions
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface SuggestionCardProps {
  suggestion: TaxonomyImprovementSuggestion;
  affectedModes: FailureMode[];
  canMerge: boolean;
  canRename: boolean;
  canSplit: boolean;
  onApply: () => void;
  onDismiss: () => void;
}

function SuggestionCard({
  suggestion,
  affectedModes,
  canMerge,
  canRename,
  canSplit,
  onApply,
  onDismiss,
}: SuggestionCardProps) {
  const [expanded, setExpanded] = useState(false);

  const TypeBadge = () => {
    if (suggestion.type === "merge") {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
          <GitMerge className="w-3 h-3" />
          Merge
        </span>
      );
    }
    if (suggestion.type === "rename") {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">
          <Edit3 className="w-3 h-3" />
          Rename
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/30">
        <Target className="w-3 h-3" />
        Split
      </span>
    );
  };

  const canApply = canMerge || canRename || canSplit;

  return (
    <div className="rounded-lg bg-moon-800/60 border border-moon-700 hover:border-moon-600 transition-colors overflow-hidden">
      {/* Header - always visible */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <TypeBadge />
          {suggestion.suggested_name && (
            <span className="text-xs text-gold truncate max-w-[140px]" title={suggestion.suggested_name}>
              → "{suggestion.suggested_name}"
            </span>
          )}
        </div>

        {/* Affected modes pills */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {affectedModes.slice(0, 3).map((mode) => (
            <span
              key={mode.id}
              className="text-xs px-2 py-0.5 bg-moon-900 rounded text-moon-300 border border-moon-700 truncate max-w-[120px]"
              title={mode.name}
            >
              {mode.name}
            </span>
          ))}
          {affectedModes.length > 3 && (
            <span className="text-xs text-moon-500">+{affectedModes.length - 3}</span>
          )}
        </div>

        {/* Reason - truncated by default */}
        <p
          className={`text-sm text-moon-400 leading-relaxed ${expanded ? "" : "line-clamp-2"} cursor-pointer hover:text-moon-300`}
          onClick={() => setExpanded(!expanded)}
        >
          {suggestion.reason}
        </p>
        {!expanded && suggestion.reason.length > 120 && (
          <button 
            onClick={() => setExpanded(true)}
            className="text-xs text-purple-400 hover:text-purple-300 mt-1"
          >
            Show more
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex border-t border-moon-700">
        <button
          onClick={onDismiss}
          className="flex-1 px-3 py-2.5 text-sm text-moon-500 hover:text-moon-300 hover:bg-moon-700/50 transition-colors"
        >
          Dismiss
        </button>
        {canApply && (
          <button
            onClick={onApply}
            className={`flex-1 px-3 py-2.5 text-sm font-medium transition-colors border-l border-moon-700 ${
              canMerge
                ? "text-blue-400 hover:bg-blue-500/20"
                : canRename
                ? "text-green-400 hover:bg-green-500/20"
                : "text-orange-400 hover:bg-orange-500/20"
            }`}
          >
            Apply
          </button>
        )}
      </div>
    </div>
  );
}
