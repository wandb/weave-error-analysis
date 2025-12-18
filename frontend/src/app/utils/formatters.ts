import { format, parseISO, formatDistanceToNow } from "date-fns";
import type { FailureMode, FailureModeStatus, Taxonomy } from "../types";

export function formatTime(isoString: string | null): string {
  if (!isoString) return "—";
  try {
    return format(parseISO(isoString), "MMM d, HH:mm");
  } catch {
    return isoString;
  }
}

export function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "—";
  try {
    return formatDistanceToNow(parseISO(isoString), { addSuffix: true });
  } catch {
    return isoString;
  }
}

export function formatTaxonomyForCopy(taxonomy: Taxonomy | null): string {
  if (!taxonomy?.failure_modes.length) return "";

  const formatted = taxonomy.failure_modes
    .map((mode, idx) => {
      const notes = taxonomy.notes?.filter((n) => mode.note_ids.includes(n.id)) || [];
      const notesList = notes.map((n) => `    - "${n.content}"`).join("\n");

      return `## ${idx + 1}. ${mode.name} [${mode.severity.toUpperCase()}]

**Description:** ${mode.description}

**Suggested Fix:** ${mode.suggested_fix || "N/A"}

**Occurrences:** ${mode.times_seen} times (Last seen: ${mode.last_seen_at ? formatRelativeTime(mode.last_seen_at) : "N/A"})

**Example Notes:**
${notesList || "    No notes"}
`;
    })
    .join("\n---\n\n");

  return `# Failure Mode Taxonomy

**Total Failure Modes:** ${taxonomy.failure_modes.length}
**Saturation Score:** ${Math.round((taxonomy.saturation?.saturation_score || 0) * 100)}%
**Status:** ${taxonomy.saturation?.status || "Unknown"}

---

${formatted}

---
*Generated from Error Analysis Tool*`;
}

export function formatSingleModeForCopy(mode: FailureMode, taxonomy: Taxonomy | null): string {
  const notes = taxonomy?.notes?.filter((n) => mode.note_ids.includes(n.id)) || [];
  const notesList = notes.map((n) => `- "${n.content}"`).join("\n");

  return `## ${mode.name} [${mode.severity.toUpperCase()}]

**Description:** ${mode.description}

**Suggested Fix:** ${mode.suggested_fix || "N/A"}

**Occurrences:** ${mode.times_seen} times

**Example Notes:**
${notesList || "No notes"}`;
}

export function getSeverityColor(severity: string): string {
  switch (severity) {
    case "high":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "medium":
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    case "low":
      return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    default:
      return "bg-ink-700 text-ink-300";
  }
}

export function getSeverityBorder(severity: string): string {
  switch (severity) {
    case "high":
      return "border-l-red-500";
    case "medium":
      return "border-l-amber-500";
    case "low":
      return "border-l-emerald-500";
    default:
      return "border-l-ink-600";
  }
}

export function calculateETA(startTime: number, completed: number, total: number): number | null {
  if (completed === 0 || completed >= total) return null;
  const elapsed = Date.now() - startTime;
  const avgTimePerItem = elapsed / completed;
  const remaining = total - completed;
  return Math.ceil((avgTimePerItem * remaining) / 1000);
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

// =============================================================================
// Status Utilities for Failure Modes
// =============================================================================

export function getStatusColor(status: FailureModeStatus): string {
  switch (status) {
    case "active":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "investigating":
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    case "resolved":
      return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "wont_fix":
      return "bg-moon-600/20 text-moon-400 border-moon-500/30";
    default:
      return "bg-moon-700 text-moon-400";
  }
}

export function getStatusLabel(status: FailureModeStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "investigating":
      return "Investigating";
    case "resolved":
      return "Resolved";
    case "wont_fix":
      return "Won't Fix";
    default:
      return status;
  }
}

export function getStatusIcon(status: FailureModeStatus): string {
  switch (status) {
    case "active":
      return "🔴";
    case "investigating":
      return "🔧";
    case "resolved":
      return "✅";
    case "wont_fix":
      return "⊘";
    default:
      return "●";
  }
}

export function calculateDistributionPercent(noteCount: number, totalNotes: number): number {
  if (totalNotes === 0) return 0;
  return Math.round((noteCount / totalNotes) * 100);
}

// =============================================================================
// Numeric Formatting (for metrics display)
// =============================================================================

/**
 * Format token count with K/M suffixes
 * e.g., 1500 -> "1.5K", 1500000 -> "1.5M"
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toString();
}

/**
 * Format cost in USD with appropriate precision
 * e.g., 0.0012 -> "$0.0012", 1.50 -> "$1.50"
 */
export function formatCost(cost: number): string {
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.01) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(4)}`;
}

/**
 * Format latency in ms or seconds
 * e.g., 500 -> "500ms", 1500 -> "1.5s"
 */
export function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

