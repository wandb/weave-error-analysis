"use client";

import { ReactNode, useState, useCallback } from "react";
import {
  RefreshCw,
  AlertTriangle,
  MessageSquare,
  Cpu,
  ChevronRight,
  Check,
  Copy,
  Loader2,
  AlertCircle,
} from "lucide-react";

// Re-export standalone components
export { DualRangeSlider } from "./DualRangeSlider";

// ============================================================================
// Loading States - Standardized patterns for consistent UX
// ============================================================================

/**
 * Shimmer - Animated placeholder for skeleton loading
 */
export function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`shimmer rounded-md ${className}`} />;
}

/**
 * LoadingSpinner - Consistent spinning indicator
 * Use for inline loading states and button loading
 */
export function LoadingSpinner({ size = 4, className = "" }: { size?: number; className?: string }) {
  const sizeClass = size === 3 ? "w-3 h-3" : size === 5 ? "w-5 h-5" : size === 6 ? "w-6 h-6" : "w-4 h-4";
  return <Loader2 className={`${sizeClass} animate-spin text-gold ${className}`} />;
}

/**
 * LoadingCards - Skeleton cards for list loading
 * Use for initial page/list loads
 */
export function LoadingCards({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {[...Array(count)].map((_, i) => (
        <Shimmer key={i} className="h-20" />
      ))}
    </div>
  );
}

/**
 * LoadingState - Standardized loading wrapper
 * 
 * Usage patterns:
 * - variant="skeleton": Initial page load - shows shimmer placeholders
 * - variant="spinner": Refresh/fetch - shows inline spinner with optional message
 * - variant="overlay": Action in progress - shows overlay on existing content
 */
interface LoadingStateProps {
  loading: boolean;
  children: ReactNode;
  variant?: "skeleton" | "spinner" | "overlay";
  skeletonCount?: number;
  skeletonHeight?: string;
  message?: string;
  className?: string;
}

export function LoadingState({
  loading,
  children,
  variant = "skeleton",
  skeletonCount = 3,
  skeletonHeight = "h-20",
  message,
  className = "",
}: LoadingStateProps) {
  if (!loading) return <>{children}</>;

  switch (variant) {
    case "skeleton":
      return (
        <div className={`space-y-2 ${className}`}>
          {[...Array(skeletonCount)].map((_, i) => (
            <Shimmer key={i} className={skeletonHeight} />
          ))}
        </div>
      );

    case "spinner":
      return (
        <div className={`flex items-center justify-center py-8 text-moon-450 ${className}`}>
          <LoadingSpinner size={5} className="mr-2" />
          <span>{message || "Loading..."}</span>
        </div>
      );

    case "overlay":
      return (
        <div className={`relative ${className}`}>
          {children}
          <div className="absolute inset-0 bg-moon-900/60 flex items-center justify-center rounded-lg backdrop-blur-sm">
            <div className="flex items-center gap-2 text-moon-50">
              <LoadingSpinner size={5} />
              {message && <span className="text-sm">{message}</span>}
            </div>
          </div>
        </div>
      );

    default:
      return <>{children}</>;
  }
}

/**
 * InlineLoading - Compact loading indicator for headers and inline use
 */
export function InlineLoading({ message = "Loading..." }: { message?: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-moon-450">
      <LoadingSpinner size={3} />
      {message}
    </span>
  );
}

/**
 * ButtonLoading - Loading state for buttons
 * Replaces button content while maintaining button dimensions
 */
