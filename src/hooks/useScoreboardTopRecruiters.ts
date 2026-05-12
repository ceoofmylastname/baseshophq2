import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";

export type ScoreboardRecruiterRow = {
  rank: number; agent_id: string; agent_name: string;
  position_code: string | null; position_name: string | null;
  recruits: number;
};

export function useScoreboardTopRecruiters(args: {
  startDate: string; endDate: string; limit?: number;
}) {
  const tenant = useTenant();
  const [rows, setRows] = useState<ScoreboardRecruiterRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("scoreboard_top_recruiters", {
      p_start_date: args.startDate, p_end_date: args.endDate, p_limit: args.limit ?? 25,
    });
    setLoading(false);
    const r = data as { success?: boolean; rows?: ScoreboardRecruiterRow[] };
    if (!r?.success) { setRows([]); return; }
    setRows((r.rows ?? []).map((x) => ({ ...x, recruits: Number(x.recruits) })));
  }, [args.startDate, args.endDate, args.limit]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`scoreboard-recruiters-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "agents", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { rows, loading, refresh };
}
