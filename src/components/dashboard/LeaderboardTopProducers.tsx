import { useLeaderboardTopProducers, type ProducerRow } from "@/hooks/useLeaderboardTopProducers";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

type Props = { startDate: string; endDate: string; carrierId: string | null; limit?: number };

export function LeaderboardTopProducers({ startDate, endDate, carrierId, limit = 10 }: Props) {
  const { rows, isOwnerView, loading } = useLeaderboardTopProducers({ startDate, endDate, carrierId, limit });
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{isOwnerView ? "Team total" : "Your subtree"}</p>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No producers in this window.</p>
      ) : (
        <Table rows={rows} />
      )}
    </div>
  );
}

function Table({ rows }: { rows: ProducerRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="px-2 py-2">#</th>
          <th className="px-2 py-2">Agent</th>
          <th className="px-2 py-2">Position</th>
          <th className="px-2 py-2 text-right">Booked</th>
          <th className="px-2 py-2 text-right">Realized</th>
          <th className="px-2 py-2 text-right">Total</th>
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
            <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(r.booked)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(r.realized)}</td>
            <td className="px-2 py-2 text-right font-semibold tabular-nums">{fmtMoney(r.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
