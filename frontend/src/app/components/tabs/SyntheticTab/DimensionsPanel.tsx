"use client";

/**
 * DimensionsPanel - Testing dimensions management panel
 *
 * Extracted from SyntheticTab to reduce component size and re-renders.
 * Uses React.memo to prevent unnecessary re-renders when other state changes.
 * 
 * Features:
 * - Empty state with "Add manually" + "Generate with AI" CTAs
 * - Testing goals input for targeted AI suggestions
 * - Per-bucket "suggest more values" button
 * - Favorites (starred values get 5x sampling weight)
 * - Heatmap showing value usage distribution
 * - Prompt editing via drawer
 */

import React, { useState, memo } from "react";
import {
  Target,
  Plus,
  Trash2,
  Edit3,
  ChevronDown,
  ChevronUp,
  Star,
  Sparkles,
  Loader2,
  Settings2,
  MoreHorizontal,
  RotateCcw,
  Square,
  CheckSquare,
} from "lucide-react";
import type { Dimension } from "../../../types";
import * as api from "../../../lib/api";
import { ConfirmDialog } from "../../ui";
import { PromptEditDrawer } from "../../PromptEditDrawer";

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
  // Favorites and heatmap support
  favorites?: Record<string, string[]>; // dim_name -> favorite values
  onFavoritesChange?: (favorites: Record<string, string[]>) => void;
  seenCounts?: Record<string, Record<string, number>>; // dim_name -> value -> count
  isGenerating?: boolean;
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
  favorites = {},
  onFavoritesChange,
  seenCounts = {},
  isGenerating = false,
}: DimensionsPanelProps) {
  // Local editing state
  const [editingDimension, setEditingDimension] = useState<string | null>(null);
  const [newDimensionName, setNewDimensionName] = useState("");
  const [newDimensionValues, setNewDimensionValues] = useState("");
  const [showAddDimension, setShowAddDimension] = useState(false);
  
  // Delete confirmation state
  const [deletingDimension, setDeletingDimension] = useState<string | null>(null);
  
  // Bulk selection state
  const [selectedDimensions, setSelectedDimensions] = useState<Set<string>>(new Set());
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  
  // AI generation state
  const [isGeneratingDimensions, setIsGeneratingDimensions] = useState(false);
  const [suggestingValuesFor, setSuggestingValuesFor] = useState<string | null>(null);
  const [suggestedDimensions, setSuggestedDimensions] = useState<api.SuggestedDimension[] | null>(null);
  
  // Testing goals for AI generation
  const [testingGoals, setTestingGoals] = useState("");
  const [showTestingGoalsInput, setShowTestingGoalsInput] = useState(false);
  
  // Prompt editing
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  
  // More options menu
  const [showMoreMenu, setShowMoreMenu] = useState(false);

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
    try {
      await api.deleteDimension(agentId, dimName);
      await onDimensionsChanged(agentId);
    } catch (error) {
      console.error("Error deleting dimension:", error);
    } finally {
      setDeletingDimension(null);
    }
  };

  const handleClearAllDimensions = async () => {
    try {
      for (const dim of dimensions) {
        await api.deleteDimension(agentId, dim.name);
      }
      await onDimensionsChanged(agentId);
      setSelectedDimensions(new Set());
    } catch (error) {
      console.error("Error clearing dimensions:", error);
    } finally {
      setShowClearAllConfirm(false);
    }
  };

  const handleBulkDelete = async () => {
    try {
      for (const dimName of selectedDimensions) {
        await api.deleteDimension(agentId, dimName);
      }
      await onDimensionsChanged(agentId);
      setSelectedDimensions(new Set());
    } catch (error) {
      console.error("Error bulk deleting dimensions:", error);
    } finally {
      setShowBulkDeleteConfirm(false);
    }
  };

  const toggleDimensionSelection = (dimName: string) => {
    setSelectedDimensions((prev) => {
      const next = new Set(prev);
      if (next.has(dimName)) {
        next.delete(dimName);
      } else {
        next.add(dimName);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedDimensions.size === dimensions.length) {
      setSelectedDimensions(new Set());
    } else {
      setSelectedDimensions(new Set(dimensions.map((d) => d.name)));
    }
  };

  const toggleFavorite = (dimName: string, value: string) => {
    if (!onFavoritesChange) return;
    
    const currentFavorites = favorites[dimName] || [];
    const isFavorite = currentFavorites.includes(value);
    
    const newFavorites = {
      ...favorites,
      [dimName]: isFavorite
        ? currentFavorites.filter((v) => v !== value)
        : [...currentFavorites, value],
    };
    
    // Clean up empty arrays
    if (newFavorites[dimName].length === 0) {
      delete newFavorites[dimName];
    }
    
    onFavoritesChange(newFavorites);
  };

  const getHeatColor = (dimName: string, value: string): string => {
    const count = seenCounts[dimName]?.[value] || 0;
    if (count === 0) return "";
    
    // Calculate max seen for this dimension
    const dimCounts = seenCounts[dimName] || {};
    const maxCount = Math.max(...Object.values(dimCounts), 1);
    const intensity = count / maxCount;
    
    // Gradient from dim teal to bright teal
    const opacity = 0.1 + intensity * 0.4;
    return `rgba(94, 234, 212, ${opacity})`;
  };

  // ========== AI GENERATION HANDLERS ==========

  const handleGenerateWithAI = async () => {
    setIsGeneratingDimensions(true);
    setSuggestedDimensions(null);
    try {
      const response = await api.suggestDimensions(
        agentId,
        testingGoals.trim() || undefined
      );
      setSuggestedDimensions(response.dimensions);
      setShowTestingGoalsInput(false);
    } catch (error) {
      console.error("Error generating dimensions:", error);
    } finally {
      setIsGeneratingDimensions(false);
    }
  };

  const handleAcceptSuggestedDimension = async (dim: api.SuggestedDimension) => {
    try {
      // Convert suggested values to string array (using labels)
      const values = dim.values.map((v) => v.label || v.id);
      await api.saveDimension(agentId, dim.name, values);
      await onDimensionsChanged(agentId);
      
      // Remove from suggestions
      setSuggestedDimensions((prev) =>
        prev ? prev.filter((d) => d.name !== dim.name) : null
      );
    } catch (error) {
      console.error("Error saving suggested dimension:", error);
    }
  };

  const handleAcceptAllSuggestions = async () => {
    if (!suggestedDimensions) return;
    
    for (const dim of suggestedDimensions) {
      try {
        const values = dim.values.map((v) => v.label || v.id);
        await api.saveDimension(agentId, dim.name, values);
      } catch (error) {
        console.error(`Error saving dimension ${dim.name}:`, error);
      }
    }
    
    await onDimensionsChanged(agentId);
    setSuggestedDimensions(null);
  };

  const handleDismissSuggestions = () => {
    setSuggestedDimensions(null);
  };

  const handleSuggestMoreValues = async (dimName: string) => {
    setSuggestingValuesFor(dimName);
    try {
      const response = await api.suggestBucketValues(agentId, dimName, 5);
      
      // Find the current dimension and add the new values
      const currentDim = dimensions.find((d) => d.name === dimName);
      if (currentDim) {
        const newValues = response.new_values.map((v) => v.label || v.id);
        const mergedValues = [...currentDim.values, ...newValues];
        await api.saveDimension(agentId, dimName, mergedValues);
        await onDimensionsChanged(agentId);
      }
    } catch (error) {
      console.error("Error suggesting values:", error);
    } finally {
      setSuggestingValuesFor(null);
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
          {/* Bulk delete button (shown when items selected) */}
          {selectedDimensions.size > 0 && (
            <button
              onClick={() => setShowBulkDeleteConfirm(true)}
              className="text-xs px-3 py-1.5 rounded transition-colors flex items-center gap-1.5 bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete {selectedDimensions.size}
            </button>
          )}
          
          {/* Generate with AI button (prominent) */}
          {dimensions.length > 0 && selectedDimensions.size === 0 && (
            <button
              onClick={() => setShowTestingGoalsInput(true)}
              disabled={isGeneratingDimensions}
              className="text-xs px-3 py-1.5 rounded transition-colors flex items-center gap-1.5 bg-gold/20 text-gold border border-gold/30 hover:bg-gold/30"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Generate more
            </button>
          )}
          
          {/* More options menu */}
          <div className="relative">
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="p-1.5 rounded transition-colors bg-moon-800 text-moon-450 border border-moon-700 hover:bg-moon-700"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            
            {showMoreMenu && (
              <>
                {/* Backdrop to close menu */}
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowMoreMenu(false)} 
                />
                
                <div className="absolute right-0 top-full mt-1 w-56 rounded-lg z-50 bg-moon-800 border border-moon-700 shadow-xl overflow-hidden">
                  {/* Clear all dimensions */}
                  {dimensions.length > 0 && (
                    <>
                      <button
                        onClick={() => {
                          setShowClearAllConfirm(true);
                          setShowMoreMenu(false);
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 hover:bg-moon-700 transition-colors text-red-400"
                      >
                        <RotateCcw className="w-4 h-4" />
                        <span>Clear all & start fresh</span>
                      </button>
                      
                      <div className="border-t border-moon-700" />
                    </>
                  )}
                  
                  {/* Edit prompts */}
                  <button
                    onClick={() => {
                      setEditingPromptId("dimension_suggestion");
                      setShowMoreMenu(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 hover:bg-moon-700 transition-colors text-moon-200"
                  >
                    <Settings2 className="w-4 h-4 text-moon-450" />
                    <span>Edit dimension prompt</span>
                  </button>
                  
                  <button
                    onClick={() => {
                      setEditingPromptId("value_suggestion");
                      setShowMoreMenu(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 hover:bg-moon-700 transition-colors text-moon-200"
                  >
                    <Settings2 className="w-4 h-4 text-moon-450" />
                    <span>Edit value prompt</span>
                  </button>
                </div>
              </>
            )}
          </div>
          
          <button
            onClick={() => setShowAddDimension(true)}
            className="p-1.5 rounded transition-colors bg-gold text-moon-900"
            title="Add dimension manually"
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
            {/* Testing Goals Input (shown when generating) */}
            {showTestingGoalsInput && !suggestedDimensions && (
              <div className="mb-4 p-4 rounded-lg border border-gold/50 bg-gold/5">
                <h4 className="text-sm font-medium text-gold flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4" />
                  What do you want to test?
                </h4>
                <p className="text-xs text-moon-400 mb-3">
                  Describe your testing goals to get more targeted dimension suggestions.
                  Leave empty for generic dimensions.
                </p>
                <textarea
                  value={testingGoals}
                  onChange={(e) => setTestingGoals(e.target.value)}
                  placeholder="e.g., Edge cases around refunds, frustrated customers, complex multi-step requests..."
                  rows={3}
                  className="w-full px-3 py-2 rounded text-sm mb-3 bg-moon-900 border border-moon-700 text-moon-50 placeholder:text-moon-600"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleGenerateWithAI}
                    disabled={isGeneratingDimensions}
                    className="px-4 py-2 rounded text-sm font-medium flex items-center gap-2 bg-gold text-moon-900 hover:bg-gold/90 transition-colors disabled:opacity-50"
                  >
                    {isGeneratingDimensions ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Generate Dimensions
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setShowTestingGoalsInput(false);
                      setTestingGoals("");
                    }}
                    className="px-4 py-2 rounded text-sm bg-moon-700 text-moon-400 hover:bg-moon-600"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Suggested Dimensions Preview (from AI) */}
            {suggestedDimensions && suggestedDimensions.length > 0 && (
              <div className="mb-4 p-4 rounded-lg border-2 border-dashed border-gold/50 bg-gold/5">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-gold flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    AI-Suggested Dimensions
                  </h4>
                  <div className="flex gap-2">
                    <button
                      onClick={handleAcceptAllSuggestions}
                      className="text-xs px-3 py-1.5 rounded bg-gold text-moon-900 font-medium"
                    >
                      Accept All
                    </button>
                    <button
                      onClick={handleDismissSuggestions}
                      className="text-xs px-3 py-1.5 rounded bg-moon-700 text-moon-450"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {suggestedDimensions.map((dim) => (
                    <div
                      key={dim.name}
                      className="p-3 rounded-lg bg-moon-800 border border-moon-700"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm text-moon-50">
                          {dim.name}
                        </span>
                        <button
                          onClick={() => handleAcceptSuggestedDimension(dim)}
                          className="text-xs px-2 py-1 rounded bg-gold/20 text-gold hover:bg-gold/30"
                        >
                          Add
                        </button>
                      </div>
                      {dim.description && (
                        <p className="text-xs text-moon-450 mb-2">{dim.description}</p>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        {dim.values.map((val, j) => (
                          <span
                            key={j}
                            className="text-xs px-2 py-1 rounded bg-moon-700 text-moon-300"
                          >
                            {val.label || val.id}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {dimensions.length > 0 ? (
              <>
                {/* Select all bar (shown when at least one selected) */}
                {dimensions.length > 1 && (
                  <div className="flex items-center gap-3 mb-2 pb-2 border-b border-moon-700/50">
                    <button
                      onClick={toggleSelectAll}
                      className="flex items-center gap-2 text-xs text-moon-400 hover:text-moon-200 transition-colors"
                    >
                      {selectedDimensions.size === dimensions.length ? (
                        <CheckSquare className="w-4 h-4 text-gold" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                      {selectedDimensions.size === dimensions.length ? "Deselect all" : "Select all"}
                    </button>
                    {selectedDimensions.size > 0 && (
                      <span className="text-xs text-moon-500">
                        {selectedDimensions.size} of {dimensions.length} selected
                      </span>
                    )}
                  </div>
                )}
                
                {dimensions.map((dim) => {
                  const isSelected = selectedDimensions.has(dim.name);
                  
                  return (
                    <div
                      key={dim.id}
                      className={`rounded-lg p-3 bg-moon-800 border transition-colors ${
                        isSelected ? "border-gold/50 bg-gold/5" : "border-moon-700"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {/* Checkbox */}
                          <button
                            onClick={() => toggleDimensionSelection(dim.name)}
                            className="transition-colors"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-gold" />
                            ) : (
                              <Square className="w-4 h-4 text-moon-500 hover:text-moon-300" />
                            )}
                          </button>
                          
                          <span className="font-medium text-sm text-moon-50">
                            {dim.name}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded bg-moon-700 text-moon-450">
                            {dim.values?.length || 0}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          {/* Suggest more values button */}
                          <button
                            onClick={() => handleSuggestMoreValues(dim.name)}
                            disabled={suggestingValuesFor === dim.name}
                            className="p-1.5 rounded transition-colors text-gold/70 hover:text-gold disabled:opacity-50"
                            title="Suggest more values with AI"
                          >
                            {suggestingValuesFor === dim.name ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="w-3.5 h-3.5" />
                            )}
                          </button>
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
                            onClick={() => setDeletingDimension(dim.name)}
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
                      {dim.values?.map((val, j) => {
                        const isFavorite = favorites[dim.name]?.includes(val) || false;
                        const seenCount = seenCounts[dim.name]?.[val] || 0;
                        const heatColor = getHeatColor(dim.name, val);
                        
                        return (
                          <div
                            key={j}
                            className={`group relative flex items-center gap-1 text-xs px-2 py-1 rounded transition-all ${
                              isFavorite ? "ring-1 ring-gold/50" : ""
                            }`}
                            style={{
                              backgroundColor: heatColor || "rgb(55, 55, 60)",
                            }}
                          >
                            {/* Star toggle */}
                            {onFavoritesChange && (
                              <button
                                onClick={() => toggleFavorite(dim.name, val)}
                                className={`transition-colors ${
                                  isFavorite ? "text-gold" : "text-moon-600 hover:text-moon-400"
                                }`}
                                title={isFavorite ? "Remove from favorites" : "Add to favorites (5x weight)"}
                              >
                                <Star
                                  className={`w-3 h-3 ${isFavorite ? "fill-current" : ""}`}
                                />
                              </button>
                            )}
                            
                            {/* Value text */}
                            <span className="text-moon-50">{val}</span>
                            
                            {/* Seen count badge - persists after generation */}
                            {seenCount > 0 && (
                              <span 
                                className={`ml-1 px-1.5 py-0.5 text-[10px] rounded font-mono transition-all ${
                                  isGenerating 
                                    ? "bg-teal/30 text-teal animate-pulse" 
                                    : "bg-moon-700 text-moon-450"
                                }`}
                              >
                                {seenCount}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </>
            ) : !suggestedDimensions && !showTestingGoalsInput ? (
              <div className="flex-1 flex items-center justify-center text-moon-450">
                <div className="text-center max-w-md">
                  <Target className="w-12 h-12 mx-auto mb-4 opacity-40" />
                  <h3 className="text-base font-medium text-moon-200 mb-2">
                    Testing Dimensions
                  </h3>
                  <p className="text-sm mb-4 leading-relaxed">
                    Buckets (dimensions) are how we slice your test space: 
                    persona, scenario, complexity, etc. Each bucket has values 
                    that we combine to generate diverse test queries.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                      onClick={() => setShowAddDimension(true)}
                      className="px-4 py-2 rounded text-sm font-medium flex items-center justify-center gap-2 bg-moon-700 text-moon-200 hover:bg-moon-600 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Add bucket manually
                    </button>
                    <button
                      onClick={() => setShowTestingGoalsInput(true)}
                      className="px-4 py-2 rounded text-sm font-medium flex items-center justify-center gap-2 bg-gold text-moon-900 hover:bg-gold/90 transition-colors"
                    >
                      <Sparkles className="w-4 h-4" />
                      Generate with AI
                    </button>
                  </div>
                  <p className="text-xs mt-4 text-gold">
                    ⚠️ Define at least one dimension to generate queries
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
      
      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deletingDimension}
        onConfirm={() => deletingDimension && handleDeleteDimension(deletingDimension)}
        onCancel={() => setDeletingDimension(null)}
        title="Delete Dimension?"
        message={`Are you sure you want to delete the dimension "${deletingDimension}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
      
      {/* Clear All Confirmation Dialog */}
      <ConfirmDialog
        open={showClearAllConfirm}
        onConfirm={handleClearAllDimensions}
        onCancel={() => setShowClearAllConfirm(false)}
        title="Clear All Dimensions?"
        message={`This will delete all ${dimensions.length} dimensions. You can then generate new dimensions for a different testing goal. This action cannot be undone.`}
        confirmText="Clear All"
        variant="danger"
      />
      
      {/* Bulk Delete Confirmation Dialog */}
      <ConfirmDialog
        open={showBulkDeleteConfirm}
        onConfirm={handleBulkDelete}
        onCancel={() => setShowBulkDeleteConfirm(false)}
        title="Delete Selected Dimensions?"
        message={`Are you sure you want to delete ${selectedDimensions.size} selected dimension${selectedDimensions.size > 1 ? "s" : ""}? This action cannot be undone.`}
        confirmText="Delete Selected"
        variant="danger"
      />
      
      {/* Prompt Edit Drawer */}
      <PromptEditDrawer
        isOpen={!!editingPromptId}
        onClose={() => setEditingPromptId(null)}
        promptId={editingPromptId || ""}
      />
    </div>
  );
});

