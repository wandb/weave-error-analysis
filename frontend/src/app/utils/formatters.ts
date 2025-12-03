import { format, parseISO, formatDistanceToNow } from "date-fns";
import type { FailureMode, Taxonomy } from "../types";

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

