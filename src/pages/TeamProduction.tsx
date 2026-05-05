/**
 * Phase 10C: Team Production — view-down funnel + leaderboards.
 *
 * Realtime cascade dependencies (Phase 10A.1 build rule):
 *   policies            - funnel cards, leaderboards (booked/realized)
 *   policy_commissions  - realized roll-ups, top earners
 *
 * View-down: this page reuses leaderboard_* RPCs which already enforce
 * is_owner ? all-tenant : self-subtree via visible_agent_ids().
 */

import { useState } from "react";
import {
  TimeRangeFilter, type RangePreset, rangeFromPreset, loadStoredRange,
} from "@/components/dashboard/TimeRangeFilter";
import { CarrierFilter } from "@/components/dashboard/CarrierFilter";
import { CommissionTrendChart } from "@/components/dashboard/CommissionTrendChart";
import { TeamProductionFunnelCards } from "@/components/team-production/TeamProductionFunnelCards";
import { LeaderboardTopProducers } from "@/components/dashboard/LeaderboardTopProducers";
import { LeaderboardTopEarners } from "@/components/team-production/LeaderboardTopEarners";

export function TeamProductionPage() {
  const [rangeState, setRangeState] = useState(() =>
    loadStoredRange() ?? { preset: "month" as RangePreset, range: rangeFromPreset("month") },
  );
  const [carrierId, setCarrierId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card p-3">
        <TimeRangeFilter value={rangeState} onChange={setRangeState} />
      </div>

      <header>
        <h1 className="text-2xl font-semibold">Team Production</h1>
        <p className="text-sm text-muted-foreground">Subtree-scoped funnel + leaderboards.</p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <CarrierFilter value={carrierId} onChange={setCarrierId} />
      </div>

      <TeamProductionFunnelCards
        startDate={rangeState.range.start}
        endDate={rangeState.range.end}
        carrierId={carrierId}
      />

      <CommissionTrendChart
        startDate={rangeState.range.start}
        endDate={rangeState.range.end}
        carrierId={carrierId}
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border bg-card p-4">
          <h3 className="text-sm font-semibold">Top Producers</h3>
          <div className="mt-3">
            <LeaderboardTopProducers
              startDate={rangeState.range.start}
              endDate={rangeState.range.end}
              carrierId={carrierId}
            />
          </div>
        </div>
        <LeaderboardTopEarners
          startDate={rangeState.range.start}
          endDate={rangeState.range.end}
          carrierId={carrierId}
        />
      </div>
    </div>
  );
}
