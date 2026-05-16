import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";
import {
  composeBillingState,
  type BillingSnapshot,
  type BillingState,
  type TenantBillingRow,
} from "@/lib/billing/helpers";

/**
 * Owner-facing billing state for the /billing page.
 *
 * Pulls three things:
 *   1. The tenant row (all billing columns + current_period_end).
 *   2. The last 6 billing_snapshots (newest first).
 *   3. Count of agents with archived_at IS NULL.
 *
 * Subscribes to realtime on `tenants` filtered by id so Stripe-webhook-driven
 * tier/status flips repaint without a refresh. We do not subscribe to
 * billing_snapshots — those land on a monthly cron and the user will refresh
 * naturally; live updates are over-engineered.
 *
 * Returns the structured BillingState via the pure composeBillingState helper,
 * so all derived values (usagePct, hasStripeCustomer, etc.) come from the
 * tested pure code path.
 */
export function useBillingState() {
  const tenant = useTenant();
  const [state, setState] = useState<BillingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    setError(null);

    const [{ data: tenantRow, error: tenantErr }, { data: snaps, error: snapsErr }, { count: agentCount, error: countErr }] = await Promise.all([
      supabase
        .from("tenants")
        .select(
          "id, current_plan_tier, white_label_addon_active, agent_cap, billing_status, is_in_trial, trial_ends_at, current_period_end, past_due_since, suspended_at, stripe_customer_id, billing_interval",
        )
        .eq("id", tenant.id)
        .maybeSingle(),
      supabase
        .from("billing_snapshots")
        .select(
          "id, period_start, period_end, active_agent_count, tier_at_snapshot, stripe_usage_record_id, created_at",
        )
        .eq("tenant_id", tenant.id)
        .order("period_start", { ascending: false })
        .limit(6),
      supabase
        .from("agents")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .is("archived_at", null),
    ]);

    if (tenantErr) {
      setError(tenantErr.message);
      setLoading(false);
      return;
    }
    if (!tenantRow) {
      setError("Tenant row not found.");
      setLoading(false);
      return;
    }
    if (snapsErr) {
      setError(snapsErr.message);
      setLoading(false);
      return;
    }
    if (countErr) {
      setError(countErr.message);
      setLoading(false);
      return;
    }

    const composed = composeBillingState({
      tenantRow: tenantRow as unknown as TenantBillingRow,
      snapshots: (snaps ?? []) as unknown as BillingSnapshot[],
      agentCount: agentCount ?? 0,
    });
    setState(composed);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Realtime on tenants: pick up webhook-driven tier / status flips.
  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`billing-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "tenants", filter: `id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { state, loading, error, refresh };
}
