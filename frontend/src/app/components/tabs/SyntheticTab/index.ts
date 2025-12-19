/**
 * SyntheticTab Sub-components
 *
 * Extracted from the monolithic SyntheticTab.tsx to reduce component size
 * and improve re-render performance. Each component is memoized with React.memo.
 *
 * Component Structure:
 * - DimensionsPanel: Testing dimensions management (with AI-assisted design)
 * - BatchesPanel: Generated batches list with run controls
 * - QueryPreviewCard: Expandable card for individual query preview
 *
 * Related Hooks (in lib/):
 * - useBatchGeneration: SSE streaming for query generation
 * - useBatchExecution: SSE streaming for batch execution
 */

export { DimensionsPanel } from "./DimensionsPanel";
export { BatchesPanel } from "./BatchesPanel";
export { QueryPreviewCard } from "./QueryPreviewCard";

