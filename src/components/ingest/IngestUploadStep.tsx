import { useState } from "react";
import { parseIngestCsv, type ParsedCsv } from "@/lib/ingest-csv-parser";

type Props = { onLoaded: (parsed: ParsedCsv) => void };

export function IngestUploadStep({ onLoaded }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    const result = await parseIngestCsv(file);
    setBusy(false);
    if ("code" in result) {
      setError(result.message);
      return;
    }
    onLoaded(result);
  }

  return (
    <div className="space-y-3 rounded-md border p-6">
      <p className="text-sm">
        Upload a carrier statement CSV. Up to 1,000 rows per file. Larger files should be split.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        disabled={busy}
        onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
        className="block text-sm"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
