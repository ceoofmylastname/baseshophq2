import { useLeaderboardTopRecruiters } from "@/hooks/useLeaderboardTopRecruiters";

type Props = { startDate: string; endDate: string; limit?: number };

export function LeaderboardTopRecruiters({ startDate, endDate, limit = 10 }: Props) {
  const { rows, isOwnerView, loading } = useLeaderboardTopRecruiters({ startDate, endDate, limit });
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{isOwnerView ? "Team total" : "Your subtree"}</p>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No new recruits in this window.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Agent</th>
              <th className="px-2 py-2">Position</th>
              <th className="px-2 py-2 text-right">Recruits</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.agent_id} className="border-t">
                <td className="px-2 py-2 text-muted-foreground">{r.rank}</td>
                <td className="px-2 py-2 font-medium">{r.agent_name}</td>
                <td className="px-2 py-2 text-xs text-muted-foreground">
                  {r.position_code ? `${r.position_code} ${r.position_name}` : "—"}
                </td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{r.recruits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
