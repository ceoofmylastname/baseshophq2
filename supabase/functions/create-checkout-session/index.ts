/**
 * Supabase Edge Function: create-checkout-session (Phase 17 PR 2)
 *
 * verify_jwt = true. Caller must be a tenant owner. Creates a Stripe
 * Checkout Session for the caller's tenant on the requested tier (with
 * optional white-label add-on) and returns the session URL.
 *
 * Hard rules from the locked checkpoint S-1:
 *   - Enterprise tier is NOT self-serve. Body sets tier='enterprise' →
 *     400 enterprise_not_self_serve (explicit, not implicit).
 *   - Starter + white-label is rejected at this layer with 400 (also
 *     blocked at the DB layer by the tenants_no_white_label_on_starter
 *     CHECK constraint; we reject early for a cleaner UX).
 *   - The tenant already exists when this function is called — signup runs
 *     first and creates the row at billing_status='active' /
 *     current_plan_tier='starter'. We pass client_reference_id=tenant_id so
 *     the webhook can correlate the resulting subscription back to the row.
 *   - Monthly only; no annual toggle in this PR.
 *
 * Success / cancel URLs go to /billing — that route is shipped in PR 3, so
 * the interim 404 is acceptable.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  CORS_HEADERS,
  getAdminClient,
  getStripeClient,
  getVaultSecret,
  jsonResponse,
} from "../_shared/stripe-client.ts";

type CheckoutBody = {
  tier: "starter" | "growth" | "pro" | "enterprise";
  whiteLabel?: boolean;
  /** Phase 17 PR 3c: 'monthly' (default) or 'annual'. Enterprise must be monthly. */
  interval?: "monthly" | "annual";
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST")     return jsonResponse(405, { ok: false, error: "method not allowed" });

  // ---- Auth: extract caller from JWT, confirm owner ----
  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    return jsonResponse(401, { ok: false, error_code: "no_token", error_message: "missing bearer token" });
  }

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

  const { data: { user: caller }, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !caller) {
    return jsonResponse(401, { ok: false, error_code: "invalid_token", error_message: "could not resolve caller" });
  }

  const { data: callerAgent, error: callerErr } = await admin
    .from("agents")
    .select("is_owner, tenant_id")
    .eq("id", caller.id)
    .maybeSingle();
  if (callerErr) {
    return jsonResponse(500, { ok: false, error_code: "caller_lookup_failed", error_message: callerErr.message });
  }
  if (!callerAgent) {
    return jsonResponse(403, { ok: false, error_code: "caller_no_agent_record", error_message: "your account is not linked to a tenant" });
  }
  if (!callerAgent.is_owner) {
    return jsonResponse(403, { ok: false, error_code: "caller_not_owner", error_message: "only the tenant owner can start checkout" });
  }

  const tenantId = callerAgent.tenant_id;

  // ---- Parse + validate body ----
  let body: CheckoutBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { ok: false, error_code: "validation_failed", error_message: "invalid JSON body" });
  }

  if (!body.tier || !["starter","growth","pro","enterprise"].includes(body.tier)) {
    return jsonResponse(400, { ok: false, error_code: "validation_failed", error_message: "tier must be one of starter|growth|pro|enterprise" });
  }

  // Locked decision #4: Enterprise is sales-led. Reject explicitly.
  if (body.tier === "enterprise") {
    return jsonResponse(400, {
      ok: false,
      error_code: "enterprise_not_self_serve",
      error_message: "Enterprise plans are sales-led. Contact sales to provision an Enterprise subscription.",
    });
  }

  const whiteLabel = body.whiteLabel === true;

  // Starter cannot have white-label (DB CHECK enforces this too, but we
  // reject at the API boundary for clearer UX).
  if (body.tier === "starter" && whiteLabel) {
    return jsonResponse(400, {
      ok: false,
      error_code: "starter_white_label_combination",
      error_message: "white-label add-on is not available on the Starter tier",
    });
  }

  // Phase 17 PR 3c: validate optional interval. Enterprise has no annual variant.
  const interval: "monthly" | "annual" = body.interval === "annual" ? "annual" : "monthly";
  if (interval === "annual" && body.tier === "enterprise") {
    return jsonResponse(400, {
      ok: false,
      error_code: "enterprise_annual_not_supported",
      error_message: "Enterprise is not available on the annual interval",
    });
  }

  // ---- Load tenant + ensure we have a Stripe customer ----
  const { data: tenantRow, error: tenantErr } = await admin
    .from("tenants")
    .select("id, name, slug, stripe_customer_id")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantErr) {
    return jsonResponse(500, { ok: false, error_code: "tenant_lookup_failed", error_message: tenantErr.message });
  }
  if (!tenantRow) {
    return jsonResponse(404, { ok: false, error_code: "tenant_not_found", error_message: "tenant row not found for caller" });
  }

  // ---- Resolve price IDs from Vault ----
  // PR 3c: pick monthly vs annual variant by `interval`. Enterprise has no
  // annual variant (rejected earlier); Starter/Growth/Pro use the `_annual`
  // suffix on the Vault key.
  let priceBase: string | null;
  let priceWhiteLabel: string | null;
  try {
    if (body.tier === "starter") {
      priceBase = interval === "annual"
        ? await getVaultSecret(admin, "stripe_price_starter_annual")
        : await getVaultSecret(admin, "stripe_price_starter");
    } else if (body.tier === "growth") {
      priceBase = interval === "annual"
        ? await getVaultSecret(admin, "stripe_price_growth_annual")
        : await getVaultSecret(admin, "stripe_price_growth");
    } else {
      // pro
      priceBase = interval === "annual"
        ? await getVaultSecret(admin, "stripe_price_pro_annual")
        : await getVaultSecret(admin, "stripe_price_pro");
    }
    priceWhiteLabel = whiteLabel
      ? (interval === "annual"
          ? await getVaultSecret(admin, "stripe_price_white_label_addon_annual")
          : await getVaultSecret(admin, "stripe_price_white_label_addon"))
      : null;
  } catch (e) {
    return jsonResponse(500, {
      ok: false,
      error_code: "vault_read_failed",
      error_message: e instanceof Error ? e.message : String(e),
    });
  }

  if (!priceBase) {
    return jsonResponse(500, {
      ok: false,
      error_code: "price_id_missing",
      error_message: `Vault entry stripe_price_${body.tier} is not set`,
    });
  }
  if (whiteLabel && !priceWhiteLabel) {
    return jsonResponse(500, {
      ok: false,
      error_code: "price_id_missing",
      error_message: "Vault entry stripe_price_white_label_addon is not set",
    });
  }

  // ---- Initialize Stripe ----
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

  // ---- Reuse or create the Stripe customer ----
  let customerId = tenantRow.stripe_customer_id as string | null;
  if (!customerId) {
    try {
      const customer = await stripe.customers.create({
        email: caller.email ?? undefined,
        name: tenantRow.name ?? undefined,
        metadata: {
          tenant_id: tenantId,
          tenant_slug: tenantRow.slug ?? "",
        },
      });
      customerId = customer.id;

      const { error: updErr } = await admin
        .from("tenants")
        .update({ stripe_customer_id: customerId })
        .eq("id", tenantId);
      if (updErr) {
        // Continue — the customer exists in Stripe, but our local row didn't
        // get the back-reference. The webhook (checkout.session.completed)
        // will re-attempt this write with the same value.
        console.error("tenants.stripe_customer_id update failed:", updErr.message);
      }
    } catch (e) {
      return jsonResponse(500, {
        ok: false,
        error_code: "stripe_customer_create_failed",
        error_message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ---- Build the checkout session ----
  const lineItems: Array<{ price: string; quantity: number }> = [
    { price: priceBase, quantity: 1 },
  ];
  if (whiteLabel && priceWhiteLabel) {
    lineItems.push({ price: priceWhiteLabel, quantity: 1 });
  }

  const siteUrl = Deno.env.get("PUBLIC_SITE_URL") ?? "https://baseshophq.com";
  const successUrl = `${siteUrl}/billing?status=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl  = `${siteUrl}/billing?status=cancelled`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId!,
      client_reference_id: tenantId,
      line_items: lineItems,
      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: {
        metadata: {
          tenant_id: tenantId,
          tier: body.tier,
          white_label: whiteLabel ? "true" : "false",
          interval,
        },
      },
      metadata: {
        tenant_id: tenantId,
        tier: body.tier,
        white_label: whiteLabel ? "true" : "false",
        interval,
      },
    });

    return jsonResponse(200, {
      ok: true,
      session_id: session.id,
      url: session.url,
    });
  } catch (e) {
    return jsonResponse(500, {
      ok: false,
      error_code: "stripe_checkout_create_failed",
      error_message: e instanceof Error ? e.message : String(e),
    });
  }
});
