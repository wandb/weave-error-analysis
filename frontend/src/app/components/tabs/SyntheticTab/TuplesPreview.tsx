"use client";

/**
 * TuplesPreview - Preview panel for generated tuples before query generation
 *
 * Extracted from SyntheticTab to reduce component size and re-renders.
 * Uses React.memo to prevent unnecessary re-renders.
 */

import React, { memo } from "react";
import { Target, Trash2, Edit3, Check } from "lucide-react";
import type { PreviewTuple, GenerationProgress } from "../../../lib/useBatchGeneration";

// ============================================================================
// Types
// ============================================================================

interface TuplesPreviewProps {
  tuples: PreviewTuple[];
  selectedTupleIds: Set<string>;
  editingTupleId: string | null;
  generatingQueries: boolean;
  genProgress: GenerationProgress | null;
  onToggleSelect: (tupleId: string, selected: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onEdit: (tupleId: string | null) => void;
  onUpdateValue: (tupleId: string, key: string, value: string) => void;
  onDelete: (tupleId: string) => void;
}

// ============================================================================
// Tuple Row Component
// ============================================================================

interface TupleRowProps {
  tuple: PreviewTuple;
  index: number;
  isSelected: boolean;
  isEditing: boolean;
  onToggleSelect: (selected: boolean) => void;
  onEdit: () => void;
  onDoneEditing: () => void;
  onUpdateValue: (key: string, value: string) => void;
  onDelete: () => void;
}

const TupleRow = memo(function TupleRow({
  tuple,
  index,
  isSelected,
  isEditing,
  onToggleSelect,
  onEdit,
  onDoneEditing,
  onUpdateValue,
  onDelete,
}: TupleRowProps) {
  const tags = Object.entries(tuple.values);

  return (
    <div
      className={`flex items-center gap-3 p-2 rounded transition-colors border ${
        isEditing
          ? "bg-gold/10 border-gold"
          : isSelected
          ? "bg-teal/10 border-teal"
          : "bg-moon-900 border-moon-700"
      } ${isSelected || isEditing ? "opacity-100" : "opacity-60"}`}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={(e) => onToggleSelect(e.target.checked)}
        className="w-4 h-4 rounded flex-shrink-0 accent-teal"
      />
      <span className="text-xs flex-shrink-0 text-moon-450 min-w-[40px]">
        #{index + 1}
      </span>

      {/* Editing mode: show inputs */}
      {isEditing ? (
        <div className="flex flex-wrap gap-2 flex-1">
          {tags.map(([key, value]) => (
            <div key={key} className="flex items-center gap-1">
              <span className="text-xs text-moon-450">{key}:</span>
              <input
                type="text"
                value={value}
                onChange={(e) => onUpdateValue(key, e.target.value)}
                className="text-xs px-2 py-0.5 rounded w-32 bg-moon-900 border border-gold text-moon-50"
              />
            </div>
          ))}
        </div>
      ) : (
        /* Display mode: show tags */
        <div className="flex flex-wrap gap-1.5 flex-1">
          {tags.map(([key, value]) => (
            <span
              key={key}
              className="text-xs px-2 py-0.5 rounded bg-moon-700 text-teal"
              title={`${key}: ${value}`}
            >
              {value}
            </span>
          ))}
        </div>
      )}

      {/* Edit/Done button */}
      <button
        onClick={isEditing ? onDoneEditing : onEdit}
        className={`p-1 rounded transition-colors flex-shrink-0 ${
          isEditing ? "bg-teal/20" : "bg-transparent"
        }`}
        title={isEditing ? "Done editing" : "Edit tuple"}
      >
        {isEditing ? (
          <Check className="w-3.5 h-3.5 text-teal" />
        ) : (
          <Edit3 className="w-3.5 h-3.5 text-moon-450" />
        )}
      </button>

      <button
        onClick={onDelete}
        className="p-1 rounded hover:bg-red-500/20 transition-colors flex-shrink-0"
        title="Remove this tuple"
      >
        <Trash2 className="w-3.5 h-3.5 text-red-500" />
      </button>
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

export const TuplesPreview = memo(function TuplesPreview({
  tuples,
  selectedTupleIds,
  editingTupleId,
  generatingQueries,
  genProgress,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  onEdit,
  onUpdateValue,
  onDelete,
}: TuplesPreviewProps) {
  if (tuples.length === 0) return null;

  return (
    <div className="rounded-lg p-4 mb-4 bg-ink-900 border-2 border-teal">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg flex items-center gap-2 text-moon-50">
          <Target className="w-5 h-5 text-teal" />
          Tuples Preview
          <span className="text-xs px-2 py-0.5 rounded ml-1 bg-teal text-moon-900">
            Step 1: Review
          </span>
          <span className="text-xs px-2 py-0.5 rounded ml-1 bg-moon-700 text-moon-450">
            {selectedTupleIds.size}/{tuples.length} selected
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-moon-450">
            <input
              type="checkbox"
              checked={selectedTupleIds.size === tuples.length}
              onChange={(e) => {
                if (e.target.checked) onSelectAll();
                else onDeselectAll();
              }}
              className="w-3.5 h-3.5 rounded accent-teal"
            />
            Select all
          </label>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs mb-3 text-moon-450">
        Review the generated test case combinations below. Uncheck any you want
        to exclude, then click &quot;GENERATE QUERIES&quot; to create the batch.
      </p>

      {/* Tuples Grid */}
      <div className="grid gap-2 max-h-64 overflow-y-auto">
        {tuples.map((tuple, idx) => (
          <TupleRow
            key={tuple.id}
            tuple={tuple}
            index={idx}
            isSelected={selectedTupleIds.has(tuple.id)}
            isEditing={editingTupleId === tuple.id}
            onToggleSelect={(selected) => onToggleSelect(tuple.id, selected)}
            onEdit={() => onEdit(tuple.id)}
            onDoneEditing={() => onEdit(null)}
            onUpdateValue={(key, value) => onUpdateValue(tuple.id, key, value)}
            onDelete={() => onDelete(tuple.id)}
          />
        ))}
      </div>

      {/* Progress Bar */}
      {genProgress && generatingQueries && (
        <div className="mt-3 pt-3 border-t border-moon-700">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-moon-450">Generating queries...</span>
            <span className="text-teal">
              {genProgress.completed}/{genProgress.total}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-moon-700">
            <div
              className="h-full rounded-full transition-all bg-teal"
              style={{ width: `${genProgress.percent}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
});

