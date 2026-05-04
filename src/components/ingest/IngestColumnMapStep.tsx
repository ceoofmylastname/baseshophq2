import type { ParsedCsv } from "@/lib/ingest-csv-parser";
import {
  CANONICAL_FIELDS,
  type CanonicalField,
  type ColumnMap,
} from "@/lib/ingest-row-canonicalize";
import { Button } from "@/components/ui/button";

type Props = {
  csv: ParsedCsv;
  columnMap: ColumnMap;
  onChange: (map: ColumnMap) => void;
  onBack: () => void;
  onNext: () => void;
};

export function IngestColumnMapStep({ csv, columnMap, onChange, onBack, onNext }: Props) {
  const policyNumberMapped = Object.values(columnMap).includes("policy_number");

  function setHeader(header: string, field: CanonicalField | "") {
    onChange({ ...columnMap, [header]: field });
  }

  return (
    <div className="space-y-4 rounded-md border p-6">
      <p className="text-sm text-muted-foreground">
        {csv.rows.length} rows detected. Map each carrier column to a canonical field. Leave columns
        unmapped to ignore them. <span className="font-medium text-foreground">policy_number is required.</span>
      </p>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="pb-2">CSV column</th>
            <th className="pb-2">Sample value</th>
            <th className="pb-2">Map to</th>
          </tr>
        </thead>
        <tbody>
          {csv.headers.map((h) => (
            <tr key={h} className="border-t">
              <td className="py-2 font-mono">{h}</td>
              <td className="py-2 text-muted-foreground">{csv.rows[0]?.[h] ?? "—"}</td>
              <td className="py-2">
                <select
                  value={columnMap[h] ?? ""}
                  onChange={(e) => setHeader(h, e.target.value as CanonicalField | "")}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">— ignore —</option>
                  {CANONICAL_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {!policyNumberMapped && (
        <p className="text-sm text-destructive">policy_number must be mapped to continue.</p>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button onClick={onNext} disabled={!policyNumberMapped}>Next: status mapping</Button>
      </div>
    </div>
  );
}
