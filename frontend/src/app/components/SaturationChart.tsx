"use client";

import { useState, useEffect, useMemo } from "react";
import {
  TrendingUp,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Target,
  Layers,
} from "lucide-react";
import { SaturationHistory, fetchSaturationHistory } from "../lib/api";

interface SaturationChartProps {
  /** Optional callback when data is refreshed */
  onRefresh?: () => void;
  /** Whether to show expanded view by default */
  defaultExpanded?: boolean;
  /** Compact mode for sidebar display */
  compact?: boolean;
}

export function SaturationChart({ 
  onRefresh, 
  defaultExpanded = false,
  compact = false 
}: SaturationChartProps) {
  const [history, setHistory] = useState<SaturationHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchSaturationHistory();
      setHistory(data);
    } catch (err) {
      setError("Failed to load saturation data");
      console.error("Saturation history error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleRefresh = () => {
    fetchHistory();
    onRefresh?.();
  };

  // Chart dimensions and scaling
  const chartData = useMemo(() => {
    if (!history || history.snapshots.length === 0) return null;

    const snapshots = history.snapshots;
    const maxThreads = Math.max(
      history.current_threads,
      ...snapshots.map((s) => s.threads_reviewed),
      20 // Minimum x-axis
    );
    const maxModes = Math.max(
      history.current_modes,
      ...snapshots.map((s) => s.failure_modes_count),
      5 // Minimum y-axis
    );

    // Normalize points for SVG (0-100 scale)
    const points = snapshots.map((s) => ({
      x: (s.threads_reviewed / maxThreads) * 100,
      y: 100 - (s.failure_modes_count / maxModes) * 100,
      threads: s.threads_reviewed,
      modes: s.failure_modes_count,
    }));

    // Add current point if different from last snapshot
    const lastSnapshot = snapshots[snapshots.length - 1];
    if (
      history.current_threads !== lastSnapshot?.threads_reviewed ||
      history.current_modes !== lastSnapshot?.failure_modes_count
    ) {
      points.push({
        x: (history.current_threads / maxThreads) * 100,
        y: 100 - (history.current_modes / maxModes) * 100,
        threads: history.current_threads,
        modes: history.current_modes,
      });
    }

    // Create SVG path
    const pathData =
      points.length > 0
        ? points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")
        : "";

    return {
      points,
      pathData,
      maxThreads,
      maxModes,
      // Saturation threshold line (where discovery flattens)
      saturationY: 100 - (history.current_modes / maxModes) * 100,
    };
  }, [history]);

  // Status styling
  const getStatusStyles = (status: SaturationHistory["saturation_status"]) => {
    switch (status) {
      case "saturated":
        return {
          bg: "bg-emerald-500/20",
          border: "border-emerald-500/40",
          text: "text-emerald-400",
          icon: CheckCircle2,
          label: "Saturated",
          chartColor: "#10b981", // emerald
        };
      case "approaching_saturation":
        return {
          bg: "bg-amber-500/20",
          border: "border-amber-500/40",
          text: "text-amber-400",
          icon: Activity,
          label: "Approaching",
          chartColor: "#f59e0b", // amber
        };
      case "discovering":
        return {
          bg: "bg-blue-500/20",
          border: "border-blue-500/40",
          text: "text-blue-400",
          icon: TrendingUp,
          label: "Discovering",
          chartColor: "#3b82f6", // blue
        };
      default:
        return {
          bg: "bg-moon-700/40",
          border: "border-moon-600/40",
          text: "text-moon-400",
          icon: Layers,
          label: "No Data",
          chartColor: "#6b7280", // gray
        };
    }
  };

  const getRecommendationIcon = (type: SaturationHistory["recommendation_type"]) => {
    switch (type) {
      case "success":
        return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case "action":
        return <Target className="w-4 h-4 text-amber-400" />;
      default:
        return <Lightbulb className="w-4 h-4 text-blue-400" />;
    }
  };

  if (loading) {
    return (
      <div className={`bg-moon-900/60 border border-moon-800 rounded-lg ${compact ? "p-3" : "p-4"}`}>
        <div className="flex items-center justify-center gap-2 text-moon-500">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading saturation data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-moon-900/60 border border-moon-800 rounded-lg ${compact ? "p-3" : "p-4"}`}>
        <div className="flex items-center justify-center gap-2 text-red-400">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm">{error}</span>
          <button onClick={handleRefresh} className="text-moon-400 hover:text-moon-200">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  if (!history) return null;

  const styles = getStatusStyles(history.saturation_status);
  const StatusIcon = styles.icon;

  // Compact mode for sidebar
  if (compact) {
    return (
      <div className={`bg-moon-900/60 border ${styles.border} rounded-lg p-3`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <StatusIcon className={`w-4 h-4 ${styles.text}`} />
            <span className="text-xs font-medium text-moon-200">{styles.label}</span>
          </div>
          <span className="text-xs text-moon-500">
            {history.current_modes} modes / {history.current_threads} threads
          </span>
        </div>

        {/* Mini progress indicator */}
        <div className="h-1.5 bg-moon-800 rounded-full overflow-hidden mb-2">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(history.saturation_score * 100, 100)}%`,
              backgroundColor: styles.chartColor,
            }}
          />
        </div>

        {/* Recommendation */}
        <div className="flex items-start gap-2">
          {getRecommendationIcon(history.recommendation_type)}
          <p className="text-xs text-moon-400 leading-relaxed">{history.recommendation}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-moon-900/60 border ${styles.border} rounded-lg overflow-hidden`}>
      {/* Header - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-moon-800/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`p-1.5 rounded-lg ${styles.bg}`}>
            <StatusIcon className={`w-4 h-4 ${styles.text}`} />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-medium text-moon-100">Saturation Tracking</h3>
            <p className="text-xs text-moon-500">
              {history.current_modes} failure modes from {history.current_threads} reviewed threads
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className={`text-xs px-2 py-1 rounded-full ${styles.bg} ${styles.text}`}>
            {styles.label}
          </span>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-moon-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-moon-500" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-moon-800 pt-4 space-y-4">
          {/* Discovery Chart */}
          {chartData && chartData.points.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-moon-500">Failure Mode Discovery Curve</span>
                <button
                  onClick={handleRefresh}
                  className="text-moon-500 hover:text-moon-300"
                  title="Refresh"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="relative bg-moon-950 rounded-lg p-4 border border-moon-800">
                {/* Y-axis labels */}
                <div className="absolute left-1 top-4 bottom-8 flex flex-col justify-between text-[10px] text-moon-600">
                  <span>{chartData.maxModes}</span>
                  <span>{Math.round(chartData.maxModes / 2)}</span>
                  <span>0</span>
                </div>

                {/* Chart area */}
                <div className="ml-6 mr-2">
                  <svg viewBox="0 0 100 100" className="w-full h-32" preserveAspectRatio="none">
                    {/* Grid lines */}
                    <line
                      x1="0"
                      y1="50"
                      x2="100"
                      y2="50"
                      stroke="#374151"
                      strokeWidth="0.5"
                      strokeDasharray="2,2"
                    />
                    <line
                      x1="0"
                      y1="25"
                      x2="100"
                      y2="25"
                      stroke="#374151"
                      strokeWidth="0.5"
                      strokeDasharray="2,2"
                    />
                    <line
                      x1="0"
                      y1="75"
                      x2="100"
                      y2="75"
                      stroke="#374151"
                      strokeWidth="0.5"
                      strokeDasharray="2,2"
                    />

                    {/* Saturation threshold line */}
                    {history.saturation_status === "saturated" && (
                      <line
                        x1="0"
                        y1={chartData.saturationY}
                        x2="100"
                        y2={chartData.saturationY}
                        stroke="#10b981"
                        strokeWidth="1"
                        strokeDasharray="4,4"
                        opacity="0.5"
                      />
                    )}

                    {/* Area fill under curve */}
                    <path
                      d={`${chartData.pathData} L ${chartData.points[chartData.points.length - 1].x} 100 L 0 100 Z`}
                      fill={styles.chartColor}
                      opacity="0.1"
                    />

                    {/* Discovery curve line */}
                    <path
                      d={chartData.pathData}
                      fill="none"
                      stroke={styles.chartColor}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    {/* Data points */}
                    {chartData.points.map((point, i) => (
                      <circle
                        key={i}
                        cx={point.x}
                        cy={point.y}
                        r="3"
                        fill={styles.chartColor}
                        stroke="#1f2937"
                        strokeWidth="1"
                      />
                    ))}

                    {/* Current point (highlighted) */}
                    <circle
                      cx={chartData.points[chartData.points.length - 1].x}
                      cy={chartData.points[chartData.points.length - 1].y}
                      r="4"
                      fill={styles.chartColor}
                      stroke="white"
                      strokeWidth="2"
                    />
                  </svg>

                  {/* X-axis labels */}
                  <div className="flex justify-between text-[10px] text-moon-600 mt-1">
                    <span>0</span>
                    <span>{Math.round(chartData.maxThreads / 2)}</span>
                    <span>{chartData.maxThreads}</span>
                  </div>
                  <div className="text-center text-[10px] text-moon-500 mt-1">Threads Reviewed</div>
                </div>

                {/* Y-axis label */}
                <div
                  className="absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] text-moon-500"
                  style={{ transformOrigin: "center" }}
                >
                  Modes
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-moon-500">
              <Layers className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No discovery data yet</p>
              <p className="text-xs mt-1">Review some threads to start tracking saturation</p>
            </div>
          )}

          {/* Stats Row */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-moon-800/40 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-moon-100">{history.current_threads}</div>
              <div className="text-[10px] text-moon-500">Threads Reviewed</div>
            </div>
            <div className="bg-moon-800/40 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-moon-100">{history.current_modes}</div>
              <div className="text-[10px] text-moon-500">Failure Modes</div>
            </div>
            <div className="bg-moon-800/40 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-moon-100">{history.threads_since_last_discovery}</div>
              <div className="text-[10px] text-moon-500">Since Last Discovery</div>
            </div>
            <div className="bg-moon-800/40 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-moon-100">{history.recent_discoveries}</div>
              <div className="text-[10px] text-moon-500">Recent (last 20)</div>
            </div>
          </div>

          {/* Recommendation */}
          <div className={`flex items-start gap-3 p-3 rounded-lg ${styles.bg}`}>
            {getRecommendationIcon(history.recommendation_type)}
            <div>
              <span className="text-xs font-medium text-moon-200 block mb-1">Recommendation</span>
              <p className="text-sm text-moon-300 leading-relaxed">{history.recommendation}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

