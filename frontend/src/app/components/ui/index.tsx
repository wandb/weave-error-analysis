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
  return <div className={`shimmer rounded-md ${className}`} />;
}

export function LoadingSpinner({ size = 4 }: { size?: number }) {
  return <RefreshCw className={`w-${size} h-${size} animate-spin text-gold`} />;
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
    <div className="text-center py-12 text-moon-450">
      {icon && <div className="mb-3">{icon}</div>}
      <p className="text-base">{title}</p>
      {description && <p className="text-sm mt-2 text-moon-450/80">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function NoSessionsFound() {
  return (
    <EmptyState
      icon={<AlertTriangle className="w-8 h-8 mx-auto text-moon-450/50" />}
      title="No sessions found"
      description="Try adjusting filters"
    />
  );
}

export function NoAgentsRegistered({ onRegister }: { onRegister?: () => void }) {
  return (
    <EmptyState
      icon={<Cpu className="w-12 h-12 mx-auto text-moon-450/50" />}
      title="No agents registered yet"
      description="Register your agent to enable synthetic data generation and automated review."
      action={
        onRegister && (
          <button onClick={onRegister} className="btn-primary">
            REGISTER YOUR FIRST AGENT
          </button>
        )
      }
    />
  );
}

export function SelectPrompt({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="text-center py-16 text-moon-450">
      <div className="mx-auto mb-3 opacity-50">{icon}</div>
      <p className="text-moon-50">{title}</p>
      {description && <p className="text-sm mt-1 text-moon-450">{description}</p>}
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
  gradientFrom = "from-teal",
  gradientTo = "to-gold",
}: ProgressBarProps) {
  const percent = Math.min((value / max) * 100, 100);
  return (
    <div className={className}>
      {(label || sublabel) && (
        <div className="flex items-center justify-between mb-2 text-xs text-moon-450">
          {label && <span>{label}</span>}
          {sublabel && <span className="text-moon-50">{sublabel}</span>}
        </div>
      )}
      <div className="h-1.5 bg-moon-800 rounded-full overflow-hidden">
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
  const baseClass = "bg-moon-800/40 rounded-lg border border-moon-800 p-4";
  const interactiveClass = onClick
    ? `cursor-pointer ${hoverable ? "hover:bg-moon-800/60" : ""} transition-colors`
    : "";
  const selectedClass = selected ? "ring-2 ring-gold" : "";

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
    <div className={`bg-moon-800/40 rounded-lg border border-moon-800 p-5 ${className}`}>
      {children}
    </div>
  );
}

interface PanelHeaderProps {
  icon?: ReactNode;
  title: string;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PanelHeader({ icon, title, badge, actions, className = "" }: PanelHeaderProps) {
  return (
    <div className={`flex items-center justify-between mb-4 ${className}`}>
      <h2 className="font-display text-lg text-moon-50 flex items-center gap-2">
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
        selected ? "ring-2 ring-gold" : ""
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
      ? "text-teal"
      : connectionStatus === "error"
      ? "text-red-400"
      : "text-moon-450";

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-lg border transition-all ${
        selected
          ? "bg-gold/10 border-gold"
          : "bg-moon-800/50 border-moon-700 hover:border-moon-600"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-moon-50 truncate">{name}</span>
            {version && <span className="text-xs text-moon-450">v{version}</span>}
          </div>
          {purpose && (
            <p className="text-sm text-moon-450 truncate mt-1">{purpose}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs">
            {connectionStatus && (
              <span className={`flex items-center gap-1 ${statusColor}`}>
                {connectionStatus}
              </span>
            )}
            {dimensionsCount !== undefined && dimensionsCount > 0 && (
              <span className="text-moon-450">{dimensionsCount} dimensions</span>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-moon-450 flex-shrink-0" />
      </div>
    </button>
  );
}

// ============================================================================
// Badges - W&B Brand Colors
// ============================================================================

type BadgeVariant = "coral" | "teal" | "gold" | "plum" | "amber" | "default";

const badgeVariants: Record<BadgeVariant, string> = {
  coral: "bg-gold/15 text-gold",
  teal: "bg-teal/15 text-teal",
  gold: "bg-gold/15 text-gold",
  plum: "bg-moon-450/15 text-moon-450",
  amber: "bg-gold/15 text-gold",
  default: "bg-moon-700 text-moon-450",
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
    connected: "bg-teal/20 text-teal",
    disconnected: "bg-moon-700 text-moon-450",
    error: "bg-red-500/20 text-red-400",
    completed: "bg-teal/20 text-teal",
    running: "bg-gold/20 text-gold animate-pulse",
    ready: "bg-teal/20 text-teal",
    pending: "bg-moon-700 text-moon-450",
    failed: "bg-red-500/20 text-red-400",
    success: "bg-teal/20 text-teal",
  };

  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-md ${statusStyles[status] || statusStyles.pending} ${className}`}
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
// Modal - W&B Styled
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-moon-800 rounded-lg border border-moon-700 p-6 w-full max-w-md shadow-xl">
        <h3 className="font-display text-lg text-moon-50 mb-4">{title}</h3>
        {children}
        {footer && (
          <div className="flex items-center justify-end gap-3 mt-6">{footer}</div>
        )}
      </div>
    </div>
  );
}

