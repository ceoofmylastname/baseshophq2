import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";

export const SETUP_STEPS = [
  { key: "agency_profile",      label: "Agency profile",     description: "Confirm tenant name, slug, and owner." },
  { key: "positions_blueprint", label: "Positions blueprint", description: "Add or confirm position structure in Master Grid." },
  { key: "first_carrier",       label: "First carrier",       description: "Add at least one carrier under Carriers & products." },
  { key: "invite_agent",        label: "Invite an agent",     description: "Send the first agent invite from the Agents page." },
  { key: "webhook",             label: "Webhook (optional)",  description: "Webhook integration ships in a later phase. Mark this step complete to clear the checklist." },
  { key: "mark_complete",       label: "Mark complete",       description: "Final acknowledgment — closes the setup banner." },
] as const;

export type SetupStepKey = typeof SETUP_STEPS[number]["key"];

export function useTenantSetupState() {
  const tenant = useTenant();
  const [completedKeys, setCompletedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("tenant_setup_state")
      .select("step_key")
      .eq("tenant_id", tenant.id);
    setLoading(false);
    setCompletedKeys(new Set((data ?? []).map((r) => r.step_key as string)));
  }, [tenant?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Realtime: another owner-tab marking a step shows here too
  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`setup-state-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "tenant_setup_state", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  async function markComplete(stepKey: SetupStepKey) {
    const { data, error } = await supabase.rpc("mark_setup_step_complete", { p_step_key: stepKey });
    if (error) return { ok: false, errorMessage: error.message };
    const r = data as { success: boolean; error_code?: string };
    if (!r.success) return { ok: false, errorMessage: r.error_code ?? "unknown" };
    setCompletedKeys((prev) => new Set(prev).add(stepKey));
    return { ok: true };
  }

  const totalSteps = SETUP_STEPS.length;
  const completedCount = SETUP_STEPS.filter((s) => completedKeys.has(s.key)).length;
  const allComplete = completedCount === totalSteps;
  const nextIncomplete = SETUP_STEPS.find((s) => !completedKeys.has(s.key)) ?? null;

  return {
    steps: SETUP_STEPS, completedKeys, completedCount, totalSteps, allComplete, nextIncomplete,
    loading, markComplete, refresh,
  };
}
