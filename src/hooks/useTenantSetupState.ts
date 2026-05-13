import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";

/**
 * Static metadata about each setup step. Order here drives display order.
 *
 * `mode`:
 *   - "auto"   = the server detects completion from real data. The UI shows
 *                a read-only tick; no manual button.
 *   - "manual" = the owner explicitly marks the step complete. The UI shows
 *                a 'Mark complete' button until done.
 */
export const SETUP_STEPS = [
  { key: "agency_profile",      mode: "auto"   as const, label: "Agency profile",      description: "Tenant name, slug, and owner are configured." },
  { key: "positions_blueprint", mode: "auto"   as const, label: "Positions blueprint", description: "Two or more active rungs configured in the position ladder." },
  { key: "first_carrier",       mode: "auto"   as const, label: "First carrier",       description: "At least one active carrier added under Carriers & products." },
  { key: "invite_agent",        mode: "auto"   as const, label: "Invite an agent",     description: "First agent added to the team." },
  { key: "webhook",             mode: "manual" as const, label: "Webhook (optional)",  description: "Webhook integration ships in a later phase. Mark this step complete to clear the checklist." },
  { key: "mark_complete",       mode: "manual" as const, label: "Mark complete",       description: "Final acknowledgment — closes the setup banner." },
] as const;

export type SetupStepKey = typeof SETUP_STEPS[number]["key"];
export type SetupStepMode = "auto" | "manual";

type ServerStep = { key: SetupStepKey; complete: boolean; mode: SetupStepMode };

export function useTenantSetupState() {
  const tenant = useTenant();
  const [serverSteps, setServerSteps] = useState<ServerStep[] | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data } = await supabase.rpc("tenant_setup_status");
    setLoading(false);
    const r = data as { success: boolean; steps?: ServerStep[] } | null;
    if (r?.success && Array.isArray(r.steps)) {
      setServerSteps(r.steps);
    } else {
      setServerSteps([]);
    }
  }, [tenant?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Realtime: re-evaluate when any underlying source table changes.
  // The four auto-detected steps read from tenants, comp_grid_positions,
  // comp_grid_carriers, and agents. The two manual steps read from
  // tenant_setup_state. Subscribe to all five.
  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`setup-status-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "tenant_setup_state", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "comp_grid_positions", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "comp_grid_carriers", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "agents", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  /**
   * Marks a manual step complete. Auto steps cannot be manually marked —
   * if the underlying data condition isn't met yet, this returns
   * 'auto_step_cannot_be_manually_marked'.
   */
  async function markComplete(stepKey: SetupStepKey) {
    const meta = SETUP_STEPS.find((s) => s.key === stepKey);
    if (!meta) return { ok: false as const, errorMessage: "unknown_step" };
    if (meta.mode !== "manual") {
      return { ok: false as const, errorMessage: "auto_step_cannot_be_manually_marked" };
    }
    const { data, error } = await supabase.rpc("mark_setup_step_complete", { p_step_key: stepKey });
    if (error) return { ok: false as const, errorMessage: error.message };
    const r = data as { success: boolean; error_code?: string };
    if (!r.success) return { ok: false as const, errorMessage: r.error_code ?? "unknown" };
    void refresh();
    return { ok: true as const };
  }

  // Merge static metadata with server-detected completion state.
  const steps = SETUP_STEPS.map((s) => {
    const fromServer = serverSteps?.find((x) => x.key === s.key);
    return { ...s, complete: fromServer?.complete ?? false };
  });

  const completedCount = steps.filter((s) => s.complete).length;
  const totalSteps = steps.length;
  // Banner hides only after the explicit 'mark_complete' final-ack is
  // ticked. Auto-detected progress still shows even if all auto steps
  // are done, so the owner sees the optional webhook + the final-ack
  // prompt and can dismiss them deliberately.
  const dismissed = steps.find((s) => s.key === "mark_complete")?.complete ?? false;
  const allComplete = dismissed;
  const nextIncomplete = steps.find((s) => !s.complete) ?? null;

  return {
    steps, completedCount, totalSteps, allComplete, nextIncomplete,
    loading, markComplete, refresh,
  };
}
