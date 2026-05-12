import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";

export type DashboardMetrics = {
  pipeline_premium: number;
  booked_premium: number;
  realized_premium: number;
  at_risk_premium: number;
  booked_policies: number;
  team_size: number;
  booked_commission: number;
  realized_commission: number;
  meta: { is_owner_view: boolean; start_date: string; end_date: string; carrier_id: string | null };
};

/**
 * Wraps dashboard_metrics RPC. Single round trip per (range, carrier) change.
 * Realtime: subscribes to policies + policy_commissions filtered by tenant_id;
 * any change triggers a refetch.
 */
export function useDashboardMetrics(args: {
  startDate: string; endDate: string; carrierId: string | null;
}) {
  const tenant = useTenant();
  const [data, setData] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: result, error: err } = await supabase.rpc("dashboard_metrics", {
      p_start_date: args.startDate,
      p_end_date:   args.endDate,
      p_carrier_id: args.carrierId,
    });
    setLoading(false);
    if (err) { setError(err.message); return; }
    const r = result as { success?: boolean; error_code?: string } & DashboardMetrics;
    if (!r?.success) { setError(r?.error_code ?? "unknown"); return; }
    setError(null);
    const { success: _s, error_code: _e, ...rest } = r as { success?: boolean; error_code?: string } & DashboardMetrics;
    void _s; void _e;
    setData({ ...rest, pipeline_premium: Number(rest.pipeline_premium), booked_premium: Number(rest.booked_premium),
      realized_premium: Number(rest.realized_premium), at_risk_premium: Number(rest.at_risk_premium),
      booked_commission: Number(rest.booked_commission), realized_commission: Number(rest.realized_commission) });
  }, [args.startDate, args.endDate, args.carrierId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`dashboard-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policies", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policy_commissions", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { data, loading, error, refresh };
}
