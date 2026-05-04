/**
 * Phase 10A: operator Dashboard.
 *
 * Replaces the Phase 5 placeholder. Top-level filter state (time range +
 * carrier) flows down to every widget. dashboard_metrics RPC is the single
 * round trip per filter change; realtime hooks (policies, policy_commissions,
 * announcements, ingest_runs, tenant_setup_state) refresh widgets in place.
 */

import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import {
  TimeRangeFilter, type RangePreset, rangeFromPreset, loadStoredRange,
} from "@/components/dashboard/TimeRangeFilter";
import { CarrierFilter } from "@/components/dashboard/CarrierFilter";
import { MetricsGrid } from "@/components/dashboard/MetricsGrid";
import { SetupWizardBanner } from "@/components/dashboard/SetupWizardBanner";
import { QuickActionButtons } from "@/components/dashboard/QuickActionButtons";
import { LastImportSummary } from "@/components/dashboard/LastImportSummary";
import { AnnualGoalProgress } from "@/components/dashboard/AnnualGoalProgress";
import { AnnouncementsList } from "@/components/dashboard/AnnouncementsList";

export function DashboardPage() {
  const { currentAgent } = useAuth();

  const [rangeState, setRangeState] = useState(() =>
    loadStoredRange() ?? { preset: "month" as RangePreset, range: rangeFromPreset("month") },
  );
  const [carrierId, setCarrierId] = useState<string | null>(null);

  const { data, loading, refresh } = useDashboardMetrics({
    startDate: rangeState.range.start,
    endDate:   rangeState.range.end,
    carrierId,
  });

  const goalProgressAmount = useMemo(
    () => (data ? data.booked_premium + data.realized_premium : 0),
    [data],
  );

  const firstName = currentAgent?.first_name ?? currentAgent?.email ?? "there";

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card p-3">
        <TimeRangeFilter value={rangeState} onChange={setRangeState} />
      </div>

      <SetupWizardBanner />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Welcome back, {firstName}.</p>
        </div>
        <QuickActionButtons onActivity={refresh} />
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <CarrierFilter value={carrierId} onChange={setCarrierId} />
      </div>

      <MetricsGrid data={data} loading={loading} />

      <div className="grid gap-3 lg:grid-cols-2">
        <LastImportSummary />
        <AnnualGoalProgress progressAmount={goalProgressAmount} />
      </div>

      <AnnouncementsList />
    </div>
  );
}
