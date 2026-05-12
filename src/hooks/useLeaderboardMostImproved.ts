import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";

export type MostImprovedRow = {
  rank: number; agent_id: string; agent_name: string;
  position_code: string | null; position_name: string | null;
  curr_booked: number; prev_booked: number; pct_growth: number | null;
};

export type MostImprovedResult = {
  rows: MostImprovedRow[];
  priorWindow: { start: string; end: string } | null;
  isOwnerView: boolean;
};

export function useLeaderboardMostImproved(args: {
  startDate: string; endDate: string; carrierId: string | null; limit?: number;
}) {
  const tenant = useTenant();
  const [data, setData] = useState<MostImprovedResult>({ rows: [], priorWindow: null, isOwnerView: false });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: result } = await supabase.rpc("leaderboard_most_improved", {
      p_start_date: args.startDate, p_end_date: args.endDate,
      p_carrier_id: args.carrierId, p_limit: args.limit ?? 10,
    });
    setLoading(false);
    const r = result as {
      success?: boolean; is_owner_view?: boolean;
      prior_window?: { start: string; end: string } | null;
      rows?: MostImprovedRow[];
    };
    if (!r?.success) { setData({ rows: [], priorWindow: null, isOwnerView: false }); return; }
    setData({
      rows: (r.rows ?? []).map((x) => ({
        ...x, curr_booked: Number(x.curr_booked), prev_booked: Number(x.prev_booked),
        pct_growth: x.pct_growth === null ? null : Number(x.pct_growth),
      })),
      priorWindow: r.prior_window ?? null,
      isOwnerView: !!r.is_owner_view,
    });
  }, [args.startDate, args.endDate, args.carrierId, args.limit]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`most-improved-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policies", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { ...data, loading, refresh };
}
