import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";

export type RecruiterRow = {
  rank: number; agent_id: string; agent_name: string;
  position_code: string | null; position_name: string | null;
  recruits: number;
};

export function useLeaderboardTopRecruiters(args: {
  startDate: string; endDate: string; limit?: number;
}) {
  const tenant = useTenant();
  const [rows, setRows] = useState<RecruiterRow[]>([]);
  const [isOwnerView, setIsOwnerView] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("leaderboard_top_recruiters", {
      p_start_date: args.startDate, p_end_date: args.endDate, p_limit: args.limit ?? 10,
    });
    setLoading(false);
    const r = data as { success?: boolean; is_owner_view?: boolean; rows?: RecruiterRow[] };
    if (!r?.success) { setRows([]); return; }
    setIsOwnerView(!!r.is_owner_view);
    setRows((r.rows ?? []).map((x) => ({ ...x, recruits: Number(x.recruits) })));
  }, [args.startDate, args.endDate, args.limit]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`top-recruiters-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "agents", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { rows, isOwnerView, loading, refresh };
}
