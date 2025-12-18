/**
 * Context Exports
 * 
 * This barrel file exports all domain-specific contexts.
 * 
 * Architecture:
 * - SessionContext: Sessions, filters, sync status
 * - AgentContext: Agents, connection testing
 * - SyntheticContext: Dimensions, batches
 * - TaxonomyContext: Failure modes, categorization
 * - AppContext: Navigation, setup, landing page (slim coordinator)
 * 
 * Migration Note:
 * The original monolithic AppContext (1009 lines) has been split into
 * these domain-specific contexts to reduce re-render scope and improve
 * maintainability. Components should import from the specific context
 * they need rather than AppContext when possible.
 */

// Domain-specific contexts
export { SessionProvider, useSession, type SessionFilters } from "./SessionContext";
export { AgentProvider, useAgent } from "./AgentContext";
export { SyntheticProvider, useSynthetic } from "./SyntheticContext";
export { TaxonomyProvider, useTaxonomy } from "./TaxonomyContext";

// Coordinator context (navigation, setup, landing page)
export { AppProvider, useApp } from "./AppContext";

