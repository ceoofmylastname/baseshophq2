import { useState } from "react";
import { supabase } from "@/lib/supabase-browser";

export type OverridesAction = "keep" | "clear" | "review";

export type AssignInput = {
  agentId: string;
  positionId: string;
  startDate: string; // ISO date (YYYY-MM-DD)
  overridesAction: OverridesAction;
  assignedBy?: string | null;
};

export type AssignResult =
  | { ok: true; data: unknown }
  | { ok: false; errorMessage: string };

/**
 * Wraps the existing Phase 3a assign_agent_to_position RPC. UI gates this
 * by isOwner — the RPC itself does not yet enforce owner-only (defense-in-
 * depth gap; flagged for follow-up).
 */
export function useAssignAgentToPosition() {
  const [submitting, setSubmitting] = useState(false);

  async function assign(input: AssignInput): Promise<AssignResult> {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("assign_agent_to_position", {
        p_agent_id: input.agentId,
        p_position_id: input.positionId,
        p_start_date: input.startDate,
        p_assigned_by: input.assignedBy ?? null,
        p_overrides_action: input.overridesAction,
      });
      if (error) return { ok: false, errorMessage: error.message };
      return { ok: true, data };
    } finally {
      setSubmitting(false);
    }
  }

  return { assign, submitting };
}
