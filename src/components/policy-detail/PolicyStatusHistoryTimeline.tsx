import type { StatusHistoryRow } from "@/hooks/usePolicyDetail";
import { StatusPill } from "@/components/ui/status-pill";
import type { PolicyStatus } from "@/lib/policy-bucket";
import { statusStyle } from "@/lib/status-style";
import { ArrowRight } from "lucide-react";

type Props = { rows: StatusHistoryRow[] };

export function PolicyStatusHistoryTimeline({ rows }: Props) {
  return (
    <div className="rounded-2xl glass p-5">
      <h2 className="text-sm font-semibold tracking-tight">Status history</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No status changes recorded.</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {rows.map((r) => {
            const newStyle = statusStyle(r.status as PolicyStatus);
            return (
              <li key={r.id} className="flex gap-3 text-sm">
                <div
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: newStyle.hsl, boxShadow: `0 0 8px ${newStyle.hsl}` }}
                  aria-hidden
                />
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {r.prev_status ? (
                      <>
                        <StatusPill status={r.prev_status as PolicyStatus} />
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <StatusPill status={r.status as PolicyStatus} />
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-muted-foreground">Created at</span>
                        <StatusPill status={r.status as PolicyStatus} />
                      </>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                    {r.source && <> · source: {r.source}</>}
                    {r.changed_by_name && r.changed_by_name !== "—" && <> · by {r.changed_by_name}</>}
                  </p>
                  {r.notes && <p className="mt-1 text-xs">{r.notes}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
