"use client";

import { useState, useEffect } from "react";
import { 
  Layers, 
  Key, 
  Cloud, 
  CheckCircle, 
  AlertCircle, 
  ChevronRight,
  Loader2,
  ExternalLink
} from "lucide-react";
import * as api from "../lib/api";
import type { ConfigStatus, TestConnectionResult } from "../types";

// ============================================================================
// Types
// ============================================================================

interface SetupWizardProps {
  onComplete: () => void;
}

type SetupStep = "llm" | "weave" | "complete";

// ============================================================================
// Step Indicator
// ============================================================================

function StepIndicator({ 
  currentStep, 
  steps 
}: { 
  currentStep: SetupStep; 
  steps: { id: SetupStep; label: string }[];
}) {
  const currentIndex = steps.findIndex(s => s.id === currentStep);
  
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((step, index) => {
        const isComplete = index < currentIndex;
        const isCurrent = step.id === currentStep;
        
        return (
          <div key={step.id} className="flex items-center">
            <div 
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                isComplete 
                  ? "bg-teal text-moon-900" 
                  : isCurrent 
                    ? "bg-gold text-moon-900" 
                    : "bg-moon-700 text-moon-400"
              }`}
            >
              {isComplete ? <CheckCircle className="w-4 h-4" /> : index + 1}
            </div>
            {index < steps.length - 1 && (
              <div 
                className={`w-12 h-0.5 mx-2 ${
                  isComplete ? "bg-teal" : "bg-moon-700"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// LLM Setup Step
// ============================================================================

function LLMSetupStep({ 
  onComplete, 
  initialStatus 
}: { 
  onComplete: () => void;
  initialStatus: ConfigStatus["llm"];
}) {
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // If already configured, show success state
  useEffect(() => {
    if (initialStatus.configured) {
      setTestResult({
        success: true,
        model: initialStatus.model,
        message: `Connected with ${initialStatus.model}`,
      });
    }
  }, [initialStatus]);

  const handleTest = async () => {
    if (!apiKey.trim()) {
      setError("Please enter your API key");
      return;
    }

    setTesting(true);
    setError(null);
    setTestResult(null);

    try {
      // Save the API key first
      await api.updateSetting("llm_api_key", apiKey);
      
      // Then test the connection
      const result = await api.testLLMConnection();
      setTestResult(result);
      
      if (!result.success) {
        setError(result.error || "Connection test failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save API key");
    } finally {
      setTesting(false);
    }
  };

  const isConfigured = testResult?.success || initialStatus.configured;

  return (
    <div className="max-w-md mx-auto">
      <div className="text-center mb-6">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-moon-700/50">
          <Key className="w-8 h-8 text-gold" />
        </div>
        <h2 className="font-display text-2xl text-moon-50 mb-2">LLM API Key</h2>
        <p className="text-moon-450">
          Required for AI-powered features like synthetic query generation and auto-categorization.
        </p>
      </div>

      {isConfigured ? (
        <div className="bg-teal/10 border border-teal/30 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-teal flex-shrink-0" />
            <div>
              <p className="text-moon-50 font-medium">LLM Connected</p>
              <p className="text-sm text-moon-400">
                Using {testResult?.model || initialStatus.model}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <label className="block text-sm text-moon-400 mb-2">
              OpenAI API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="input-field w-full"
            />
            <p className="text-xs text-moon-500 mt-2">
              Get your API key from{" "}
              <a 
                href="https://platform.openai.com/api-keys" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-gold hover:underline inline-flex items-center gap-1"
              >
                OpenAI <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            </div>
          )}

          <button
            onClick={handleTest}
            disabled={testing || !apiKey.trim()}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {testing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Testing...
              </>
            ) : (
              "Test Connection"
            )}
          </button>
        </>
      )}

      <div className="mt-6">
        <button
          onClick={onComplete}
          disabled={!isConfigured}
          className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg transition-colors ${
            isConfigured 
              ? "bg-gold text-moon-900 hover:bg-gold/90" 
              : "bg-moon-700 text-moon-500 cursor-not-allowed"
          }`}
        >
          Continue
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Weave Setup Step
// ============================================================================

function WeaveSetupStep({ 
  onComplete,
  onSkip,
  initialStatus 
}: { 
  onComplete: () => void;
  onSkip: () => void;
  initialStatus: ConfigStatus["weave"];
}) {
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // If already configured, show success state
  useEffect(() => {
    if (initialStatus.configured) {
      setTestResult({
        success: true,
        message: "W&B API key is configured",
      });
    }
  }, [initialStatus]);

  const handleTest = async () => {
    if (!apiKey.trim()) {
      setError("Please enter your W&B API key");
      return;
    }

    setTesting(true);
    setError(null);
    setTestResult(null);

    try {
      // Save the API key
      await api.updateSetting("weave_api_key", apiKey);
      
      // Test connection
      const result = await api.testWeaveConnection();
      setTestResult(result);
      
      if (!result.success) {
        setError(result.error || "Connection test failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setTesting(false);
    }
  };

  const isConfigured = testResult?.success || initialStatus.configured;

  return (
    <div className="max-w-md mx-auto">
      <div className="text-center mb-6">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-moon-700/50">
          <Cloud className="w-8 h-8 text-gold" />
        </div>
        <h2 className="font-display text-2xl text-moon-50 mb-2">W&B API Key</h2>
        <p className="text-moon-450">
          Required to fetch and analyze traces from your agent's Weave project.
        </p>
      </div>

      {isConfigured ? (
        <div className="bg-teal/10 border border-teal/30 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-teal flex-shrink-0" />
            <div>
              <p className="text-moon-50 font-medium">W&B Connected</p>
              <p className="text-sm text-moon-400">
                API key is valid. You'll specify agent Weave projects when registering agents.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <label className="block text-sm text-moon-400 mb-2">
              W&B API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Your Weights & Biases API key"
              className="input-field w-full"
            />
            <p className="text-xs text-moon-500 mt-2">
              Get your API key from{" "}
              <a 
                href="https://wandb.ai/authorize" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-gold hover:underline inline-flex items-center gap-1"
              >
                wandb.ai/authorize <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            </div>
          )}

          <button
            onClick={handleTest}
            disabled={testing || !apiKey.trim()}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {testing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Testing...
              </>
            ) : (
              "Test Connection"
            )}
          </button>
        </>
      )}

      <div className="mt-6 flex gap-3">
        <button
          onClick={onSkip}
          className="flex-1 btn-secondary"
        >
          Skip for Now
        </button>
        <button
          onClick={onComplete}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg transition-colors ${
            isConfigured 
              ? "bg-gold text-moon-900 hover:bg-gold/90" 
              : "bg-moon-700 text-moon-400"
          }`}
        >
          {isConfigured ? "Continue" : "Configure Later"}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Complete Step
// ============================================================================

function CompleteStep({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="max-w-md mx-auto text-center">
      <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 bg-teal/20">
        <CheckCircle className="w-10 h-10 text-teal" />
      </div>
      
      <h2 className="font-display text-3xl text-moon-50 mb-3">You're All Set!</h2>
      <p className="text-moon-450 mb-8">
        Your Error Analysis tool is configured and ready to use. 
        Connect an agent to start discovering failure modes.
      </p>

      <button
        onClick={onComplete}
        className="btn-primary px-8 py-3 text-base flex items-center justify-center gap-2 mx-auto"
      >
        Get Started
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}

// ============================================================================
// Main Setup Wizard Component
// ============================================================================

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [currentStep, setCurrentStep] = useState<SetupStep>("llm");
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch current config status on mount
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const status = await api.fetchConfigStatus();
        setConfigStatus(status);
        
        // Skip to appropriate step based on what's configured
        if (status.llm.configured && status.weave.configured) {
          setCurrentStep("complete");
        } else if (status.llm.configured) {
          setCurrentStep("weave");
        }
      } catch (e) {
        console.error("Failed to fetch config status:", e);
      } finally {
        setLoading(false);
      }
    };
    
    fetchStatus();
  }, []);

  const steps: { id: SetupStep; label: string }[] = [
    { id: "llm", label: "LLM" },
    { id: "weave", label: "Weave" },
    { id: "complete", label: "Done" },
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#171A1F' }}>
        <Loader2 className="w-8 h-8 text-gold animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#171A1F' }}>
      {/* Header */}
      <header className="border-b" style={{ borderColor: '#252830' }}>
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#FCBC32' }}>
              <Layers className="w-6 h-6" style={{ color: '#171A1F' }} />
            </div>
            <div>
              <h1 className="font-display text-xl" style={{ color: '#FDFDFD' }}>
                Error Analysis
              </h1>
              <p className="text-xs" style={{ color: '#8F949E' }}>Initial Setup</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center py-12">
        <div className="w-full max-w-2xl mx-auto px-6">
          <StepIndicator currentStep={currentStep} steps={steps} />

          {currentStep === "llm" && configStatus && (
            <LLMSetupStep 
              initialStatus={configStatus.llm}
              onComplete={() => setCurrentStep("weave")} 
            />
          )}

          {currentStep === "weave" && configStatus && (
            <WeaveSetupStep 
              initialStatus={configStatus.weave}
              onComplete={() => setCurrentStep("complete")}
              onSkip={() => setCurrentStep("complete")}
            />
          )}

          {currentStep === "complete" && (
            <CompleteStep onComplete={onComplete} />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 border-t border-moon-800">
        <div className="max-w-4xl mx-auto px-6 text-center text-sm text-moon-500">
          You can always update these settings later in the Settings tab.
        </div>
      </footer>
    </div>
  );
}

