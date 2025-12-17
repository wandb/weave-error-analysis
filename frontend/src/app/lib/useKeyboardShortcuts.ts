/**
 * Keyboard Shortcuts Hook
 * 
 * Provides keyboard navigation for power users.
 * 
 * Global Shortcuts:
 *   T - Switch to Threads tab
 *   A - Switch to Agents tab
 *   X - Switch to Taxonomy tab
 *   S - Switch to Synthetic tab
 *   R - Refresh current tab data
 *   ? - Show keyboard shortcuts help (TODO)
 * 
 * Threads Tab Shortcuts:
 *   N - Mark current session as reviewed and go to next
 *   ← - Previous session in list
 *   → - Next session in list
 *   Escape - Deselect session
 */

import { useEffect, useCallback } from "react";

export interface KeyboardShortcutHandlers {
  // Tab navigation
  goToAgents: () => void;
  goToSynthetic: () => void;
  goToThreads: () => void;
  goToTaxonomy: () => void;
  
  // Global actions
  refresh: () => void;
  
  // Threads tab actions
  markReviewedAndNext?: () => void;
  previousSession?: () => void;
  nextSession?: () => void;
  deselectSession?: () => void;
  
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
        
      case "t":
        event.preventDefault();
        handlers.goToThreads();
        break;
        
      case "x":
        // X for taXonomy (T is taken by Threads)
        event.preventDefault();
        handlers.goToTaxonomy();
        break;
        
      // Global actions
      case "r":
        event.preventDefault();
        handlers.refresh();
        break;
        
      // Threads tab actions
      case "n":
        if (handlers.activeTab === "threads" && handlers.markReviewedAndNext) {
          event.preventDefault();
          handlers.markReviewedAndNext();
        }
        break;
        
      case "arrowleft":
        if (handlers.activeTab === "threads" && handlers.previousSession) {
          event.preventDefault();
          handlers.previousSession();
        }
        break;
        
      case "arrowright":
        if (handlers.activeTab === "threads" && handlers.nextSession) {
          event.preventDefault();
          handlers.nextSession();
        }
        break;
        
      case "escape":
        if (handlers.activeTab === "threads" && handlers.deselectSession) {
          event.preventDefault();
          handlers.deselectSession();
        }
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
    // Global
    { key: "A", description: "Go to Agents tab" },
    { key: "S", description: "Go to Synthetic tab" },
    { key: "T", description: "Go to Threads tab" },
    { key: "X", description: "Go to Taxonomy tab" },
    { key: "R", description: "Refresh current tab" },
    // Threads tab specific
    { key: "N", description: "Mark reviewed & go to next", context: "Threads tab" },
    { key: "←", description: "Previous session", context: "Threads tab" },
    { key: "→", description: "Next session", context: "Threads tab" },
    { key: "Esc", description: "Deselect session", context: "Threads tab" },
  ];
}

