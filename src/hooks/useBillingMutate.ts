import { useCallback, useState } from "react";
import { toast } from "sonner";
import { supabase, SUPABASE_FUNCTIONS_URL } from "@/lib/supabase-browser";
import { MUTATION_ERROR_CODES } from "../../supabase/functions/_shared/mutation-error-codes";
import type { BillingInterval, PlanTier } from "@/lib/billing/helpers";

/**
 * Wraps the billing-mutate Edge Function (Phase 17 PR 3c). Owner-only.
 *
 * Four actions:
 *   - changeTier(targetTier)
 *   - toggleWhiteLabel(active)
 *   - changeInterval(interval)
 *   - previewChange(body) — dry-run; returns the proration block without mutating
 *
 * On success: refresh the billing page (caller wires via state.refresh).
 * On failure: surfaces the structured error_code via a sonner toast.
 *
 * The mutation-error-codes module is imported across the Edge/UI seam so the
 * toast switch has a typed-union of every possible error code. Unknown codes
 * fall back to a generic toast.
 */

type PreviewBlock = {
  amount_due: number;
  currency: string;
  prorated_credit: number;
  prorated_charge: number;
  next_invoice_total: number;
  period_start: number;
  period_end: number;
};

type MutateBody =
  | { action: "change_tier"; tier: PlanTier }
  | { action: "toggle_white_label"; active: boolean }
  | { action: "change_interval"; interval: BillingInterval };

/**
 * Map a structured error code to a user-facing toast string. Keeps the
 * Edge handler's error vocabulary and the UI in lock-step.
 */
function toastForErrorCode(code: string | undefined, fallback: string): string {
  switch (code) {
    case MUTATION_ERROR_CODES.validation_failed:
      return "Invalid request.";
    case MUTATION_ERROR_CODES.enterprise_not_self_serve:
      return "Enterprise plans are sales-led. Contact sales.";
    case MUTATION_ERROR_CODES.enterprise_annual_not_supported:
      return "Enterprise is not available on the annual interval.";
    case MUTATION_ERROR_CODES.starter_white_label_combination:
      return "White-label is not available on Starter.";
    case MUTATION_ERROR_CODES.same_target_as_current:
      return "You're already on that plan.";
    case MUTATION_ERROR_CODES.stripe_card_declined:
      return "Card declined. Update your payment method in the Stripe portal.";
    case MUTATION_ERROR_CODES.stripe_invalid_request:
      return "Stripe rejected the request. Please try again.";
    case MUTATION_ERROR_CODES.stripe_network_error:
      return "Network error reaching Stripe. Try again in a moment.";
    case MUTATION_ERROR_CODES.stripe_api_error:
      return "Stripe API error. Try again or contact support.";
    case "no_active_subscription":
      return "No active subscription to change. Subscribe first.";
    case "no_stripe_customer":
      return "No Stripe customer on file yet.";
    default:
      return fallback;
  }
}

async function postMutate(body: MutateBody & { preview?: boolean }): Promise<
  | { ok: true; applied?: "immediate" | "scheduled"; preview?: PreviewBlock }
  | { ok: false; error_code?: string; error_message?: string }
> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return { ok: false, error_code: "invalid_token", error_message: "not signed in" };
  }
  const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/billing-mutate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return json;
}

export function useBillingMutate(onSuccess?: () => void) {
  const [mutating, setMutating] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewBlock | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runMutation = useCallback(async (body: MutateBody) => {
    setMutating(true);
    setError(null);
    try {
      const json = await postMutate(body);
      if (!json.ok) {
        const code = json.error_code ?? "unknown";
        toast.error(toastForErrorCode(code, "Could not update billing."));
        setError(code);
        return false;
      }
      if (json.applied === "scheduled") {
        toast.success("Change scheduled. Takes effect at the next billing period.");
      } else {
        toast.success("Billing updated.");
      }
      onSuccess?.();
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Network error: ${msg}`);
      setError(msg);
      return false;
    } finally {
      setMutating(false);
    }
  }, [onSuccess]);

  const changeTier = useCallback(
    (tier: PlanTier) => runMutation({ action: "change_tier", tier }),
    [runMutation],
  );
  const toggleWhiteLabel = useCallback(
    (active: boolean) => runMutation({ action: "toggle_white_label", active }),
    [runMutation],
  );
  const changeInterval = useCallback(
    (interval: BillingInterval) => runMutation({ action: "change_interval", interval }),
    [runMutation],
  );

  const previewChange = useCallback(async (body: MutateBody) => {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const json = await postMutate({ ...body, preview: true });
      if (!json.ok) {
        const code = json.error_code ?? "unknown";
        // For preview failures we set error but do not toast (the drawer
        // surfaces the message inline).
        setError(code);
        setPreview(null);
        return null;
      }
      const p = json.preview ?? null;
      setPreview(p);
      setError(null);
      return p;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return null;
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const resetPreview = useCallback(() => {
    setPreview(null);
    setError(null);
  }, []);

  return {
    changeTier,
    toggleWhiteLabel,
    changeInterval,
    previewChange,
    resetPreview,
    mutating,
    preview,
    previewLoading,
    error,
  };
}
