import type { StatusHistoryRow } from "@/hooks/usePolicyDetail";

type Props = { rows: StatusHistoryRow[] };

export function PolicyStatusHistoryTimeline({ rows }: Props) {
  return (
    <div className="rounded-md border p-4">
      <h2 className="text-sm font-semibold">Status history</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No status changes recorded.</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="flex gap-3 text-sm">
              <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
              <div className="flex-1">
                <p>
                  {r.prev_status ? (
                    <>
                      <span className="text-muted-foreground">{r.prev_status}</span>
                      {" → "}
                      <span className="font-medium">{r.status}</span>
                    </>
                  ) : (
                    <>Created at <span className="font-medium">{r.status}</span></>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleString()}
                  {r.source && <> · source: {r.source}</>}
                  {r.changed_by_name && r.changed_by_name !== "—" && <> · by {r.changed_by_name}</>}
                </p>
                {r.notes && <p className="mt-1 text-xs">{r.notes}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
