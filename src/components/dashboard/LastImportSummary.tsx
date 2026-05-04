import { Link } from "react-router-dom";
import { useLastImportRun } from "@/hooks/useLastImportRun";

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60); if (min < 60) return `${min}m ago`;
  const hr  = Math.floor(min / 60); if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}

export function LastImportSummary() {
  const { run, loading } = useLastImportRun();

  if (loading) {
    return (
      <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
        Loading last import…
      </div>
    );
  }
  if (!run) {
    return (
      <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
        No imports yet. Run the <Link to="/ingest" className="text-primary underline">carrier ingest wizard</Link> to get started.
      </div>
    );
  }

  const summary = run.rows_orphan === 0
    ? "all assigned"
    : `${run.rows_orphan} orphan${run.rows_orphan === 1 ? "" : "s"}`;

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm">
        <p className="font-medium">Last import</p>
        <p className="text-xs text-muted-foreground">
          {timeAgo(run.started_at)} · {run.rows_total} row{run.rows_total === 1 ? "" : "s"} · {summary}
        </p>
      </div>
      <Link to={`/ingest/history/${run.id}`} className="text-xs text-primary underline">View</Link>
    </div>
  );
}
