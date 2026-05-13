import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useTenant } from "@/contexts/AuthContext";

export type PromotionCriteria = {
  min_premium_last_3_months?: number;
  min_personal_policies?: number;
  min_active_downline_count?: number;
};

export type PromotionTarget = {
  id: string;
  from_position_id: string;
  to_position_id: string;
  criteria: PromotionCriteria;
  updated_at: string;
};

export function usePromotionTargets() {
  const tenant = useTenant();
  const [targets, setTargets] = useState<PromotionTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("promotion_targets")
      .select("id, from_position_id, to_position_id, criteria, updated_at")
      .eq("tenant_id", tenant.id);
    setLoading(false);
    setTargets((data ?? []) as PromotionTarget[]);
  }, [tenant?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function upsert(args: {
    from_position_id: string;
    to_position_id: string;
    criteria: PromotionCriteria;
  }) {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("upsert_promotion_target", {
        p_from_position_id: args.from_position_id,
        p_to_position_id:   args.to_position_id,
        p_criteria:         args.criteria,
      });
      if (error) return { ok: false as const, errorMessage: error.message };
      const r = data as { success: boolean; error_code?: string };
      if (!r.success) return { ok: false as const, errorMessage: r.error_code ?? "unknown" };
      await refresh();
      return { ok: true as const };
    } finally { setSubmitting(false); }
  }

  async function remove(id: string) {
    const { error } = await supabase.from("promotion_targets").delete().eq("id", id);
    if (error) return { ok: false as const, errorMessage: error.message };
    await refresh();
    return { ok: true as const };
  }

  return { targets, loading, submitting, refresh, upsert, remove };
}
