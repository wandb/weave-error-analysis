"use client";

import { useCallback, useState } from "react";
import {
  Layers,
  BarChart3,
  Cpu,
  Zap,
  Settings,
  RefreshCw,
} from "lucide-react";
import { AppProvider, useApp } from "./context/AppContext";
import { TaxonomyTab, AgentsTab, SyntheticTab, SettingsTab } from "./components/tabs";
import { Badge } from "./components/ui";
import LandingPage from "./components/LandingPage";
import SetupWizard from "./components/SetupWizard";
import { useKeyboardShortcuts } from "./lib/useKeyboardShortcuts";
import { Loader2 } from "lucide-react";

// ============================================================================
// Main Layout
// ============================================================================

function AppLayout() {
  const {
    activeTab,
    setActiveTab,
    taxonomy,
    agents,
    syntheticBatches,
    selectedAgent,
    executingBatch,
    fetchTaxonomy,
    fetchAgents,
    fetchDimensions,
    fetchBatches,
    setShowLandingPage,
    configStatus,
  } = useApp();
  
  // Check if settings are incomplete (missing LLM or Weave API key)
  const settingsIncomplete = configStatus && (!configStatus.llm.configured || !configStatus.weave.configured);

  const handleLogoClick = () => {
    // Clear the sessionStorage dismissal and show landing page
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('landingPageDismissed');
    }
    setShowLandingPage(true);
  };

  const handleRefresh = useCallback(() => {
    switch (activeTab) {
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
  }, [activeTab, fetchTaxonomy, fetchAgents, fetchDimensions, fetchBatches, selectedAgent]);

  // Register keyboard shortcuts
  useKeyboardShortcuts({
    activeTab,
    goToAgents: () => setActiveTab("agents"),
    goToSynthetic: () => setActiveTab("synthetic"),
    goToTaxonomy: () => setActiveTab("taxonomy"),
    refresh: handleRefresh,
  });

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
              {/* Refresh */}
              <button onClick={handleRefresh} className="btn-secondary flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                <span className="uppercase text-xs tracking-wide">Refresh</span>
              </button>

              {/* Settings - Icon only in corner with warning badge */}
              <button
                onClick={() => setActiveTab("settings")}
                className="p-2.5 rounded-lg transition-all hover:opacity-90 relative"
                style={activeTab === "settings"
                  ? { backgroundColor: '#FCBC32', color: '#171A1F' }
                  : { color: '#8F949E' }
                }
                title={settingsIncomplete ? "Settings - Configuration incomplete" : "Settings"}
              >
                <Settings className="w-5 h-5" />
                {settingsIncomplete && activeTab !== "settings" && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-500 rounded-full border-2 border-[#171A1F]" />
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1800px] mx-auto px-6 py-6">
        {activeTab === "agents" && <AgentsTab />}
        {activeTab === "synthetic" && <SyntheticTab />}
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
  setActiveTab: (tab: "taxonomy" | "agents" | "synthetic" | "settings") => void;
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
  // Tabs ordered by workflow: Connect → Generate/Run → Categorize
  // Note: Threads tab removed - users review traces in Weave UI directly
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
      id: "taxonomy" as const,
      label: "Taxonomy",
      icon: BarChart3,
      step: 3,
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
// App Router - Conditional Setup / Landing Page
// ============================================================================

function AppRouter() {
  const { 
    showLandingPage, 
    dismissLandingPage,
    setActiveTab,
    needsSetup,
    checkingSetup,
    completeSetup,
  } = useApp();

  // Track if user clicked Start on landing page and needs setup
  const [showSetupWizard, setShowSetupWizard] = useState(false);

  const handleStart = () => {
    // If setup is needed, show the wizard instead of going directly to agents
    if (needsSetup) {
      setShowSetupWizard(true);
    } else {
      dismissLandingPage();
      setActiveTab("agents");
    }
  };

  const handleSetupComplete = () => {
    completeSetup();
    setShowSetupWizard(false);
    dismissLandingPage();
    setActiveTab("agents");
  };

  // Show loading while checking setup status
  if (checkingSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#171A1F' }}>
        <Loader2 className="w-8 h-8 text-gold animate-spin" />
      </div>
    );
  }

  // Show setup wizard if user clicked Start and config is missing
  if (showSetupWizard && needsSetup) {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

  // Show landing page (workflow guide) on first visit - ALWAYS show first
  if (showLandingPage) {
    return (
      <LandingPage
        onSkipToAgents={handleStart}
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
