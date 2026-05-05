import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useTenant } from "@/contexts/AuthContext";

export type ScoreboardImprovedRow = {
  rank: number; agent_id: string; agent_name: string;
  position_code: string | null; position_name: string | null;
  curr_booked: number; prev_booked: number; pct_growth: number | null;
};

export type ScoreboardImprovedResult = {
  rows: ScoreboardImprovedRow[];
  priorWindow: { start: string; end: string } | null;
};

export function useScoreboardMostImproved(args: {
  startDate: string; endDate: string; carrierId: string | null; limit?: number;
}) {
  const tenant = useTenant();
  const [data, setData] = useState<ScoreboardImprovedResult>({ rows: [], priorWindow: null });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: result } = await supabase.rpc("scoreboard_most_improved", {
      p_start_date: args.startDate, p_end_date: args.endDate,
      p_carrier_id: args.carrierId, p_limit: args.limit ?? 25,
    });
    setLoading(false);
    const r = result as {
      success?: boolean; prior_window?: { start: string; end: string } | null;
      rows?: ScoreboardImprovedRow[];
    };
    if (!r?.success) { setData({ rows: [], priorWindow: null }); return; }
    setData({
      rows: (r.rows ?? []).map((x) => ({
        ...x, curr_booked: Number(x.curr_booked), prev_booked: Number(x.prev_booked),
        pct_growth: x.pct_growth === null ? null : Number(x.pct_growth),
      })),
      priorWindow: r.prior_window ?? null,
    });
  }, [args.startDate, args.endDate, args.carrierId, args.limit]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(`scoreboard-most-improved-${tenant.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policies", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { ...data, loading, refresh };
}
