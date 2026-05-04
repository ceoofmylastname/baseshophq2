import { useRecentActivityFeed, type ActivityEvent } from "@/hooks/useRecentActivityFeed";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60); if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60); if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24); if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}

const TYPE_LABELS: Record<ActivityEvent["event_type"], string> = {
  policy_created: "Policy",
  policy_status_changed: "Status",
  agent_invited: "Invite",
  agent_position_changed: "Position",
  master_grid_edited: "Grid",
};

export function RecentActivityFeed() {
  const { events, loading, hasMore, loadMore, loadingMore } = useRecentActivityFeed();
  return (
    <div className="rounded-md border bg-card p-4">
      <h3 className="text-sm font-semibold">Recent activity</h3>
      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : events.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No recent activity.</p>
      ) : (
        <>
          <ul className="mt-3 divide-y">
            {events.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <div className="flex items-start gap-2 min-w-0">
                  <Badge variant="muted" className="mt-0.5 shrink-0">
                    {TYPE_LABELS[e.event_type]}
                  </Badge>
                  <span className="truncate" title={e.summary}>{e.summary}</span>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(e.event_at)}</span>
              </li>
            ))}
          </ul>
          {hasMore && (
            <div className="mt-3 flex justify-center">
              <Button size="sm" variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
