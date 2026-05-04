import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useTenant } from "@/contexts/AuthContext";

/**
 * Reads + UPDATEs tenants.annual_goal_amount.
 * RLS already gates owner-only writes via tenants_update_owner.
 */
export function useAnnualGoal() {
  const tenant = useTenant();
  const [goal, setGoal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("tenants")
      .select("annual_goal_amount")
      .eq("id", tenant.id)
      .maybeSingle();
    setLoading(false);
    setGoal(data ? Number(data.annual_goal_amount) : null);
  }, [tenant?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function setAnnualGoal(amount: number) {
    if (!tenant?.id) return { ok: false as const, errorMessage: "no tenant" };
    if (Number.isNaN(amount) || amount < 0) {
      return { ok: false as const, errorMessage: "Amount must be 0 or greater." };
    }
    const { error } = await supabase
      .from("tenants")
      .update({ annual_goal_amount: amount })
      .eq("id", tenant.id);
    if (error) return { ok: false as const, errorMessage: error.message };
    setGoal(amount);
    return { ok: true as const };
  }

  return { goal, loading, refresh, setAnnualGoal };
}
