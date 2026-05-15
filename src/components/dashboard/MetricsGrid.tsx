import { DollarSign, TrendingUp, CheckCircle, AlertTriangle, FileText, Users, Wallet, Coins, Activity } from "lucide-react";
import { MetricCard } from "./MetricCard";
import { KpiTile } from "./KpiTile";
import type { DashboardMetrics } from "@/hooks/useDashboardMetrics";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const fmtCount = (n: number) => new Intl.NumberFormat("en-US").format(n);

type Props = {
  data: DashboardMetrics | null;
  loading: boolean;
  startDate: string;
  endDate: string;
  carrierId: string | null;
};

/**
 * 9 metrics in a 3-row × 3-col grid on large screens:
 *   Row 1 (premium states):    Pipeline | Booked | Realized
 *   Row 2 (dollars + at-risk): At-Risk  | Booked Commission | Realized Commission
 *   Row 3 (counts):            Booked Policies | Team Size | Active Writers
 *
 * Seven of the nine tiles are now KpiTile (clickable + hover-preview);
 * Team Size and Active Writers remain plain MetricCards — they're agent
 * headcounts, not policy buckets, so they don't drill into the policy
 * ledger.
 */
export function MetricsGrid({ data, loading, startDate, endDate, carrierId }: Props) {
  const isOwner = data?.meta?.is_owner_view ?? false;
  const teamLabel = isOwner ? "Team Size" : "My Team";

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <KpiTile
        label="Pipeline Premium" value={fmtMoney(data?.pipeline_premium ?? 0)}
        icon={<TrendingUp className="h-4 w-4 text-sky-300" />} loading={loading}
        tooltip="Sum of annual_premium for policies with status Submitted or Pending in the selected window."
        bucket="pipeline" startDate={startDate} endDate={endDate} carrierId={carrierId}
      />
      <KpiTile
        label="Booked Premium" value={fmtMoney(data?.booked_premium ?? 0)}
        icon={<DollarSign className="h-4 w-4 text-primary" />} loading={loading}
        tooltip="Sum of annual_premium for policies with status Issued in the selected window."
        bucket="booked" startDate={startDate} endDate={endDate} carrierId={carrierId}
      />
      <KpiTile
        label="Realized Premium" value={fmtMoney(data?.realized_premium ?? 0)}
        icon={<CheckCircle className="h-4 w-4 text-emerald-300" />} loading={loading}
        tooltip="Sum of annual_premium for policies with status Issue Paid in the selected window."
        bucket="realized" startDate={startDate} endDate={endDate} carrierId={carrierId}
      />

      <KpiTile
        label="At-Risk Premium" value={fmtMoney(data?.at_risk_premium ?? 0)}
        icon={<AlertTriangle className="h-4 w-4 text-orange-300" />} loading={loading}
        tooltip="Sum of annual_premium for policies with status Potential Lapse in the selected window."
        bucket="at_risk" startDate={startDate} endDate={endDate} carrierId={carrierId}
      />
      <KpiTile
        label="Booked Commission" value={fmtMoney(data?.booked_commission ?? 0)}
        icon={<Wallet className="h-4 w-4 text-primary" />} loading={loading}
        tooltip="Sum of policy_commissions.amount for commission rows where the linked policy is Issued."
        bucket="booked_commission" startDate={startDate} endDate={endDate} carrierId={carrierId}
      />
      <KpiTile
        label="Realized Commission" value={fmtMoney(data?.realized_commission ?? 0)}
        icon={<Coins className="h-4 w-4 text-emerald-300" />} loading={loading}
        tooltip="Sum of policy_commissions.amount for commission rows where the linked policy is Issue Paid."
        bucket="realized_commission" startDate={startDate} endDate={endDate} carrierId={carrierId}
      />

      <KpiTile
        label="Booked Policies" value={fmtCount(data?.booked_policies ?? 0)}
        icon={<FileText className="h-4 w-4" />} loading={loading}
        tooltip="Count of policies with status Issued in the selected window."
        bucket="booked_policies" startDate={startDate} endDate={endDate} carrierId={carrierId}
      />
      <MetricCard
        label={teamLabel} value={fmtCount(data?.team_size ?? 0)}
        icon={<Users className="h-4 w-4" />} loading={loading}
        tooltip={isOwner
          ? "Total non-archived agents in the tenant."
          : "Self plus all descendants in your downline tree."}
      />
      <MetricCard
        label="Active Writers" value={fmtCount(data?.active_writers ?? 0)}
        icon={<Activity className="h-4 w-4" />} loading={loading}
        tooltip="Distinct agents who wrote at least one policy in the selected window. Today shows today only, This Week shows this week, and so on. Updates live as deals post."
      />
    </div>
  );
}
