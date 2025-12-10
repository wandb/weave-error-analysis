"use client";

import { useState, useEffect } from "react";
import {
  Settings,
  Key,
  Database,
  Bot,
  Check,
  X,
  RefreshCw,
  Eye,
  EyeOff,
  Save,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { Panel, PanelHeader, Badge, StatusBadge } from "../ui";
import type { SettingsGroup, ConfigStatus, TestConnectionResult } from "../../types";
import * as api from "../../lib/api";

// Label mappings for better display
const SETTING_LABELS: Record<string, string> = {
  llm_provider: "Provider",
  llm_model: "Model",
  llm_api_key: "API Key",
  llm_api_base: "API Base URL",
  weave_api_key: "W&B API Key",
  weave_entity: "Entity",
  weave_project: "Project",
  auto_review_model: "Model",
  auto_review_concurrency: "Max Concurrent Calls",
};

const SETTING_PLACEHOLDERS: Record<string, string> = {
  llm_provider: "openai, anthropic, google...",
  llm_model: "gpt-4o-mini, claude-3-sonnet...",
  llm_api_key: "sk-...",
  llm_api_base: "https://api.openai.com/v1 (optional)",
  weave_api_key: "Your W&B API key",
  weave_entity: "Your W&B username or team",
  weave_project: "error-analysis-demo",
  auto_review_model: "openai/gpt-5.1",
  auto_review_concurrency: "10",
};

export function SettingsTab() {
  const [settingsGroups, setSettingsGroups] = useState<SettingsGroup[]>([]);
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Form state - stores the actual values being edited
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  // Test results
  const [testingLLM, setTestingLLM] = useState(false);
  const [testingWeave, setTestingWeave] = useState(false);
  const [llmTestResult, setLLMTestResult] = useState<TestConnectionResult | null>(null);
  const [weaveTestResult, setWeaveTestResult] = useState<TestConnectionResult | null>(null);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const [groups, status] = await Promise.all([
        api.fetchSettingsGrouped(),
        api.fetchConfigStatus(),
      ]);
      setSettingsGroups(groups);
      setConfigStatus(status);

      // Initialize form values from settings
      const initialValues: Record<string, string> = {};
      groups.forEach((group) => {
        group.settings.forEach((setting) => {
          // For secrets, don't populate the masked value
          if (setting.is_secret && setting.value.startsWith("••••")) {
            initialValues[setting.key] = "";
          } else {
            initialValues[setting.key] = setting.value;
          }
        });
      });
      setFormValues(initialValues);
      setDirty(false);
    } catch (error) {
      console.error("Failed to load settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Only save values that have been changed (non-empty for secrets, or any change for non-secrets)
      const settingsToSave: Record<string, string> = {};

      settingsGroups.forEach((group) => {
        group.settings.forEach((setting) => {
          const newValue = formValues[setting.key];
          if (setting.is_secret) {
            // Only save secret if user entered a new value
            if (newValue && newValue.trim() !== "") {
              settingsToSave[setting.key] = newValue;
            }
          } else {
            // Save all non-secret values
            settingsToSave[setting.key] = newValue || "";
          }
        });
      });

      await api.bulkUpdateSettings(settingsToSave);
      await loadSettings();
      setDirty(false);
    } catch (error) {
      console.error("Failed to save settings:", error);
      alert(error instanceof Error ? error.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleTestLLM = async () => {
    setTestingLLM(true);
    setLLMTestResult(null);
    try {
      const result = await api.testLLMConnection();
      setLLMTestResult(result);
    } catch (error) {
      setLLMTestResult({
        success: false,
        error: error instanceof Error ? error.message : "Test failed",
        message: "Connection test failed",
      });
    } finally {
      setTestingLLM(false);
    }
  };

  const handleTestWeave = async () => {
    setTestingWeave(true);
    setWeaveTestResult(null);
    try {
      const result = await api.testWeaveConnection();
      setWeaveTestResult(result);
    } catch (error) {
      setWeaveTestResult({
        success: false,
        error: error instanceof Error ? error.message : "Test failed",
        message: "Connection test failed",
      });
    } finally {
      setTestingWeave(false);
    }
  };

  const toggleShowSecret = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const getGroupIcon = (groupName: string) => {
    if (groupName.includes("LLM")) return Bot;
    if (groupName.includes("Weave")) return Database;
    return Settings;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-ink-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Save Button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-display font-semibold text-sand-100">Settings</h2>
          <p className="text-ink-400 mt-1">
            Configure LLM and Weave connections for the application
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dirty && (
            <Badge variant="gold" className="animate-pulse">
              Unsaved changes
            </Badge>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className={`btn-primary flex items-center gap-2 ${
              !dirty ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save Settings
          </button>
        </div>
      </div>

      {/* Configuration Status Banner */}
      {configStatus && (
        <div className="grid grid-cols-2 gap-4">
          <StatusCard
            title="LLM Configuration"
            configured={configStatus.llm.configured}
            details={
              configStatus.llm.configured
                ? `Model: ${configStatus.llm.model}`
                : configStatus.llm.message
            }
            onTest={handleTestLLM}
            testing={testingLLM}
            testResult={llmTestResult}
          />
          <StatusCard
            title="Weave Configuration"
            configured={configStatus.weave.configured}
            details={
              configStatus.weave.configured
                ? `Project: ${configStatus.weave.project_id}`
                : configStatus.weave.message
            }
            onTest={handleTestWeave}
            testing={testingWeave}
            testResult={weaveTestResult}
          />
        </div>
      )}

      {/* Settings Groups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {settingsGroups.map((group) => {
          const Icon = getGroupIcon(group.name);
          return (
            <Panel key={group.name}>
              <PanelHeader className="flex items-center gap-2">
                <Icon className="w-5 h-5 text-accent-coral" />
                {group.name}
              </PanelHeader>
              <p className="text-ink-400 text-sm mb-4">{group.description}</p>

              <div className="space-y-4">
                {group.settings.map((setting) => (
                  <SettingField
                    key={setting.key}
                    settingKey={setting.key}
                    label={SETTING_LABELS[setting.key] || setting.key}
                    value={formValues[setting.key] || ""}
                    placeholder={SETTING_PLACEHOLDERS[setting.key] || ""}
                    isSecret={setting.is_secret}
                    showSecret={showSecrets[setting.key] || false}
                    onToggleSecret={() => toggleShowSecret(setting.key)}
                    onChange={(value) => handleInputChange(setting.key, value)}
                    description={setting.description}
                    hasStoredValue={setting.value.startsWith("••••")}
                  />
                ))}
              </div>
            </Panel>
          );
        })}
      </div>

      {/* Help Text */}
      <Panel>
        <PanelHeader className="flex items-center gap-2">
          <Key className="w-5 h-5 text-accent-gold" />
          Getting API Keys
        </PanelHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div>
            <h4 className="font-medium text-sand-200 mb-2">LLM API Keys</h4>
            <ul className="space-y-1 text-ink-400">
              <li>
                <strong>OpenAI:</strong>{" "}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-coral hover:underline"
                >
                  platform.openai.com/api-keys
                </a>
              </li>
              <li>
                <strong>Anthropic:</strong>{" "}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-coral hover:underline"
                >
                  console.anthropic.com
                </a>
              </li>
              <li>
                <strong>Google:</strong>{" "}
                <a
                  href="https://makersuite.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-coral hover:underline"
                >
                  makersuite.google.com
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-sand-200 mb-2">W&B / Weave</h4>
            <ul className="space-y-1 text-ink-400">
              <li>
                <strong>API Key:</strong>{" "}
                <a
                  href="https://wandb.ai/authorize"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-coral hover:underline"
                >
                  wandb.ai/authorize
                </a>
              </li>
              <li>
                <strong>Entity:</strong> Your W&B username or team name
              </li>
              <li>
                <strong>Project:</strong> The Weave project name where traces are logged
              </li>
            </ul>
          </div>
        </div>
      </Panel>
    </div>
  );
}

// ============================================================================
// Sub-Components
// ============================================================================

interface StatusCardProps {
  title: string;
  configured: boolean;
  details: string;
  onTest: () => void;
  testing: boolean;
  testResult: TestConnectionResult | null;
}

function StatusCard({ title, configured, details, onTest, testing, testResult }: StatusCardProps) {
  return (
    <div
      className={`p-4 rounded-lg border ${
        configured
          ? "bg-emerald-950/20 border-emerald-800/50"
          : "bg-amber-950/20 border-amber-800/50"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {configured ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          )}
          <span className="font-medium text-sand-100">{title}</span>
        </div>
        <button
          onClick={onTest}
          disabled={testing}
          className="text-sm text-ink-400 hover:text-sand-200 flex items-center gap-1"
        >
          {testing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          Test
        </button>
      </div>
      <p className="text-sm text-ink-400">{details}</p>

      {testResult && (
        <div
          className={`mt-2 p-2 rounded text-sm ${
            testResult.success
              ? "bg-emerald-950/30 text-emerald-300"
              : "bg-red-950/30 text-red-300"
          }`}
        >
          {testResult.success ? (
            <span className="flex items-center gap-1">
              <Check className="w-3 h-3" /> {testResult.message}
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <X className="w-3 h-3" /> {testResult.error || testResult.message}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

interface SettingFieldProps {
  settingKey: string;
  label: string;
  value: string;
  placeholder: string;
  isSecret: boolean;
  showSecret: boolean;
  onToggleSecret: () => void;
  onChange: (value: string) => void;
  description?: string;
  hasStoredValue: boolean;
}

function SettingField({
  settingKey,
  label,
  value,
  placeholder,
  isSecret,
  showSecret,
  onToggleSecret,
  onChange,
  description,
  hasStoredValue,
}: SettingFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-sand-200 mb-1">
        {label}
        {isSecret && hasStoredValue && !value && (
          <span className="ml-2 text-xs text-emerald-400">(stored)</span>
        )}
      </label>
      <div className="relative">
        <input
          type={isSecret && !showSecret ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isSecret && hasStoredValue ? "Enter new value to update" : placeholder}
          className="w-full px-3 py-2 bg-ink-900 border border-ink-700 rounded-md text-sand-100 
                     placeholder-ink-500 focus:outline-none focus:border-accent-coral 
                     focus:ring-1 focus:ring-accent-coral/50 pr-10"
        />
        {isSecret && (
          <button
            type="button"
            onClick={onToggleSecret}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-sand-200"
          >
            {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {description && <p className="text-xs text-ink-500 mt-1">{description}</p>}
    </div>
  );
}

