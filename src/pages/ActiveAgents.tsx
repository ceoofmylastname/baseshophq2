/**
 * Phase 10C: Active Agents — agents who wrote >= 1 policy in [now() - days, now()].
 *
 * Realtime cascade dependencies (Phase 10A.1 build rule):
 *   policies            - membership: a new policy may pull an agent into the window
 *   agents              - status, position, name changes
 *
 * Note (Flag A): activity_events intentionally OMITTED — the recompute is
 * driven by the source of truth (policies) and re-enriched against agents.
 * Activity events would over-fire (status pill clicks, etc.) without changing
 * the underlying membership.
 */

import { useState } from "react";
import { ActiveAgentsDateRange } from "@/components/active-agents/ActiveAgentsDateRange";
import { ActiveAgentsTable } from "@/components/active-agents/ActiveAgentsTable";

export function ActiveAgentsPage() {
  const [days, setDays] = useState<number>(30);

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Active Agents</h1>
          <p className="text-sm text-muted-foreground">
            Agents who wrote at least one policy in the selected window. View-down enforced via RLS.
          </p>
        </div>
        <ActiveAgentsDateRange value={days} onChange={setDays} />
      </header>

      <ActiveAgentsTable days={days} />
    </div>
  );
}
