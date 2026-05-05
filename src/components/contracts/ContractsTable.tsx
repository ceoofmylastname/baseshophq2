/**
 * Phase 10E: Contracts table per wiki/contracts-page.md.
 * Carrier · Agent · LOA · Status · Start Date · Agent # · Referral Code.
 */

import { Link } from "react-router-dom";
import type { ContractRow, ContractStatus } from "@/hooks/useContracts";
import { LOACell } from "./LOACell";

const STATUS_STYLES: Record<ContractStatus, string> = {
  Active:     "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  Pending:    "bg-amber-100   text-amber-800   dark:bg-amber-900/40   dark:text-amber-200",
  Terminated: "bg-zinc-100    text-zinc-700    dark:bg-zinc-800/60    dark:text-zinc-300",
};

type Props = {
  rows: ContractRow[];
  loading: boolean;
  onRowClick: (row: ContractRow) => void;
};

export function ContractsTable({ rows, loading, onRowClick }: Props) {
  return (
    <div className="rounded-md border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Carrier</th>
              <th className="px-4 py-2 text-left">Agent</th>
              <th className="px-4 py-2 text-left">LOA</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Start Date</th>
              <th className="px-4 py-2 text-left">Agent #</th>
              <th className="px-4 py-2 text-left">Referral Code</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                No contracts match these filters.
              </td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="cursor-pointer border-t hover:bg-accent/30" onClick={() => onRowClick(r)}>
                <td className="px-4 py-2">{r.carrier_name}</td>
                <td className="px-4 py-2">
                  <Link
                    to={`/agents/${r.agent_id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="font-medium hover:underline"
                  >
                    {r.agent_name}
                  </Link>
                  <div className="text-xs text-muted-foreground">{r.agent_email}</div>
                </td>
                <td className="px-4 py-2"><LOACell contract={r} /></td>
                <td className="px-4 py-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status]}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs">{r.effective_date ?? "—"}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.writing_number}</td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                  {r.referral_code || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
