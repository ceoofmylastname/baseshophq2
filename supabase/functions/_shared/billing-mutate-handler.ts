/**
 * Extracted handler for the billing-mutate Edge Function (Phase 17 PR 3c).
 *
 * Lives under _shared/ with zero Deno-specific imports so tests/ can import
 * it under bun's tsconfig. The Deno entrypoint
 * (supabase/functions/billing-mutate/index.ts) wires the real admin + stripe
 * clients into this pure function.
 *
 * Dispatch:
 *   POST { action: 'change_tier',         tier: <Tier> }
 *   POST { action: 'toggle_white_label',  active: boolean }
 *   POST { action: 'change_interval',     interval: <BillingInterval> }
 *   POST { preview: true, action: ..., ... }   -> dry-run, returns proration breakdown
 *
 * Pattern: same authz + caller-resolution as billing-portal-handler.ts.
 *
 * Subscription Schedules for deferred downgrades:
 *   Stripe pattern: create a schedule from the existing subscription, then
 *   update it with two phases — phase 1 carries the current items until
 *   period end, phase 2 carries the new items starting at period end.
 *     stripe.subscriptionSchedules.create({ from_subscription: <sub_id> })
 *     stripe.subscriptionSchedules.update(sched.id, { phases: [<phase1>, <phase2>] })
 *   On phase 2 start the webhook re-resolves tier + interval and updates the
 *   tenants row.
 *
 * Error classes (S-1 §7):
 *   - validation: 400 with one of MUTATION_ERROR_CODES.validation_failed,
 *     enterprise_not_self_serve, enterprise_annual_not_supported,
 *     starter_white_label_combination, same_target_as_current.
 *   - stripe API: 502 with stripe_card_declined / stripe_invalid_request /
 *     stripe_api_error / stripe_network_error.
 *   - infra: 401 / 403 / 500 unchanged from billing-portal precedent.
 */

import {
  buildChangeIntervalUpdate,
  buildChangeTierUpdate,
  buildPreviewParams,
  buildScheduledPhaseItems,
  buildToggleWhiteLabelUpdate,
  classifyChange,
  findCurrentItems,
  resolveBasePriceId,
  resolveWhiteLabelPriceId,
  type BillingInterval,
  type CurrentItem,
  type CurrentStateSnapshot,
  type PriceCatalog,
  type SubscriptionItemPatch,
  type Tier,
} from "./billing-mutate-actions.ts";
import { MUTATION_ERROR_CODES } from "./mutation-error-codes.ts";

// ---------------------------------------------------------------------------
// Admin + Stripe surfaces (mockable)
// ---------------------------------------------------------------------------

export type BillingMutateAdminLike = {
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
  };
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

export type BillingMutateStripeLike = {
  subscriptions: {
    retrieve: (id: string) => Promise<{
      id: string;
      customer: string;
      items: {
        data: Array<{ id: string; price: { id: string }; quantity?: number }>;
      };
      current_period_end?: number;
    }>;
    update: (
      id: string,
      params: {
        items?: SubscriptionItemPatch[];
        proration_behavior?: string;
        billing_cycle_anchor?: string;
      },
    ) => Promise<{ id: string }>;
  };
  subscriptionSchedules: {
    create: (params: { from_subscription: string }) => Promise<{ id: string; phases: unknown[] }>;
    update: (
      id: string,
      params: {
        phases: Array<{
          items: Array<{ price: string; quantity: number }>;
          start_date?: number | "now";
          end_date?: number | "now";
        }>;
      },
    ) => Promise<{ id: string }>;
  };
  invoices: {
    retrieveUpcoming: (params: {
      customer: string;
      subscription: string;
      subscription_items: SubscriptionItemPatch[];
      subscription_proration_behavior?: string;
    }) => Promise<{
      amount_due: number;
      currency: string;
      lines: { data: Array<{ amount: number; proration: boolean }> };
      period_start: number;
      period_end: number;
      total: number;
    }>;
  };
};

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type BillingMutateResult =
  | { status: 200; body: { ok: true; applied?: "immediate" | "scheduled"; preview?: PreviewBlock } }
  | {
      status: 400 | 401 | 403 | 500 | 502;
      body: { ok: false; error_code: string; error_message: string };
    };

