/**
 * Context Exports
 * 
 * This barrel file exports all domain-specific contexts.
 * 
 * Architecture:
 * - AgentContext: Agents, connection testing
 * - SyntheticContext: Dimensions, batches
 * - TaxonomyContext: Failure modes, categorization
 * - AppContext: Navigation, setup, landing page (slim coordinator)
 * 
 * Note: SessionContext removed - users review traces in Weave UI directly.
 */

// Domain-specific contexts
export { AgentProvider, useAgent } from "./AgentContext";
export { SyntheticProvider, useSynthetic } from "./SyntheticContext";
export { TaxonomyProvider, useTaxonomy } from "./TaxonomyContext";

// Coordinator context (navigation, setup, landing page)
export { AppProvider, useApp } from "./AppContext";

