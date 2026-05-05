/**
 * Phase 10D: Production line graph with 4-mode toggle.
 *
 * Modes per wiki/production-dashboard-page.md "Production graph":
 *   - Total Premium      → one line, all in-window premium
 *   - Submitted Only     → one line, status='Submitted'
 *   - Active Only        → one line, status IN ('Issued','Issue Paid')
 *   - Per-Agent (top 5)  → top 5 agents by premium, one line each
 */

import { useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import {
  useProductionPremiumTrend, type TrendMode, type SinglePoint, type PerAgentPoint,
} from "@/hooks/useProductionPremiumTrend";
import type { ProductionBasis } from "@/hooks/useProductionMetrics";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const MODES: { value: TrendMode; label: string }[] = [
  { value: "total",     label: "Total Premium" },
  { value: "submitted", label: "Submitted Only" },
  { value: "active",    label: "Active Only" },
  { value: "per_agent", label: "Per-Agent (Top 5)" },
];

// Distinct hues for the per-agent lines.
const AGENT_COLORS = [
  "hsl(217 91% 60%)", "hsl(142 71% 45%)", "hsl(346 84% 61%)",
  "hsl(45 93% 50%)",  "hsl(280 67% 60%)",
];

type Props = {
  startDate: string;
  endDate:   string;
  carrierId: string | null;
  basis:     ProductionBasis;
};

export function PremiumTrendChart({ startDate, endDate, carrierId, basis }: Props) {
  const [mode, setMode] = useState<TrendMode>("total");
  const { data, bucket, loading } = useProductionPremiumTrend({ startDate, endDate, carrierId, basis, mode });

  // For per_agent: pivot the long-form series into one row per bucket_date with
  // a column per agent_id. Recharts Line wants this shape.
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

  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Production trend</h3>
          <p className="mt-1 text-xs text-muted-foreground">Premium over time, bucketed by {bucket}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={
                mode === m.value
                  ? "rounded-full bg-primary px-3 py-1 text-primary-foreground"
                  : "rounded-full border px-3 py-1 text-muted-foreground hover:text-foreground"
              }
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : isEmpty ? (
        <p className="mt-3 text-sm text-muted-foreground">No premium in this window.</p>
      ) : (
        <div className="mt-3 h-72 w-full">
          <ResponsiveContainer>
            <LineChart data={data?.mode === "per_agent" ? perAgentChart?.rows : singleSeries ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
              <XAxis dataKey="bucket_date" stroke="currentColor" fontSize={11} />
              <YAxis stroke="currentColor" fontSize={11} tickFormatter={(v) => fmtMoney(Number(v))} width={70} />
              <Tooltip
                formatter={(value, name) => [fmtMoney(Number(value ?? 0)), String(name)]}
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {data?.mode === "per_agent"
                ? perAgentChart?.agents.map(([agentId, agentName], i) => (
                    <Line key={agentId} type="monotone" dataKey={agentId} name={agentName}
                      stroke={AGENT_COLORS[i % AGENT_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
                  ))
                : <Line type="monotone" dataKey="amount" name={MODES.find((m) => m.value === mode)?.label}
                    stroke="hsl(217 91% 60%)" strokeWidth={2} dot={{ r: 3 }} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
