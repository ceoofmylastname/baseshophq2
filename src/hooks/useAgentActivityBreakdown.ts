import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

export type WindowKey = "today" | "week" | "month" | "year" | "lifetime";

export type WindowStats = {
  total_count: number;
  total_premium: number;
  submitted_count: number;
  submitted_premium: number;
  pending_count: number;
  pending_premium: number;
  issued_count: number;
  issued_premium: number;
  issue_paid_count: number;
  issue_paid_premium: number;
  lapse_count: number;
  lapse_premium: number;
  terminated_count: number;
  terminated_premium: number;
};

export type ActivityBreakdown = {
  agent_id: string;
  windows: Record<WindowKey, WindowStats>;
};

const EMPTY_WINDOW: WindowStats = {
  total_count: 0, total_premium: 0,
  submitted_count: 0, submitted_premium: 0,
  pending_count: 0, pending_premium: 0,
  issued_count: 0, issued_premium: 0,
  issue_paid_count: 0, issue_paid_premium: 0,
  lapse_count: 0, lapse_premium: 0,
  terminated_count: 0, terminated_premium: 0,
};

function coerceWindow(raw: Record<string, unknown> | undefined): WindowStats {
  if (!raw) return { ...EMPTY_WINDOW };
  const num = (k: string) => Number(raw[k] ?? 0);
  return {
    total_count:        num("total_count"),
    total_premium:      num("total_premium"),
    submitted_count:    num("submitted_count"),
    submitted_premium:  num("submitted_premium"),
    pending_count:      num("pending_count"),
    pending_premium:    num("pending_premium"),
    issued_count:       num("issued_count"),
    issued_premium:     num("issued_premium"),
    issue_paid_count:   num("issue_paid_count"),
    issue_paid_premium: num("issue_paid_premium"),
    lapse_count:        num("lapse_count"),
    lapse_premium:      num("lapse_premium"),
    terminated_count:   num("terminated_count"),
    terminated_premium: num("terminated_premium"),
  };
}

export function useAgentActivityBreakdown(agentId: string | null) {
  const [data, setData] = useState<ActivityBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!agentId) { setData(null); return; }
    setLoading(true);
    setError(null);
    const { data: result, error: err } = await supabase.rpc("agent_activity_breakdown", {
      p_agent_id: agentId,
    });
    setLoading(false);
    if (err) { setError(err.message); return; }
    const r = result as {
      success: boolean;
      error_code?: string;
      agent_id?: string;
      windows?: Record<string, Record<string, unknown>>;
    };
    if (!r?.success) { setError(r?.error_code ?? "unknown"); return; }
    setData({
      agent_id: r.agent_id!,
      windows: {
        today:    coerceWindow(r.windows?.today),
        week:     coerceWindow(r.windows?.week),
        month:    coerceWindow(r.windows?.month),
        year:     coerceWindow(r.windows?.year),
        lifetime: coerceWindow(r.windows?.lifetime),
      },
    });
  }, [agentId]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { data, loading, error, refresh };
}
