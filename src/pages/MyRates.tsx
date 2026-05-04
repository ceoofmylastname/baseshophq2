/**
 * Phase 9: agent-facing read-only view of carrier commission rates.
 *
 * Reads agent_rates_with_product (Phase 6b view) scoped to the calling user
 * via RLS. Realtime subscription (Phase 6b useAgentRates pattern, reused via
 * useMyRates) keeps the view in sync as the master grid changes upstream.
 *
 * Owner-side propagation chain that this view sits at the end of:
 *   Phase 8 owner edits master grid cell
 *   Phase 8 set_master_grid_rate() RPC
 *   Phase 8 hotfix propagate_master_grid_change() (in_place / close_insert)
 *   agent_carrier_rates row UPDATE / INSERT
 *   Phase 6b realtime postgres_changes channel filtered by agent_id
 *   useAgentRates refetch
 *   this view re-renders, badge + rate update without user action
 */

import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAgent } from "@/hooks/useAgent";
import { useMyRates } from "@/hooks/useMyRates";
import { MyRatesHeader } from "@/components/my-rates/MyRatesHeader";
import { MyRatesSearchSort, type SortMode } from "@/components/my-rates/MyRatesSearchSort";
import { MyRatesSection } from "@/components/my-rates/MyRatesSection";

export function MyRatesPage() {
  const { currentAgent, loading: authLoading } = useAuth();
  const { agent, loading: agentLoading } = useAgent(currentAgent?.id);
  const { rows, loading: ratesLoading, error } = useMyRates();

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("carrier_az");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.carrier_name.toLowerCase().includes(q) ||
        r.product_name.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const lifeRows = useMemo(() => filtered.filter((r) => r.product_type === "life"), [filtered]);
  const annuityRows = useMemo(() => filtered.filter((r) => r.product_type === "annuity"), [filtered]);

  if (authLoading || agentLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!agent) {
    return (
      <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
        Your account is not linked to an agent record. Contact your owner.
      </div>
    );
  }

  // Empty state: no position assigned (defensive — shouldn't happen post-Phase 6b)
  if (!agent.current_position_id) {
    return (
      <div className="space-y-4">
        <MyRatesHeader agent={agent} />
        <div className="rounded-md border bg-muted/40 p-6 text-center text-sm">
          No position assigned. Contact your owner to be placed at a position.
        </div>
      </div>
    );
  }

  // Non-commissioned position (e.g. 80 Associate): training banner instead of rates
  if (agent.current_position_is_commissioned === false) {
    return (
      <div className="space-y-4">
        <MyRatesHeader agent={agent} />
        <div className="rounded-md border bg-muted/40 p-6 text-center text-sm">
          You are currently in a non-commissioned training position. Rates will appear here once
          you are promoted to a commissioned position.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <MyRatesHeader agent={agent} />
      <MyRatesSearchSort search={search} onSearchChange={setSearch} sort={sort} onSortChange={setSort} />

      {ratesLoading && <p className="text-sm text-muted-foreground">Loading rates…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!ratesLoading && !error && rows.length === 0 && (
        <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          No rates yet. Your owner can template the master grid to your position.
        </div>
      )}

      {!ratesLoading && !error && rows.length > 0 && (
        <>
          <MyRatesSection title="Life Rates" rows={lifeRows} sort={sort} />
          <MyRatesSection title="Annuity Rates" rows={annuityRows} sort={sort} />
          {filtered.length === 0 && search && (
            <p className="text-center text-sm text-muted-foreground">
              No rates match "{search}".
            </p>
          )}
        </>
      )}
    </div>
  );
}
