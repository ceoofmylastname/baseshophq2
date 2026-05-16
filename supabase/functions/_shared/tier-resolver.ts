/**
 * Pure resolver: given a Stripe subscription's line items + the platform's
 * known price IDs from Vault, figure out what tier the tenant is on and
 * whether the white-label add-on is attached.
 *
 * Lives under supabase/functions/_shared/ but has zero Deno-specific imports
 * so it can be `import`-ed from tests/ under bun's tsconfig.
 *
 * Caller responsibility: this function NEVER mutates. It returns a structured
 * decision object; the caller decides whether to UPDATE the tenants row or
 * reject the subscription as malformed.
 */

export type Tier = "starter" | "growth" | "pro" | "enterprise";

export type TierResolution = {
  tier: Tier | null;
  whiteLabel: boolean;
  /** Stripe subscription_item.id for the Enterprise per-active-agent line, used by the snapshot job */
  enterpriseUsageItemId: string | null;
  /** Stripe subscription_item.id for the white-label add-on line, exposed for parity */
  whiteLabelAddonItemId: string | null;
  errors: Array<{ code: string; detail: string }>;
};

export type SubscriptionItem = {
  id: string;
  price: { id: string };
};

export type PriceIdCatalog = {
  starter: string | null;
  growth: string | null;
  pro: string | null;
  enterprise_active_agent_unit: string | null;
  white_label_addon: string | null;
};

export function resolveTierFromSubscriptionItems(
  items: SubscriptionItem[],
  priceIds: PriceIdCatalog
): TierResolution {
  const errors: TierResolution["errors"] = [];

  // Walk every line item exactly once; classify it. We avoid Object.values
  // / filter dances so the bookkeeping is explicit and the failure modes
  // are obvious to anyone reading the function in a 3-am incident.
  const matchedBaseTiers: Tier[] = [];
  let enterpriseUsageItemId: string | null = null;
  let whiteLabelAddonItemId: string | null = null;
  let whiteLabel = false;

  for (const item of items) {
    const pid = item.price?.id;
    if (!pid) continue;

    if (priceIds.starter && pid === priceIds.starter) {
      matchedBaseTiers.push("starter");
    } else if (priceIds.growth && pid === priceIds.growth) {
      matchedBaseTiers.push("growth");
    } else if (priceIds.pro && pid === priceIds.pro) {
      matchedBaseTiers.push("pro");
    } else if (
      priceIds.enterprise_active_agent_unit &&
      pid === priceIds.enterprise_active_agent_unit
    ) {
      matchedBaseTiers.push("enterprise");
      enterpriseUsageItemId = item.id;
    } else if (
      priceIds.white_label_addon &&
      pid === priceIds.white_label_addon
    ) {
      whiteLabel = true;
      whiteLabelAddonItemId = item.id;
    }
    // Unknown price IDs (e.g. additional vanity domains, custom Enterprise
    // negotiated prices) are silently ignored here — the caller can scan the
    // raw items separately if it needs to attribute them.
  }

  let tier: Tier | null = null;
  if (matchedBaseTiers.length === 0) {
    errors.push({
      code: "no_base_tier_matched",
      detail: "subscription has no line item matching any known base tier price ID",
    });
  } else if (matchedBaseTiers.length > 1) {
    errors.push({
      code: "multiple_base_tiers_matched",
      detail: `subscription has multiple base-tier line items: ${matchedBaseTiers.join(", ")}`,
    });
    // Still pick the first deterministically so the caller has something to
    // log against; the error flags this row as bad.
    tier = matchedBaseTiers[0];
  } else {
    tier = matchedBaseTiers[0];
  }

  // White-label is only legal when there IS a base tier. Add-on without a
  // base is a contradiction — this is also enforced at the DB layer by the
  // tenants_no_white_label_on_starter CHECK, but we surface it here too.
  if (whiteLabel && tier === null) {
    errors.push({
      code: "white_label_without_base_tier",
      detail: "white-label add-on is attached but no base tier was matched",
    });
  }

  // Starter + white-label is rejected at checkout time (in
  // create-checkout-session) and at the DB layer (CHECK constraint). If we
  // somehow see it on a subscription read, surface it cleanly.
  if (whiteLabel && tier === "starter") {
    errors.push({
      code: "white_label_on_starter",
      detail: "starter tier cannot have white-label add-on",
    });
  }

  return {
    tier,
    whiteLabel,
    enterpriseUsageItemId,
    whiteLabelAddonItemId,
    errors,
  };
}
