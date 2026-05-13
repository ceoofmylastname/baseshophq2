import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useRecentActivityFeed, type ActivityEvent } from "@/hooks/useRecentActivityFeed";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

/**
 * Recent activity feed.
 *
 * Each row is a single tap-target. Summary truncates to 1 line by default
 * and expands to full text when tapped. Time moves below the summary so
 * the row never needs to be wider than the viewport — eliminating the
 * horizontal-scroll problem on mobile when a summary is long.
 */
export function RecentActivityFeed() {
  const { events, loading, hasMore, loadMore, loadingMore } = useRecentActivityFeed();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="overflow-hidden rounded-2xl glass p-4 sm:p-5">
      <h3 className="text-sm font-semibold tracking-tight">Recent activity</h3>
      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : events.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No recent activity.</p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-white/[0.04]">
            {events.map((e) => {
              const expanded = expandedId === e.id;
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : e.id)}
                    className="group flex w-full items-start gap-2 py-2.5 text-left transition-colors hover:bg-white/[0.02]"
                    aria-expanded={expanded}
                  >
                    <Badge variant="muted" className="mt-0.5 shrink-0 text-[10px]">
                      {TYPE_LABELS[e.event_type]}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "break-words text-sm",
                          !expanded && "line-clamp-1",
                        )}
                      >
                        {e.summary}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {timeAgo(e.event_at)}
                      </p>
                    </div>
                    <ChevronDown
                      className={cn(
                        "mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                        expanded && "rotate-180",
                      )}
                    />
                  </button>
                </li>
              );
            })}
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
