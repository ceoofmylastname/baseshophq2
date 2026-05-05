/**
 * Phase 10C: Scoreboard — TENANT-SCOPED (no view-down).
 *
 * Realtime cascade dependencies (Phase 10A.1 build rule):
 *   policies            - producers / most-improved
 *   policy_commissions  - top earners
 *   agents              - top recruiters (joined-at this window)
 *
 * View-down carve-out (locked Phase 10C):
 *   Every row in scoreboard_* RPCs is visible regardless of position in the
 *   hierarchy. Drill-through to /agents/:id is gated client-side via the
 *   visible_agent_ids() set — non-uplink agents see a Lock icon and the row
 *   is silently non-clickable. See per-RPC comment blocks in
 *   20260511100000_phase10c_scoreboard_and_earners.sql for the rule.
 */

import { useState } from "react";
import {
  TimeRangeFilter, type RangePreset, rangeFromPreset, loadStoredRange,
} from "@/components/dashboard/TimeRangeFilter";
import { CarrierFilter } from "@/components/dashboard/CarrierFilter";
import { ScoreboardTabs } from "@/components/scoreboard/ScoreboardTabs";
import { useVisibleAgentIds } from "@/hooks/useVisibleAgentIds";

export function ScoreboardPage() {
  const [rangeState, setRangeState] = useState(() =>
    loadStoredRange() ?? { preset: "month" as RangePreset, range: rangeFromPreset("month") },
  );
  const [carrierId, setCarrierId] = useState<string | null>(null);
  const { visibleAgentIds } = useVisibleAgentIds();

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card p-3">
        <TimeRangeFilter value={rangeState} onChange={setRangeState} />
      </div>

      <header>
        <h1 className="text-2xl font-semibold">Scoreboard</h1>
        <p className="text-sm text-muted-foreground">
          Whole-tenant rankings. Profile drill-through is restricted to your subtree.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <CarrierFilter value={carrierId} onChange={setCarrierId} />
      </div>

      <ScoreboardTabs
        startDate={rangeState.range.start}
        endDate={rangeState.range.end}
        carrierId={carrierId}
        visibleAgentIds={visibleAgentIds}
      />
    </div>
  );
}
