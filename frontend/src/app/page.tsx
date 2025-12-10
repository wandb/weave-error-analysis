"use client";

import {
  Layers,
  MessageCircle,
  BarChart3,
  Cpu,
  Zap,
  Settings,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
} from "lucide-react";
import { AppProvider, useApp } from "./context/AppContext";
import { ThreadsTab, TaxonomyTab, AgentsTab, SyntheticTab, SettingsTab } from "./components/tabs";
import { Badge } from "./components/ui";
import LandingPage from "./components/LandingPage";

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
    setShowLandingPage,
  } = useApp();

  const handleLogoClick = () => {
    // Clear the localStorage dismissal and show landing page
    if (typeof window !== 'undefined') {
      localStorage.removeItem('landingPageDismissed');
    }
    setShowLandingPage(true);
  };

  const handleRefresh = () => {
    switch (activeTab) {
      case "threads":
        fetchThreads();
        break;
      case "taxonomy":
        fetchTaxonomy();
        break;
      case "agents":
        fetchAgents();
        break;
      case "synthetic":
        if (selectedAgent) {
          fetchDimensions(selectedAgent.id);
          fetchBatches(selectedAgent.id);
        }
        break;
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#171A1F' }}>
      {/* Header */}
      <header 
        className="border-b backdrop-blur-md sticky top-0 z-50"
        style={{ borderColor: '#252830', backgroundColor: 'rgba(23, 26, 31, 0.95)' }}
      >
        <div className="max-w-[1800px] mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-8">
              {/* Logo - Clickable to show landing page */}
              <button 
                onClick={handleLogoClick}
                className="flex items-center gap-3 hover:opacity-90 transition-opacity"
                title="Show workflow guide"
              >
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#FCBC32' }}>
                  <Layers className="w-5 h-5" style={{ color: '#171A1F' }} />
                </div>
                <div className="text-left">
                  <h1 className="font-display text-lg" style={{ color: '#FDFDFD' }}>
                    Error analysis
                  </h1>
                  <p className="text-xs" style={{ color: '#8F949E' }}>Bottom-up failure mode discovery</p>
                </div>
              </button>

              {/* Tab Navigation - Reordered for workflow */}
              <TabNavigation
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                taxonomy={taxonomy}
                agents={agents}
                syntheticBatches={syntheticBatches}
                executingBatch={executingBatch}
              />
            </div>

            <div className="flex items-center gap-3">
              {/* Feedback Stats */}
              {feedbackSummary && (
                <div className="flex items-center gap-3 text-sm">
                  <div className="flex items-center gap-1.5" style={{ color: '#10BFCC' }}>
                    <ThumbsUp className="w-4 h-4" />
                    <span>{feedbackSummary.thumbs_up}</span>
                  </div>
                  <div className="flex items-center gap-1.5" style={{ color: '#8F949E' }}>
                    <ThumbsDown className="w-4 h-4" />
                    <span>{feedbackSummary.thumbs_down}</span>
                  </div>
                </div>
              )}

              {/* Refresh */}
              <button onClick={handleRefresh} className="btn-secondary flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                <span className="uppercase text-xs tracking-wide">Refresh</span>
              </button>

              {/* Settings - Icon only in corner */}
              <button
                onClick={() => setActiveTab("settings")}
                className="p-2.5 rounded-lg transition-all hover:opacity-90"
                style={activeTab === "settings"
                  ? { backgroundColor: '#FCBC32', color: '#171A1F' }
                  : { color: '#8F949E' }
                }
                title="Settings"
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1800px] mx-auto px-6 py-6">
        {activeTab === "agents" && <AgentsTab />}
        {activeTab === "synthetic" && <SyntheticTab />}
        {activeTab === "threads" && <ThreadsTab />}
        {activeTab === "taxonomy" && <TaxonomyTab />}
        {activeTab === "settings" && <SettingsTab />}
      </main>
    </div>
  );
}

// ============================================================================
// Tab Navigation Component
// Workflow order: Agents → Synthetic → Threads → Taxonomy
// Settings moved to corner icon
// ============================================================================

interface TabNavigationProps {
  activeTab: string;
  setActiveTab: (tab: "threads" | "taxonomy" | "agents" | "synthetic" | "settings") => void;
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
  // Tabs ordered by workflow: Connect → Generate/Run → Review → Categorize
  const tabs = [
    {
      id: "agents" as const,
      label: "Agents",
      icon: Cpu,
      step: 1,
      badge: agents.length > 0 ? agents.length : null,
      badgeVariant: "teal" as const,
    },
    {
      id: "synthetic" as const,
      label: "Synthetic",
      icon: Zap,
      step: 2,
      badge: syntheticBatches.length > 0 ? syntheticBatches.length : null,
      badgeVariant: "gold" as const,
      showPulse: executingBatch,
    },
    {
      id: "threads" as const,
      label: "Threads",
      icon: MessageCircle,
      step: 3,
      badge: null,
    },
    {
      id: "taxonomy" as const,
      label: "Taxonomy",
      icon: BarChart3,
      step: 4,
      badge: taxonomy && taxonomy.stats.total_uncategorized > 0 
        ? taxonomy.stats.total_uncategorized 
        : null,
      badgeVariant: "gold" as const,
    },
  ];

  return (
    <nav className="flex items-center gap-0.5 rounded-lg p-1" style={{ backgroundColor: 'rgba(37, 40, 48, 0.5)' }}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-all ${
              isActive ? "font-medium" : "hover:text-white"
            }`}
            style={isActive 
              ? { backgroundColor: '#FCBC32', color: '#171A1F' }
              : { color: '#8F949E' }
            }
          >
            <Icon className="w-4 h-4" />
            <span>{tab.label}</span>
            {tab.badge && (
              <Badge variant={tab.badgeVariant || "default"} className="text-xs ml-0.5">
                {tab.badge}
              </Badge>
            )}
            {tab.showPulse && <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: '#10BFCC' }} />}
          </button>
        );
      })}
    </nav>
  );
}

// ============================================================================
// App Router - Conditional Landing Page
// ============================================================================

function AppRouter() {
  const { 
    showLandingPage, 
    workflowProgress, 
    dismissLandingPage,
    setActiveTab,
  } = useApp();

  const handleStart = () => {
    dismissLandingPage();
    setActiveTab("agents");
  };

  if (showLandingPage) {
    return (
      <LandingPage
        progress={workflowProgress}
        onSkipToAgents={handleStart}
        onDismiss={dismissLandingPage}
      />
    );
  }

  return <AppLayout />;
}

// ============================================================================
// Root Component with Provider
// ============================================================================

export default function Home() {
  return (
    <AppProvider>
      <AppRouter />
    </AppProvider>
  );
}
