import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import { KpiTile } from "@/components/dashboard/KpiTile";
import { Beaker, CheckCircle2, AlertTriangle, DollarSign } from "lucide-react";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

type Props = { startDate: string; endDate: string; carrierId: string | null };

/**
 * Phase 13.4: all four funnel tiles are KpiTile (hover-preview + click to
 * drill into the Book of Business). Uses the existing dashboard_metrics
 * RPC for the top-line totals; bucket previews come from the new
 * dashboard_bucket_preview RPC.
 */
export function TeamProductionFunnelCards({ startDate, endDate, carrierId }: Props) {
  const { data, loading } = useDashboardMetrics({ startDate, endDate, carrierId });

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiTile
        label="Pipeline"
        value={data ? fmtMoney(data.pipeline_premium) : "—"}
        loading={loading}
        icon={<Beaker className="h-4 w-4" />}
        tooltip="Submitted + Pending — premium not yet booked."
        bucket="pipeline"
        startDate={startDate} endDate={endDate} carrierId={carrierId}
      />
      <KpiTile
        label="Booked"
        value={data ? fmtMoney(data.booked_premium) : "—"}
        loading={loading}
        icon={<CheckCircle2 className="h-4 w-4" />}
        tooltip="Issued + Active — premium booked in this window."
        bucket="booked"
        startDate={startDate} endDate={endDate} carrierId={carrierId}
      />
      <KpiTile
        label="Realized"
        value={data ? fmtMoney(data.realized_premium) : "—"}
        loading={loading}
        icon={<DollarSign className="h-4 w-4" />}
        tooltip="Premium successfully paid through (issued, paid)."
        bucket="realized"
        startDate={startDate} endDate={endDate} carrierId={carrierId}
      />
      <KpiTile
        label="At Risk"
        value={data ? fmtMoney(data.at_risk_premium) : "—"}
        loading={loading}
        icon={<AlertTriangle className="h-4 w-4" />}
        tooltip="Lapsed + Charged-back + Returned premium."
        bucket="at_risk"
        startDate={startDate} endDate={endDate} carrierId={carrierId}
      />
    </div>
  );
}
