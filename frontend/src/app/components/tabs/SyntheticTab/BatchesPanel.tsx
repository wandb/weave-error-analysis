"use client";

/**
 * BatchesPanel - Generated batches list with run controls
 *
 * Extracted from SyntheticTab to reduce component size and re-renders.
 * Uses React.memo to prevent unnecessary re-renders when other state changes.
 *
 * After batch execution, users can click "Review in Weave" to open Weave's
 * trace viewer with filters pre-applied to show only traces from that batch.
 */

import React, { useState, memo, useCallback } from "react";
import {
  Zap,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Play,
  Square,
  ExternalLink,
} from "lucide-react";
import { StatusBadge, ConfirmDialog } from "../../ui";
import { formatRelativeTime } from "../../../utils/formatters";
import { getBatchWeaveUrl } from "../../../lib/api";
import type { SyntheticBatch, BatchDetail } from "../../../types";

// ============================================================================
// Types
// ============================================================================

interface BatchesPanelProps {
  batches: SyntheticBatch[];
  selectedBatch: BatchDetail | null;
  executingBatchId: string | null;
  collapsed: boolean;
  panelHeight: number;
  onToggleCollapsed: () => void;
  onSelectBatch: (batchId: string) => void;
  onDeselectBatch: () => void;
  onExecuteBatch: (batchId: string, batchName: string) => void;
  onStopExecution: () => void;
  onResetBatch: (batchId: string, onlyFailed: boolean) => void;
  onDeleteBatch: (batchId: string) => void;
}

// ============================================================================
// Batch Card Component
// ============================================================================

interface BatchCardProps {
  batch: SyntheticBatch;
  isSelected: boolean;
  isChecked: boolean;
  executingBatchId: string | null;
  copiedBatchId: string | null;
  onCheck: (checked: boolean) => void;
  onSelect: () => void;
  onDeselect: () => void;
  onCopyId: () => void;
  onDelete: () => void;
  onExecute: () => void;
  onStop: () => void;
  onReset: (onlyFailed: boolean) => void;
}

