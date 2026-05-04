import { useLeaderboardMostImproved } from "@/hooks/useLeaderboardMostImproved";
import { Badge } from "@/components/ui/badge";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

type Props = { startDate: string; endDate: string; carrierId: string | null; limit?: number };

export function LeaderboardMostImproved({ startDate, endDate, carrierId, limit = 10 }: Props) {
  const { rows, isOwnerView, priorWindow, loading } = useLeaderboardMostImproved({
    startDate, endDate, carrierId, limit,
  });
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {isOwnerView ? "Team total" : "Your subtree"}
        {priorWindow && (
          <span> · vs prior period {priorWindow.start} → {priorWindow.end}</span>
        )}
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No agents grew their booked premium in this window vs the prior one.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Agent</th>
              <th className="px-2 py-2 text-right">Prior</th>
              <th className="px-2 py-2 text-right">Current</th>
              <th className="px-2 py-2 text-right">Growth</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.agent_id} className="border-t">
                <td className="px-2 py-2 text-muted-foreground">{r.rank}</td>
                <td className="px-2 py-2 font-medium">{r.agent_name}</td>
                <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{fmtMoney(r.prev_booked)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(r.curr_booked)}</td>
                <td className="px-2 py-2 text-right">
                  {r.pct_growth === null
                    ? <Badge variant="success">new</Badge>
                    : <span className="font-semibold tabular-nums text-emerald-700">+{r.pct_growth.toFixed(1)}%</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
