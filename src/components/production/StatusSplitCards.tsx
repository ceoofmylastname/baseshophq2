/**
 * Phase 10D: Status-split scorecards for /production.
 *
 * Each card shows $ amount + % of total. Total Premium card is the denominator
 * and shown without a percentage. Active Agents and Booked Policies are counts,
 * also shown without a percentage.
 *
 * Card list per wiki/production-dashboard-page.md:
 *   Total Premium / Submitted / Pending / Active / Potential Lapse / Terminated
 *   / Active Agents / Booked Policies
 *
 * Refs Collected and Refs Sold cards are deferred to Phase 10F.
 */

import { DollarSign, TrendingUp, Clock, CheckCircle, AlertTriangle, XCircle, Users, FileText } from "lucide-react";
import { MetricCard } from "@/components/dashboard/MetricCard";
import type { ProductionMetrics } from "@/hooks/useProductionMetrics";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const fmtCount = (n: number) => new Intl.NumberFormat("en-US").format(n);

type Props = { data: ProductionMetrics | null; loading: boolean };

export function StatusSplitCards({ data, loading }: Props) {
  const total = data?.total_premium ?? 0;
  const pct = (n: number) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "—");
  const moneyWithPct = (n: number) => `${fmtMoney(n)} · ${pct(n)}`;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        label="Total Premium" value={fmtMoney(total)}
        icon={<DollarSign className="h-4 w-4" />} loading={loading}
        tooltip="Sum of annual_premium across all in-window policies (per the active basis)."
      />
      <MetricCard
        label="Submitted" value={moneyWithPct(data?.submitted_premium ?? 0)}
        icon={<TrendingUp className="h-4 w-4" />} loading={loading}
        tooltip="Annual premium of policies currently in Submitted status."
      />
      <MetricCard
        label="Pending" value={moneyWithPct(data?.pending_premium ?? 0)}
        icon={<Clock className="h-4 w-4" />} loading={loading}
        tooltip="Annual premium of policies currently in Pending status."
      />
      <MetricCard
        label="Active" value={moneyWithPct(data?.active_premium ?? 0)}
        icon={<CheckCircle className="h-4 w-4" />} loading={loading}
        tooltip="Annual premium of policies in Issued or Issue Paid status."
      />
      <MetricCard
        label="Potential Lapse" value={moneyWithPct(data?.lapse_premium ?? 0)}
        icon={<AlertTriangle className="h-4 w-4 text-destructive" />} loading={loading}
        tooltip="Annual premium of policies flagged Potential Lapse — at-risk."
      />
      <MetricCard
        label="Terminated" value={moneyWithPct(data?.terminated_premium ?? 0)}
        icon={<XCircle className="h-4 w-4" />} loading={loading}
        tooltip="Annual premium of policies in Terminated status."
      />
      <MetricCard
        label="Active Agents" value={fmtCount(data?.active_agents ?? 0)}
        icon={<Users className="h-4 w-4" />} loading={loading}
        tooltip="Distinct agents who wrote at least one policy in the last 30 days. The billing unit; ignores the page's date range."
      />
      <MetricCard
        label="Booked Policies" value={fmtCount(data?.booked_policies ?? 0)}
        icon={<FileText className="h-4 w-4" />} loading={loading}
        tooltip="Count of policies in Issued or Issue Paid status in the window."
      />
    </div>
  );
}
