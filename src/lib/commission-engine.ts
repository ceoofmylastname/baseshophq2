/**
 * Commission engine TS wrapper around the Phase 4a SQL RPC.
 *
 * The actual math + writes happen inside `recalculate_policy_payouts` in
 * Postgres (atomic transaction, single roundtrip). This module exists so
 * application code can invoke the engine with typed inputs / outputs instead
 * of `supabase.rpc("recalculate_policy_payouts", ...)`.
 *
 * The pure spread calculator (`commission-spread-calculator.ts`) mirrors the
 * SQL math for unit-testing and for client-side preview features. The SQL RPC
 * is the canonical writer.
 *
 * Service-role only — same protocol as templating wrappers in Phase 3a.
 */

import type { SupabaseLikeClient } from "./comp-grid-templating.ts";

// -----------------------------------------------------------------------------
// Types matching the JSONB return shape of recalculate_policy_payouts
// -----------------------------------------------------------------------------

export type PayoutRecord = {
  agent_id: string;
  position_id: string | null;
  rate: number;
  spread: number;
  amount: number;
  schedule_code: string | null;
  is_override: boolean;
};

export type EngineError = {
  code:
    | "no_writing_agent"
    | "no_product_id"
    | "no_application_date"
    | "invalid_annual_premium";
};

export type RecalculatePayoutsResult = {
  policy_id: string;
  writing_agent_payout?: PayoutRecord;
  upline_payouts?: PayoutRecord[];
  total_paid?: number;
  chain_length?: number;
  errors: EngineError[];
};

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export type CalculateAndSavePayoutsInput = {
  policyId: string;
  supabaseAdminClient: SupabaseLikeClient;
};

/**
 * Wraps the `recalculate_policy_payouts` RPC. The RPC reads the policy, walks
 * the upline chain via agents.upline_agent_id, resolves each link's rate at
 * the policy's application_date (sums Lincoln Bonus when applicable), and
 * UPSERTs payout rows into policy_commissions.
 *
 * Returns a structured result. `errors` is non-empty when validation fails;
 * `writing_agent_payout` and `upline_payouts` are undefined in that case.
 *
 * Idempotent — re-running on the same policy produces the same payouts and
 * updates `recalculated_at`.
 */
export async function calculateAndSavePayouts(
  input: CalculateAndSavePayoutsInput,
): Promise<RecalculatePayoutsResult> {
  const { data, error } = await input.supabaseAdminClient.rpc(
    "recalculate_policy_payouts",
    { p_policy_id: input.policyId },
  );
  if (error) {
    throw new Error(`recalculate_policy_payouts RPC failed: ${error.message}`);
  }
  return data as RecalculatePayoutsResult;
}
