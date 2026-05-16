import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { shouldShowSnapshots, type BillingSnapshot } from "@/lib/billing/helpers";

/**
 * Snapshot history card. Renders the last 6 billing_snapshots rows.
 *
 * Visibility: enterprise tier only (shouldShowSnapshots returns true
 * unconditionally for enterprise; false otherwise). Non-enterprise tiers do
 * not generate snapshots — they bill flat-rate, so this card returns null.
 *
 * Empty state (enterprise + 0 snapshots): the table renders with the headers
 * and a single explanatory row so the owner knows metering is wired up but
 * no period has closed yet.
 */
function formatPeriod(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
}

function formatReportedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function SnapshotHistoryCard({
  tier,
  snapshots,
}: {
  tier: string;
  snapshots: BillingSnapshot[];
}) {
  if (!shouldShowSnapshots(tier, snapshots.length)) return null;

  return (
    <section className="rounded-2xl glass p-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold tracking-tight">Billing snapshots</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Last six closed periods. Active agent counts reported to Stripe for usage-based billing.
        </p>
      </div>

      {snapshots.length === 0 ? (
        <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-muted-foreground">
          No snapshots yet. The first period closes at the end of this billing cycle.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Active agents</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Reported at</TableHead>
              <TableHead>Stripe usage record</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshots.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="text-sm">{formatPeriod(s.period_start, s.period_end)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{s.active_agent_count}</TableCell>
                <TableCell className="text-sm capitalize">{s.tier_at_snapshot}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatReportedAt(s.created_at)}
                </TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">
                  {s.stripe_usage_record_id ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
