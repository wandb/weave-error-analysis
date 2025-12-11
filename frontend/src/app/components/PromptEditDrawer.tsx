"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  RotateCcw,
  Save,
  ExternalLink,
  Sparkles,
  FileText,
  Code2,
  AlertCircle,
  Check,
  Copy,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Badge, LoadingSpinner } from "./ui";
import * as api from "../lib/api";
import type { PromptConfig, PromptVersionsResponse } from "../types";

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
  // State
  const [prompt, setPrompt] = useState<PromptConfig | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userPromptTemplate, setUserPromptTemplate] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Version info
  const [versions, setVersions] = useState<PromptVersionsResponse | null>(null);
  const [showVersions, setShowVersions] = useState(false);

  // Track if there are unsaved changes
  const [isDirty, setIsDirty] = useState(false);

  // Variable insertion helpers
  const [copiedVar, setCopiedVar] = useState<string | null>(null);

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
      setError(null);
      setSaveSuccess(false);
      setIsDirty(false);
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
      setVersions(versionsData);
      setIsDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load prompt");
    } finally {
      setLoading(false);
    }
  };

  const handleSystemPromptChange = (value: string) => {
    setSystemPrompt(value);
    setIsDirty(true);
    setSaveSuccess(false);
  };

  const handleUserPromptChange = (value: string) => {
    setUserPromptTemplate(value);
    setIsDirty(true);
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    if (!prompt) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      const updated = await api.updatePrompt(
        promptId,
        systemPrompt || null,
        userPromptTemplate
      );
      setPrompt(updated);
      setIsDirty(false);
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

  const handleReset = async () => {
    if (!confirm("Reset this prompt to its default version? Your changes will be lost.")) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const reset = await api.resetPrompt(promptId);
      setPrompt(reset);
      setSystemPrompt(reset.system_prompt || "");
      setUserPromptTemplate(reset.user_prompt_template);
      setIsDirty(false);
      setSaveSuccess(true);
      onSave?.(reset);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset prompt");
    } finally {
      setSaving(false);
    }
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

  const handleClose = () => {
    if (isDirty) {
      if (!confirm("You have unsaved changes. Discard them?")) {
        return;
      }
    }
    onClose();
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
  }, [isOpen, isDirty]);

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
              {/* Variables Reference */}
              <VariablesReference
                variables={prompt.available_variables}
                copiedVar={copiedVar}
                onCopy={handleCopyVariable}
              />

              {/* System Prompt */}
              <PromptSection
                title="System Prompt"
                subtitle="Sets the AI's context and behavior"
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
                subtitle="The main prompt sent for each analysis"
                icon={<Code2 className="w-4 h-4" />}
              >
                <PromptTextArea
                  value={userPromptTemplate}
                  onChange={handleUserPromptChange}
                  placeholder="The main prompt template with {placeholders} for variables..."
                  minHeight={280}
                />
              </PromptSection>

              {/* Version Info */}
              <VersionInfo
                versions={versions}
                prompt={prompt}
                showVersions={showVersions}
                onToggle={() => setShowVersions(!showVersions)}
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
            {isDirty && !saveSuccess && (
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
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading || !isDirty}
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
  subtitle: string;
  icon: React.ReactNode;
  optional?: boolean;
  children: React.ReactNode;
}

function PromptSection({ title, subtitle, icon, optional, children }: PromptSectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
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
        <span className="text-xs" style={{ color: "#8F949E" }}>
          {subtitle}
        </span>
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
}

function VersionInfo({ versions, prompt, showVersions, onToggle }: VersionInfoProps) {
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
              style={{ backgroundColor: "#252830", color: "#8F949E" }}
            >
              {prompt.version.slice(0, 8)}...
            </code>
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
          className="px-4 py-3 text-sm"
          style={{ borderTop: "1px solid #333333" }}
        >
          {versions?.weave_versions_url ? (
            <a
              href={versions.weave_versions_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm transition-colors"
              style={{ color: "#10BFCC" }}
            >
              <ExternalLink className="w-4 h-4" />
              View all versions in Weave
            </a>
          ) : (
            <p style={{ color: "#8F949E" }}>
              Version history is available in the Weave UI when connected.
            </p>
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
        <Sparkles className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
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

