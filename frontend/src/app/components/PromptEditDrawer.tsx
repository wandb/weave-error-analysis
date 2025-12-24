"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  X,
  RotateCcw,
  Save,
  ExternalLink,
  Sparkles,
  Pencil,
  FileText,
  Code2,
  AlertCircle,
  Check,
  Copy,
  ChevronDown,
  ChevronUp,
  Cpu,
  Play,
  Eye,
} from "lucide-react";
import { Badge, LoadingSpinner, ConfirmDialog } from "./ui";
import * as api from "../lib/api";
import { useApp } from "../context";
import type { PromptConfig, PromptVersionsResponse, PromptVersion } from "../types";

// ============================================================================
// Types
// ============================================================================

interface PromptEditDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  promptId: string;
  onSave?: (prompt: PromptConfig) => void;
}

// ============================================================================
// Main Component
// ============================================================================

export function PromptEditDrawer({
  isOpen,
  onClose,
  promptId,
  onSave,
}: PromptEditDrawerProps) {
  // Get global model from app context
  const { configStatus } = useApp();
  const globalModel = configStatus?.llm?.model || "default";

  // State
  const [prompt, setPrompt] = useState<PromptConfig | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userPromptTemplate, setUserPromptTemplate] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // LLM Configuration state
  const [llmModel, setLlmModel] = useState<string>("");
  const [llmTemperature, setLlmTemperature] = useState<number | null>(null);
  // Track original LLM values to detect changes
  const [originalLlmModel, setOriginalLlmModel] = useState<string>("");
  const [originalLlmTemperature, setOriginalLlmTemperature] = useState<number | null>(null);

  // Version info
  const [versions, setVersions] = useState<PromptVersionsResponse | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [switchingVersion, setSwitchingVersion] = useState(false);

  // Track if there are unsaved prompt content changes (triggers Weave version)
  const [isPromptDirty, setIsPromptDirty] = useState(false);
  
  // Computed: check if LLM config has changed from original
  const isLlmConfigDirty = llmModel !== originalLlmModel || 
    llmTemperature !== originalLlmTemperature;

  // Variable insertion helpers
  const [copiedVar, setCopiedVar] = useState<string | null>(null);

  // Confirmation dialogs state
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [pendingSwitchVersion, setPendingSwitchVersion] = useState<PromptVersion | null>(null);

  // Load prompt data when drawer opens
  useEffect(() => {
    if (isOpen && promptId) {
      loadPrompt();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, promptId]);

  // Reset state when drawer closes
  useEffect(() => {
    if (!isOpen) {
      setPrompt(null);
      setSystemPrompt("");
      setUserPromptTemplate("");
      setLlmModel("");
      setLlmTemperature(null);
      setOriginalLlmModel("");
      setOriginalLlmTemperature(null);
      setError(null);
      setSaveSuccess(false);
      setIsPromptDirty(false);
      setVersions(null);
      setShowVersions(false);
    }
  }, [isOpen]);

  const loadPrompt = async () => {
    setLoading(true);
    setError(null);
    try {
      const [promptData, versionsData] = await Promise.all([
        api.fetchPrompt(promptId),
        api.fetchPromptVersions(promptId),
      ]);
      setPrompt(promptData);
      setSystemPrompt(promptData.system_prompt || "");
      setUserPromptTemplate(promptData.user_prompt_template);
      // Set both current and original LLM values
      const model = promptData.llm_model || "";
      const temp = promptData.llm_temperature;
      setLlmModel(model);
      setLlmTemperature(temp);
      setOriginalLlmModel(model);
      setOriginalLlmTemperature(temp);
      setVersions(versionsData);
      setIsPromptDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load prompt");
    } finally {
      setLoading(false);
    }
  };

  const handleSystemPromptChange = (value: string) => {
    setSystemPrompt(value);
    setIsPromptDirty(true);
    setSaveSuccess(false);
  };

  const handleUserPromptChange = (value: string) => {
    setUserPromptTemplate(value);
    setIsPromptDirty(true);
    setSaveSuccess(false);
  };

  // LLM config changes don't affect prompt dirty state
  // They are saved separately on drawer close
  const handleLlmModelChange = (value: string) => {
    setLlmModel(value);
  };

  const handleLlmTemperatureChange = (value: number | null) => {
    setLlmTemperature(value);
  };

  const handleSave = async () => {
    if (!prompt) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      // Only save prompt content - LLM config is saved on close
      const updated = await api.updatePrompt(
        promptId,
        systemPrompt || null,
        userPromptTemplate
      );
      setPrompt(updated);
      setIsPromptDirty(false);
      setSaveSuccess(true);
      onSave?.(updated);

      // Reload versions after save
      const versionsData = await api.fetchPromptVersions(promptId);
      setVersions(versionsData);

      // Clear success message after a delay
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save prompt");
    } finally {
      setSaving(false);
    }
  };

  // Save LLM config silently (no version creation in Weave)
  const saveLlmConfig = async () => {
    if (!prompt || !isLlmConfigDirty) return;
    try {
      await api.updatePrompt(
        promptId,
        undefined,  // Don't update system prompt
        undefined,  // Don't update user template
        llmModel || null,
        llmTemperature
      );
      // Update original values to reflect saved state
      setOriginalLlmModel(llmModel);
      setOriginalLlmTemperature(llmTemperature);
    } catch (err) {
      console.error("Failed to save LLM config:", err);
    }
  };

  const handleResetConfirmed = async () => {
    setShowResetConfirm(false);
    setSaving(true);
    setError(null);
    try {
      const reset = await api.resetPrompt(promptId);
      setPrompt(reset);
      setSystemPrompt(reset.system_prompt || "");
      setUserPromptTemplate(reset.user_prompt_template);
      const model = reset.llm_model || "";
      const temp = reset.llm_temperature;
      setLlmModel(model);
      setLlmTemperature(temp);
      setOriginalLlmModel(model);
      setOriginalLlmTemperature(temp);
      setIsPromptDirty(false);
      setSaveSuccess(true);
      onSave?.(reset);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset prompt");
    } finally {
      setSaving(false);
    }
  };
  
  const handleReset = () => {
    setShowResetConfirm(true);
  };

  const handleCopyVariable = async (variable: string) => {
    const varText = `{${variable}}`;
    try {
      await navigator.clipboard.writeText(varText);
      setCopiedVar(variable);
      setTimeout(() => setCopiedVar(null), 2000);
    } catch {
      // Fallback for browsers without clipboard API
    }
  };

  const handleSwitchVersionConfirmed = async (version: PromptVersion) => {
    setPendingSwitchVersion(null);
    setSwitchingVersion(true);
    setError(null);
    try {
      const updated = await api.setPromptVersion(promptId, version.version);
      setPrompt(updated);
      setSystemPrompt(updated.system_prompt || "");
      setUserPromptTemplate(updated.user_prompt_template);
      const model = updated.llm_model || "";
      const temp = updated.llm_temperature;
      setLlmModel(model);
      setLlmTemperature(temp);
      setOriginalLlmModel(model);
      setOriginalLlmTemperature(temp);
      setIsPromptDirty(false);
      
      // Reload versions to update current status
      const versionsData = await api.fetchPromptVersions(promptId);
      setVersions(versionsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch version");
    } finally {
      setSwitchingVersion(false);
    }
  };
  
  const handleSwitchVersion = (version: PromptVersion) => {
    if (isPromptDirty) {
      setPendingSwitchVersion(version);
    } else {
      handleSwitchVersionConfirmed(version);
    }
  };

  const handleCloseConfirmed = async () => {
    setShowDiscardConfirm(false);
    
    // Save LLM config silently if it changed (no version creation)
    if (isLlmConfigDirty) {
      await saveLlmConfig();
    }
    
    onClose();
  };
  
  const handleClose = () => {
    // Only confirm if there are unsaved PROMPT changes (not LLM config)
    if (isPromptDirty) {
      setShowDiscardConfirm(true);
    } else {
      handleCloseConfirmed();
    }
  };

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        handleClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isPromptDirty, isLlmConfigDirty]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity"
        onClick={handleClose}
      />

      {/* Drawer */}
      <div
        className="fixed inset-y-0 right-0 w-[680px] max-w-[90vw] z-50 flex flex-col shadow-2xl"
        style={{
          backgroundColor: "#1C1E24",
          borderLeft: "1px solid #333333",
          animation: "slideIn 0.3s ease-out",
        }}
      >
        {/* Header */}
        <div
          className="flex-shrink-0 flex items-center justify-between px-6 py-4"
          style={{
            borderBottom: "1px solid #333333",
            background: "linear-gradient(180deg, #252830 0%, #1C1E24 100%)",
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: "rgba(252, 188, 50, 0.15)" }}
            >
              <Sparkles className="w-5 h-5" style={{ color: "#FCBC32" }} />
            </div>
            <div>
              <h2 className="font-display text-lg" style={{ color: "#FDFDFD" }}>
                {loading ? "Loading..." : prompt?.name || "Edit Prompt"}
              </h2>
              <p className="text-xs" style={{ color: "#8F949E" }}>
                {prompt?.description}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {prompt && !prompt.is_default && (
              <Badge variant="gold" className="text-[10px]">
                CUSTOMIZED
              </Badge>
            )}
            <button
              onClick={handleClose}
              className="p-2 rounded-lg transition-colors hover:bg-moon-800"
              style={{ color: "#8F949E" }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <LoadingSpinner size={6} />
            </div>
          ) : error ? (
            <div
              className="p-4 rounded-lg flex items-center gap-3"
              style={{ backgroundColor: "rgba(239, 68, 68, 0.1)" }}
            >
              <AlertCircle className="w-5 h-5 text-red-400" />
              <p className="text-red-400">{error}</p>
            </div>
          ) : prompt ? (
            <>
              {/* LLM Configuration */}
              <LLMConfigSection
                model={llmModel}
                temperature={llmTemperature}
                globalModel={globalModel}
                onModelChange={handleLlmModelChange}
                onTemperatureChange={handleLlmTemperatureChange}
              />

              {/* Variables Reference */}
              <VariablesReference
                variables={prompt.available_variables}
                copiedVar={copiedVar}
                onCopy={handleCopyVariable}
              />

              {/* System Prompt */}
              <PromptSection
                title="System Prompt"
                icon={<FileText className="w-4 h-4" />}
                optional
              >
                <PromptTextArea
                  value={systemPrompt}
                  onChange={handleSystemPromptChange}
                  placeholder="Optional system message that sets the AI's persona and context..."
                  minHeight={140}
                />
              </PromptSection>

              {/* User Prompt Template */}
              <PromptSection
                title="User Prompt Template"
                icon={<Code2 className="w-4 h-4" />}
              >
                <PromptTextArea
                  value={userPromptTemplate}
                  onChange={handleUserPromptChange}
                  placeholder="The main prompt template with {placeholders} for variables..."
                  minHeight={220}
                />
              </PromptSection>

              {/* Prompt Preview & Test */}
              <PromptPreviewSection
                promptId={promptId}
                systemPrompt={systemPrompt}
                userPromptTemplate={userPromptTemplate}
                variables={prompt.available_variables}
                model={llmModel || globalModel}
                temperature={llmTemperature}
              />

              {/* Version Info */}
              <VersionInfo
                versions={versions}
                prompt={prompt}
                showVersions={showVersions}
                onToggle={() => setShowVersions(!showVersions)}
                onSwitchVersion={handleSwitchVersion}
                switchingVersion={switchingVersion}
              />
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div
          className="flex-shrink-0 px-6 py-4 flex items-center justify-between"
          style={{
            borderTop: "1px solid #333333",
            background: "linear-gradient(0deg, #252830 0%, #1C1E24 100%)",
          }}
        >
          <div className="flex items-center gap-3">
            {!prompt?.is_default && (
              <button
                onClick={handleReset}
                disabled={saving || loading}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-all"
                style={{
                  backgroundColor: "transparent",
                  color: "#8F949E",
                  border: "1px solid #333333",
                }}
              >
                <RotateCcw className="w-4 h-4" />
                Reset to Default
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {saveSuccess && (
              <span
                className="flex items-center gap-1.5 text-sm"
                style={{ color: "#10BFCC" }}
              >
                <Check className="w-4 h-4" />
                Saved to Weave
              </span>
            )}
            {isPromptDirty && !saveSuccess && (
              <span className="text-xs" style={{ color: "#FCBC32" }}>
                Unsaved changes
              </span>
            )}
            <button
              onClick={handleClose}
              className="px-4 py-2 rounded-md text-sm transition-colors"
              style={{
                backgroundColor: "transparent",
                color: "#8F949E",
                border: "1px solid #333333",
              }}
            >
              {isLlmConfigDirty ? "Done" : "Cancel"}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading || !isPromptDirty}
              className="flex items-center gap-2 px-5 py-2 rounded-md text-sm font-medium transition-all uppercase tracking-wide disabled:opacity-50"
              style={{
                backgroundColor: "#FCBC32",
                color: "#171A1F",
              }}
            >
              {saving ? (
                <>
                  <LoadingSpinner size={4} />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* CSS Animation */}
      <style jsx global>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
      
      {/* Reset Confirmation Dialog */}
      <ConfirmDialog
        open={showResetConfirm}
        onConfirm={handleResetConfirmed}
        onCancel={() => setShowResetConfirm(false)}
        title="Reset Prompt?"
        message="Reset this prompt to its default version? Your changes will be lost."
        confirmText="Reset"
        variant="warning"
      />
      
      {/* Discard Changes Confirmation Dialog */}
      <ConfirmDialog
        open={showDiscardConfirm}
        onConfirm={handleCloseConfirmed}
        onCancel={() => setShowDiscardConfirm(false)}
        title="Discard Changes?"
        message="You have unsaved prompt changes. Discard them?"
        confirmText="Discard"
        variant="warning"
      />
      
      {/* Switch Version Confirmation Dialog */}
      <ConfirmDialog
        open={!!pendingSwitchVersion}
        onConfirm={() => pendingSwitchVersion && handleSwitchVersionConfirmed(pendingSwitchVersion)}
        onCancel={() => setPendingSwitchVersion(null)}
        title="Switch Version?"
        message="You have unsaved changes. Switching versions will discard them. Continue?"
        confirmText="Switch"
        variant="warning"
      />
    </>
  );
}

// ============================================================================
// Sub-Components
// ============================================================================

interface VariablesReferenceProps {
  variables: string[];
  copiedVar: string | null;
  onCopy: (variable: string) => void;
}

function VariablesReference({ variables, copiedVar, onCopy }: VariablesReferenceProps) {
  if (variables.length === 0) return null;

  return (
    <div
      className="rounded-lg p-4"
      style={{
        backgroundColor: "rgba(16, 191, 204, 0.08)",
        border: "1px solid rgba(16, 191, 204, 0.2)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Code2 className="w-4 h-4" style={{ color: "#10BFCC" }} />
        <span className="text-sm font-medium" style={{ color: "#10BFCC" }}>
          Available Variables
        </span>
        <span className="text-xs" style={{ color: "#8F949E" }}>
          Click to copy
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {variables.map((variable) => (
          <button
            key={variable}
            onClick={() => onCopy(variable)}
            className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono transition-all"
            style={{
              backgroundColor: "rgba(16, 191, 204, 0.12)",
              color: "#10BFCC",
              border: "1px solid rgba(16, 191, 204, 0.25)",
            }}
          >
            {copiedVar === variable ? (
              <>
                <Check className="w-3 h-3" />
                Copied!
              </>
            ) : (
              <>
                <span>{`{${variable}}`}</span>
                <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

interface PromptSectionProps {
  title: string;
  icon: React.ReactNode;
  optional?: boolean;
  children: React.ReactNode;
}

function PromptSection({ title, icon, optional, children }: PromptSectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span style={{ color: "#FCBC32" }}>{icon}</span>
        <span className="text-sm font-medium" style={{ color: "#FDFDFD" }}>
          {title}
        </span>
        {optional && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "#252830", color: "#8F949E" }}>
            Optional
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

interface PromptTextAreaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  minHeight: number;
}

function PromptTextArea({ value, onChange, placeholder, minHeight }: PromptTextAreaProps) {
  return (
    <div className="relative">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 rounded-lg font-mono text-sm resize-y"
        style={{
          minHeight: `${minHeight}px`,
          backgroundColor: "#171A1F",
          border: "1px solid #333333",
          color: "#FDFDFD",
          lineHeight: 1.6,
        }}
        spellCheck={false}
      />
      {/* Line numbers gutter effect */}
      <div
        className="absolute top-0 left-0 w-1 h-full rounded-l-lg"
        style={{
          background: "linear-gradient(180deg, #FCBC32 0%, #10BFCC 100%)",
          opacity: 0.4,
        }}
      />
    </div>
  );
}

interface VersionInfoProps {
  versions: PromptVersionsResponse | null;
  prompt: PromptConfig;
  showVersions: boolean;
  onToggle: () => void;
  onSwitchVersion: (version: PromptVersion) => void;
  switchingVersion: boolean;
}

function VersionInfo({ versions, prompt, showVersions, onToggle, onSwitchVersion, switchingVersion }: VersionInfoProps) {
  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  const hasVersions = versions?.versions && versions.versions.length > 0;

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        backgroundColor: "rgba(37, 40, 48, 0.5)",
        border: "1px solid #333333",
      }}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors hover:bg-moon-800/30"
      >
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4" style={{ color: "#8F949E" }} />
          <span className="text-sm" style={{ color: "#FDFDFD" }}>
            Version History
          </span>
          {prompt.version && (
            <code
              className="text-[10px] px-1.5 py-0.5 rounded font-mono"
              style={{ backgroundColor: "#252830", color: "#10BFCC" }}
            >
              {prompt.version}
            </code>
          )}
          {hasVersions && (
            <span className="text-[10px]" style={{ color: "#8F949E" }}>
              ({versions.versions.length} versions)
            </span>
          )}
        </div>
        {showVersions ? (
          <ChevronUp className="w-4 h-4" style={{ color: "#8F949E" }} />
        ) : (
          <ChevronDown className="w-4 h-4" style={{ color: "#8F949E" }} />
        )}
      </button>

      {showVersions && (
        <div
          className="px-4 py-3 space-y-3"
          style={{ borderTop: "1px solid #333333" }}
        >
          {/* Version List */}
          {hasVersions && (
            <div className="space-y-2">
              <p className="text-xs font-medium" style={{ color: "#8F949E" }}>
                Click to switch version:
              </p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {versions.versions.slice().reverse().map((v) => (
                  <button
                    key={v.digest}
                    onClick={() => !v.is_current && onSwitchVersion(v)}
                    disabled={v.is_current || switchingVersion}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded text-left text-sm transition-all ${
                      v.is_current 
                        ? 'cursor-default' 
                        : 'hover:bg-moon-800/50 cursor-pointer'
                    }`}
                    style={{
                      backgroundColor: v.is_current ? "rgba(16, 191, 204, 0.1)" : "transparent",
                      border: v.is_current ? "1px solid rgba(16, 191, 204, 0.3)" : "1px solid transparent",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <code 
                        className="text-xs font-mono px-1.5 py-0.5 rounded"
                        style={{ 
                          backgroundColor: v.is_current ? "rgba(16, 191, 204, 0.2)" : "#252830",
                          color: v.is_current ? "#10BFCC" : "#FDFDFD",
                        }}
                      >
                        {v.version}
                      </code>
                      <span className="text-xs" style={{ color: "#8F949E" }}>
                        {formatDate(v.created_at)}
                      </span>
                      {v.is_current && (
                        <span 
                          className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide"
                          style={{ backgroundColor: "rgba(16, 191, 204, 0.2)", color: "#10BFCC" }}
                        >
                          Current
                        </span>
                      )}
                    </div>
                    <code 
                      className="text-[10px] font-mono"
                      style={{ color: "#666" }}
                    >
                      {v.digest.slice(0, 8)}...
                    </code>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Weave UI Link */}
          {versions?.weave_versions_url && (
            <a
              href={versions.weave_versions_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs transition-colors pt-2"
              style={{ color: "#10BFCC", borderTop: "1px solid #333333" }}
            >
              <ExternalLink className="w-3 h-3" />
              View complete history in Weave
            </a>
          )}

          {/* No versions message */}
          {!hasVersions && !versions?.weave_versions_url && (
            <p className="text-sm" style={{ color: "#8F949E" }}>
              Version history will appear here after the first edit.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// LLM Configuration Section
// ============================================================================

interface LLMConfigSectionProps {
  model: string;
  temperature: number | null;
  globalModel: string;
  onModelChange: (value: string) => void;
  onTemperatureChange: (value: number | null) => void;
}

const MODEL_PRESETS_BASE = [
  // GPT-5.2 series (Dec 2025)
  { value: "gpt-5.2", label: "gpt-5.2" },
  { value: "gpt-5.2-pro", label: "gpt-5.2-pro" },
  // GPT-5.1 series
  { value: "gpt-5.1", label: "gpt-5.1" },
  { value: "gpt-5.1-codex", label: "gpt-5.1-codex" },
  // GPT-5 series
  { value: "gpt-5", label: "gpt-5" },
  { value: "gpt-5-mini", label: "gpt-5-mini" },
  { value: "gpt-5-nano", label: "gpt-5-nano" },
  { value: "gpt-5-pro", label: "gpt-5-pro" },
  // GPT-4.1 series
  { value: "gpt-4.1", label: "gpt-4.1" },
  { value: "gpt-4.1-mini", label: "gpt-4.1-mini" },
  { value: "gpt-4.1-nano", label: "gpt-4.1-nano" },
  // Reasoning models
  { value: "o4-mini", label: "o4-mini" },
  { value: "o3", label: "o3" },
  { value: "o3-mini", label: "o3-mini" },
  // GPT-4o series (still available)
  { value: "gpt-4o", label: "gpt-4o" },
  { value: "gpt-4o-mini", label: "gpt-4o-mini" },
];

function LLMConfigSection({
  model,
  temperature,
  globalModel,
  onModelChange,
  onTemperatureChange,
}: LLMConfigSectionProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Build presets with global model displayed
  const globalLabel = `Use Global Setting (${globalModel})`;
  const modelPresets = [
    { value: "", label: globalLabel },
    ...MODEL_PRESETS_BASE,
  ];

  // Filter presets based on search
  const filteredPresets = modelPresets.filter(
    (preset) =>
      preset.label.toLowerCase().includes(searchText.toLowerCase()) ||
      preset.value.toLowerCase().includes(searchText.toLowerCase())
  );

  // Get display text for the dropdown
  const displayText = model || globalLabel;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
        setSearchText("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectModel = (value: string) => {
    onModelChange(value);
    setIsDropdownOpen(false);
    setSearchText("");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(e.target.value);
    if (!isDropdownOpen) setIsDropdownOpen(true);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // If there's a search text, use it as custom model
      if (searchText.trim()) {
        onModelChange(searchText.trim());
        setIsDropdownOpen(false);
        setSearchText("");
      }
    } else if (e.key === "Escape") {
      setIsDropdownOpen(false);
      setSearchText("");
    }
  };

  return (
    <div
      className="rounded-lg"
      style={{
        backgroundColor: "rgba(252, 188, 50, 0.08)",
        border: "1px solid rgba(252, 188, 50, 0.2)",
      }}
    >
      {/* Header */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-t-lg transition-colors hover:bg-gold/5"
      >
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4" style={{ color: "#FCBC32" }} />
          <span className="text-sm font-medium" style={{ color: "#FCBC32" }}>
            LLM Configuration
          </span>
          {model && (
            <code
              className="text-[10px] px-1.5 py-0.5 rounded font-mono"
              style={{ backgroundColor: "rgba(252, 188, 50, 0.15)", color: "#FCBC32" }}
            >
              {model}
            </code>
          )}
          {temperature !== null && (
            <span className="text-xs" style={{ color: "#8F949E" }}>
              temp: {temperature.toFixed(1)}
            </span>
          )}
        </div>
        {showAdvanced ? (
          <ChevronUp className="w-4 h-4" style={{ color: "#8F949E" }} />
        ) : (
          <ChevronDown className="w-4 h-4" style={{ color: "#8F949E" }} />
        )}
      </button>

      {/* Expanded Content */}
      {showAdvanced && (
        <div className="px-4 py-3 space-y-4" style={{ borderTop: "1px solid rgba(252, 188, 50, 0.2)" }}>
          {/* Model Selection - Searchable Dropdown */}
          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: "#FDFDFD" }}>
              Model Override
            </label>
            <div className="relative" ref={dropdownRef}>
              {/* Dropdown trigger / search input */}
              <div
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer"
                style={{
                  backgroundColor: "#171A1F",
                  border: isDropdownOpen ? "1px solid #FCBC32" : "1px solid #333333",
                }}
                onClick={() => setIsDropdownOpen(true)}
              >
                <input
                  type="text"
                  value={isDropdownOpen ? searchText : displayText}
                  onChange={handleInputChange}
                  onKeyDown={handleInputKeyDown}
                  onFocus={() => setIsDropdownOpen(true)}
                  placeholder="Search or enter model..."
                  className="flex-1 bg-transparent text-sm font-mono outline-none"
                  style={{ color: model ? "#FDFDFD" : "#8F949E" }}
                />
                <ChevronDown 
                  className={`w-4 h-4 transition-transform ${isDropdownOpen ? "rotate-180" : ""}`}
                  style={{ color: "#8F949E" }}
                />
              </div>

              {/* Dropdown menu */}
              {isDropdownOpen && (
                <div
                  className="absolute z-50 w-full mt-1 rounded-lg shadow-xl overflow-hidden"
                  style={{
                    backgroundColor: "#1C1E24",
                    border: "1px solid #333333",
                  }}
                >
                  <div>
                    {filteredPresets.map((preset) => (
                      <button
                        key={preset.value}
                        onClick={() => handleSelectModel(preset.value)}
                        className="w-full px-3 py-2.5 text-left text-sm font-mono transition-colors hover:bg-moon-800/50 flex items-center justify-between"
                        style={{
                          backgroundColor: model === preset.value ? "rgba(252, 188, 50, 0.1)" : "transparent",
                          color: "#FDFDFD",
                        }}
                      >
                        <span>{preset.label}</span>
                        {model === preset.value && (
                          <Check className="w-4 h-4" style={{ color: "#FCBC32" }} />
                        )}
                      </button>
                    ))}
                    {/* Show custom option if search doesn't match any preset */}
                    {searchText && !filteredPresets.some(p => p.value === searchText || p.label === searchText) && (
                      <button
                        onClick={() => handleSelectModel(searchText)}
                        className="w-full px-3 py-2.5 text-left text-sm font-mono transition-colors hover:bg-moon-800/50 flex items-center gap-2"
                        style={{
                          backgroundColor: "transparent",
                          color: "#10BFCC",
                          borderTop: "1px solid #333333",
                        }}
                      >
                        <span>Use custom:</span>
                        <code className="px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(16, 191, 204, 0.15)" }}>
                          {searchText}
                        </code>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Temperature Slider */}
          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: "#FDFDFD" }}>
              Temperature
              <span className="ml-2 font-mono" style={{ color: "#10BFCC" }}>
                {temperature !== null ? temperature.toFixed(1) : "default (0.3)"}
              </span>
            </label>
            <div className="flex items-center gap-3">
              <span className="text-[10px]" style={{ color: "#8F949E" }}>Precise</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={temperature ?? 0.3}
                onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
                className="flex-1"
                style={{ accentColor: "#FCBC32" }}
              />
              <span className="text-[10px]" style={{ color: "#8F949E" }}>Creative</span>
            </div>
            <div className="flex justify-between mt-2">
              <button
                onClick={() => onTemperatureChange(null)}
                className="text-[10px] hover:underline"
                style={{ color: "#8F949E" }}
              >
                Reset to default
              </button>
              <div className="flex gap-2">
                {[0, 0.3, 0.7, 1.0].map((t) => (
                  <button
                    key={t}
                    onClick={() => onTemperatureChange(t)}
                    className={`text-[10px] px-1.5 py-0.5 rounded transition-all ${
                      temperature === t ? "ring-1" : ""
                    }`}
                    style={{
                      backgroundColor: temperature === t 
                        ? "rgba(16, 191, 204, 0.2)" 
                        : "rgba(37, 40, 48, 0.5)",
                      color: temperature === t ? "#10BFCC" : "#8F949E",
                      ringColor: "#10BFCC",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Agent Context Toggle */}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Prompt Preview & Test Section
// ============================================================================

interface PromptPreviewSectionProps {
  promptId: string;
  systemPrompt: string;
  userPromptTemplate: string;
  variables: string[];
  model: string;
  temperature: number | null;
}

function PromptPreviewSection({
  promptId,
  systemPrompt,
  userPromptTemplate,
  variables,
  model,
  temperature,
}: PromptPreviewSectionProps) {
  const { selectedAgent, dimensions, taxonomy } = useApp();
  const [showPreview, setShowPreview] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  // Build real values from context - no user input needed!
  const realValues = useMemo(() => {
    const values: Record<string, string> = {};
    
    variables.forEach((v) => {
      switch (v) {
        case "agent_name":
          values[v] = selectedAgent?.name || "My Agent";
          break;
        case "agent_context":
          values[v] = selectedAgent?.agent_context || "A helpful AI assistant";
          break;
        case "dimension_values":
          // Format dimensions as readable text
          if (dimensions && dimensions.length > 0) {
            const dimLines = dimensions.map((d) => 
              `• ${d.name}: ${d.values.slice(0, 3).join(", ")}${d.values.length > 3 ? "..." : ""}`
            );
            values[v] = dimLines.join("\n");
          } else {
            values[v] = "• user_type: new, returning\n• complexity: simple, complex";
          }
          break;
        case "testing_goals":
          values[v] = "Edge cases, error handling, multi-step interactions";
          break;
        case "existing_categories":
          values[v] = "• API timeout errors\n• Unclear user requests\n• Missing context";
          break;
        case "note_content":
          values[v] = "User seemed frustrated when the bot couldn't find their order";
          break;
        case "trace_summary":
          values[v] = "User asked about order status, bot provided incorrect information";
          break;
        case "modes_text":
          // Format failure modes from taxonomy for preview
          if (taxonomy && taxonomy.failure_modes && taxonomy.failure_modes.length > 0) {
            const modeLines = taxonomy.failure_modes.map((m) => 
              `- ID: ${m.id}\n  Name: ${m.name}\n  Description: ${m.description}\n  Notes count: ${m.times_seen}`
            );
            values[v] = modeLines.join("\n");
          } else {
            values[v] = "- ID: mode_1\n  Name: API Timeout\n  Description: External API calls taking too long\n  Notes count: 5\n- ID: mode_2\n  Name: Unclear Request\n  Description: User query was ambiguous\n  Notes count: 3";
          }
          break;
        // Synthetic prompt variables
        case "agent_context_section":
          // Format agent context section for dimension/value suggestion
          if (selectedAgent?.name || selectedAgent?.agent_context) {
            values[v] = `Agent: ${selectedAgent?.name || "My Agent"}\nPurpose: ${selectedAgent?.agent_context || "A helpful AI assistant"}`;
          } else {
            values[v] = "Agent: Customer Support Bot\nPurpose: Helps users with order inquiries and returns";
          }
          break;
        case "count":
          values[v] = "4";
          break;
        case "testing_goals_section":
          values[v] = "Focus on edge cases and error handling scenarios";
          break;
        case "dimension_name":
          // Use first dimension if available
          if (dimensions && dimensions.length > 0) {
            values[v] = dimensions[0].name;
          } else {
            values[v] = "user_type";
          }
          break;
        case "dimension_description":
          if (dimensions && dimensions.length > 0 && dimensions[0].description) {
            values[v] = dimensions[0].description;
          } else {
            values[v] = "Type of user interacting with the system";
          }
          break;
        case "existing_values":
          // Format existing values from first dimension
          if (dimensions && dimensions.length > 0 && dimensions[0].values.length > 0) {
            values[v] = dimensions[0].values.join(", ");
          } else {
            values[v] = "new_user, returning_user, premium_user";
          }
          break;
        default:
          values[v] = `[${v}]`;
      }
    });
    
    return values;
  }, [variables, selectedAgent, dimensions, taxonomy]);

  // Generate preview by replacing variables with real values
  const getPreview = (template: string) => {
    let result = template;
    Object.entries(realValues).forEach(([key, value]) => {
      result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
    });
    return result;
  };

  const handleTest = async () => {
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const response = await api.testPrompt(promptId, realValues);
      setTestResult(response.result);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        backgroundColor: "rgba(37, 40, 48, 0.5)",
        border: "1px solid #333333",
      }}
    >
      {/* Header */}
      <button
        onClick={() => setShowPreview(!showPreview)}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors hover:bg-moon-800/30"
      >
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4" style={{ color: "#10BFCC" }} />
          <span className="text-sm font-medium" style={{ color: "#FDFDFD" }}>
            Preview & Test
          </span>
          <span className="text-[10px]" style={{ color: "#8F949E" }}>
            (with your agent data)
          </span>
        </div>
        {showPreview ? (
          <ChevronUp className="w-4 h-4" style={{ color: "#8F949E" }} />
        ) : (
          <ChevronDown className="w-4 h-4" style={{ color: "#8F949E" }} />
        )}
      </button>

      {showPreview && (
        <div className="px-4 py-3 space-y-4" style={{ borderTop: "1px solid #333333" }}>
          {/* Variables Being Used (read-only display) */}
          {variables.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium" style={{ color: "#8F949E" }}>
                Variables populated from your data:
              </p>
              <div className="flex flex-wrap gap-2">
                {variables.map((variable) => (
                  <div
                    key={variable}
                    className="text-[10px] px-2 py-1 rounded font-mono"
                    style={{
                      backgroundColor: "rgba(16, 191, 204, 0.1)",
                      border: "1px solid rgba(16, 191, 204, 0.2)",
                      color: "#10BFCC",
                    }}
                    title={realValues[variable]}
                  >
                    {`{${variable}}`} = {realValues[variable]?.slice(0, 30)}{realValues[variable]?.length > 30 ? "..." : ""}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Preview */}
          <div className="space-y-2">
            <p className="text-xs font-medium" style={{ color: "#8F949E" }}>
              Final prompt preview:
            </p>
            <div
              className="p-3 rounded-lg font-mono text-xs overflow-x-auto"
              style={{
                backgroundColor: "#171A1F",
                border: "1px solid #333333",
                color: "#FDFDFD",
                lineHeight: 1.6,
                maxHeight: "200px",
                overflowY: "auto",
              }}
            >
              {systemPrompt && (
                <div className="mb-3 pb-3" style={{ borderBottom: "1px solid #333" }}>
                  <span className="text-[10px] uppercase tracking-wide" style={{ color: "#8F949E" }}>
                    System
                  </span>
                  <div className="mt-1 whitespace-pre-wrap">{getPreview(systemPrompt)}</div>
                </div>
              )}
              <div>
                <span className="text-[10px] uppercase tracking-wide" style={{ color: "#8F949E" }}>
                  User
                </span>
                <div className="mt-1 whitespace-pre-wrap">{getPreview(userPromptTemplate)}</div>
              </div>
            </div>
          </div>

          {/* Test Button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleTest}
              disabled={testing}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all"
              style={{
                backgroundColor: testing ? "#333" : "#10BFCC",
                color: testing ? "#8F949E" : "#171A1F",
              }}
            >
              {testing ? (
                <>
                  <LoadingSpinner size={4} />
                  Testing...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Test with Real Data
                </>
              )}
            </button>
            <span className="text-[10px]" style={{ color: "#8F949E" }}>
              {model} {temperature !== null ? `@ temp ${temperature}` : ""}
            </span>
          </div>

          {/* Test Result */}
          {testResult && (
            <div
              className="p-3 rounded-lg"
              style={{
                backgroundColor: "rgba(16, 191, 204, 0.1)",
                border: "1px solid rgba(16, 191, 204, 0.3)",
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Check className="w-4 h-4" style={{ color: "#10BFCC" }} />
                <span className="text-xs font-medium" style={{ color: "#10BFCC" }}>
                  LLM Response
                </span>
              </div>
              <div
                className="text-xs font-mono whitespace-pre-wrap"
                style={{ color: "#FDFDFD", maxHeight: "150px", overflowY: "auto" }}
              >
                {testResult}
              </div>
            </div>
          )}

          {/* Test Error */}
          {testError && (
            <div
              className="p-3 rounded-lg flex items-center gap-2"
              style={{
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
              }}
            >
              <AlertCircle className="w-4 h-4 text-red-400" />
              <span className="text-xs text-red-400">{testError}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Edit Prompt Button - Compact trigger button
// ============================================================================

interface EditPromptButtonProps {
  promptId: string;
  label?: string;
  size?: "sm" | "md";
  variant?: "ghost" | "outline";
  className?: string;
}

export function EditPromptButton({
  promptId,
  label,
  size = "sm",
  variant = "ghost",
  className = "",
}: EditPromptButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const sizeStyles = {
    sm: "px-2 py-1 text-[10px] gap-1",
    md: "px-3 py-1.5 text-xs gap-1.5",
  };

  const variantStyles = {
    ghost: {
      backgroundColor: "transparent",
      color: "#8F949E",
      border: "none",
    },
    outline: {
      backgroundColor: "transparent",
      color: "#8F949E",
      border: "1px solid #333333",
    },
  };

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(true);
        }}
        className={`inline-flex items-center rounded transition-all hover:text-gold ${sizeStyles[size]} ${className}`}
        style={variantStyles[variant]}
        title="Edit prompt"
      >
        <Pencil className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
        {label && <span>{label}</span>}
      </button>

      <PromptEditDrawer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        promptId={promptId}
      />
    </>
  );
}

export default PromptEditDrawer;

