import { useLeaderboardTopProducers } from "@/hooks/useLeaderboardTopProducers";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

type Props = {
  startDate: string; endDate: string; carrierId: string | null;
  onSeeMore?: () => void;
};

export function TopProducersMini({ startDate, endDate, carrierId, onSeeMore }: Props) {
  const { rows, isOwnerView, loading } = useLeaderboardTopProducers({
    startDate, endDate, carrierId, limit: 5,
  });
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Top producers</h3>
        {onSeeMore && (
          <button onClick={onSeeMore} className="text-xs text-primary hover:underline">
            See all →
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{isOwnerView ? "Team total" : "Your subtree"}</p>
      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No producers in this window.</p>
      ) : (
        <ul className="mt-2 divide-y">
          {rows.map((r) => (
            <li key={r.agent_id} className="flex items-center justify-between py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">{r.rank}.</span>
                <span className="font-medium">{r.agent_name}</span>
              </div>
              <span className="font-semibold tabular-nums">{fmtMoney(r.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
