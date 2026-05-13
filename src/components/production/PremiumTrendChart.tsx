/**
 * Phase 10D + Phase 11.8: Production line graph with 4-mode toggle, modernized.
 *
 * Modes per wiki/production-dashboard-page.md "Production graph":
 *   - Total Premium      → one area, all in-window premium
 *   - Submitted Only     → one area, status='Submitted'
 *   - Active Only        → one area, status IN ('Issued','Issue Paid')
 *   - Per-Agent (top 5)  → top 5 agents by premium, one line each (no fills)
 *
 * Single-series modes use a filled AreaChart with the brand palette (warm
 * gold) and a soft glow on the stroke, matching CommissionTrendChart. The
 * per-agent mode stays as bare Lines with distinct hues because 5 stacked
 * area fills muddy the chart and obscure individual agents.
 */

import { useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import {
  useProductionPremiumTrend, type TrendMode, type SinglePoint, type PerAgentPoint,
} from "@/hooks/useProductionPremiumTrend";
import type { ProductionBasis } from "@/hooks/useProductionMetrics";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const fmtCompactMoney = (v: number | string): string => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "$0";
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `$${n}`;
};

const MODES: { value: TrendMode; label: string }[] = [
  { value: "total",     label: "Total Premium" },
  { value: "submitted", label: "Submitted Only" },
  { value: "active",    label: "Active Only" },
  { value: "per_agent", label: "Per-Agent (Top 5)" },
];

// Brand-locked palette for single-series modes. Warm gold matches the
// app primary token and pairs with the kinetic gradient elsewhere.
const SINGLE_COLOR = "hsl(38 92% 60%)";

// Distinct hues for the per-agent lines — varied enough to be unambiguous
// at a glance, all in the same saturation/lightness band so no single agent
// visually dominates.
const AGENT_COLORS = [
  "hsl(38 92% 60%)",   // gold
  "hsl(150 70% 55%)",  // emerald
  "hsl(199 89% 60%)",  // cyan
  "hsl(280 80% 65%)",  // violet
  "hsl(346 84% 61%)",  // rose
];

/**
 * Custom dark-aware tooltip identical in posture to CommissionTrendChart's:
 * glass surface, brand-locked typography, color-matched accent dots, tabular
 * money values right-aligned for easy column scanning.
 */
function ChartTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg border border-white/10 px-3 py-2 text-xs shadow-2xl backdrop-blur-xl"
      style={{ backgroundColor: "hsl(0 0% 8% / 0.92)" }}
    >
      <p className="mb-1.5 font-semibold tracking-wide text-foreground/90">{String(label ?? "")}</p>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={String(entry.dataKey)} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: String(entry.color ?? "white"),
                boxShadow: `0 0 8px ${String(entry.color ?? "white")}`,
              }}
            />
            <span className="text-muted-foreground">{String(entry.name ?? "")}</span>
            <span className="ml-auto font-semibold tabular-nums text-foreground">
              {fmtMoney(Number(entry.value ?? 0))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

type Props = {
  startDate: string;
  endDate:   string;
  carrierId: string | null;
  basis:     ProductionBasis;
};

export function PremiumTrendChart({ startDate, endDate, carrierId, basis }: Props) {
  const [mode, setMode] = useState<TrendMode>("total");
  const { data, bucket, loading } = useProductionPremiumTrend({ startDate, endDate, carrierId, basis, mode });

  const perAgentChart = useMemo(() => {
    if (data?.mode !== "per_agent") return null;
    const points = data.series as PerAgentPoint[];
    const bucketMap = new Map<string, Record<string, string | number>>();
    const agentIdToName = new Map<string, string>();
    for (const p of points) {
      agentIdToName.set(p.agent_id, p.agent_name);
      const row = bucketMap.get(p.bucket_date) ?? { bucket_date: p.bucket_date };
      row[p.agent_id] = Number(p.amount);
      bucketMap.set(p.bucket_date, row);
    }
    const rows = Array.from(bucketMap.values()).sort((a, b) =>
      String(a.bucket_date).localeCompare(String(b.bucket_date)));
    const agents = Array.from(agentIdToName.entries());
    return { rows, agents };
  }, [data]);

  const singleSeries = data?.mode !== "per_agent"
    ? ((data?.series ?? []) as SinglePoint[]).map((p) => ({ ...p, amount: Number(p.amount) }))
    : null;

  const isEmpty =
    (data?.mode === "per_agent" && (perAgentChart?.rows.length ?? 0) === 0) ||
    (data?.mode !== "per_agent" && (singleSeries?.length ?? 0) === 0);

  const isPerAgent = data?.mode === "per_agent";

  return (
    <div className="rounded-2xl glass p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Production trend</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Premium over time, bucketed by {bucket}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={
                mode === m.value
                  ? "rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground shadow-[0_0_16px_hsl(38_92%_60%/0.4)]"
                  : "rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
              }
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Inline legend (per-agent mode only — single modes are self-evident from the toggle) */}
      {isPerAgent && perAgentChart && perAgentChart.agents.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          {perAgentChart.agents.map(([agentId, agentName], i) => {
            const color = AGENT_COLORS[i % AGENT_COLORS.length];
            return (
              <div key={agentId} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
                />
                <span className="text-muted-foreground">{agentName}</span>
              </div>
            );
          })}
        </div>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      ) : isEmpty ? (
        <p className="mt-4 text-sm text-muted-foreground">No premium in this window.</p>
      ) : (
        <div className="mt-4 h-72 w-full">
          <ResponsiveContainer>
            {isPerAgent ? (
              <LineChart data={perAgentChart?.rows ?? []} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <filter id="production-trend-glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="2" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <CartesianGrid strokeDasharray="3 4" stroke="hsl(0 0% 100% / 0.06)" vertical={false} />
                <XAxis dataKey="bucket_date" stroke="hsl(0 0% 60%)" fontSize={11}
                  tickLine={false} axisLine={false} dy={6} />
                <YAxis stroke="hsl(0 0% 60%)" fontSize={11} tickLine={false} axisLine={false}
                  width={64} tickFormatter={fmtCompactMoney} dx={-4} />
                <Tooltip
                  content={ChartTooltip}
                  cursor={{ stroke: "hsl(0 0% 100% / 0.10)", strokeWidth: 1 }}
                  wrapperStyle={{ outline: "none" }}
                />
                {perAgentChart?.agents.map(([agentId, agentName], i) => {
                  const color = AGENT_COLORS[i % AGENT_COLORS.length];
                  return (
                    <Line
                      key={agentId}
                      type="monotone"
                      dataKey={agentId}
                      name={agentName}
                      stroke={color}
                      strokeWidth={2.25}
                      dot={false}
                      activeDot={{ r: 5, stroke: "hsl(0 0% 4.7%)", strokeWidth: 2, fill: color }}
                      filter="url(#production-trend-glow)"
                      isAnimationActive
                      animationDuration={600}
                    />
                  );
                })}
              </LineChart>
            ) : (
              <AreaChart data={singleSeries ?? []} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="production-trend-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={SINGLE_COLOR} stopOpacity={0.32} />
                    <stop offset="100%" stopColor={SINGLE_COLOR} stopOpacity={0} />
                  </linearGradient>
                  <filter id="production-trend-glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="2.2" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <CartesianGrid strokeDasharray="3 4" stroke="hsl(0 0% 100% / 0.06)" vertical={false} />
                <XAxis dataKey="bucket_date" stroke="hsl(0 0% 60%)" fontSize={11}
                  tickLine={false} axisLine={false} dy={6} />
                <YAxis stroke="hsl(0 0% 60%)" fontSize={11} tickLine={false} axisLine={false}
                  width={64} tickFormatter={fmtCompactMoney} dx={-4} />
                <Tooltip
                  content={ChartTooltip}
                  cursor={{ stroke: "hsl(0 0% 100% / 0.10)", strokeWidth: 1 }}
                  wrapperStyle={{ outline: "none" }}
                />
                <Area
                  type="monotone"
                  dataKey="amount"
                  name={MODES.find((m) => m.value === mode)?.label}
                  stroke={SINGLE_COLOR}
                  strokeWidth={2.25}
                  fill="url(#production-trend-fill)"
                  filter="url(#production-trend-glow)"
                  dot={false}
                  activeDot={{ r: 5, stroke: "hsl(0 0% 4.7%)", strokeWidth: 2, fill: SINGLE_COLOR }}
                  isAnimationActive
                  animationDuration={650}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
