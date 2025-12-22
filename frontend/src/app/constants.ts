/**
 * Application Constants
 * 
 * Centralizes magic strings and configuration values to avoid hardcoding
 * and make the codebase more maintainable.
 */

// =============================================================================
// Session Filters
// =============================================================================

/** Special filter value to show only sessions not linked to any batch */
export const ORGANIC_FILTER = "__organic__";

// Display strings
export const ORGANIC_DISPLAY_NAME = "Organic (no batch)";

// =============================================================================
// UI Layout Constants
// =============================================================================

/** 
 * Offset for thread list height calculation
 * Accounts for: header (80px) + tabs (50px) + filters (200px) + padding (190px)
 */
export const THREAD_LIST_HEADER_OFFSET = 520;

/**
 * Offset for conversation view height calculation  
 * Accounts for: header, tabs, thread info, notes input, padding
 */
export const CONVERSATION_VIEW_HEADER_OFFSET = 650;

// =============================================================================
// Timing Constants
// =============================================================================

/** How often to batch UI updates during SSE streaming (in event count) */
export const SSE_BATCH_UPDATE_INTERVAL = 10;

/** Delay before clearing progress indicators after completion (ms) */
export const PROGRESS_CLEAR_DELAY_MS = 3000;

/** Interval for background agent health checks (ms) */
export const AGENT_HEALTH_CHECK_INTERVAL_MS = 30000;

/** Initial sync polling interval (ms) */
export const SYNC_POLL_INITIAL_INTERVAL_MS = 1000;

/** Maximum sync polling interval (ms) */
export const SYNC_POLL_MAX_INTERVAL_MS = 5000;

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

