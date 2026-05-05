import { useLeaderboardTopEarners, type EarnerRow } from "@/hooks/useLeaderboardTopEarners";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

type Props = { startDate: string; endDate: string; carrierId: string | null; limit?: number };

export function LeaderboardTopEarners({ startDate, endDate, carrierId, limit = 10 }: Props) {
  const { rows, isOwnerView, loading } = useLeaderboardTopEarners({ startDate, endDate, carrierId, limit });
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Top Earners</h3>
        <p className="text-xs text-muted-foreground">{isOwnerView ? "Team total" : "Your subtree"}</p>
      </div>
      <div className="mt-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No earners in this window.</p>
        ) : (
          <Table rows={rows} />
        )}
      </div>
    </div>
  );
}

function Table({ rows }: { rows: EarnerRow[] }) {
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
        {rows.map((r) => (
          <tr key={r.agent_id} className="border-t">
            <td className="px-2 py-2 text-muted-foreground">{r.rank}</td>
            <td className="px-2 py-2 font-medium">{r.agent_name}</td>
            <td className="px-2 py-2 text-xs text-muted-foreground">
              {r.position_code ? `${r.position_code} ${r.position_name}` : "—"}
            </td>
            <td className="px-2 py-2 text-right font-semibold tabular-nums">{fmtMoney(r.earned)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
