/**
 * Pure action builders for the billing-mutate Edge Function (Phase 17 PR 3c).
 *
 * Zero Deno or npm imports so tests/billing-mutate-actions.test.ts can pull
 * these in under bun's tsconfig. The Deno handler
 * (billing-mutate-handler.ts) wraps these with auth, dispatch, and the
 * actual Stripe API calls.
 *
 * Pattern mirrors _shared/state-mapping.ts: the function takes a structured
 * input + the current subscription line items, returns a structured patch
 * that the handler hands to stripe.subscriptions.update or to
 * stripe.subscriptionSchedules.update.
 *
 * Subscription Schedules vs. update:
 *   - Upgrades (Starter→Growth, Growth→Pro, white-label add) → immediate
 *     update with proration_behavior='create_prorations'.
 *   - Downgrades (tier or annual→monthly, remove white-label) → schedule
 *     deferred to current_period_end via subscriptionSchedules. The schedule
 *     gets two phases: phase 1 = current items continued until period end,
 *     phase 2 = the new desired items starting at period end.
 *
 * The "is this a downgrade" decision lives here as a pure function
 * (classifyChange) so it is testable.
 */

export type Tier = "starter" | "growth" | "pro" | "enterprise";
export type BillingInterval = "monthly" | "annual";

export type CurrentItem = {
  /** Stripe subscription_item.id */
  id: string;
  /** Stripe price.id */
  price_id: string;
  /** quantity (used for white-label add-on detection — base is always 1) */
  quantity?: number;
};

/**
 * Subset of the PriceIdCatalog this module needs. We import the full type
 * from tier-resolver and re-key it here for documentation clarity.
 */
export type PriceCatalog = {
  starter: string | null;
  growth: string | null;
  pro: string | null;
  enterprise_active_agent_unit: string | null;
  white_label_addon: string | null;
  starter_annual: string | null;
  growth_annual: string | null;
  pro_annual: string | null;
  white_label_addon_annual: string | null;
};

export type CurrentStateSnapshot = {
  tier: Tier;
  interval: BillingInterval;
  whiteLabel: boolean;
  items: CurrentItem[];
};

export type ChangeKind = "upgrade" | "downgrade" | "lateral" | "noop";

export type SubscriptionItemPatch =
  | { id: string; price: string }     // replace existing line item
  | { id: string; deleted: true }      // remove existing line item
  | { price: string; quantity: number }; // add new line item

export type SubscriptionUpdateParams = {
  items: SubscriptionItemPatch[];
  proration_behavior: "create_prorations" | "none";
  /** present only for monthly→annual or annual→monthly (period_end deferral) */
  billing_cycle_anchor?: "now" | "unchanged";
};

export type SchedulePhasePatch = {
  /** items array for stripe.subscriptionSchedules.update phases[].items */
  items: Array<{ price: string; quantity: number }>;
  /** ISO seconds since epoch; the period boundary at which this phase starts */
  start_date?: number | "now";
  /** ISO seconds since epoch; the period boundary at which this phase ends */
  end_date?: number;
};

// ---------------------------------------------------------------------------
// Classification: upgrade vs downgrade
// ---------------------------------------------------------------------------

const TIER_RANK: Record<Tier, number> = {
  starter: 0,
  growth: 1,
  pro: 2,
  enterprise: 3,
};

/**
 * Decide whether the target represents an upgrade, downgrade, lateral, or
 * no-op relative to the current state. Drives the
 * "apply immediately" vs "defer to period end" branch in the handler.
 *
 *   - Tier rank increases → upgrade
 *   - Tier rank decreases → downgrade
 *   - Same tier + interval changes:
 *       monthly → annual : upgrade (more revenue, prorated upfront)
 *       annual → monthly : downgrade (defer to period end)
 *   - Same tier + WL add: upgrade
 *   - Same tier + WL remove: downgrade
 *   - Same tier + same interval + same WL: noop
 */
export function classifyChange(args: {
  current: { tier: Tier; interval: BillingInterval; whiteLabel: boolean };
  target: { tier: Tier; interval: BillingInterval; whiteLabel: boolean };
}): ChangeKind {
  const { current, target } = args;
  if (
    current.tier === target.tier &&
    current.interval === target.interval &&
    current.whiteLabel === target.whiteLabel
  ) {
    return "noop";
  }
  if (current.tier !== target.tier) {
    const c = TIER_RANK[current.tier];
    const t = TIER_RANK[target.tier];
    if (t > c) return "upgrade";
    if (t < c) return "downgrade";
    return "lateral";
  }
  if (current.interval !== target.interval) {
    return current.interval === "monthly" ? "upgrade" : "downgrade";
  }
  // tier + interval unchanged → WL changed
  return target.whiteLabel ? "upgrade" : "downgrade";
}

