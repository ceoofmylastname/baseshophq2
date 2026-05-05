import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useTenant } from "@/contexts/AuthContext";

export type ScoreboardEarnerRow = {
  rank: number; agent_id: string; agent_name: string;
  position_code: string | null; position_name: string | null;
  earned: number;
};

export function useScoreboardTopEarners(args: {
  startDate: string; endDate: string; carrierId: string | null; limit?: number;
}) {
  const tenant = useTenant();
  const [rows, setRows] = useState<ScoreboardEarnerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("scoreboard_top_earners", {
      p_start_date: args.startDate, p_end_date: args.endDate,
      p_carrier_id: args.carrierId, p_limit: args.limit ?? 25,
    });
    setLoading(false);
    const r = data as { success?: boolean; rows?: ScoreboardEarnerRow[] };
    if (!r?.success) { setRows([]); return; }
    setRows((r.rows ?? []).map((x) => ({ ...x, earned: Number(x.earned) })));
  }, [args.startDate, args.endDate, args.carrierId, args.limit]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(`scoreboard-earners-${tenant.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policy_commissions", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { rows, loading, refresh };
}
