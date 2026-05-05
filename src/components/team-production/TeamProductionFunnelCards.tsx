import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { Beaker, CheckCircle2, AlertTriangle, DollarSign } from "lucide-react";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

type Props = { startDate: string; endDate: string; carrierId: string | null };

export function TeamProductionFunnelCards({ startDate, endDate, carrierId }: Props) {
  const { data, loading } = useDashboardMetrics({ startDate, endDate, carrierId });

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        label="Pipeline"
        value={data ? fmtMoney(data.pipeline_premium) : "—"}
        loading={loading}
        icon={<Beaker className="h-4 w-4" />}
        tooltip="Submitted + Pending — premium not yet booked."
      />
      <MetricCard
        label="Booked"
        value={data ? fmtMoney(data.booked_premium) : "—"}
        loading={loading}
        icon={<CheckCircle2 className="h-4 w-4" />}
        tooltip="Issued + Active — premium booked in this window."
      />
      <MetricCard
        label="Realized"
        value={data ? fmtMoney(data.realized_premium) : "—"}
        loading={loading}
        icon={<DollarSign className="h-4 w-4" />}
        tooltip="Premium successfully paid through (issued, paid)."
      />
      <MetricCard
        label="At Risk"
        value={data ? fmtMoney(data.at_risk_premium) : "—"}
        loading={loading}
        icon={<AlertTriangle className="h-4 w-4" />}
        tooltip="Lapsed + Charged-back + Returned premium."
      />
    </div>
  );
}
