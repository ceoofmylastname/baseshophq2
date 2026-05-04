import { useMemo } from "react";
import type { CommitResult } from "@/hooks/useIngestCommit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Props = {
  results: CommitResult[];
  onStartOver: () => void;
};

export function IngestSummaryStep({ results, onStartOver }: Props) {
  const summary = useMemo(() => {
    const s = {
      total: results.length,
      inserted: 0,
      orphan: 0,
      unmatched: 0,
      product_ambiguous: 0,
      status_unknown: 0,
      errored: 0,
    };
    for (const r of results) {
      if (r.error_code) { s.errored++; continue; }
      if (r.policy_id) s.inserted++;
      if (r.flags.includes("orphan")) s.orphan++;
      if (r.flags.includes("unmatched")) s.unmatched++;
      if (r.flags.includes("product_ambiguous")) s.product_ambiguous++;
      if (r.flags.includes("status_unknown")) s.status_unknown++;
    }
    return s;
  }, [results]);

  const flaggedRows = results.filter((r) => r.flags.length > 0 || r.error_code);

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-6">
        <h2 className="text-lg font-semibold mb-3">Ingest complete</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Inserted" value={summary.inserted} variant="success" />
          <Stat label="Orphan" value={summary.orphan} variant={summary.orphan ? "warning" : "muted"} />
          <Stat label="Unmatched" value={summary.unmatched} variant={summary.unmatched ? "warning" : "muted"} />
          <Stat label="Product ambiguous" value={summary.product_ambiguous} variant={summary.product_ambiguous ? "warning" : "muted"} />
          <Stat label="Status unknown" value={summary.status_unknown} variant={summary.status_unknown ? "warning" : "muted"} />
          <Stat label="Errored" value={summary.errored} variant={summary.errored ? "warning" : "muted"} />
          <Stat label="Total processed" value={summary.total} variant="muted" />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Orphan rows were inserted with no agent_id. They will auto-link when you add the matching
          writing_number on the agent's contracts page.
        </p>
      </div>

      {flaggedRows.length > 0 && (
        <div className="rounded-md border p-4">
          <h3 className="mb-2 text-sm font-medium">Rows needing follow-up</h3>
          <table className="w-full text-xs">
            <thead className="text-left uppercase text-muted-foreground">
              <tr>
                <th className="pb-2">#</th>
                <th className="pb-2">Policy ID</th>
                <th className="pb-2">Flags / error</th>
              </tr>
            </thead>
            <tbody>
              {flaggedRows.map((r) => (
                <tr key={r.row_index} className="border-t">
                  <td className="py-1.5 text-muted-foreground">{r.row_index + 1}</td>
                  <td className="py-1.5 font-mono text-muted-foreground">
                    {r.policy_id ? r.policy_id.slice(0, 8) : "—"}
                  </td>
                  <td className="py-1.5 space-x-1">
                    {r.flags.map((f) => <Badge key={f} variant="warning">{f}</Badge>)}
                    {r.error_code && (
                      <Badge variant="destructive">{r.error_code}: {r.error_message}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={onStartOver}>Upload another file</Button>
      </div>
    </div>
  );
}

function Stat({
  label, value, variant,
}: { label: string; value: number; variant: "success" | "warning" | "muted" }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">
        <Badge variant={variant}>{value}</Badge>
      </p>
    </div>
  );
}
