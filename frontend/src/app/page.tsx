"use client";

import {
  Layers,
  MessageCircle,
  BarChart3,
  Cpu,
  Zap,
  Play,
  Settings,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
} from "lucide-react";
import { AppProvider, useApp } from "./context/AppContext";
import { SessionsTab, TaxonomyTab, AgentsTab, SyntheticTab, RunsTab, SettingsTab } from "./components/tabs";
import { Badge } from "./components/ui";

// ============================================================================
// Main Layout
// ============================================================================

function AppLayout() {
  const {
    activeTab,
    setActiveTab,
    feedbackSummary,
    taxonomy,
    agents,
    syntheticBatches,
    selectedAgent,
    executingBatch,
    fetchThreads,
    fetchTaxonomy,
    fetchAgents,
    fetchDimensions,
    fetchBatches,
  } = useApp();

  const handleRefresh = () => {
    switch (activeTab) {
      case "sessions":
        fetchThreads();
        break;
      case "taxonomy":
        fetchTaxonomy();
        break;
      case "agents":
        fetchAgents();
        break;
      case "synthetic":
      case "runs":
        if (selectedAgent) {
          fetchDimensions(selectedAgent.id);
          fetchBatches(selectedAgent.id);
        }
        break;
    }
  };

  return (
    <div className="min-h-screen bg-grid-pattern">
      {/* Header */}
      <header className="border-b border-ink-800 bg-ink-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1800px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              {/* Logo */}
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-coral to-accent-gold flex items-center justify-center">
                  <Layers className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="font-display text-xl font-semibold text-sand-100">
                    Error Analysis
                  </h1>
                  <p className="text-xs text-ink-400">Bottom-up failure mode discovery</p>
                </div>
              </div>

              {/* Tab Navigation */}
              <TabNavigation
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                taxonomy={taxonomy}
                agents={agents}
                syntheticBatches={syntheticBatches}
                executingBatch={executingBatch}
              />
            </div>

            <div className="flex items-center gap-4">
              {/* Feedback Stats */}
              {feedbackSummary && (
                <div className="flex items-center gap-3 text-sm">
                  <div className="flex items-center gap-1 text-emerald-400">
                    <ThumbsUp className="w-4 h-4" />
                    <span>{feedbackSummary.thumbs_up}</span>
                  </div>
                  <div className="flex items-center gap-1 text-red-400">
                    <ThumbsDown className="w-4 h-4" />
                    <span>{feedbackSummary.thumbs_down}</span>
                  </div>
                </div>
              )}

              {/* Refresh */}
              <button onClick={handleRefresh} className="btn-secondary flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1800px] mx-auto px-6 py-6">
        {activeTab === "sessions" && <SessionsTab />}
        {activeTab === "taxonomy" && <TaxonomyTab />}
        {activeTab === "agents" && <AgentsTab />}
        {activeTab === "synthetic" && <SyntheticTab />}
        {activeTab === "runs" && <RunsTab />}
        {activeTab === "settings" && <SettingsTab />}
      </main>
    </div>
  );
}

// ============================================================================
// Tab Navigation Component
// ============================================================================

interface TabNavigationProps {
  activeTab: string;
  setActiveTab: (tab: "sessions" | "taxonomy" | "agents" | "synthetic" | "runs" | "settings") => void;
  taxonomy: ReturnType<typeof useApp>["taxonomy"];
  agents: ReturnType<typeof useApp>["agents"];
  syntheticBatches: ReturnType<typeof useApp>["syntheticBatches"];
  executingBatch: boolean;
}

function TabNavigation({
  activeTab,
  setActiveTab,
  taxonomy,
  agents,
  syntheticBatches,
  executingBatch,
}: TabNavigationProps) {
  const tabs = [
    {
      id: "sessions" as const,
      label: "Sessions",
      icon: MessageCircle,
      color: "accent-coral",
      badge: null,
    },
    {
      id: "taxonomy" as const,
      label: "Taxonomy",
      icon: BarChart3,
      color: "accent-plum",
      badge: taxonomy && taxonomy.stats.total_uncategorized > 0 
        ? taxonomy.stats.total_uncategorized 
        : null,
      badgeVariant: "gold" as const,
    },
    {
      id: "agents" as const,
      label: "Agents",
      icon: Cpu,
      color: "accent-teal",
      badge: agents.length > 0 ? agents.length : null,
      badgeVariant: "teal" as const,
    },
    {
      id: "synthetic" as const,
      label: "Synthetic",
      icon: Zap,
      color: "accent-amber",
      badge: syntheticBatches.length > 0 ? syntheticBatches.length : null,
      badgeVariant: "amber" as const,
    },
    {
      id: "runs" as const,
      label: "Runs",
      icon: Play,
      color: "accent-coral",
      badge: null,
      showPulse: executingBatch,
    },
    {
      id: "settings" as const,
      label: "Settings",
      icon: Settings,
      color: "ink-500",
      badge: null,
    },
  ];

  return (
    <nav className="flex items-center gap-1 bg-ink-900 rounded-lg p-1 ml-4">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
              isActive
                ? `bg-${tab.color} text-white shadow-lg shadow-${tab.color}/20`
                : "text-ink-400 hover:text-sand-200 hover:bg-ink-800"
            }`}
          >
            <Icon className="w-4 h-4" />
            {tab.label}
            {tab.badge && (
              <Badge variant={tab.badgeVariant || "default"} className="text-xs ml-1">
                {tab.badge}
              </Badge>
            )}
            {tab.showPulse && <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />}
          </button>
        );
      })}
    </nav>
  );
}

// ============================================================================
// Root Component with Provider
// ============================================================================

export default function Home() {
  return (
    <AppProvider>
      <AppLayout />
    </AppProvider>
  );
}
