import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useTenant } from "@/contexts/AuthContext";

export type EarnerRow = {
  rank: number; agent_id: string; agent_name: string;
  position_code: string | null; position_name: string | null;
  earned: number;
};

export function useLeaderboardTopEarners(args: {
  startDate: string; endDate: string; carrierId: string | null; limit?: number;
}) {
  const tenant = useTenant();
  const [rows, setRows] = useState<EarnerRow[]>([]);
  const [isOwnerView, setIsOwnerView] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("leaderboard_top_earners", {
      p_start_date: args.startDate, p_end_date: args.endDate,
      p_carrier_id: args.carrierId, p_limit: args.limit ?? 10,
    });
    setLoading(false);
    const r = data as { success?: boolean; is_owner_view?: boolean; rows?: EarnerRow[] };
    if (!r?.success) { setRows([]); return; }
    setIsOwnerView(!!r.is_owner_view);
    setRows((r.rows ?? []).map((x) => ({ ...x, earned: Number(x.earned) })));
  }, [args.startDate, args.endDate, args.carrierId, args.limit]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(`top-earners-${tenant.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policy_commissions", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policies", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { rows, isOwnerView, loading, refresh };
}
