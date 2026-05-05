import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useScoreboardMostImproved } from "@/hooks/useScoreboardMostImproved";
import { Badge } from "@/components/ui/badge";
import { Lock } from "lucide-react";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

type Props = {
  startDate: string; endDate: string; carrierId: string | null;
  visibleAgentIds: Set<string>;
};

export function ScoreboardMostImproved({ startDate, endDate, carrierId, visibleAgentIds }: Props) {
  const { isOwner } = useAuth();
  const navigate = useNavigate();
  const { rows, priorWindow, loading } = useScoreboardMostImproved({ startDate, endDate, carrierId });

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No agents grew their booked premium in this window.</p>;

  return (
    <>
      {priorWindow && (
        <p className="mb-2 text-xs text-muted-foreground">
          Compared to {priorWindow.start} → {priorWindow.end}
        </p>
      )}
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
          {rows.map((r) => {
            const canDrill = isOwner || visibleAgentIds.has(r.agent_id);
            return (
              <tr
                key={r.agent_id}
                className={canDrill ? "cursor-pointer border-t hover:bg-muted/40" : "border-t"}
                onClick={canDrill ? () => navigate(`/agents/${r.agent_id}`) : undefined}
                title={canDrill ? "" : "Profile available to upline only."}
              >
                <td className="px-2 py-2 text-muted-foreground">{r.rank}</td>
                <td className="px-2 py-2 font-medium">
                  <span className="inline-flex items-center gap-1">
                    {r.agent_name}
                    {!canDrill && <Lock className="h-3 w-3 text-muted-foreground" />}
                  </span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{fmtMoney(r.prev_booked)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(r.curr_booked)}</td>
                <td className="px-2 py-2 text-right">
                  {r.pct_growth === null
                    ? <Badge variant="success">new</Badge>
                    : <span className="font-semibold tabular-nums text-emerald-700">+{r.pct_growth.toFixed(1)}%</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
