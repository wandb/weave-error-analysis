"use client";

import { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  Legend,
  TooltipProps,
} from "recharts";
import {
  TrendingUp,
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Layers,
  BarChart3,
  Sparkles,
  Target,
} from "lucide-react";
import { fetchBatchSaturation, BatchSaturationResponse, BatchSaturationData } from "../lib/api";

interface BatchSaturationChartsProps {
  onRefresh?: () => void;
  defaultExpanded?: boolean;
  agentId?: string;
}

// Theme colors matching the app
const COLORS = {
  blue: "#3b82f6",
  green: "#10b981",
  purple: "#8b5cf6",
  gray: "#4b5563",
  amber: "#f59e0b",
};

export function BatchSaturationCharts({
  onRefresh,
  defaultExpanded = false,
  agentId,
}: BatchSaturationChartsProps) {
  const [data, setData] = useState<BatchSaturationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await fetchBatchSaturation(agentId);
      setData(result);
    } catch (err) {
      setError("Failed to load batch saturation data");
      console.error("Batch saturation error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [agentId]);

  const handleRefresh = () => {
    fetchData();
    onRefresh?.();
  };

  const getStatusStyles = (status: BatchSaturationResponse["summary"]["saturation_status"]) => {
    switch (status) {
      case "saturated":
        return {
          bg: "bg-emerald-500/20",
          border: "border-emerald-500/40",
          text: "text-emerald-400",
          icon: CheckCircle2,
          label: "Saturated",
        };
      case "stabilizing":
        return {
          bg: "bg-amber-500/20",
          border: "border-amber-500/40",
          text: "text-amber-400",
          icon: Activity,
          label: "Stabilizing",
        };
      default:
        return {
          bg: "bg-blue-500/20",
          border: "border-blue-500/40",
          text: "text-blue-400",
          icon: TrendingUp,
          label: "Discovering",
        };
    }
  };

  if (loading) {
    return (
      <div className="bg-moon-900/60 border border-moon-800 rounded-lg p-4">
        <div className="flex items-center justify-center gap-2 text-moon-500">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading batch data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-moon-900/60 border border-moon-800 rounded-lg p-4">
        <div className="flex items-center justify-center gap-2 text-red-400">
          <span className="text-sm">{error}</span>
          <button onClick={handleRefresh} className="text-moon-400 hover:text-moon-200">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  if (!data || data.batches.length === 0) {
    return (
      <div className="bg-moon-900/60 border border-moon-800 rounded-lg p-6">
        <div className="text-center">
          <Layers className="w-10 h-10 mx-auto mb-3 text-moon-600" />
          <h3 className="text-sm font-medium text-moon-300 mb-1">No Batches Yet</h3>
          <p className="text-xs text-moon-500">Create your first batch to start tracking.</p>
        </div>
      </div>
    );
  }

  const styles = getStatusStyles(data.summary.saturation_status);
  const StatusIcon = styles.icon;

  // Prepare chart data
  const chartData = data.batches.map((b, i) => ({
    name: b.batch_name.length > 12 ? `B${i + 1}` : b.batch_name,
    fullName: b.batch_name,
    reviewed: b.reviewed_sessions,
    unreviewed: b.total_sessions - b.reviewed_sessions,
    total: b.total_sessions,
    newModes: b.new_modes_discovered,
    matchedModes: b.existing_modes_matched,
    cumulative: b.cumulative_modes,
  }));

  // Growth chart needs a starting point
  const growthData = [
    { name: "Start", cumulative: 0 },
    ...chartData.map((d, i) => ({ name: `B${i + 1}`, cumulative: d.cumulative })),
  ];

  return (
    <div className={`bg-moon-900/60 border ${styles.border} rounded-lg overflow-hidden`}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-moon-800/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`p-1.5 rounded-lg ${styles.bg}`}>
            <BarChart3 className={`w-4 h-4 ${styles.text}`} />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-medium text-moon-100">Batch Saturation</h3>
            <p className="text-xs text-moon-500">
              {data.summary.total_modes} modes · {data.summary.total_batches} batches · {data.summary.total_reviewed}/{data.summary.total_sessions} reviewed
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className={`text-xs px-2 py-1 rounded-full ${styles.bg} ${styles.text}`}>
            {styles.label}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); handleRefresh(); }}
            className="text-moon-500 hover:text-moon-300"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {expanded ? <ChevronUp className="w-4 h-4 text-moon-500" /> : <ChevronDown className="w-4 h-4 text-moon-500" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-moon-800 pt-4 space-y-6">
          {/* Summary Stats */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard value={data.summary.total_batches} label="Batches" icon={<Layers className="w-4 h-4" />} />
            <StatCard value={data.summary.total_sessions} label="Sessions" icon={<BarChart3 className="w-4 h-4" />} />
            <StatCard value={data.summary.total_reviewed} label="Reviewed" icon={<CheckCircle2 className="w-4 h-4" />} color="text-blue-400" />
            <StatCard value={data.summary.total_modes} label="Failure Modes" icon={<Target className="w-4 h-4" />} color="text-purple-400" />
          </div>

          {/* Chart 1: Sessions Reviewed per Batch */}
          <ChartSection title="Sessions Reviewed per Batch">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                <Tooltip content={<CustomTooltip type="sessions" />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
                <Bar dataKey="reviewed" stackId="a" fill={COLORS.blue} radius={[0, 0, 0, 0]} name="Reviewed" />
                <Bar dataKey="unreviewed" stackId="a" fill={COLORS.gray} radius={[4, 4, 0, 0]} name="Unreviewed" />
              </BarChart>
            </ResponsiveContainer>
          </ChartSection>

          {/* Chart 2: Failure Mode Discovery by Batch */}
          <ChartSection 
            title="Failure Mode Discovery by Batch"
            badge={data.summary.saturation_status === "saturated" ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Saturating
              </span>
            ) : undefined}
          >
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                <Tooltip content={<CustomTooltip type="discovery" />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
                <Bar dataKey="matchedModes" stackId="a" fill={COLORS.green} radius={[0, 0, 0, 0]} name="Matched" />
                <Bar dataKey="newModes" stackId="a" fill={COLORS.purple} radius={[4, 4, 0, 0]} name="New" />
              </BarChart>
            </ResponsiveContainer>
          </ChartSection>

          {/* Chart 3: Taxonomy Growth */}
          <ChartSection 
            title="Taxonomy Growth"
            badge={data.summary.saturation_status === "saturated" ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Plateau reached
              </span>
            ) : undefined}
          >
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={growthData}>
                <defs>
                  <linearGradient id="purpleGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.purple} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.purple} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                <Tooltip content={<CustomTooltip type="growth" />} cursor={{ stroke: COLORS.purple, strokeDasharray: "3 3" }} />
                <Area 
                  type="monotone" 
                  dataKey="cumulative" 
                  stroke={COLORS.purple} 
                  strokeWidth={2}
                  fill="url(#purpleGradient)" 
                  dot={{ fill: COLORS.purple, strokeWidth: 0, r: 3 }}
                  activeDot={{ fill: COLORS.purple, stroke: "#fff", strokeWidth: 2, r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartSection>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function StatCard({ value, label, icon, color = "text-moon-100" }: { 
  value: number; label: string; icon: React.ReactNode; color?: string;
}) {
  return (
    <div className="bg-moon-800/40 rounded-lg p-3 text-center">
      <div className={`flex items-center justify-center gap-2 ${color}`}>
        {icon}
        <span className="text-xl font-bold">{value}</span>
      </div>
      <div className="text-[10px] text-moon-500 mt-1">{label}</div>
    </div>
  );
}

function ChartSection({ title, children, badge }: { 
  title: string; children: React.ReactNode; badge?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-medium text-moon-300">{title}</span>
        {badge}
      </div>
      <div className="bg-moon-950/50 rounded-lg p-3 border border-moon-800">
        {children}
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload, type }: TooltipProps<number, string> & { type: "sessions" | "discovery" | "growth" }) {
  if (!active || !payload?.length) return null;

  const data = payload[0]?.payload;
  
  return (
    <div className="bg-moon-800 border border-moon-700 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs font-medium text-moon-100 mb-1">{data?.fullName || data?.name}</p>
      {type === "sessions" && (
        <div className="text-xs space-y-0.5">
          <p><span className="text-blue-400">Reviewed:</span> <span className="text-moon-200">{data?.reviewed}</span></p>
          <p><span className="text-moon-500">Total:</span> <span className="text-moon-200">{data?.total}</span></p>
        </div>
      )}
      {type === "discovery" && (
        <div className="text-xs space-y-0.5">
          <p><span className="text-purple-400">New:</span> <span className="text-moon-200">{data?.newModes}</span></p>
          <p><span className="text-green-400">Matched:</span> <span className="text-moon-200">{data?.matchedModes}</span></p>
        </div>
      )}
      {type === "growth" && (
        <p className="text-xs"><span className="text-purple-400">Total Modes:</span> <span className="text-moon-200">{data?.cumulative}</span></p>
      )}
    </div>
  );
}
