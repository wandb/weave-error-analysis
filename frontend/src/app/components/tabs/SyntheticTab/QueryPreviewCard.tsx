"use client";

/**
 * QueryPreviewCard - Expandable card for query preview in batch data view
 *
 * Extracted from SyntheticTab to reduce re-renders during batch preview.
 * Uses React.memo to prevent unnecessary re-renders when scrolling/other updates.
 */

import React, { useState, memo } from "react";
import {
  ChevronDown,
  RefreshCw,
  Copy,
  Check,
  Edit3,
  Tag,
  Bot,
  Zap,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { StatusBadge } from "../../ui";
import type { SyntheticQuery } from "../../../types";

// ============================================================================
// Types
// ============================================================================

interface QueryPreviewCardProps {
  query: SyntheticQuery;
  index: number;
  totalCount: number;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: (selected: boolean) => void;
  onToggleExpand: () => void;
  onEdit: (newText: string) => void;
  onViewInThreads: (sessionId: string) => void;
}

// ============================================================================
// Component
// ============================================================================

export const QueryPreviewCard = memo(function QueryPreviewCard({
  query,
  index,
  totalCount,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
  onEdit,
  onViewInThreads,
}: QueryPreviewCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(query.query_text); // Controlled input for editing
  const [copiedQueryId, setCopiedQueryId] = useState(false);

  const isExecuted =
    query.execution_status === "success" || query.execution_status === "error";
  const tags = Object.entries(query.tuple_values || {});

  const copyQueryText = () => {
    navigator.clipboard.writeText(query.query_text);
    setCopiedQueryId(true);
    setTimeout(() => setCopiedQueryId(false), 2000);
  };

  return (
    <div className="border-b transition-colors border-moon-700">
      {/* Collapsed Row Header - Always visible */}
      <button
        onClick={onToggleExpand}
        className="w-full grid gap-4 px-4 py-3 text-left transition-colors hover:bg-white/5 items-center grid-cols-[24px_60px_80px_1fr_auto]"
      >
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={isSelected}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            onToggleSelect(e.target.checked);
          }}
          className="w-4 h-4 rounded accent-gold"
        />

        {/* Index */}
        <span className="text-xs font-mono px-2 py-1 rounded text-center bg-moon-700 text-moon-450">
          {index + 1}/{totalCount}
        </span>

        {/* Status */}
        <div className="flex items-center gap-1">
          {query.execution_status === "running" && (
            <RefreshCw className="w-3 h-3 animate-spin text-gold" />
          )}
          <StatusBadge status={query.execution_status || "pending"} />
        </div>

        {/* Query Preview */}
        <div className="min-w-0 flex items-center gap-2">
          <ChevronDown
            className={`w-4 h-4 flex-shrink-0 transition-transform text-moon-450 ${
              isExpanded ? "rotate-180" : ""
            }`}
          />
          <span className="text-sm truncate text-moon-50">
            {query.query_text.slice(0, 100)}
            {query.query_text.length > 100 ? "..." : ""}
          </span>
        </div>

        {/* Tags */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {tags.slice(0, 3).map(([key, val]) => (
            <span
              key={key}
              className="text-xs px-2 py-0.5 rounded bg-teal/15 text-teal"
            >
              {val}
            </span>
          ))}
          {tags.length > 3 && (
            <span className="text-xs text-moon-450">+{tags.length - 3}</span>
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 bg-moon-900/50">
          {/* Full Query */}
          {isEditing ? (
            <div className="space-y-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={4}
                autoFocus
                className="w-full px-3 py-2 rounded text-sm bg-moon-900 border border-gold text-moon-50"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    onEdit(editText);
                    setIsEditing(false);
                  }}
                  className="text-xs px-3 py-1.5 rounded font-medium bg-gold text-moon-900"
                >
                  SAVE
                </button>
                <button
                  onClick={() => {
                    setEditText(query.query_text); // Reset to original on cancel
                    setIsEditing(false);
                  }}
                  className="text-xs px-3 py-1.5 rounded bg-moon-700 text-moon-450"
                >
                  CANCEL
                </button>
              </div>
            </div>
          ) : (
            <div
              className={`p-4 rounded-lg bg-moon-900 border border-moon-700 ${
                !isExecuted ? "cursor-pointer group" : ""
              }`}
              onClick={() => !isExecuted && setIsEditing(true)}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded flex items-center justify-center bg-moon-700">
                    <span className="text-xs text-moon-50">Q</span>
                  </div>
                  <span className="text-xs font-medium uppercase tracking-wider text-moon-450">
                    User Query
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    copyQueryText();
                  }}
                  className={`p-1.5 rounded transition-colors hover:bg-white/10 ${
                    copiedQueryId ? "text-teal" : "text-moon-450"
                  }`}
                  title="Copy query text"
                >
                  {copiedQueryId ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-moon-50">
                {query.query_text}
              </p>
              {!isExecuted && (
                <span className="text-xs opacity-0 group-hover:opacity-100 transition-opacity mt-2 inline-block text-moon-450">
                  Click to edit
                </span>
              )}
            </div>
          )}

          {/* Call Metrics Indicator */}
          {isExecuted && query.call_count && query.call_count > 1 && (
            <button
              onClick={() => query.session_id && onViewInThreads(query.session_id)}
              className="flex items-center justify-center gap-3 py-2 px-4 rounded-lg transition-all hover:bg-white/5 group/metrics bg-gold/5 border border-dashed border-gold/30"
            >
              <div className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-gold" />
                <span className="text-xs text-gold">{query.call_count} calls</span>
              </div>
              {query.total_latency_ms && (
                <>
                  <span className="text-moon-700">•</span>
                  <span className="text-xs text-moon-450">
                    {query.total_latency_ms >= 1000
                      ? `${(query.total_latency_ms / 1000).toFixed(1)}s`
                      : `${Math.round(query.total_latency_ms)}ms`}
                  </span>
                </>
              )}
              <span className="text-xs opacity-0 group-hover/metrics:opacity-100 transition-opacity flex items-center gap-1 text-teal">
                View details <ExternalLink className="w-3 h-3" />
              </span>
            </button>
          )}

          {/* Full Response */}
          {query.response_text && (
            <div className="p-4 rounded-lg bg-moon-900 border border-teal/30">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded flex items-center justify-center bg-teal/20">
                  <Bot className="w-3.5 h-3.5 text-teal" />
                </div>
                <span className="text-xs font-medium uppercase tracking-wider text-teal">
                  Agent Response
                </span>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-moon-50">
                {query.response_text}
              </p>
            </div>
          )}

          {/* Error Message */}
          {query.error_message && (
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded flex items-center justify-center bg-red-500/20">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                </div>
                <span className="text-xs font-medium uppercase tracking-wider text-red-500">
                  Error
                </span>
              </div>
              <p className="text-sm leading-relaxed text-red-300">
                {query.error_message}
              </p>
            </div>
          )}

          {/* All Tags */}
          {tags.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap pt-2">
              <span className="text-xs uppercase tracking-wider text-moon-450">
                Tags:
              </span>
              {tags.map(([key, val]) => (
                <span
                  key={key}
                  className="text-xs px-2 py-1 rounded flex items-center gap-1 bg-teal/15 text-teal"
                >
                  <Tag className="w-3 h-3 opacity-50" />
                  <span className="text-moon-450">{key}:</span> {val}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

