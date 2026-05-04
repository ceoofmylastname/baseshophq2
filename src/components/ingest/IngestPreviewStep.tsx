import { useEffect, useMemo, useState } from "react";
import type { ParsedCsv } from "@/lib/ingest-csv-parser";
import { canonicalizeRow, type ColumnMap, type StatusMap } from "@/lib/ingest-row-canonicalize";
import { useIngestPreview, type PreviewResult, type PreviewRow } from "@/hooks/useIngestPreview";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DupAction } from "@/pages/Ingest";

type Props = {
  csv: ParsedCsv;
  columnMap: ColumnMap;
  statusMap: StatusMap;
  dupAction: DupAction;
  onDupActionChange: (a: DupAction) => void;
  onPreviewLoaded: (rows: PreviewRow[], results: PreviewResult[]) => void;
  onBack: () => void;
  onNext: () => void;
};

export function IngestPreviewStep({
  csv,
  columnMap,
  statusMap,
  dupAction,
  onDupActionChange,
  onPreviewLoaded,
  onBack,
  onNext,
}: Props) {
  const { preview, submitting } = useIngestPreview();
  const [results, setResults] = useState<PreviewResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const rows: PreviewRow[] = useMemo(
    () =>
      csv.rows.map((raw, i) => {
        const { payload } = canonicalizeRow(raw, columnMap, statusMap);
        return { row_index: i, payload };
      }),
    [csv.rows, columnMap, statusMap],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await preview(rows);
      if (cancelled) return;
      if (!r.ok) {
        setError(r.errorMessage);
        return;
      }
      setResults(r.results);
      onPreviewLoaded(rows, r.results);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const c = { orphan: 0, unmatched: 0, product_ambiguous: 0, status_unknown: 0, dups: 0, clean: 0 };
    for (const r of results) {
      let dirty = false;
      if (r.flags.includes("orphan")) { c.orphan++; dirty = true; }
      if (r.flags.includes("unmatched")) { c.unmatched++; dirty = true; }
      if (r.flags.includes("product_ambiguous")) { c.product_ambiguous++; dirty = true; }
      if (r.flags.includes("status_unknown")) { c.status_unknown++; dirty = true; }
      if (r.existing_policy_number) { c.dups++; dirty = true; }
      if (!dirty) c.clean++;
    }
    return c;
  }, [results]);

  if (submitting) {
    return <div className="rounded-md border p-6 text-sm text-muted-foreground">Running dry-run preview…</div>;
  }
  if (error) {
    return (
      <div className="space-y-3 rounded-md border p-6">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={onBack}>Back</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-md border p-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Clean" value={counts.clean} variant="success" />
        <Stat label="Orphan" value={counts.orphan} variant={counts.orphan ? "warning" : "muted"} />
        <Stat label="Unmatched" value={counts.unmatched} variant={counts.unmatched ? "warning" : "muted"} />
        <Stat label="Product ambiguous" value={counts.product_ambiguous} variant={counts.product_ambiguous ? "warning" : "muted"} />
        <Stat label="Status unknown" value={counts.status_unknown} variant={counts.status_unknown ? "warning" : "muted"} />
        <Stat label="Existing policy #" value={counts.dups} variant={counts.dups ? "warning" : "muted"} />
      </div>

      {counts.dups > 0 && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <p className="mb-2">
            <span className="font-medium">{counts.dups}</span> of these policy numbers already exist in your tenant.
          </p>
          <fieldset className="space-y-1">
            <Radio
              name="dup"
              value="skip_duplicates"
              checked={dupAction === "skip_duplicates"}
              onChange={onDupActionChange}
              label="Skip duplicates and ingest only new rows"
            />
            <Radio
              name="dup"
              value="create_duplicates"
              checked={dupAction === "create_duplicates"}
              onChange={onDupActionChange}
              label="Proceed and create duplicates"
            />
            <Radio
              name="dup"
              value="cancel"
              checked={dupAction === "cancel"}
              onChange={onDupActionChange}
              label="Cancel and review"
            />
          </fieldset>
        </div>
      )}

      <details className="rounded-md border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          Per-row preview ({results.length} rows)
        </summary>
        <table className="w-full text-xs">
          <thead className="text-left uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Policy #</th>
              <th className="px-3 py-2">Carrier</th>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Agent ID</th>
              <th className="px-3 py-2">Flags</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const row = rows.find((x) => x.row_index === r.row_index);
              return (
                <tr key={r.row_index} className="border-t">
                  <td className="px-3 py-1.5 text-muted-foreground">{r.row_index + 1}</td>
                  <td className="px-3 py-1.5 font-mono">{row?.payload.policy_number || "—"}</td>
                  <td className="px-3 py-1.5">{row?.payload.carrier || "—"}</td>
                  <td className="px-3 py-1.5">{row?.payload.product || "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">{r.agent_id ? r.agent_id.slice(0, 8) : "—"}</td>
                  <td className="px-3 py-1.5 space-x-1">
                    {r.flags.map((f) => <Badge key={f} variant="warning">{f}</Badge>)}
                    {r.existing_policy_number && <Badge variant="warning">existing</Badge>}
                    {r.flags.length === 0 && !r.existing_policy_number && <Badge variant="success">ok</Badge>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button onClick={onNext} disabled={dupAction === "cancel"}>Next: resolve overrides</Button>
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

function Radio({
  name, value, checked, onChange, label,
}: {
  name: string;
  value: DupAction;
  checked: boolean;
  onChange: (v: DupAction) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} />
      {label}
    </label>
  );
}
