/**
 * Supabase Edge Function: stripe-webhook (Phase 17 PR 2)
 *
 * verify_jwt = false. Stripe signs the request; we verify the
 * `stripe-signature` header against the Vault entry
 * `stripe_webhook_signing_secret`.
 *
 * Handles six event types per the locked checkpoint S-1:
 *   - checkout.session.completed
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *   - invoice.paid
 *   - invoice.payment_failed
 *
 * State updates run through the pure helper
 * `mapStripeEventToTenantUpdate` in _shared/state-mapping.ts. Tier + addon
 * resolution from subscription line items runs through
 * `resolveTierFromSubscriptionItems` in _shared/tier-resolver.ts.
 *
 * By-design idempotency:
 *   - We do NOT maintain a stripe_events_seen table.
 *   - All writes are derived from the event payload deterministically; if
 *     Stripe redelivers the same event, the resulting UPDATE is a no-op or
 *     identical. The 3-failure → past_due flip is based on
 *     `invoice.attempt_count`, which is monotonic per invoice, so retries
 *     of the same event do not double-count.
 *
 * Dev-mode signature bypass:
 *   When SUPABASE_URL contains 'localhost' AND
 *   SKIP_SIGNATURE_VERIFICATION === 'true', we accept unsigned bodies. This
 *   lets `supabase functions serve` + a curl `--data-binary @event.json`
 *   work without a real Stripe CLI tunnel. Production never trips this
 *   branch because SUPABASE_URL is the project URL.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type Stripe from "npm:stripe@^17";

import {
  CORS_HEADERS,
  getAdminClient,
  getStripeClient,
  getVaultSecret,
  jsonResponse,
  loadPriceIdCatalog,
} from "../_shared/stripe-client.ts";
import { mapStripeEventToTenantUpdate } from "../_shared/state-mapping.ts";
import { resolveTierFromSubscriptionItems } from "../_shared/tier-resolver.ts";

const HANDLED_EVENTS = new Set<string>([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

function isLocalDev(): boolean {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const skip = Deno.env.get("SKIP_SIGNATURE_VERIFICATION") === "true";
  return skip && (url.includes("localhost") || url.includes("127.0.0.1"));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST")     return jsonResponse(405, { ok: false, error: "method not allowed" });

  let admin;
  try {
    admin = getAdminClient();
  } catch (e) {
    return jsonResponse(500, { ok: false, error_code: "env_missing", error_message: e instanceof Error ? e.message : String(e) });
  }

  let stripe;
  try {
    stripe = await getStripeClient();
  } catch (e) {
    return jsonResponse(500, { ok: false, error_code: "stripe_init_failed", error_message: e instanceof Error ? e.message : String(e) });
  }

  // ---- Read raw body + verify signature ----
  const rawBody = await req.text();
  const sigHeader = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  if (isLocalDev() && !sigHeader) {
    try {
      event = JSON.parse(rawBody) as Stripe.Event;
    } catch (e) {
      return jsonResponse(400, { ok: false, error_code: "invalid_json", error_message: e instanceof Error ? e.message : String(e) });
    }
    console.warn("stripe-webhook: signature verification SKIPPED (local dev)");
  } else {
    if (!sigHeader) {
      return jsonResponse(400, { ok: false, error_code: "missing_signature", error_message: "stripe-signature header is required" });
    }

    let webhookSecret: string | null;
    try {
      webhookSecret = await getVaultSecret(admin, "stripe_webhook_signing_secret");
    } catch (e) {
      return jsonResponse(500, { ok: false, error_code: "vault_read_failed", error_message: e instanceof Error ? e.message : String(e) });
    }
    if (!webhookSecret) {
      return jsonResponse(500, { ok: false, error_code: "webhook_secret_missing", error_message: "stripe_webhook_signing_secret is not set in Vault" });
    }

    try {
      event = await stripe.webhooks.constructEventAsync(rawBody, sigHeader, webhookSecret);
    } catch (e) {
      return jsonResponse(400, { ok: false, error_code: "signature_verification_failed", error_message: e instanceof Error ? e.message : String(e) });
    }
  }

  // ---- Dispatch ----
  if (!HANDLED_EVENTS.has(event.type)) {
    // Acknowledge to keep Stripe's delivery queue happy; we just don't act.
    return jsonResponse(200, { ok: true, ignored: true, event_type: event.type });
  }

  try {
    // Step 1: figure out which tenant the event is about.
    const tenantId = await resolveTenantId(admin, event);
    if (!tenantId) {
      // Nothing to do — log and ack. The most common cause is an event for
      // an unknown subscription/customer (e.g. test data, or a customer
      // created outside this app).
      console.warn(`stripe-webhook: could not resolve tenant for event ${event.id} (${event.type})`);
      return jsonResponse(200, { ok: true, ignored: true, reason: "no_tenant_match", event_type: event.type });
    }

    // Step 2: derive tier + addon from subscription items where applicable.
    const tierPatch = await deriveTierPatch(admin, event);

    // Step 3: derive billing_status / trial fields from the event.
    const statePatch = mapStripeEventToTenantUpdate(extractStateInput(event));

    // Step 4: persist as one UPDATE if we have anything to write.
    const patch = { ...tierPatch, ...statePatch };
    if (Object.keys(patch).length > 0) {
      const { error: updErr } = await admin
        .from("tenants")
        .update(patch)
        .eq("id", tenantId);
      if (updErr) {
        return jsonResponse(500, {
          ok: false,
          error_code: "tenant_update_failed",
          error_message: updErr.message,
          event_type: event.type,
        });
      }
    }

    // Step 5: structured log line — useful for grepping Edge Function logs
    // during an incident. The webhook does not maintain its own table.
    console.log(JSON.stringify({
      msg: "stripe_webhook_processed",
      event_id: event.id,
      event_type: event.type,
      tenant_id: tenantId,
      patch,
    }));

    return jsonResponse(200, { ok: true, event_type: event.type, tenant_id: tenantId, patch });
  } catch (e) {
    return jsonResponse(500, {
      ok: false,
      error_code: "webhook_handler_threw",
      error_message: e instanceof Error ? e.message : String(e),
      event_type: event.type,
    });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find the tenants row this event refers to.
 *
 * Preferred path: event payload metadata.tenant_id (we set this on every
 * Stripe object we create via create-checkout-session).
 *
 * Fallback path: look up by stripe_customer_id from the event's customer
 * field — covers the subscription/invoice events where Stripe doesn't
 * propagate the session metadata.
 */
