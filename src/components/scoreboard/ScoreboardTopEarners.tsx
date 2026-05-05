import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useScoreboardTopEarners } from "@/hooks/useScoreboardTopEarners";
import { Lock } from "lucide-react";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

type Props = {
  startDate: string; endDate: string; carrierId: string | null;
  visibleAgentIds: Set<string>;
};

export function ScoreboardTopEarners({ startDate, endDate, carrierId, visibleAgentIds }: Props) {
  const { isOwner } = useAuth();
  const navigate = useNavigate();
  const { rows, loading } = useScoreboardTopEarners({ startDate, endDate, carrierId });

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No earners in this window.</p>;

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="px-2 py-2">#</th>
          <th className="px-2 py-2">Agent</th>
          <th className="px-2 py-2">Position</th>
          <th className="px-2 py-2 text-right">Earned</th>
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
              <td className="px-2 py-2 text-xs text-muted-foreground">
                {r.position_code ? `${r.position_code} ${r.position_name}` : "—"}
              </td>
              <td className="px-2 py-2 text-right font-semibold tabular-nums">{fmtMoney(r.earned)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
