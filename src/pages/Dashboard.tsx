/**
 * Operator Dashboard. Phase 10A initial + Phase 10A.1 leaderboards/feed/chart.
 *
 * Realtime cascade dependencies (Build Rule, locked starting 10A.1)
 * ----------------------------------------------------------------------------
 * This page subscribes to the following source tables via postgres_changes
 * filtered by tenant_id. Any column or status change is reflected without
 * manual refresh.
 *
 *   policies            - metric cards, commission trend, leaderboards,
 *                          activity feed (via the policy_created and
 *                          policy_status_changed AFTER triggers)
 *   policy_commissions  - metric cards, commission trend
 *   announcements       - announcements list
 *   ingest_runs         - last import summary
 *   tenant_setup_state  - setup wizard banner
 *   activity_events     - recent activity feed (debounced 400ms; bulk Set
 *                          Column flows can fire 10+ events in seconds)
 *   agents              - top recruiters leaderboard, team_size metric
 *
 * Convention: when adding a new aggregate widget that reads cross-cutting
 * data, declare its table dependencies in this comment block AND ensure the
 * hook subscribes to those tables. activity_events is the union "something
 * happened" channel; per-table subscriptions stay for high-fidelity per-cell
 * updates. See [[realtime-updates-and-hierarchy-cascade]] in the wiki.
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
import { CommissionTrendChart } from "@/components/dashboard/CommissionTrendChart";
import { TopProducersMini } from "@/components/dashboard/TopProducersMini";
import { LeaderboardsSection } from "@/components/dashboard/LeaderboardsSection";
import { RecentActivityFeed } from "@/components/dashboard/RecentActivityFeed";

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

      <MetricsGrid
        data={data}
        loading={loading}
        startDate={rangeState.range.start}
        endDate={rangeState.range.end}
        carrierId={carrierId}
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <LastImportSummary />
        <AnnualGoalProgress progressAmount={goalProgressAmount} />
      </div>

      <CommissionTrendChart
        startDate={rangeState.range.start}
        endDate={rangeState.range.end}
        carrierId={carrierId}
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <TopProducersMini
          startDate={rangeState.range.start}
          endDate={rangeState.range.end}
          carrierId={carrierId}
        />
        <RecentActivityFeed />
      </div>

      <LeaderboardsSection
        startDate={rangeState.range.start}
        endDate={rangeState.range.end}
        carrierId={carrierId}
      />

      <AnnouncementsList />
    </div>
  );
}