async function resolveTenantId(
  admin: ReturnType<typeof getAdminClient>,
  event: Stripe.Event,
): Promise<string | null> {
  const obj = event.data.object as Record<string, unknown>;

  // Path 1: client_reference_id on checkout.session (our explicit handle)
  if (typeof obj.client_reference_id === "string" && obj.client_reference_id) {
    return obj.client_reference_id;
  }

  // Path 2: metadata.tenant_id (we set this on subscription + checkout)
  const meta = obj.metadata as Record<string, string> | undefined;
  if (meta && typeof meta.tenant_id === "string" && meta.tenant_id) {
    return meta.tenant_id;
  }

  // Path 3: lookup by stripe_customer_id
  const customer = obj.customer;
  if (typeof customer === "string" && customer) {
    const { data, error } = await admin
      .from("tenants")
      .select("id")
      .eq("stripe_customer_id", customer)
      .maybeSingle();
    if (error) {
      console.error("tenant lookup by customer failed:", error.message);
      return null;
    }
    if (data?.id) return data.id as string;
  }

  // Path 4: lookup by stripe_subscription_id for subscription events
  const subscription = (obj as { subscription?: string }).subscription;
  const subscriptionId = typeof subscription === "string"
    ? subscription
    : (obj as { id?: string }).id;
  if (typeof subscriptionId === "string" && subscriptionId.startsWith("sub_")) {
    const { data } = await admin
      .from("tenants")
      .select("id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }

  return null;
}

/**
 * Extract subscription items from a subscription event and resolve them to a
 * tier + addon patch. Returns {} for non-subscription events.
 */
async function deriveTierPatch(
  admin: ReturnType<typeof getAdminClient>,
  event: Stripe.Event,
): Promise<Partial<{
  current_plan_tier: string;
  white_label_addon_active: boolean;
  stripe_subscription_id: string;
}>> {
  // Only subscription events carry items. checkout.session and invoice
  // events don't.
  if (
    event.type !== "customer.subscription.created" &&
    event.type !== "customer.subscription.updated" &&
    event.type !== "customer.subscription.deleted"
  ) {
    return {};
  }

  const sub = event.data.object as Stripe.Subscription;
  const items = sub.items?.data ?? [];

  const catalog = await loadPriceIdCatalog(admin);
  const resolution = resolveTierFromSubscriptionItems(
    items.map((i: Stripe.SubscriptionItem) => ({
      id: i.id,
      price: { id: i.price.id },
    })),
    catalog,
  );

  if (resolution.errors.length > 0) {
    // Surface the error in logs; do NOT update tier on a malformed
    // subscription — that could clobber legit state. The caller still
    // writes billing_status from statePatch.
    console.error(JSON.stringify({
      msg: "stripe_webhook_tier_resolution_failed",
      event_id: event.id,
      event_type: event.type,
      errors: resolution.errors,
    }));
    return { stripe_subscription_id: sub.id };
  }

  const patch: Partial<{
    current_plan_tier: string;
    white_label_addon_active: boolean;
    stripe_subscription_id: string;
  }> = {
    stripe_subscription_id: sub.id,
  };
  if (resolution.tier) {
    patch.current_plan_tier = resolution.tier;
  }
  patch.white_label_addon_active = resolution.whiteLabel;
  return patch;
}

/**
 * Pull the four fields the pure state-mapper needs out of an event.
 */
function extractStateInput(event: Stripe.Event) {
  const obj = event.data.object as Record<string, unknown>;

  // For subscription events: subscription.status + trial_end live on the obj
  // For invoice events:      invoice.attempt_count lives on the obj
  return {
    eventType: event.type,
    subscriptionStatus: typeof obj.status === "string" ? obj.status : undefined,
    invoiceAttemptCount: typeof obj.attempt_count === "number" ? obj.attempt_count : undefined,
    subscriptionTrialEnd: typeof obj.trial_end === "number" ? obj.trial_end : null,
  };
}
