import { useAuth } from "@/contexts/AuthContext";
import { useAgentRates, type AgentRateRow } from "./useAgentRates";

/**
 * Phase 9 thin wrapper around the existing Phase 6b useAgentRates hook.
 * Pins the agent_id to the currently-authenticated user's id so the realtime
 * subscription self-scopes via auth.uid(). RLS does the rest (agents_select_self
 * + agent_carrier_rates_select_visible).
 */
export function useMyRates() {
  const { currentAgent } = useAuth();
  const { rows, loading, error, refresh } = useAgentRates(currentAgent?.id);
  return { rows, loading, error, refresh };
}

export type { AgentRateRow };
