import type { CommissionSplitRow } from "@/hooks/usePolicyDetail";
import { Badge } from "@/components/ui/badge";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);

type Props = { rows: CommissionSplitRow[] };

export function PolicyCommissionSplit({ rows }: Props) {
  return (
    <div className="rounded-md border p-4">
      <h2 className="text-sm font-semibold">Commission split</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No commission rows yet. The Phase 4a engine will populate this once the policy reaches Issued or Issue Paid.
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-2">Agent</th>
                <th className="px-2 py-2">Position</th>
                <th className="px-2 py-2 text-right">Rate</th>
                <th className="px-2 py-2">Schedule</th>
                <th className="px-2 py-2 text-right">Amount</th>
                <th className="px-2 py-2">Type</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-2 py-2 font-medium">{r.agent_name}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">
                    {r.position_code ? `${r.position_code} ${r.position_name}` : "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.rate}%</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{r.schedule_code ?? "—"}</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">{fmtMoney(r.amount)}</td>
                  <td className="px-2 py-2">
                    {r.is_override
                      ? <Badge variant="warning">Override</Badge>
                      : <Badge variant="muted">Writing</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
