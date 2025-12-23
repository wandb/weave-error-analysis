/**
 * Keyboard Shortcuts Hook
 * 
 * Provides keyboard navigation for power users.
 * 
 * Global Shortcuts:
 *   A - Switch to Agents tab
 *   S - Switch to Synthetic tab
 *   X - Switch to Taxonomy tab
 *   R - Refresh current tab data
 */

import { useEffect, useCallback } from "react";

export interface KeyboardShortcutHandlers {
  // Tab navigation
  goToAgents: () => void;
  goToSynthetic: () => void;
  goToTaxonomy: () => void;
  
  // Global actions
  refresh: () => void;
  
  // Current tab for context-aware shortcuts
  activeTab: string;
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Don't trigger shortcuts when typing in input/textarea
    const target = event.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();
    const isEditable = target.isContentEditable;
    
    if (tagName === "input" || tagName === "textarea" || isEditable) {
      // Only allow Escape in inputs
      if (event.key === "Escape") {
        target.blur();
      }
      return;
    }

    // Don't trigger shortcuts with modifier keys (except for combinations we define)
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    switch (event.key.toLowerCase()) {
      // Tab navigation (single letter keys)
      case "a":
        event.preventDefault();
        handlers.goToAgents();
        break;
        
      case "s":
        event.preventDefault();
        handlers.goToSynthetic();
        break;
        
      case "x":
        event.preventDefault();
        handlers.goToTaxonomy();
        break;
        
      // Global actions
      case "r":
        event.preventDefault();
        handlers.refresh();
        break;
    }
  }, [handlers]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}

/**
 * Get formatted list of keyboard shortcuts for display
 */
export function getShortcutsList(): Array<{ key: string; description: string; context?: string }> {
  return [
    { key: "A", description: "Go to Agents tab" },
    { key: "S", description: "Go to Synthetic tab" },
    { key: "X", description: "Go to Taxonomy tab" },
    { key: "R", description: "Refresh current tab" },
  ];
}

