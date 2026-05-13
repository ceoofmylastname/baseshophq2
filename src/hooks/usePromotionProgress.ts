import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useAuth } from "@/contexts/AuthContext";

export type CriterionProgress = {
  key: string;
  target: number;
  current: number;
  pct: number;
  met: boolean;
};

export type PositionRef = { id: string; code: string; name: string };

export type PromotionProgress = {
  current_position: PositionRef | null;
  next_position: PositionRef | null;
  criteria_progress: CriterionProgress[];
  all_met: boolean;
};

/**
 * Wraps promotion_progress() RPC. Server computes window sums + downline
 * counts; the UI just renders bars.
 */
export function usePromotionProgress() {
  const { currentAgent } = useAuth();
  const [data, setData] = useState<PromotionProgress | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!currentAgent?.id) return;
    setLoading(true);
    const { data: result } = await supabase.rpc("promotion_progress");
    setLoading(false);
    const r = result as
      | ({ success: boolean; error_code?: string } & PromotionProgress)
      | null;
    if (!r?.success) { setData(null); return; }
    setData({
      current_position: r.current_position,
      next_position: r.next_position,
      criteria_progress: (r.criteria_progress ?? []).map(c => ({
        ...c,
        target: Number(c.target),
        current: Number(c.current),
        pct: Number(c.pct),
      })),
      all_met: r.all_met,
    });
  }, [currentAgent?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { data, loading, refresh };
}
