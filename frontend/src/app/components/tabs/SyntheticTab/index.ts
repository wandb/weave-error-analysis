/**
 * SyntheticTab Sub-components
 *
 * Extracted from the monolithic SyntheticTab.tsx to reduce component size
 * and improve re-render performance. Each component is memoized with React.memo.
 *
 * Component Structure:
 * - DimensionsPanel: Testing dimensions management
 * - BatchesPanel: Generated batches list with run controls
 * - TuplesPreview: Preview tuples before query generation (LLM Decides mode)
 * - QueryPreviewCard: Expandable card for individual query preview
 *
 * Related Hooks (in lib/):
 * - useBatchGeneration: SSE streaming for tuple/query generation
 * - useBatchExecution: SSE streaming for batch execution
 */

export { DimensionsPanel } from "./DimensionsPanel";
export { BatchesPanel } from "./BatchesPanel";
export { TuplesPreview } from "./TuplesPreview";
export { QueryPreviewCard } from "./QueryPreviewCard";

