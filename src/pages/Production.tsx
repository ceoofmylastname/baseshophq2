/**
 * Phase 10D: Production Dashboard at /production.
 *
 * Per wiki/production-dashboard-page.md. Top-level analytics surface for
 * owners and managers. Status-split scorecards, premium trend graph with
 * 4-mode toggle, and Agent Totals table — each respects the page-level
 * Submitted Business vs Issue Paid Business basis toggle (Kevin's must-have).
 *
 * View-down enforced server-side via visible_agent_ids() in the three
 * production_* RPCs. Owner sees full tenant.
 *
 * Realtime cascade dependencies (Build Rule, Phase 10A.1):
 *   policies              → all three widgets
 *   policy_status_history → status splits + trend ('issue_paid' basis depends on it)
 *   agents                → agent totals table (status, position, name)
 */

import { useState } from "react";
import {
  TimeRangeFilter, type RangePreset, rangeFromPreset, loadStoredRange,
} from "@/components/dashboard/TimeRangeFilter";
import { CarrierFilter } from "@/components/dashboard/CarrierFilter";
import { BasisToggle } from "@/components/production/BasisToggle";
import { MissingApplicationDateBanner } from "@/components/production/MissingApplicationDateBanner";
import { StatusSplitCards } from "@/components/production/StatusSplitCards";
import { PremiumTrendChart } from "@/components/production/PremiumTrendChart";
import { AgentTotalsTable } from "@/components/production/AgentTotalsTable";
import { useProductionMetrics, type ProductionBasis } from "@/hooks/useProductionMetrics";

type Props = {
  /** When true, renders the same page under the /team-production route header. */
  teamView?: boolean;
};

export function ProductionPage({ teamView = false }: Props) {
  const [rangeState, setRangeState] = useState(() =>
    loadStoredRange() ?? { preset: "month" as RangePreset, range: rangeFromPreset("month") },
  );
  const [carrierId, setCarrierId] = useState<string | null>(null);
  const [basis,     setBasis]     = useState<ProductionBasis>("submitted");

  const { data, loading } = useProductionMetrics({
    startDate: rangeState.range.start,
    endDate:   rangeState.range.end,
    carrierId,
    basis,
  });

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card p-3">
        <TimeRangeFilter value={rangeState} onChange={setRangeState} />
      </div>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {teamView ? "Team Production" : "Production"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {teamView
              ? "Same dashboard, scoped to your downline tree."
              : "High-level scoreboard. View-down enforced; owners see the full tenant."}
          </p>
        </div>
        <BasisToggle value={basis} onChange={setBasis} />
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <CarrierFilter value={carrierId} onChange={setCarrierId} />
      </div>

      <MissingApplicationDateBanner />

      <StatusSplitCards data={data} loading={loading} />

      <PremiumTrendChart
        startDate={rangeState.range.start}
        endDate={rangeState.range.end}
        carrierId={carrierId}
        basis={basis}
      />

      <AgentTotalsTable
        startDate={rangeState.range.start}
        endDate={rangeState.range.end}
        carrierId={carrierId}
        basis={basis}
      />
    </div>
  );
}
