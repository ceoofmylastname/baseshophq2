import { DollarSign, TrendingUp, CheckCircle, AlertTriangle, FileText, Users, Wallet, Coins } from "lucide-react";
import { MetricCard } from "./MetricCard";
import type { DashboardMetrics } from "@/hooks/useDashboardMetrics";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const fmtCount = (n: number) => new Intl.NumberFormat("en-US").format(n);

type Props = { data: DashboardMetrics | null; loading: boolean };

export function MetricsGrid({ data, loading }: Props) {
  const isOwner = data?.meta?.is_owner_view ?? false;
  const teamLabel = isOwner ? "Team Size" : "My Team";

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        label="Pipeline Premium" value={fmtMoney(data?.pipeline_premium ?? 0)}
        icon={<TrendingUp className="h-4 w-4" />} loading={loading}
        tooltip="Sum of annual_premium for policies with status Submitted or Pending in the selected window."
      />
      <MetricCard
        label="Booked Premium" value={fmtMoney(data?.booked_premium ?? 0)}
        icon={<DollarSign className="h-4 w-4" />} loading={loading}
        tooltip="Sum of annual_premium for policies with status Issued in the selected window."
      />
      <MetricCard
        label="Realized Premium" value={fmtMoney(data?.realized_premium ?? 0)}
        icon={<CheckCircle className="h-4 w-4" />} loading={loading}
        tooltip="Sum of annual_premium for policies with status Issue Paid in the selected window."
      />
      <MetricCard
        label="At-Risk Premium" value={fmtMoney(data?.at_risk_premium ?? 0)}
        icon={<AlertTriangle className="h-4 w-4" />} loading={loading}
        tooltip="Sum of annual_premium for policies with status Potential Lapse in the selected window."
      />
      <MetricCard
        label="Booked Policies" value={fmtCount(data?.booked_policies ?? 0)}
        icon={<FileText className="h-4 w-4" />} loading={loading}
        tooltip="Count of policies with status Issued in the selected window."
      />
      <MetricCard
        label={teamLabel} value={fmtCount(data?.team_size ?? 0)}
        icon={<Users className="h-4 w-4" />} loading={loading}
        tooltip={isOwner
          ? "Total non-archived agents in the tenant."
          : "Self plus all descendants in your downline tree."}
      />
      <MetricCard
        label="Booked Commission" value={fmtMoney(data?.booked_commission ?? 0)}
        icon={<Wallet className="h-4 w-4" />} loading={loading}
        tooltip="Sum of policy_commissions.amount for commission rows where the linked policy is Issued."
      />
      <MetricCard
        label="Realized Commission" value={fmtMoney(data?.realized_commission ?? 0)}
        icon={<Coins className="h-4 w-4" />} loading={loading}
        tooltip="Sum of policy_commissions.amount for commission rows where the linked policy is Issue Paid."
      />
    </div>
  );
}
