import { useMemo } from "react";
import type { ParsedCsv } from "@/lib/ingest-csv-parser";
import {
  type ColumnMap,
  type StatusMap,
  POLICY_STATUS_VALUES,
  statusKey,
} from "@/lib/ingest-row-canonicalize";
import { canonicalizeCarrierName } from "@/lib/comp-grid-product-canonicalization";
import { Button } from "@/components/ui/button";

type Props = {
  csv: ParsedCsv;
  columnMap: ColumnMap;
  statusMap: StatusMap;
  onChange: (map: StatusMap) => void;
  onBack: () => void;
  onNext: () => void;
};

const ALREADY_VALID = new Set<string>(POLICY_STATUS_VALUES.map((s) => s.toLowerCase()));

export function IngestStatusMapStep({ csv, columnMap, statusMap, onChange, onBack, onNext }: Props) {
  const carrierHeader = Object.entries(columnMap).find(([, f]) => f === "carrier")?.[0];
  const statusHeader = Object.entries(columnMap).find(([, f]) => f === "status")?.[0];

  // Distinct (carrier, status_string) pairs that don't already match a valid enum value
  const pairs = useMemo(() => {
    if (!statusHeader) return [] as { carrier: string; raw: string; key: string }[];
    const seen = new Set<string>();
    const out: { carrier: string; raw: string; key: string }[] = [];
    for (const row of csv.rows) {
      const carrier = canonicalizeCarrierName(carrierHeader ? row[carrierHeader] ?? "" : "");
      const raw = (row[statusHeader] ?? "").trim();
      if (!raw) continue;
      if (ALREADY_VALID.has(raw.toLowerCase())) continue;
      const k = statusKey(carrier, raw);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ carrier, raw, key: k });
    }
    return out;
  }, [csv.rows, carrierHeader, statusHeader]);

  if (!statusHeader) {
    return (
      <div className="space-y-3 rounded-md border p-6">
        <p className="text-sm text-muted-foreground">
          No column was mapped to <span className="font-mono">status</span>. Skipping status mapping.
        </p>
        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}>Back</Button>
          <Button onClick={onNext}>Next: preview</Button>
        </div>
      </div>
    );
  }

  if (pairs.length === 0) {
    return (
      <div className="space-y-3 rounded-md border p-6">
        <p className="text-sm text-muted-foreground">
          All status values in the file are already valid policy statuses. No mapping needed.
        </p>
        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}>Back</Button>
          <Button onClick={onNext}>Next: preview</Button>
        </div>
      </div>
    );
  }

  function setMapped(key: string, value: string) {
    onChange({ ...statusMap, [key]: value });
  }

  const allMapped = pairs.every((p) => statusMap[p.key]);

  return (
    <div className="space-y-4 rounded-md border p-6">
      <p className="text-sm text-muted-foreground">
        Map carrier-specific status vocabulary to one of the canonical 7 policy statuses.
        Unmapped values will fall back to <span className="font-mono">Submitted</span> with a
        <span className="font-mono"> status_unknown</span> flag.
      </p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="pb-2">Carrier</th>
            <th className="pb-2">Carrier status</th>
            <th className="pb-2">Maps to</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((p) => (
            <tr key={p.key} className="border-t">
              <td className="py-2">{p.carrier || <span className="text-muted-foreground">—</span>}</td>
              <td className="py-2 font-mono">{p.raw}</td>
              <td className="py-2">
                <select
                  value={statusMap[p.key] ?? ""}
                  onChange={(e) => setMapped(p.key, e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">— pick —</option>
                  {POLICY_STATUS_VALUES.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button onClick={onNext} disabled={!allMapped}>Next: preview</Button>
      </div>
    </div>
  );
}
