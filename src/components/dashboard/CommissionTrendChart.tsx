import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { useCommissionTrend } from "@/hooks/useCommissionTrend";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

type Props = { startDate: string; endDate: string; carrierId: string | null };

export function CommissionTrendChart({ startDate, endDate, carrierId }: Props) {
  const { series, loading } = useCommissionTrend({ startDate, endDate, carrierId });
  return (
    <div className="rounded-md border bg-card p-4">
      <h3 className="text-sm font-semibold">Commission trend</h3>
      <p className="mt-1 text-xs text-muted-foreground">Booked vs realized commission, monthly.</p>
      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : series.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No commissions in this window.</p>
      ) : (
        <div className="mt-3 h-64 w-full">
          <ResponsiveContainer>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
              <XAxis dataKey="month" stroke="currentColor" fontSize={11} />
              <YAxis stroke="currentColor" fontSize={11} tickFormatter={(v) => fmtMoney(Number(v))} width={70} />
              <Tooltip
                formatter={(value, name) => [fmtMoney(Number(value ?? 0)), String(name)]}
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="booked" name="Booked" stroke="hsl(217 91% 60%)" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="realized" name="Realized" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