// ---------------------------------------------------------------------------
// Price-ID resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the base price ID for a (tier, interval) pair. Returns null if the
 * catalog is missing the requested entry — the handler converts that into a
 * 500 price_id_missing.
 *
 * Enterprise is monthly-only by catalog construction; if a caller asks for
 * enterprise+annual we return null and the handler should already have
 * rejected the request via enterprise_annual_not_supported.
 */
export function resolveBasePriceId(
  catalog: PriceCatalog,
  tier: Tier,
  interval: BillingInterval,
): string | null {
  if (tier === "enterprise") {
    return catalog.enterprise_active_agent_unit;
  }
  if (interval === "annual") {
    if (tier === "starter") return catalog.starter_annual;
    if (tier === "growth") return catalog.growth_annual;
    if (tier === "pro") return catalog.pro_annual;
  }
  if (tier === "starter") return catalog.starter;
  if (tier === "growth") return catalog.growth;
  if (tier === "pro") return catalog.pro;
  return null;
}

export function resolveWhiteLabelPriceId(
  catalog: PriceCatalog,
  interval: BillingInterval,
): string | null {
  return interval === "annual"
    ? catalog.white_label_addon_annual
    : catalog.white_label_addon;
}

// ---------------------------------------------------------------------------
// Item-walk helpers
// ---------------------------------------------------------------------------

/**
 * Identify the current base-tier subscription_item and the current
 * white-label subscription_item from the current snapshot. Returns nulls
 * where the matching item is absent.
 */
export function findCurrentItems(
  current: CurrentStateSnapshot,
  catalog: PriceCatalog,
): { baseItemId: string | null; whiteLabelItemId: string | null } {
  const basePriceIds = new Set<string>(
    [
      catalog.starter, catalog.growth, catalog.pro,
      catalog.enterprise_active_agent_unit,
      catalog.starter_annual, catalog.growth_annual, catalog.pro_annual,
    ].filter((p): p is string => !!p),
  );
  const wlPriceIds = new Set<string>(
    [catalog.white_label_addon, catalog.white_label_addon_annual].filter(
      (p): p is string => !!p,
    ),
  );

  let baseItemId: string | null = null;
  let whiteLabelItemId: string | null = null;
  for (const item of current.items) {
    if (basePriceIds.has(item.price_id)) baseItemId = item.id;
    else if (wlPriceIds.has(item.price_id)) whiteLabelItemId = item.id;
  }
  return { baseItemId, whiteLabelItemId };
}

// ---------------------------------------------------------------------------
// Builders — immediate update path (upgrade)
// ---------------------------------------------------------------------------

/**
 * Build the items[] patch for stripe.subscriptions.update when the caller
 * wants to swap tier (immediate, prorated). Does NOT change the interval.
 *
 * If the white-label item already exists, it is left in place. The handler
 * is responsible for separately calling buildToggleWhiteLabelUpdate when
 * the WL state itself changes.
 */
export function buildChangeTierUpdate(args: {
  current: CurrentStateSnapshot;
  targetTier: Tier;
  catalog: PriceCatalog;
}): SubscriptionUpdateParams {
  const { current, targetTier, catalog } = args;
  const { baseItemId } = findCurrentItems(current, catalog);
  const newBasePrice = resolveBasePriceId(catalog, targetTier, current.interval);
  if (!newBasePrice) {
    throw new Error(`buildChangeTierUpdate: no price for ${targetTier}+${current.interval}`);
  }
  const items: SubscriptionItemPatch[] = [];
  if (baseItemId) {
    items.push({ id: baseItemId, price: newBasePrice });
  } else {
    // Defensive: if we somehow have no base item on the current sub, add a
    // fresh one rather than crash. Should never happen on a healthy sub.
    items.push({ price: newBasePrice, quantity: 1 });
  }
  return {
    items,
    proration_behavior: "create_prorations",
  };
}

/**
 * Build the items[] patch to add or remove the white-label add-on. Adds use
 * the current interval's WL price; removes mark the item deleted.
 */
