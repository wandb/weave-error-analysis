"use client";

/**
 * DimensionsPanel - Testing dimensions management panel
 *
 * Extracted from SyntheticTab to reduce component size and re-renders.
 * Uses React.memo to prevent unnecessary re-renders when other state changes.
 */

import React, { useState, memo } from "react";
import {
  Target,
  Plus,
  Trash2,
  Edit3,
  ChevronDown,
  ChevronUp,
  Copy,
  HelpCircle,
} from "lucide-react";
import type { Dimension } from "../../../types";
import * as api from "../../../lib/api";

// ============================================================================
// Types
// ============================================================================

interface DimensionsPanelProps {
  agentId: string;
  dimensions: Dimension[];
  loadingDimensions: boolean;
  collapsed: boolean;
  panelHeight: number;
  onToggleCollapsed: () => void;
  onImportDimensions: (agentId: string) => Promise<void>;
  onDimensionsChanged: (agentId: string) => Promise<void>;
}

// ============================================================================
// Component
// ============================================================================

export const DimensionsPanel = memo(function DimensionsPanel({
  agentId,
  dimensions,
  loadingDimensions,
  collapsed,
  panelHeight,
  onToggleCollapsed,
  onImportDimensions,
  onDimensionsChanged,
}: DimensionsPanelProps) {
  // Local editing state
  const [editingDimension, setEditingDimension] = useState<string | null>(null);
  const [newDimensionName, setNewDimensionName] = useState("");
  const [newDimensionValues, setNewDimensionValues] = useState("");
  const [showAddDimension, setShowAddDimension] = useState(false);
  const [showImportHelp, setShowImportHelp] = useState(false);

  // ========== HANDLERS ==========

  const handleSaveDimension = async (dimName: string, values: string[]) => {
    try {
      await api.saveDimension(agentId, dimName, values);
      await onDimensionsChanged(agentId);
      setEditingDimension(null);
    } catch (error) {
      console.error("Error saving dimension:", error);
    }
  };

  const handleAddDimension = async () => {
    if (!newDimensionName || !newDimensionValues) return;
    const values = newDimensionValues
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    await handleSaveDimension(newDimensionName, values);
    setNewDimensionName("");
    setNewDimensionValues("");
    setShowAddDimension(false);
  };

  const handleDeleteDimension = async (dimName: string) => {
    if (!confirm(`Delete dimension "${dimName}"?`)) return;
    try {
      await api.deleteDimension(agentId, dimName);
      await onDimensionsChanged(agentId);
    } catch (error) {
      console.error("Error deleting dimension:", error);
    }
  };

  // ========== RENDER ==========

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
          <Target className="w-5 h-5 text-gold" />
          Testing dimensions
          <span className="text-xs px-2 py-0.5 rounded ml-1 bg-moon-700 text-moon-450">
            {dimensions.length}
          </span>
        </button>
        <div className="flex gap-2 items-center">
          {/* Import Button with Help Tooltip */}
          <div className="relative" onMouseLeave={() => setShowImportHelp(false)}>
            <button
              onClick={() => onImportDimensions(agentId)}
              disabled={loadingDimensions}
              className="text-xs px-3 py-1.5 rounded transition-colors flex items-center gap-1.5 bg-moon-800 text-moon-450 border border-moon-700"
            >
              {loadingDimensions ? "..." : "Import from AGENT_INFO"}
              <span
                className="cursor-help"
                onMouseEnter={() => setShowImportHelp(true)}
                onClick={(e) => e.stopPropagation()}
              >
                <HelpCircle
                  className={`w-3.5 h-3.5 ${
                    showImportHelp ? "text-gold" : "text-moon-450"
                  }`}
                />
              </span>
            </button>
            {/* Tooltip */}
            {showImportHelp && (
              <div
                className="absolute right-0 top-full mt-1 p-4 rounded-lg z-50 w-96 text-xs cursor-default bg-moon-800 border border-gold shadow-xl"
                onMouseEnter={() => setShowImportHelp(true)}
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="font-medium text-gold">
                    Expected AGENT_INFO format:
                  </p>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`## Testing Dimensions
- **personas**: first_time_user, power_user
- **complexity**: simple, multi_step
- **scenarios**: pricing_inquiry, refund`);
                    }}
                    className="text-xs px-2 py-1 rounded flex items-center gap-1 transition-colors hover:opacity-80 bg-moon-700 text-moon-450"
                  >
                    <Copy className="w-3 h-3" />
                    Copy template
                  </button>
                </div>
                <pre className="p-3 rounded text-xs overflow-x-auto mb-3 select-all bg-moon-900 text-moon-50">
                  {`## Testing Dimensions
- **personas**: first_time_user, power_user
- **complexity**: simple, multi_step
- **scenarios**: pricing_inquiry, refund`}
                </pre>
                <p className="text-moon-450">
                  Add a{" "}
                  <code className="px-1 rounded bg-moon-700">
                    ## Testing Dimensions
                  </code>{" "}
                  section with bullet points in the format{" "}
                  <code className="px-1 rounded bg-moon-700">
                    - **name**: value1, value2
                  </code>
                </p>
              </div>
            )}
          </div>
          <button
            onClick={() => setShowAddDimension(true)}
            className="p-1.5 rounded transition-colors bg-gold text-moon-900"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Collapsible Content */}
      {!collapsed && (
        <div className="mt-4 flex-1 flex flex-col overflow-hidden">
          {/* Add Dimension Form */}
          {showAddDimension && (
            <div className="rounded-lg p-4 mb-4 bg-moon-800 border border-gold">
              <h4 className="text-sm font-medium mb-3 text-moon-50">
                Add new dimension
              </h4>
              <input
                type="text"
                placeholder="Dimension name (e.g., user_mood)"
                value={newDimensionName}
                onChange={(e) => setNewDimensionName(e.target.value)}
                className="w-full px-3 py-2 rounded text-sm mb-2 bg-moon-900 border border-moon-700 text-moon-50"
              />
              <textarea
                placeholder="Values (comma-separated, e.g., happy, frustrated, confused)"
                value={newDimensionValues}
                onChange={(e) => setNewDimensionValues(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded text-sm mb-3 bg-moon-900 border border-moon-700 text-moon-50"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAddDimension}
                  className="text-xs px-4 py-2 rounded font-medium bg-gold text-moon-900"
                >
                  ADD
                </button>
                <button
                  onClick={() => {
                    setShowAddDimension(false);
                    setNewDimensionName("");
                    setNewDimensionValues("");
                  }}
                  className="text-xs px-4 py-2 rounded bg-moon-700 text-moon-450"
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}

          {/* Dimensions List */}
          <div className="space-y-3 flex-1 overflow-y-auto pr-1">
            {dimensions.length > 0 ? (
              dimensions.map((dim) => (
                <div
                  key={dim.id}
                  className="rounded-lg p-3 bg-moon-800 border border-moon-700"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-moon-50">
                        {dim.name}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded bg-moon-700 text-moon-450">
                        {dim.values?.length || 0}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() =>
                          setEditingDimension(
                            editingDimension === dim.id ? null : dim.id
                          )
                        }
                        className={`p-1.5 rounded transition-colors hover:bg-opacity-80 ${
                          editingDimension === dim.id
                            ? "text-gold"
                            : "text-moon-450"
                        }`}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteDimension(dim.name)}
                        className="p-1.5 rounded transition-colors text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {editingDimension === dim.id ? (
                    <textarea
                      defaultValue={dim.values.join(", ")}
                      rows={3}
                      className="w-full px-3 py-2 rounded text-sm bg-moon-900 border border-gold text-moon-50"
                      onBlur={(e) => {
                        const newValues = e.target.value
                          .split(",")
                          .map((v) => v.trim())
                          .filter(Boolean);
                        handleSaveDimension(dim.name, newValues);
                      }}
                      autoFocus
                    />
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {dim.values?.map((val, j) => (
                        <span
                          key={j}
                          className="text-xs px-2 py-1 rounded bg-moon-700 text-moon-50"
                        >
                          {val}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="flex-1 flex items-center justify-center text-moon-450">
                <div className="text-center">
                  <Target className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm mb-2">No dimensions defined yet</p>
                  <p className="text-xs mb-3">
                    Click &quot;Import from AGENT_INFO&quot; or add manually
                  </p>
                  <p className="text-xs text-gold">
                    ⚠️ Define at least one dimension to generate queries
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

