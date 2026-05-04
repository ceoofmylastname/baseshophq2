import type { ActivityEventRow } from "@/hooks/usePolicyDetail";
import { Badge } from "@/components/ui/badge";

const TYPE_LABELS: Record<string, string> = {
  policy_created: "Created",
  policy_status_changed: "Status",
  agent_invited: "Invite",
  agent_position_changed: "Position",
  master_grid_edited: "Grid",
};

type Props = { rows: ActivityEventRow[] };

export function PolicyAuditLog({ rows }: Props) {
  return (
    <div className="rounded-md border p-4">
      <h2 className="text-sm font-semibold">Audit log</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Filtered to events with this policy_id in metadata.
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No audit events for this policy.</p>
      ) : (
        <ul className="mt-3 divide-y">
          {rows.map((e) => (
            <li key={e.id} className="flex items-start gap-2 py-2 text-sm">
              <Badge variant="muted" className="mt-0.5 shrink-0">
                {TYPE_LABELS[e.event_type] ?? e.event_type}
              </Badge>
              <div className="flex-1 min-w-0">
                <p className="truncate" title={e.summary}>{e.summary}</p>
                <p className="text-xs text-muted-foreground">{new Date(e.event_at).toLocaleString()}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
