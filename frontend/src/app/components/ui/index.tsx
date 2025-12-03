"use client";

import { ReactNode } from "react";
import {
  RefreshCw,
  AlertTriangle,
  MessageSquare,
  Cpu,
  ChevronRight,
  Check,
  Copy,
} from "lucide-react";

// ============================================================================
// Loading States
// ============================================================================

export function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`shimmer rounded ${className}`} />;
}

export function LoadingSpinner({ size = 4 }: { size?: number }) {
  return <RefreshCw className={`w-${size} h-${size} animate-spin`} />;
}

export function LoadingCards({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {[...Array(count)].map((_, i) => (
        <Shimmer key={i} className="h-20" />
      ))}
    </div>
  );
}

// ============================================================================
// Empty States
// ============================================================================

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="text-center py-12 text-ink-500">
      {icon && <div className="mb-3">{icon}</div>}
      <p className="text-lg">{title}</p>
      {description && <p className="text-sm mt-2">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function NoSessionsFound() {
  return (
    <EmptyState
      icon={<AlertTriangle className="w-8 h-8 mx-auto opacity-50" />}
      title="No sessions found"
      description="Try adjusting filters"
    />
  );
}

export function NoAgentsRegistered({ onRegister }: { onRegister?: () => void }) {
  return (
    <EmptyState
      icon={<Cpu className="w-12 h-12 mx-auto opacity-50" />}
      title="No agents registered yet"
      description="Register your agent to enable synthetic data generation and automated review."
      action={
        onRegister && (
          <button onClick={onRegister} className="btn-primary">
            Register Your First Agent
          </button>
        )
      }
    />
  );
}

export function SelectPrompt({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="text-center py-16 text-ink-500">
      <div className="mx-auto mb-3 opacity-50">{icon}</div>
      <p>{title}</p>
      <p className="text-sm mt-1">{description}</p>
    </div>
  );
}

// ============================================================================
// Progress Indicators
// ============================================================================

interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  sublabel?: string;
  className?: string;
  gradientFrom?: string;
  gradientTo?: string;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  sublabel,
  className = "",
  gradientFrom = "from-accent-teal",
  gradientTo = "to-accent-coral",
}: ProgressBarProps) {
  const percent = Math.min((value / max) * 100, 100);
  return (
    <div className={className}>
      {(label || sublabel) && (
        <div className="flex items-center justify-between mb-2 text-xs text-ink-500">
          {label && <span>{label}</span>}
          {sublabel && <span>{sublabel}</span>}
        </div>
      )}
      <div className="h-2 bg-ink-800 rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${gradientFrom} ${gradientTo} transition-all duration-500`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Cards & Containers
// ============================================================================

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  selected?: boolean;
  hoverable?: boolean;
}

export function Card({
  children,
  className = "",
  onClick,
  selected,
  hoverable = true,
}: CardProps) {
  const baseClass = "bg-ink-900/50 rounded-xl border border-ink-800 p-4";
  const interactiveClass = onClick
    ? `cursor-pointer ${hoverable ? "hover:bg-ink-800/50" : ""} transition-colors`
    : "";
  const selectedClass = selected ? "ring-2 ring-accent-coral" : "";

  return (
    <div
      className={`${baseClass} ${interactiveClass} ${selectedClass} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-ink-900/50 rounded-xl border border-ink-800 p-5 ${className}`}>
      {children}
    </div>
  );
}

interface PanelHeaderProps {
  icon: ReactNode;
  title: string;
  badge?: ReactNode;
  actions?: ReactNode;
}

export function PanelHeader({ icon, title, badge, actions }: PanelHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="font-display text-lg font-semibold text-sand-100 flex items-center gap-2">
        {icon}
        {title}
        {badge}
      </h2>
      {actions}
    </div>
  );
}

// ============================================================================
// List Items
// ============================================================================

interface ListItemProps {
  children: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}

