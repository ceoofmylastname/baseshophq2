/**
 * Supabase Edge Function: billing-mutate (Phase 17 PR 3c)
 *
 * verify_jwt = true (by convention; the handler re-validates the JWT
 * explicitly to short-circuit with structured error codes rather than 401
 * from the runtime). Caller must be a tenant owner.
 *
 * Handles three actions:
 *   POST { action: 'change_tier',        tier: <Tier> }
 *   POST { action: 'toggle_white_label', active: boolean }
 *   POST { action: 'change_interval',    interval: <BillingInterval> }
 *
 * Preview mode (dry-run for proration math):
 *   POST { preview: true, action: ..., ... }
 *   returns { ok: true, preview: { amount_due, prorated_credit, ... } }
 *   Does NOT call stripe.subscriptions.update.
 *
 * The actual handler lives in _shared/billing-mutate-handler.ts so it can
 * be unit-tested without the Edge runtime; this file is the thin Deno-only
 * wrapper.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  CORS_HEADERS,
  getAdminClient,
  getStripeClient,
  jsonResponse,
  loadPriceIdCatalog,
} from "../_shared/stripe-client.ts";
import {
  handleBillingMutateRequest,
  type BillingMutateAdminLike,
  type BillingMutateBody,
  type BillingMutateStripeLike,
} from "../_shared/billing-mutate-handler.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse(405, { ok: false, error: "method not allowed" });

  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  let admin;
  try {
    admin = getAdminClient();
  } catch (e) {
    return jsonResponse(500, {
      ok: false,
      error_code: "env_missing",
      error_message: e instanceof Error ? e.message : String(e),
    });
  }

  let stripe;
  try {
    stripe = await getStripeClient();
  } catch (e) {
    return jsonResponse(500, {
      ok: false,
      error_code: "stripe_init_failed",
      error_message: e instanceof Error ? e.message : String(e),
    });
  }

  let catalog;
  try {
    catalog = await loadPriceIdCatalog(admin);
  } catch (e) {
    return jsonResponse(500, {
      ok: false,
      error_code: "vault_read_failed",
      error_message: e instanceof Error ? e.message : String(e),
    });
  }

  let body: BillingMutateBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, {
      ok: false,
      error_code: "validation_failed",
      error_message: "invalid JSON body",
    });
  }

  const result = await handleBillingMutateRequest({
    admin: admin as unknown as BillingMutateAdminLike,
    stripe: stripe as unknown as BillingMutateStripeLike,
    catalog,
    accessToken,
    body,
  });
  return jsonResponse(result.status, result.body as Record<string, unknown>);
});
