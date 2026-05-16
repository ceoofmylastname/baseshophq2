/**
 * Supabase Edge Function: signup-checkout (Phase 18 PR 2)
 *
 * verify_jwt = false. Public, unauthenticated endpoint that creates a Stripe
 * Checkout Session for a brand-new self-serve signup. The actual tenant /
 * agency / agent provisioning happens later via the stripe-webhook
 * (deferred to PR 3).
 *
 * Body shape (validated by the handler):
 *   { tier, interval, whiteLabel, agencyName, ownerEmail, ownerFirstName,
 *     ownerLastName, timeZone, slugHint? }
 *
 * Error codes (6):
 *   - validation_failed
 *   - enterprise_not_self_serve
 *   - starter_white_label_combination
 *   - email_already_registered
 *   - stripe_init_failed
 *   - stripe_call_failed
 *
 * The actual handler lives in _shared/signup-checkout-handler.ts so it can
 * be unit-tested without the Deno runtime; this file is the thin Deno-only
 * wrapper that injects the real admin + stripe clients + Vault catalog.
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
  handleSignupCheckoutRequest,
  type SignupCheckoutAdminLike,
  type SignupCheckoutBody,
  type SignupCheckoutPriceCatalog,
  type SignupCheckoutStripeLike,
} from "../_shared/signup-checkout-handler.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse(405, { ok: false, error: "method not allowed" });

  let admin;
  try {
    admin = getAdminClient();
  } catch (e) {
    return jsonResponse(500, {
      ok: false,
      error_code: "stripe_init_failed",
      error_message: e instanceof Error ? e.message : String(e),
    });
  }

  // Catalog is required regardless of whether Stripe init succeeds — the
  // handler picks the price IDs from it.
  let catalog: SignupCheckoutPriceCatalog;
  try {
    const full = await loadPriceIdCatalog(admin);
    catalog = {
      starter: full.starter,
      growth: full.growth,
      pro: full.pro,
      starter_annual: full.starter_annual,
      growth_annual: full.growth_annual,
      pro_annual: full.pro_annual,
      white_label_addon: full.white_label_addon,
      white_label_addon_annual: full.white_label_addon_annual,
    };
  } catch (e) {
    return jsonResponse(500, {
      ok: false,
      error_code: "stripe_init_failed",
      error_message: e instanceof Error ? e.message : String(e),
    });
  }

  // Stripe init is allowed to fail without aborting; the handler returns
  // stripe_init_failed when `stripe` is null. We construct the client up-front
  // so the handler doesn't have to know about the Vault.
  let stripe: SignupCheckoutStripeLike | null = null;
  try {
    stripe = (await getStripeClient()) as unknown as SignupCheckoutStripeLike;
  } catch {
    stripe = null;
  }

  let body: SignupCheckoutBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, {
      ok: false,
      error_code: "validation_failed",
      error_message: "invalid JSON body",
    });
  }

  const publicSiteUrl = Deno.env.get("PUBLIC_SITE_URL") ?? "https://baseshophq.com";

  const result = await handleSignupCheckoutRequest({
    admin: admin as unknown as SignupCheckoutAdminLike,
    stripe,
    catalog,
    publicSiteUrl,
    body,
  });

  return jsonResponse(result.status, result.body as unknown as Record<string, unknown>);
});