export type PreviewBlock = {
  amount_due: number;
  currency: string;
  prorated_credit: number;
  prorated_charge: number;
  next_invoice_total: number;
  period_start: number;
  period_end: number;
};

// ---------------------------------------------------------------------------
// Body shape
// ---------------------------------------------------------------------------

export type BillingMutateBody =
  | { action: "change_tier";         tier: Tier;                    preview?: boolean }
  | { action: "toggle_white_label";  active: boolean;               preview?: boolean }
  | { action: "change_interval";     interval: BillingInterval;     preview?: boolean };

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

export async function handleBillingMutateRequest(args: {
  admin: BillingMutateAdminLike;
  stripe: BillingMutateStripeLike;
  catalog: PriceCatalog;
  accessToken: string;
  body: BillingMutateBody;
}): Promise<BillingMutateResult> {
  const { admin, stripe, catalog, accessToken, body } = args;

  // ---- Auth ----
  if (!accessToken) {
    return { status: 401, body: { ok: false, error_code: "invalid_token", error_message: "missing bearer token" } };
  }
  const { data: { user: caller }, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !caller) {
    return { status: 401, body: { ok: false, error_code: "invalid_token", error_message: "could not resolve caller" } };
  }

  const { data: callerAgent, error: callerErr } = await admin
    .from("agents")
    .select("is_owner, tenant_id")
    .eq("id", caller.id)
    .maybeSingle();
  if (callerErr) {
    return { status: 500, body: { ok: false, error_code: "caller_lookup_failed", error_message: callerErr.message } };
  }
  if (!callerAgent) {
    return { status: 403, body: { ok: false, error_code: "caller_no_agent_record", error_message: "your account is not linked to a tenant" } };
  }
  if (callerAgent.is_owner !== true) {
    return { status: 403, body: { ok: false, error_code: "caller_not_owner", error_message: "only the tenant owner can change billing" } };
  }
  const tenantId = callerAgent.tenant_id as string;

  // ---- Tenant lookup ----
  const { data: tenantRow, error: tenantErr } = await admin
    .from("tenants")
    .select("id, stripe_customer_id, stripe_subscription_id, current_plan_tier, white_label_addon_active, billing_interval")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantErr) {
    return { status: 500, body: { ok: false, error_code: "tenant_lookup_failed", error_message: tenantErr.message } };
  }
  if (!tenantRow) {
    return { status: 500, body: { ok: false, error_code: "tenant_not_found", error_message: "tenant row not found for caller" } };
  }
  const customerId = tenantRow.stripe_customer_id as string | null;
  const subscriptionId = tenantRow.stripe_subscription_id as string | null;
  if (!customerId || !subscriptionId) {
    return { status: 400, body: { ok: false, error_code: "no_active_subscription", error_message: "this tenant has no active Stripe subscription to mutate" } };
  }

  // ---- Compute targets + current snapshot ----
  let targetTier: Tier;
  let targetInterval: BillingInterval;
  let targetWhiteLabel: boolean;

  const currentTier = tenantRow.current_plan_tier as Tier;
  const currentInterval = (tenantRow.billing_interval ?? "monthly") as BillingInterval;
  const currentWhiteLabel = tenantRow.white_label_addon_active === true;

  if (body.action === "change_tier") {
    if (!body.tier || !["starter","growth","pro","enterprise"].includes(body.tier)) {
      return { status: 400, body: { ok: false, error_code: MUTATION_ERROR_CODES.validation_failed, error_message: "tier must be one of starter|growth|pro|enterprise" } };
    }
    if (body.tier === "enterprise") {
      return { status: 400, body: { ok: false, error_code: MUTATION_ERROR_CODES.enterprise_not_self_serve, error_message: "Enterprise plans are sales-led. Contact sales to provision an Enterprise subscription." } };
    }
    targetTier = body.tier;
    targetInterval = currentInterval;
    targetWhiteLabel = currentWhiteLabel;
  } else if (body.action === "toggle_white_label") {
    if (typeof body.active !== "boolean") {
      return { status: 400, body: { ok: false, error_code: MUTATION_ERROR_CODES.validation_failed, error_message: "active must be boolean" } };
    }
    targetTier = currentTier;
    targetInterval = currentInterval;
    targetWhiteLabel = body.active;
  } else if (body.action === "change_interval") {
    if (body.interval !== "monthly" && body.interval !== "annual") {
      return { status: 400, body: { ok: false, error_code: MUTATION_ERROR_CODES.validation_failed, error_message: "interval must be monthly|annual" } };
    }
    targetTier = currentTier;
    targetInterval = body.interval;
    targetWhiteLabel = currentWhiteLabel;
  } else {
    return { status: 400, body: { ok: false, error_code: MUTATION_ERROR_CODES.validation_failed, error_message: "unknown action" } };
  }

  // Cross-cutting validation
  if (targetTier === "starter" && targetWhiteLabel) {
    return { status: 400, body: { ok: false, error_code: MUTATION_ERROR_CODES.starter_white_label_combination, error_message: "white-label add-on is not available on the Starter tier" } };
  }
  if (targetTier === "enterprise" && targetInterval === "annual") {
    return { status: 400, body: { ok: false, error_code: MUTATION_ERROR_CODES.enterprise_annual_not_supported, error_message: "Enterprise is not available on the annual interval" } };
  }

  // Same-target fail-fast (decision §7)
  if (
    targetTier === currentTier &&
    targetInterval === currentInterval &&
    targetWhiteLabel === currentWhiteLabel
  ) {
    return { status: 400, body: { ok: false, error_code: MUTATION_ERROR_CODES.same_target_as_current, error_message: "the requested change matches the current state" } };
  }

  // ---- Retrieve current subscription state from Stripe ----
  let stripeSub;
  try {
    stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (e) {
    return classifyStripeError(e);
  }
  const currentItems: CurrentItem[] = (stripeSub.items?.data ?? []).map((i) => ({
    id: i.id,
    price_id: i.price.id,
    quantity: i.quantity ?? 1,
  }));
  const currentSnapshot: CurrentStateSnapshot = {
    tier: currentTier,
    interval: currentInterval,
    whiteLabel: currentWhiteLabel,
    items: currentItems,
  };

  // ---- Build the items patch via the appropriate pure builder ----
  let updateParams;
  try {
    if (body.action === "change_tier") {
      updateParams = buildChangeTierUpdate({ current: currentSnapshot, targetTier, catalog });
    } else if (body.action === "toggle_white_label") {
      updateParams = buildToggleWhiteLabelUpdate({ current: currentSnapshot, targetWhiteLabel, catalog });
    } else {
      updateParams = buildChangeIntervalUpdate({ current: currentSnapshot, targetInterval, catalog });
    }
  } catch (e) {
    return { status: 500, body: { ok: false, error_code: "price_id_missing", error_message: e instanceof Error ? e.message : String(e) } };
  }

  // ---- Preview path: dry-run via invoices.retrieveUpcoming ----
  if (body.preview === true) {
    const previewParams = buildPreviewParams({
      customerId,
      subscriptionId,
      itemsPatch: updateParams.items,
      proration: updateParams.proration_behavior,
    });
    let upcoming;
    try {
      upcoming = await stripe.invoices.retrieveUpcoming(previewParams);
    } catch (e) {
      return classifyStripeError(e);
    }
    let proratedCredit = 0;
    let proratedCharge = 0;
    for (const line of upcoming.lines.data) {
      if (line.proration) {
        if (line.amount < 0) proratedCredit += line.amount;
        else proratedCharge += line.amount;
      }
    }
    return {
      status: 200,
      body: {
        ok: true,
        preview: {
          amount_due: upcoming.amount_due,
          currency: upcoming.currency,
          prorated_credit: proratedCredit,
          prorated_charge: proratedCharge,
          next_invoice_total: upcoming.total,
          period_start: upcoming.period_start,
          period_end: upcoming.period_end,
        },
      },
    };
  }

  // ---- Apply: immediate vs schedule based on classifyChange ----
  const kind = classifyChange({
    current: { tier: currentTier, interval: currentInterval, whiteLabel: currentWhiteLabel },
    target: { tier: targetTier, interval: targetInterval, whiteLabel: targetWhiteLabel },
  });

  if (kind === "downgrade") {
    // Schedule path: create from_subscription + update with 2 phases.
    let sched;
    try {
      sched = await stripe.subscriptionSchedules.create({ from_subscription: subscriptionId });
    } catch (e) {
      return classifyStripeError(e);
    }
    const periodEnd = stripeSub.current_period_end ?? 0;
    if (!periodEnd) {
      return { status: 500, body: { ok: false, error_code: "missing_period_end", error_message: "subscription has no current_period_end; cannot schedule deferred change" } };
    }

    // Phase 1 = current items, continued until period_end
    const phase1Items = buildScheduledPhaseItems({
      target: { tier: currentTier, interval: currentInterval, whiteLabel: currentWhiteLabel },
      catalog,
    });
    // Phase 2 = target items, starting at period_end
    const phase2Items = buildScheduledPhaseItems({
      target: { tier: targetTier, interval: targetInterval, whiteLabel: targetWhiteLabel },
      catalog,
    });

    try {
      await stripe.subscriptionSchedules.update(sched.id, {
        phases: [
          { items: phase1Items, end_date: periodEnd },
          { items: phase2Items, start_date: periodEnd },
        ],
      });
    } catch (e) {
      return classifyStripeError(e);
    }
    return { status: 200, body: { ok: true, applied: "scheduled" } };
  }

  // Upgrade / lateral → immediate update
  try {
    await stripe.subscriptions.update(subscriptionId, {
      items: updateParams.items,
      proration_behavior: updateParams.proration_behavior,
      ...(updateParams.billing_cycle_anchor
        ? { billing_cycle_anchor: updateParams.billing_cycle_anchor }
        : {}),
    });
  } catch (e) {
    return classifyStripeError(e);
  }
  return { status: 200, body: { ok: true, applied: "immediate" } };
}

