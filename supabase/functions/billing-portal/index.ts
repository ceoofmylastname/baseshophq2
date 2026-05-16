/**
 * Supabase Edge Function: billing-portal (Phase 17 PR 3b)
 *
 * verify_jwt = true (by convention; the handler re-validates the JWT
 * explicitly to short-circuit with structured error codes rather than 401
 * from the runtime). Caller must be a tenant owner.
 *
 * Returns a Stripe Customer Billing Portal session URL. The frontend opens
 * the URL in a new tab via window.open(url, '_blank', 'noopener,noreferrer')
 * so the user lands back on /billing on portal close (via return_url).
 *
 * The actual handler lives in _shared/billing-portal-handler.ts so it can
 * be unit-tested without the Edge runtime; this file is the thin Deno-only
 * wrapper.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  CORS_HEADERS,
  getAdminClient,
  getStripeClient,
  jsonResponse,
} from "../_shared/stripe-client.ts";
import {
  handleBillingPortalRequest,
  type BillingPortalAdminLike,
  type BillingPortalStripeLike,
} from "../_shared/billing-portal-handler.ts";

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

  const siteUrl = Deno.env.get("PUBLIC_SITE_URL") ?? "https://baseshophq.com";
  const returnUrl = `${siteUrl}/billing`;

  const result = await handleBillingPortalRequest({
    admin: admin as unknown as BillingPortalAdminLike,
    stripe: stripe as unknown as BillingPortalStripeLike,
    accessToken,
    returnUrl,
  });
  return jsonResponse(result.status, result.body as Record<string, unknown>);
});
