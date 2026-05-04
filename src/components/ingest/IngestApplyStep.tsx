import { useEffect, useRef } from "react";
import { useIngestCommit, type CommitResult, type CommitRow } from "@/hooks/useIngestCommit";

type Props = {
  rows: CommitRow[];
  onDone: (results: CommitResult[]) => void;
};

export function IngestApplyStep({ rows, onDone }: Props) {
  const { commit, submitting, progress } = useIngestCommit();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      const result = await commit(rows);
      if (result.ok) {
        onDone(result.results);
      } else {
        // Surface partial results so the summary still shows what landed
        onDone(result.partialResults ?? []);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = Math.round(progress * 100);
  return (
    <div className="space-y-3 rounded-md border p-6">
      <p className="text-sm font-medium">Applying {rows.length} rows…</p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {submitting ? `${pct}% — committing in batches of 50…` : "Finalizing…"}
      </p>
    </div>
  );
}