const BatchCard = memo(function BatchCard({
  batch,
  isSelected,
  isChecked,
  executingBatchId,
  copiedBatchId,
  onCheck,
  onSelect,
  onDeselect,
  onCopyId,
  onDelete,
  onExecute,
  onStop,
  onReset,
}: BatchCardProps) {
  const [loadingWeaveUrl, setLoadingWeaveUrl] = useState(false);
  
  const isReady = batch.status === "ready" || batch.status === "pending";
  const isRunning = batch.status === "running" || executingBatchId === batch.id;
  const isCompleted = batch.status === "completed";
  const isFailed = batch.status === "failed";

  // Open Weave with pre-applied filters for this batch
  const handleReviewInWeave = useCallback(async () => {
    setLoadingWeaveUrl(true);
    try {
      const response = await getBatchWeaveUrl(batch.id);
      if (response.configured && response.url && !response.url.startsWith("#error:")) {
        window.open(response.url, "_blank");
      } else {
        // Show a message if Weave is not configured
        alert("Weave is not configured. Please set up W&B Entity and Project in Settings.");
      }
    } catch (error) {
      console.error("Failed to get Weave URL:", error);
      alert("Failed to generate Weave URL. Please try again.");
    } finally {
      setLoadingWeaveUrl(false);
    }
  }, [batch.id]);

  return (
    <div
      className={`rounded-lg p-3 transition-all border ${
        isChecked || isSelected
          ? "bg-teal/10 border-teal/30"
          : isRunning
          ? "bg-gold/5 border-gold/30"
          : "bg-moon-800 border-moon-700"
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={(e) => {
            e.stopPropagation();
            onCheck(e.target.checked);
          }}
          className="w-4 h-4 mt-0.5 rounded flex-shrink-0 accent-teal"
        />
        <div className="flex-1">
          <div
            className="cursor-pointer"
            onClick={() => {
              if (isSelected) {
                onDeselect();
              } else {
                onSelect();
              }
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="text-sm font-medium truncate text-gold"
                  title={batch.name}
                >
                  {batch.name}
                </span>
                {isRunning && (
                  <RefreshCw className="w-3 h-3 animate-spin flex-shrink-0 text-gold" />
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopyId();
                  }}
                  className={`p-1 rounded transition-colors ${
                    copiedBatchId === batch.id ? "text-teal" : "text-moon-450"
                  }`}
                  title="Copy batch ID"
                >
                  {copiedBatchId === batch.id ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="p-1 rounded text-red-400 hover:text-red-300"
                  title="Delete batch"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <StatusBadge status={batch.status} />
                <span className="text-xs text-moon-450">
                  {batch.query_count} queries
                </span>
              </div>
              <span className="text-xs text-moon-450">
                {formatRelativeTime(batch.created_at)}
              </span>
            </div>
          </div>

          {/* Run Controls */}
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-moon-700">
            {isReady && (
              <button
                onClick={onExecute}
                disabled={!!executingBatchId}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all disabled:opacity-50 bg-gold text-moon-900"
              >
                <Play className="w-3 h-3" />
                Run
              </button>
            )}
            {isRunning && executingBatchId === batch.id && (
              <button
                onClick={onStop}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all bg-red-500/20 text-red-500"
              >
                <Square className="w-3 h-3 fill-current" />
                Stop
              </button>
            )}
            {(isCompleted || isFailed) && (
              <>
                <button
                  onClick={() => onReset(false)}
                  disabled={!!executingBatchId}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-all disabled:opacity-50 bg-moon-700 text-moon-450"
                >
                  <RefreshCw className="w-3 h-3" />
                  Re-run
                </button>
                <button
                  onClick={handleReviewInWeave}
                  disabled={loadingWeaveUrl}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-all text-teal disabled:opacity-50"
                  title="Open traces in Weave with batch filter applied"
                >
                  {loadingWeaveUrl ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <ExternalLink className="w-3 h-3" />
                  )}
                  Review in Weave
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

export const BatchesPanel = memo(function BatchesPanel({
  batches,
  selectedBatch,
  executingBatchId,
  collapsed,
  panelHeight,
  onToggleCollapsed,
  onSelectBatch,
  onDeselectBatch,
  onExecuteBatch,
  onStopExecution,
  onResetBatch,
  onDeleteBatch,
}: BatchesPanelProps) {
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(
    new Set()
  );
  const [copiedBatchId, setCopiedBatchId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const copyBatchId = (batchId: string) => {
    navigator.clipboard.writeText(batchId);
    setCopiedBatchId(batchId);
    setTimeout(() => setCopiedBatchId(null), 2000);
  };

  const handleDeleteSelectedBatches = async () => {
    Array.from(selectedBatchIds).forEach((batchId) => {
      onDeleteBatch(batchId);
    });
    setSelectedBatchIds(new Set());
    setShowDeleteConfirm(false);
  };

  return (
    <div
      className={`rounded-lg p-4 flex flex-col overflow-hidden bg-ink-900 border border-moon-700 ${
        collapsed ? "" : "resize-y"
      }`}
      style={{
        height: collapsed ? "auto" : `${panelHeight}px`,
        minHeight: collapsed ? "auto" : "200px",
        maxHeight: collapsed ? "auto" : "600px",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <button
          onClick={onToggleCollapsed}
          className="font-display text-lg flex items-center gap-2 hover:opacity-80 transition-opacity text-moon-50"
        >
          {collapsed ? (
            <ChevronDown className="w-4 h-4 text-moon-450" />
          ) : (
            <ChevronUp className="w-4 h-4 text-moon-450" />
          )}
          <Zap className="w-5 h-5 text-gold" />
          Generated batches
          <span className="text-xs px-2 py-0.5 rounded bg-moon-700 text-moon-450">
            {batches.length}
          </span>
        </button>
        <div className="flex items-center gap-2">
          {executingBatchId && (
            <span className="text-xs flex items-center gap-1 text-teal">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Running...
            </span>
          )}
          {selectedBatchIds.size > 0 && (
            <>
              <label className="flex items-center gap-1.5 cursor-pointer text-xs text-moon-450">
                <input
                  type="checkbox"
                  checked={selectedBatchIds.size === batches.length}
                  onChange={(e) => {
                    if (e.target.checked)
                      setSelectedBatchIds(new Set(batches.map((b) => b.id)));
                    else setSelectedBatchIds(new Set());
                  }}
                  className="w-3.5 h-3.5 rounded accent-gold"
                />
                All
              </label>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="text-xs px-2 py-1 rounded flex items-center gap-1 text-red-400 bg-red-500/10"
              >
                <Trash2 className="w-3 h-3" />
                Delete {selectedBatchIds.size}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      {!collapsed && (
        <div className="mt-3 flex-1 flex flex-col overflow-hidden">
          {batches.length > 0 ? (
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {batches.map((batch) => (
                <BatchCard
                  key={batch.id}
                  batch={batch}
                  isSelected={selectedBatch?.id === batch.id}
                  isChecked={selectedBatchIds.has(batch.id)}
                  executingBatchId={executingBatchId}
                  copiedBatchId={copiedBatchId}
                  onCheck={(checked) => {
                    const newSet = new Set(selectedBatchIds);
                    if (checked) newSet.add(batch.id);
                    else newSet.delete(batch.id);
                    setSelectedBatchIds(newSet);
                  }}
                  onSelect={() => onSelectBatch(batch.id)}
                  onDeselect={onDeselectBatch}
                  onCopyId={() => copyBatchId(batch.id)}
                  onDelete={() => onDeleteBatch(batch.id)}
                  onExecute={() => onExecuteBatch(batch.id, batch.name)}
                  onStop={onStopExecution}
                  onReset={(onlyFailed) => onResetBatch(batch.id, onlyFailed)}
                />
              ))}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-moon-450">
              <div className="text-center">
                <Zap className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No batches yet</p>
                <p className="text-xs">Generate one using the button above</p>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onConfirm={handleDeleteSelectedBatches}
        onCancel={() => setShowDeleteConfirm(false)}
        title="Delete Selected Batches?"
        message={`Are you sure you want to delete ${selectedBatchIds.size} selected batches and all their queries? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
});

