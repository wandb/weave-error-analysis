/**
 * User-Friendly Error Handling
 * 
 * Maps technical error messages to human-readable messages with
 * actionable troubleshooting hints.
 */

// Common error patterns and their friendly messages
const ERROR_MAPPINGS: Array<{
  pattern: RegExp | string;
  friendly: string;
  hint?: string;
}> = [
  // Connection errors
  {
    pattern: /ECONNREFUSED|Connection refused|Failed to fetch|fetch failed/i,
    friendly: "Cannot connect to the service",
    hint: "Make sure the backend server is running on port 8000.",
  },
  {
    pattern: /Agent not running|agent.*not.*running/i,
    friendly: "Agent is not running",
    hint: "Start your agent first, then try again.",
  },
  {
    pattern: /timeout|timed out|ETIMEDOUT/i,
    friendly: "Request timed out",
    hint: "The operation is taking too long. Check your network connection or try again.",
  },
  
  // Authentication errors
  {
    pattern: /401|Unauthorized|unauthorized/i,
    friendly: "Authentication failed",
    hint: "Check your API key in Settings.",
  },
  {
    pattern: /403|Forbidden|forbidden/i,
    friendly: "Access denied",
    hint: "You don't have permission for this operation.",
  },
  {
    pattern: /invalid.*api.*key|api.*key.*invalid/i,
    friendly: "Invalid API key",
    hint: "Check your API key in Settings. Make sure it's correctly copied.",
  },
  
  // Configuration errors
  {
    pattern: /Weave.*not.*configured|weave_project.*not.*set/i,
    friendly: "Weave is not configured",
    hint: "Set up your W&B API key and project in Settings.",
  },
  {
    pattern: /LLM.*not.*configured|llm.*api.*key/i,
    friendly: "LLM is not configured",
    hint: "Set up your LLM API key in Settings.",
  },
  {
    pattern: /target.*project.*not.*configured/i,
    friendly: "Target project not set",
    hint: "Configure the Weave project you want to analyze in Settings.",
  },
  
  // Rate limiting
  {
    pattern: /429|rate.*limit|too.*many.*requests/i,
    friendly: "Rate limit exceeded",
    hint: "Wait a moment and try again. The API is temporarily limiting requests.",
  },
  
  // Not found errors
  {
    pattern: /Session.*not.*found/i,
    friendly: "Session not found",
    hint: "The session may have been deleted or hasn't synced yet. Try refreshing.",
  },
  {
    pattern: /Agent.*not.*found/i,
    friendly: "Agent not found",
    hint: "The agent configuration may have been deleted.",
  },
  {
    pattern: /Batch.*not.*found/i,
    friendly: "Batch not found",
    hint: "The batch may have been deleted.",
  },
  {
    pattern: /404|not.*found/i,
    friendly: "Resource not found",
    hint: "The requested item doesn't exist or was deleted.",
  },
  
  // Server errors
  {
    pattern: /500|Internal.*Server.*Error|internal.*error/i,
    friendly: "Server error",
    hint: "Something went wrong on the server. Check the backend logs for details.",
  },
  {
    pattern: /502|Bad.*Gateway/i,
    friendly: "External service unavailable",
    hint: "A service this tool depends on is not responding. Try again shortly.",
  },
  {
    pattern: /503|Service.*Unavailable/i,
    friendly: "Service temporarily unavailable",
    hint: "The server is overloaded or under maintenance. Try again in a moment.",
  },
  
  // Database errors
  {
    pattern: /database.*error|sqlite|SQLITE/i,
    friendly: "Database error",
    hint: "A database operation failed. Try restarting the backend.",
  },
  
  // Validation errors
  {
    pattern: /validation.*error|invalid.*input/i,
    friendly: "Invalid input",
    hint: "Please check your input and try again.",
  },
  {
    pattern: /batch.*size.*must.*be/i,
    friendly: "Invalid batch size",
    hint: "Batch size must be between 1 and 100.",
  },
  
  // Network errors
  {
    pattern: /network.*error|ERR_NETWORK/i,
    friendly: "Network error",
    hint: "Check your internet connection and try again.",
  },
  {
    pattern: /CORS|cross.*origin/i,
    friendly: "Cross-origin error",
    hint: "The frontend and backend may be misconfigured. Check CORS settings.",
  },
];

export interface FriendlyError {
  message: string;
  hint?: string;
  originalMessage: string;
}

/**
 * Convert a technical error to a user-friendly message.
 * 
 * @param error - The error to convert (Error, string, or unknown)
 * @returns A FriendlyError with message, optional hint, and original message
 */
export function toFriendlyError(error: unknown): FriendlyError {
  // Extract the error message
  let originalMessage: string;
  if (error instanceof Error) {
    originalMessage = error.message;
  } else if (typeof error === "string") {
    originalMessage = error;
  } else if (typeof error === "object" && error !== null) {
    // Handle API error responses
    const obj = error as Record<string, unknown>;
    originalMessage = String(
      obj.message || obj.detail || obj.error || JSON.stringify(error)
    );
  } else {
    originalMessage = String(error);
  }

  // Try to match against known patterns
  for (const mapping of ERROR_MAPPINGS) {
    const matches =
      typeof mapping.pattern === "string"
        ? originalMessage.toLowerCase().includes(mapping.pattern.toLowerCase())
        : mapping.pattern.test(originalMessage);

    if (matches) {
      return {
        message: mapping.friendly,
        hint: mapping.hint,
        originalMessage,
      };
    }
  }

  // Default: return original message (but cleaned up)
  return {
    message: cleanErrorMessage(originalMessage),
    originalMessage,
  };
}

/**
 * Clean up an error message for display.
 * Removes technical prefixes and formats consistently.
 */
function cleanErrorMessage(message: string): string {
  // Remove common prefixes
  let cleaned = message
    .replace(/^Error:\s*/i, "")
    .replace(/^HTTPException:\s*/i, "")
    .replace(/^Fetch error:\s*/i, "")
    .trim();

  // Capitalize first letter
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  // Add period if missing
  if (cleaned.length > 0 && !/[.!?]$/.test(cleaned)) {
    cleaned += ".";
  }

  return cleaned;
}

/**
 * Format an error for display in the UI.
 * Returns a single string with message and hint.
 */
export function formatErrorForDisplay(error: unknown): string {
  const friendly = toFriendlyError(error);
  if (friendly.hint) {
    return `${friendly.message}. ${friendly.hint}`;
  }
  return friendly.message;
}

/**
 * Log an error with context for debugging while showing
 * a friendly message to the user.
 */
export function logError(
  context: string,
  error: unknown,
  additionalInfo?: Record<string, unknown>
): FriendlyError {
  const friendly = toFriendlyError(error);
  
  // Log for debugging
  console.error(`[${context}] ${friendly.originalMessage}`, {
    friendly: friendly.message,
    hint: friendly.hint,
    ...additionalInfo,
  });

  return friendly;
}

