/**
 * Phase 10D: Production scorecard metrics.
 *
 * Wraps production_metrics RPC. Single round trip per (range, carrier, basis)
 * change. Realtime: subscribes to policies + policy_status_history filtered by
 * tenant_id; either change triggers a refetch (status_history matters because
 * the 'issue_paid' basis depends on it).
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useTenant } from "@/contexts/AuthContext";

export type ProductionBasis = "submitted" | "issue_paid";

export type ProductionMetrics = {
  total_premium:     number;
  submitted_premium: number;
  pending_premium:   number;
  active_premium:    number;
  lapse_premium:     number;
  terminated_premium:number;
  booked_policies:   number;
  active_agents:     number;
  meta: {
    is_owner_view: boolean;
    basis:         ProductionBasis;
    start_date:    string;
    end_date:      string;
    carrier_id:    string | null;
  };
};

export function useProductionMetrics(args: {
  startDate: string;
  endDate:   string;
  carrierId: string | null;
  basis:     ProductionBasis;
}) {
  const tenant = useTenant();
  const [data,    setData]    = useState<ProductionMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: result, error: err } = await supabase.rpc("production_metrics", {
      p_start_date: args.startDate,
      p_end_date:   args.endDate,
      p_carrier_id: args.carrierId,
      p_basis:      args.basis,
    });
    setLoading(false);
    if (err) { setError(err.message); return; }
    const r = result as { success?: boolean; error_code?: string } & ProductionMetrics;
    if (!r?.success) { setError(r?.error_code ?? "unknown"); return; }
    setError(null);
    const num = (n: unknown) => Number(n ?? 0);
    setData({
      total_premium:      num(r.total_premium),
      submitted_premium:  num(r.submitted_premium),
      pending_premium:    num(r.pending_premium),
      active_premium:     num(r.active_premium),
      lapse_premium:      num(r.lapse_premium),
      terminated_premium: num(r.terminated_premium),
      booked_policies:    num(r.booked_policies),
      active_agents:      num(r.active_agents),
      meta: r.meta,
    });
  }, [args.startDate, args.endDate, args.carrierId, args.basis]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(`production-metrics-${tenant.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policies", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policy_status_history", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { data, loading, error, refresh };
}