export function ListItem({ children, onClick, selected, className = "" }: ListItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left trace-card rounded-lg p-3 ${
        selected ? "ring-2 ring-accent-coral" : ""
      } ${className}`}
    >
      {children}
    </button>
  );
}

interface AgentListItemProps {
  name: string;
  version?: string;
  purpose?: string;
  connectionStatus?: string;
  dimensionsCount?: number;
  onClick?: () => void;
  selected?: boolean;
}

export function AgentListItem({
  name,
  version,
  purpose,
  connectionStatus,
  dimensionsCount,
  onClick,
  selected,
}: AgentListItemProps) {
  const statusColor =
    connectionStatus === "connected"
      ? "text-emerald-400"
      : connectionStatus === "error"
      ? "text-red-400"
      : "text-ink-400";

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-lg border transition-all ${
        selected
          ? "bg-accent-teal/10 border-accent-teal"
          : "bg-ink-800/50 border-ink-700 hover:border-ink-600"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sand-100 truncate">{name}</span>
            {version && <span className="text-xs text-ink-400">v{version}</span>}
          </div>
          {purpose && (
            <p className="text-sm text-ink-400 truncate mt-1">{purpose}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs">
            {connectionStatus && (
              <span className={`flex items-center gap-1 ${statusColor}`}>
                {connectionStatus}
              </span>
            )}
            {dimensionsCount !== undefined && dimensionsCount > 0 && (
              <span className="text-ink-400">{dimensionsCount} dimensions</span>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-ink-500 flex-shrink-0" />
      </div>
    </button>
  );
}

// ============================================================================
// Badges
// ============================================================================

type BadgeVariant = "coral" | "teal" | "gold" | "plum" | "amber" | "default";

const badgeVariants: Record<BadgeVariant, string> = {
  coral: "bg-accent-coral/20 text-accent-coral",
  teal: "bg-accent-teal/20 text-accent-teal",
  gold: "bg-accent-gold/20 text-accent-gold",
  plum: "bg-accent-plum/20 text-accent-plum",
  amber: "bg-amber-500/20 text-amber-400",
  default: "bg-ink-700 text-ink-300",
};

export function Badge({
  children,
  variant = "default",
  className = "",
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span className={`badge ${badgeVariants[variant]} ${className}`}>{children}</span>
  );
}

export function StatusBadge({
  status,
  className = "",
}: {
  status: string;
  className?: string;
}) {
  const statusStyles: Record<string, string> = {
    connected: "bg-green-900/50 text-green-400",
    disconnected: "bg-ink-700 text-ink-400",
    error: "bg-red-900/50 text-red-400",
    completed: "bg-green-900/50 text-green-400",
    running: "bg-amber-900/50 text-amber-400 animate-pulse",
    ready: "bg-blue-900/50 text-blue-400",
    pending: "bg-ink-700 text-ink-400",
    failed: "bg-red-900/50 text-red-400",
    success: "bg-green-900/50 text-green-400",
  };

  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded ${statusStyles[status] || statusStyles.pending} ${className}`}
    >
      {status}
    </span>
  );
}

// ============================================================================
// Buttons
// ============================================================================

interface CopyButtonProps {
  text: string;
  onCopy?: () => void;
  className?: string;
  label?: string;
}

export function CopyButton({ text, onCopy, className = "", label }: CopyButtonProps) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      onCopy?.();
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`btn-ghost text-xs flex items-center gap-1.5 px-2 py-1 ${className}`}
      title="Copy to clipboard"
    >
      <Copy className="w-3.5 h-3.5" />
      {label && <span>{label}</span>}
    </button>
  );
}

interface ActionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon: ReactNode;
  loadingIcon?: ReactNode;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
}

export function ActionButton({
  onClick,
  disabled,
  loading,
  icon,
  loadingIcon,
  children,
  variant = "primary",
  className = "",
}: ActionButtonProps) {
  const variantClass =
    variant === "primary"
      ? "btn-primary"
      : variant === "secondary"
      ? "btn-secondary"
      : variant === "danger"
      ? "btn-ghost text-red-400 hover:text-red-300 hover:bg-red-500/10"
      : "btn-ghost";

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`${variantClass} flex items-center gap-2 ${className}`}
    >
      {loading ? loadingIcon || <LoadingSpinner size={4} /> : icon}
      {children}
    </button>
  );
}

// ============================================================================
// Modal
// ============================================================================

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-ink-900 rounded-xl border border-ink-700 p-6 w-full max-w-md">
        <h3 className="font-display text-lg font-semibold text-sand-100 mb-4">{title}</h3>
        {children}
        {footer && (
          <div className="flex items-center justify-end gap-3 mt-6">{footer}</div>
        )}
      </div>
    </div>
  );
}

