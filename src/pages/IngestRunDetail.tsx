import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase-browser";

type Run = {
  id: string;
  started_at: string;
  completed_at: string | null;
  rows_total: number;
  rows_assigned: number;
  rows_orphan: number;
  rows_skipped: number;
  started_by_user_id: string | null;
};

/**
 * Stub detail page for an ingest run. Full history page (list of all runs +
 * per-row drill-down) is a later phase. This page exists to give the Last
 * Import Summary "View" link a real destination.
 */
export function IngestRunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("ingest_runs")
        .select("id, started_at, completed_at, rows_total, rows_assigned, rows_orphan, rows_skipped, started_by_user_id")
        .eq("id", runId)
        .maybeSingle();
      if (cancelled) return;
      setLoading(false);
      setRun((data ?? null) as Run | null);
    })();
    return () => { cancelled = true; };
  }, [runId]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!run) return (
    <div className="space-y-2">
      <p className="text-sm text-destructive">Ingest run not found.</p>
      <Link to="/dashboard" className="text-sm text-primary underline">Back to dashboard</Link>
    </div>
  );

  return (
    <div className="space-y-3">
      <Link to="/dashboard" className="text-sm text-muted-foreground hover:underline">← Back to dashboard</Link>
      <h1 className="text-2xl font-semibold">Ingest run detail</h1>
      <div className="rounded-md border p-4 text-sm">
        <p className="text-xs text-muted-foreground">Run ID</p>
        <p className="font-mono">{run.id}</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Started</dt><dd>{new Date(run.started_at).toLocaleString()}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Completed</dt><dd>{run.completed_at ? new Date(run.completed_at).toLocaleString() : "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Rows total</dt><dd>{run.rows_total}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Rows assigned</dt><dd>{run.rows_assigned}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Rows orphan</dt><dd>{run.rows_orphan}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Rows skipped</dt><dd>{run.rows_skipped}</dd></div>
        </dl>
      </div>
      <p className="text-xs text-muted-foreground">
        Per-row drill-down ships in a later phase. For now this is the run-level summary.
      </p>
    </div>
  );
}
