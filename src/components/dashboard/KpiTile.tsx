/**
 * Drill-through KPI tile. Renders the same visual as MetricCard but is
 * itself a `<button>` that navigates to a Book-of-Business deep link on
 * click, and shows a Radix HoverCard preview of the top 5 policies in
 * the bucket on hover.
 *
 * Preview rows come from the dashboard_bucket_preview RPC, scoped by
 * (bucket, carrierId, startDate, endDate). The hook is gated on
 * `enabled = open` so we never call the RPC until the user actually
 * hovers — keeps the dashboard initial-load cost untouched.
 */

import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useBucketPreview } from "@/hooks/useBucketPreview";
import { bucketDestinationUrl, type BucketKey } from "@/lib/bucket-destination";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

type Props = {
  label: string;
  value: string;
  icon?: ReactNode;
  tooltip?: string;
  loading?: boolean;
  bucket: BucketKey;
  startDate: string;
  endDate: string;
  carrierId: string | null;
  /** Optional agent_id propagated into the destination URL. */
  agentId?: string | null;
};

export function KpiTile({
  label, value, icon, tooltip, loading,
  bucket, startDate, endDate, carrierId, agentId = null,
}: Props) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const destination = bucketDestinationUrl({ bucket, carrierId, agentId });

  const { data, loading: previewLoading } = useBucketPreview({
    bucket, carrierId, startDate, endDate, enabled: open,
  });

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: open ${label.toLowerCase()} list`}
          onClick={() => navigate(destination)}
          className="group block w-full rounded-md border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          title={tooltip}
        >
          <div className="flex items-start justify-between">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            {icon && <span className="text-muted-foreground">{icon}</span>}
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {loading ? <span className="text-muted-foreground">…</span> : value}
          </p>
        </button>
      </HoverCardTrigger>

      <HoverCardContent className="w-96">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            {data && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {data.total_policies} polic{data.total_policies === 1 ? "y" : "ies"}
              </span>
            )}
          </div>

          {previewLoading && !data ? (
            <p className="py-4 text-center text-xs text-muted-foreground">Loading…</p>
          ) : data && data.preview_rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No policies in this bucket</p>
          ) : data ? (
            <ul className="divide-y divide-border/60">
              {data.preview_rows.map((r) => {
                const amount = data.mode === "commission" ? r.commission_amount : r.annual_premium;
                return (
                  <li key={r.id} className="flex items-start justify-between gap-3 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.client_name}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.agent_name}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm tabular-nums">{amount != null ? fmtMoney(Number(amount)) : "—"}</p>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{r.status}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-4 text-center text-xs text-muted-foreground">—</p>
          )}

          {data && data.total_policies > 0 && (
            <div className="border-t pt-2">
              <Link
                to={destination}
                className="text-xs text-primary hover:underline"
              >
                View all {data.total_policies} →
              </Link>
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
