import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";

export type TrendPoint = { month: string; booked: number; realized: number };

export function useCommissionTrend(args: {
  startDate: string; endDate: string; carrierId: string | null;
}) {
  const tenant = useTenant();
  const [series, setSeries] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("commission_trend_series", {
      p_start_date: args.startDate, p_end_date: args.endDate, p_carrier_id: args.carrierId,
    });
    setLoading(false);
    const r = data as { success?: boolean; series?: TrendPoint[] };
    if (!r?.success) { setSeries([]); return; }
    setSeries((r.series ?? []).map((p) => ({ ...p, booked: Number(p.booked), realized: Number(p.realized) })));
  }, [args.startDate, args.endDate, args.carrierId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`commission-trend-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policy_commissions", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policies", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { series, loading, refresh };
}
