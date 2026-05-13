import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import { useCommissionTrend } from "@/hooks/useCommissionTrend";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/**
 * Custom dark-aware tooltip. The Recharts default tooltip leaks bright-white
 * backgrounds in dark mode because it ignores our glass tokens. This one
 * renders a glass surface, brand-locked text, and an accent dot per series.
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
            <span className="capitalize text-muted-foreground">{String(entry.name ?? "")}</span>
            <span className="ml-auto font-semibold tabular-nums text-foreground">
              {fmtMoney(Number(entry.value ?? 0))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Custom legend rendered above the chart in our own typography. Keeping it
 * outside Recharts gives us full control over spacing + accent dots.
 */
function ChartLegend() {
  return (
    <div className="mt-3 flex items-center gap-4 text-xs">
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: "hsl(38 92% 60%)", boxShadow: "0 0 8px hsl(38 92% 60% / 0.8)" }}
        />
        <span className="text-muted-foreground">Booked</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: "hsl(150 70% 55%)", boxShadow: "0 0 8px hsl(150 70% 55% / 0.8)" }}
        />
        <span className="text-muted-foreground">Realized</span>
      </div>
    </div>
  );
}

type Props = { startDate: string; endDate: string; carrierId: string | null };

export function CommissionTrendChart({ startDate, endDate, carrierId }: Props) {
  const { series, loading } = useCommissionTrend({ startDate, endDate, carrierId });

  // Brand-locked palette: gold for "booked" (aspirational pipeline), emerald
  // for "realized" (collected, in the bank). Matches the hero card's
  // unmet/met progress bar semantics.
  const BOOKED   = "hsl(38 92% 60%)";
  const REALIZED = "hsl(150 70% 55%)";

  return (
    <div className="rounded-2xl glass p-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Commission trend</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Booked vs realized commission, monthly.</p>
        </div>
        <ChartLegend />
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      ) : series.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No commissions in this window.</p>
      ) : (
        <div className="mt-4 h-64 w-full">
          <ResponsiveContainer>
            <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="commission-trend-booked" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={BOOKED}   stopOpacity={0.32} />
                  <stop offset="100%" stopColor={BOOKED}   stopOpacity={0} />
                </linearGradient>
                <linearGradient id="commission-trend-realized" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={REALIZED} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={REALIZED} stopOpacity={0} />
                </linearGradient>
                <filter id="commission-trend-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2.2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              <CartesianGrid
                strokeDasharray="3 4"
                stroke="hsl(0 0% 100% / 0.06)"
                vertical={false}
              />
              <XAxis
                dataKey="month"
                stroke="hsl(0 0% 60%)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                dy={6}
              />
              <YAxis
                stroke="hsl(0 0% 60%)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={(v) => {
                  const n = Number(v);
                  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
                  return `$${n}`;
                }}
                dx={-4}
              />
              <Tooltip
                content={ChartTooltip}
                cursor={{ stroke: "hsl(0 0% 100% / 0.10)", strokeWidth: 1 }}
                wrapperStyle={{ outline: "none" }}
              />

              <Area
                type="monotone"
                dataKey="booked"
                name="Booked"
                stroke={BOOKED}
                strokeWidth={2.25}
                fill="url(#commission-trend-booked)"
                filter="url(#commission-trend-glow)"
                dot={false}
                activeDot={{ r: 5, stroke: "hsl(0 0% 4.7%)", strokeWidth: 2, fill: BOOKED }}
                isAnimationActive
                animationDuration={650}
              />
              <Area
                type="monotone"
                dataKey="realized"
                name="Realized"
                stroke={REALIZED}
                strokeWidth={2.25}
                fill="url(#commission-trend-realized)"
                filter="url(#commission-trend-glow)"
                dot={false}
                activeDot={{ r: 5, stroke: "hsl(0 0% 4.7%)", strokeWidth: 2, fill: REALIZED }}
                isAnimationActive
                animationDuration={650}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
