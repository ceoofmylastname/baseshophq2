/**
 * Phase 10D: Agent Totals table.
 *
 * Every agent in the caller's view-down scope, with Individual / Team / Total
 * Annual Premium. Top of table is the de-facto Top Producers leaderboard;
 * full table covers wiki/production-dashboard-page.md "Agent Totals table".
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { useProductionAgentTotals } from "@/hooks/useProductionAgentTotals";
import type { ProductionBasis } from "@/hooks/useProductionMetrics";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

type Props = {
  startDate: string;
  endDate:   string;
  carrierId: string | null;
  basis:     ProductionBasis;
};

const PAGE_SIZE = 25;

export function AgentTotalsTable({ startDate, endDate, carrierId, basis }: Props) {
  const [offset, setOffset] = useState(0);
  const { rows, total, loading } = useProductionAgentTotals({
    startDate, endDate, carrierId, basis, limit: PAGE_SIZE, offset,
  });

  const lastPageOffset = Math.max(0, Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE);

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Agent Totals</h3>
          <p className="text-xs text-muted-foreground">
            Every agent in your scope. Click a name for the full profile.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">{total} agents</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Rank</th>
              <th className="px-4 py-2 text-left">Agent</th>
              <th className="px-4 py-2 text-left">Position</th>
              <th className="px-4 py-2 text-right">Individual AP</th>
              <th className="px-4 py-2 text-right">Team AP</th>
              <th className="px-4 py-2 text-right">Total AP</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No agents in scope for this window.</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.agent_id} className="border-t">
                  <td className="px-4 py-2 tabular-nums text-muted-foreground">{offset + i + 1}</td>
                  <td className="px-4 py-2">
                    <Link to={`/agents/${r.agent_id}`} className="font-medium hover:underline">
                      {r.agent_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{r.email}</div>
                    <Link
                      to={`/book-of-business?agent=${r.agent_id}`}
                      className="text-[11px] text-primary hover:underline"
                    >
                      View book →
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {r.position_code ? `${r.position_code} — ${r.position_name ?? ""}` : "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(r.individual_ap)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(r.team_ap)}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{fmtMoney(r.total_ap)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t px-4 py-2 text-xs">
          <span className="text-muted-foreground">
            Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-1">
            <button onClick={() => setOffset(0)}                                  disabled={offset === 0}             className="rounded border px-2 py-1 disabled:opacity-40">First</button>
            <button onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}    disabled={offset === 0}             className="rounded border px-2 py-1 disabled:opacity-40">Prev</button>
            <button onClick={() => setOffset(Math.min(lastPageOffset, offset + PAGE_SIZE))} disabled={offset >= lastPageOffset} className="rounded border px-2 py-1 disabled:opacity-40">Next</button>
            <button onClick={() => setOffset(lastPageOffset)}                     disabled={offset >= lastPageOffset} className="rounded border px-2 py-1 disabled:opacity-40">Last</button>
          </div>
        </div>
      )}
    </div>
  );
}