export function buildToggleWhiteLabelUpdate(args: {
  current: CurrentStateSnapshot;
  targetWhiteLabel: boolean;
  catalog: PriceCatalog;
}): SubscriptionUpdateParams {
  const { current, targetWhiteLabel, catalog } = args;
  const { whiteLabelItemId } = findCurrentItems(current, catalog);
  const items: SubscriptionItemPatch[] = [];

  if (targetWhiteLabel && !whiteLabelItemId) {
    const wlPrice = resolveWhiteLabelPriceId(catalog, current.interval);
    if (!wlPrice) {
      throw new Error(`buildToggleWhiteLabelUpdate: no white-label price for interval=${current.interval}`);
    }
    items.push({ price: wlPrice, quantity: 1 });
  } else if (!targetWhiteLabel && whiteLabelItemId) {
    items.push({ id: whiteLabelItemId, deleted: true });
  }
  // else: noop. Caller should have rejected via same_target_as_current.

  return {
    items,
    proration_behavior: targetWhiteLabel ? "create_prorations" : "none",
  };
}

/**
 * Build the items[] patch for monthly→annual immediate swap. Both base and
 * (optionally) white-label lines flip to their annual variants. Annual is
 * an upgrade so we prorate upfront with billing_cycle_anchor='now'.
 *
 * For annual→monthly the handler uses the schedule path (buildChangeIntervalSchedule).
 */
export function buildChangeIntervalUpdate(args: {
  current: CurrentStateSnapshot;
  targetInterval: BillingInterval;
  catalog: PriceCatalog;
}): SubscriptionUpdateParams {
  const { current, targetInterval, catalog } = args;
  const { baseItemId, whiteLabelItemId } = findCurrentItems(current, catalog);

  const newBasePrice = resolveBasePriceId(catalog, current.tier, targetInterval);
  if (!newBasePrice) {
    throw new Error(`buildChangeIntervalUpdate: no price for ${current.tier}+${targetInterval}`);
  }
  const items: SubscriptionItemPatch[] = [];
  if (baseItemId) {
    items.push({ id: baseItemId, price: newBasePrice });
  } else {
    items.push({ price: newBasePrice, quantity: 1 });
  }

  if (whiteLabelItemId) {
    const newWlPrice = resolveWhiteLabelPriceId(catalog, targetInterval);
    if (newWlPrice) {
      items.push({ id: whiteLabelItemId, price: newWlPrice });
    }
  }

  return {
    items,
    proration_behavior: "create_prorations",
    billing_cycle_anchor: "now",
  };
}

// ---------------------------------------------------------------------------
// Builders — schedule path (downgrade)
// ---------------------------------------------------------------------------

/**
 * Build the phase-2 items[] for a deferred change. Phase 1 = the current
 * line items continued until period end; phase 2 = the new items starting
 * at period end. The handler calls stripe.subscriptionSchedules.update with
 * { phases: [phase1, phase2] }.
 *
 * `target` carries the desired (tier, interval, whiteLabel). The handler
 * decides what phase 1 looks like from the current sub items.
 */
export function buildScheduledPhaseItems(args: {
  target: { tier: Tier; interval: BillingInterval; whiteLabel: boolean };
  catalog: PriceCatalog;
}): Array<{ price: string; quantity: number }> {
  const { target, catalog } = args;
  const items: Array<{ price: string; quantity: number }> = [];
  const basePrice = resolveBasePriceId(catalog, target.tier, target.interval);
  if (!basePrice) {
    throw new Error(`buildScheduledPhaseItems: no price for ${target.tier}+${target.interval}`);
  }
  items.push({ price: basePrice, quantity: 1 });

  if (target.whiteLabel) {
    const wlPrice = resolveWhiteLabelPriceId(catalog, target.interval);
    if (!wlPrice) {
      throw new Error(`buildScheduledPhaseItems: no white-label price for interval=${target.interval}`);
    }
    items.push({ price: wlPrice, quantity: 1 });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Preview params
// ---------------------------------------------------------------------------

export type PreviewParams = {
  customer: string;
  subscription: string;
  subscription_items: SubscriptionItemPatch[];
  subscription_proration_behavior: "create_prorations" | "none";
};

/**
 * Build the params for stripe.invoices.retrieveUpcoming used by the preview
 * path. The handler converts the response into the structured
 * { amount_due, prorated_charge, prorated_credit, ... } block returned to
 * the UI.
 */
export function buildPreviewParams(args: {
  customerId: string;
  subscriptionId: string;
  itemsPatch: SubscriptionItemPatch[];
  proration: "create_prorations" | "none";
}): PreviewParams {
  return {
    customer: args.customerId,
    subscription: args.subscriptionId,
    subscription_items: args.itemsPatch,
    subscription_proration_behavior: args.proration,
  };
}
