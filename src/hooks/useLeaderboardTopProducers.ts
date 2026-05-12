import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";

export type ProducerRow = {
  rank: number;
  agent_id: string;
  agent_name: string;
  position_code: string | null;
  position_name: string | null;
  booked: number;
  realized: number;
  total: number;
};

export function useLeaderboardTopProducers(args: {
  startDate: string; endDate: string; carrierId: string | null; limit?: number;
}) {
  const tenant = useTenant();
  const [rows, setRows] = useState<ProducerRow[]>([]);
  const [isOwnerView, setIsOwnerView] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("leaderboard_top_producers", {
      p_start_date: args.startDate, p_end_date: args.endDate,
      p_carrier_id: args.carrierId, p_limit: args.limit ?? 10,
    });
    setLoading(false);
    const r = data as { success?: boolean; is_owner_view?: boolean; rows?: ProducerRow[] };
    if (!r?.success) { setRows([]); return; }
    setIsOwnerView(!!r.is_owner_view);
    setRows((r.rows ?? []).map((x) => ({
      ...x, booked: Number(x.booked), realized: Number(x.realized), total: Number(x.total),
    })));
  }, [args.startDate, args.endDate, args.carrierId, args.limit]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Subscribe to policies + policy_commissions changes
  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`top-producers-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policies", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policy_commissions", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { rows, isOwnerView, loading, refresh };
}
