/**
 * Application Constants
 * 
 * Centralizes magic strings and configuration values to avoid hardcoding
 * and make the codebase more maintainable.
 */

// =============================================================================
// Timing Constants
// =============================================================================

/** How often to batch UI updates during SSE streaming (in event count) */
export const SSE_BATCH_UPDATE_INTERVAL = 10;

/** Delay before clearing progress indicators after completion (ms) */
export const PROGRESS_CLEAR_DELAY_MS = 3000;

/** Interval for background agent health checks (ms) */
export const AGENT_HEALTH_CHECK_INTERVAL_MS = 30000;

// =============================================================================
// Z-Index Scale
// =============================================================================

/** Standardized z-index values to prevent stacking conflicts */
export const Z_INDEX = {
  dropdown: 20,
  modalBackdrop: 40,
  modal: 50,
  tooltip: 60,
} as const;

