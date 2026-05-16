/**
 * Single-source-of-truth error codes for billing-mutate (Phase 17 PR 3c).
 *
 * Imported by:
 *   - supabase/functions/_shared/billing-mutate-handler.ts (the handler)
 *   - src/hooks/useBillingMutate.ts (the UI toast switch)
 *
 * Zero Deno or npm imports so both layers can pull this in directly.
 *
 * Convention: snake_case strings; one code per disjoint failure mode. The
 * UI maps each code to a user-facing toast string; unknown codes fall back
 * to a generic "Could not update billing" toast.
 */

export const MUTATION_ERROR_CODES = {
  validation_failed: "validation_failed",
  enterprise_not_self_serve: "enterprise_not_self_serve",
  enterprise_annual_not_supported: "enterprise_annual_not_supported",
  starter_white_label_combination: "starter_white_label_combination",
  same_target_as_current: "same_target_as_current",
  stripe_card_declined: "stripe_card_declined",
  stripe_invalid_request: "stripe_invalid_request",
  stripe_api_error: "stripe_api_error",
  stripe_network_error: "stripe_network_error",
} as const;

export type MutationErrorCode = keyof typeof MUTATION_ERROR_CODES;