export function ButtonLoading({ size = 4 }: { size?: number }) {
  return <LoadingSpinner size={size} />;
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

export function NoThreadsFound() {
  return (
    <EmptyState
      icon={<AlertTriangle className="w-8 h-8 mx-auto text-moon-450/50" />}
      title="No threads found"
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
    <div className="flex flex-col items-center justify-center py-12 text-moon-450">
      <div className="mb-4 opacity-40">{icon}</div>
      <h2 className="text-xl font-display text-moon-50 mb-2">{title}</h2>
      {description && <p className="text-sm text-moon-450 max-w-md text-center">{description}</p>}
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

// Note: "coral" currently renders same as "gold" - should get distinct color if needed
type BadgeVariant = "coral" | "teal" | "gold" | "plum" | "default";

const badgeVariants: Record<BadgeVariant, string> = {
  coral: "bg-gold/15 text-gold",  // TODO: Define distinct coral color if needed
  teal: "bg-teal/15 text-teal",
  gold: "bg-gold/15 text-gold",
  plum: "bg-moon-450/15 text-moon-450",
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
    generating: "bg-gold/20 text-gold animate-pulse",
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

// ============================================================================
// ConfirmDialog - Styled replacement for window.confirm()
// ============================================================================

type ConfirmVariant = "danger" | "warning" | "info";

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
  loading?: boolean;
}

const variantStyles: Record<ConfirmVariant, { icon: ReactNode; buttonClass: string }> = {
  danger: {
    icon: <AlertCircle className="w-6 h-6 text-red-400" />,
    buttonClass: "bg-red-500 hover:bg-red-600 text-white",
  },
  warning: {
    icon: <AlertTriangle className="w-6 h-6 text-gold" />,
    buttonClass: "bg-gold hover:bg-gold/90 text-moon-900",
  },
  info: {
    icon: <AlertCircle className="w-6 h-6 text-teal" />,
    buttonClass: "btn-primary",
  },
};

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  loading = false,
}: ConfirmDialogProps) {
  if (!open) return null;

  const { icon, buttonClass } = variantStyles[variant];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-moon-800 rounded-lg border border-moon-700 p-6 w-full max-w-sm shadow-xl">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 mt-0.5">{icon}</div>
          <div className="flex-1 min-w-0">
            <h3 className="font-display text-lg text-moon-50 mb-2">{title}</h3>
            <p className="text-sm text-moon-450">{message}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            disabled={loading}
            className="btn-ghost px-4 py-2 text-sm disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm rounded-md font-medium transition-colors flex items-center gap-2 disabled:opacity-50 ${buttonClass}`}
          >
            {loading && <LoadingSpinner size={3} />}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// useConfirm Hook - Easy-to-use confirmation dialog
// ============================================================================

interface UseConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
}

interface UseConfirmReturn {
  confirm: () => Promise<boolean>;
  ConfirmDialogComponent: () => ReactNode;
}

/**
 * useConfirm - Hook for easy confirmation dialogs
 * 
 * Usage:
 * ```tsx
 * const { confirm, ConfirmDialogComponent } = useConfirm({
 *   title: "Delete Item?",
 *   message: "This action cannot be undone.",
 *   variant: "danger",
 * });
 * 
 * const handleDelete = async () => {
 *   if (await confirm()) {
 *     // User confirmed - proceed with delete
 *   }
 * };
 * 
 * return (
 *   <>
 *     <button onClick={handleDelete}>Delete</button>
 *     <ConfirmDialogComponent />
 *   </>
 * );
 * ```
 */
export function useConfirm(options: UseConfirmOptions): UseConfirmReturn {
  const [state, setState] = useState<{
    open: boolean;
    resolve: ((value: boolean) => void) | null;
  }>({ open: false, resolve: null });

  const confirm = useCallback(() => {
    return new Promise<boolean>((resolve) => {
      setState({ open: true, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state.resolve?.(true);
    setState({ open: false, resolve: null });
  }, [state.resolve]);

  const handleCancel = useCallback(() => {
    state.resolve?.(false);
    setState({ open: false, resolve: null });
  }, [state.resolve]);

  const ConfirmDialogComponent = useCallback(() => (
    <ConfirmDialog
      open={state.open}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
      {...options}
    />
  ), [state.open, handleConfirm, handleCancel, options]);

  return { confirm, ConfirmDialogComponent };
}