// ---------------------------------------------------------------------------
// Stripe error classification
// ---------------------------------------------------------------------------

/**
 * Map a Stripe SDK error into the 4-code stripe error class. Falls back to
 * stripe_api_error on unknown shapes so the UI still gets a structured code.
 */
function classifyStripeError(e: unknown): BillingMutateResult {
  // Stripe errors expose `type` and `code` per
  // https://stripe.com/docs/api/errors. We touch them defensively.
  const err = e as { type?: string; code?: string; message?: string };
  const message = err.message ?? (e instanceof Error ? e.message : String(e));

  if (err.type === "StripeCardError" || err.code === "card_declined") {
    return { status: 502, body: { ok: false, error_code: MUTATION_ERROR_CODES.stripe_card_declined, error_message: message } };
  }
  if (err.type === "StripeInvalidRequestError") {
    return { status: 502, body: { ok: false, error_code: MUTATION_ERROR_CODES.stripe_invalid_request, error_message: message } };
  }
  if (err.type === "StripeConnectionError" || err.type === "StripeAPIError") {
    return { status: 502, body: { ok: false, error_code: MUTATION_ERROR_CODES.stripe_network_error, error_message: message } };
  }
  return { status: 502, body: { ok: false, error_code: MUTATION_ERROR_CODES.stripe_api_error, error_message: message } };
}

// Re-export for handler-side imports.
export { MUTATION_ERROR_CODES };

// Silence unused-warning when bundle slimming. The imports above are referenced
// in JSDoc / type assertions but TS treats them as used directly.
void findCurrentItems;
void resolveBasePriceId;
void resolveWhiteLabelPriceId;
