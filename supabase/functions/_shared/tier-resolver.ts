/**
 * Pure resolver: given a Stripe subscription's line items + the platform's
 * known price IDs from Vault, figure out what tier the tenant is on, whether
 * the white-label add-on is attached, and whether the subscription is on the
 * monthly or annual billing interval (Phase 17 PR 3c).
 *
 * Lives under supabase/functions/_shared/ but has zero Deno-specific imports
 * so it can be `import`-ed from tests/ under bun's tsconfig.
 *
 * Caller responsibility: this function NEVER mutates. It returns a structured
 * decision object; the caller decides whether to UPDATE the tenants row or
 * reject the subscription as malformed.
 */

export type Tier = "starter" | "growth" | "pro" | "enterprise";
export type BillingInterval = "monthly" | "annual";

export type TierResolution = {
  tier: Tier | null;
  whiteLabel: boolean;
  /** monthly | annual; defaults to 'monthly' when nothing matched */
  interval: BillingInterval;
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
  // Phase 17 PR 3c — annual variants. Enterprise has no annual variant.
  starter_annual: string | null;
  growth_annual: string | null;
  pro_annual: string | null;
  white_label_addon_annual: string | null;
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
  let sawMonthly = false;
  let sawAnnual = false;

  for (const item of items) {
    const pid = item.price?.id;
    if (!pid) continue;

    // Monthly base tiers
    if (priceIds.starter && pid === priceIds.starter) {
      matchedBaseTiers.push("starter");
      sawMonthly = true;
    } else if (priceIds.growth && pid === priceIds.growth) {
      matchedBaseTiers.push("growth");
      sawMonthly = true;
    } else if (priceIds.pro && pid === priceIds.pro) {
      matchedBaseTiers.push("pro");
      sawMonthly = true;
    } else if (
      priceIds.enterprise_active_agent_unit &&
      pid === priceIds.enterprise_active_agent_unit
    ) {
      // Enterprise is metered + has no annual variant; always monthly.
      matchedBaseTiers.push("enterprise");
      enterpriseUsageItemId = item.id;
      sawMonthly = true;
    }
    // Annual base tiers
    else if (priceIds.starter_annual && pid === priceIds.starter_annual) {
      matchedBaseTiers.push("starter");
      sawAnnual = true;
    } else if (priceIds.growth_annual && pid === priceIds.growth_annual) {
      matchedBaseTiers.push("growth");
      sawAnnual = true;
    } else if (priceIds.pro_annual && pid === priceIds.pro_annual) {
      matchedBaseTiers.push("pro");
      sawAnnual = true;
    }
    // White-label add-on (monthly or annual variant)
    else if (priceIds.white_label_addon && pid === priceIds.white_label_addon) {
      whiteLabel = true;
      whiteLabelAddonItemId = item.id;
      sawMonthly = true;
    } else if (
      priceIds.white_label_addon_annual &&
      pid === priceIds.white_label_addon_annual
    ) {
      whiteLabel = true;
      whiteLabelAddonItemId = item.id;
      sawAnnual = true;
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

  // Mixed-interval detection (PR 3c). A subscription should never carry both
  // monthly and annual line items — that suggests a partial migration or a
  // bad billing-mutate call. The webhook treats this as "don't trust the
  // interval discriminator; log + skip the billing_interval write."
  if (sawMonthly && sawAnnual) {
    errors.push({
      code: "mixed_intervals",
      detail: "subscription carries both monthly and annual line items",
    });
  }

  const interval: BillingInterval = sawAnnual && !sawMonthly ? "annual" : "monthly";

  return {
    tier,
    whiteLabel,
    interval,
    enterpriseUsageItemId,
    whiteLabelAddonItemId,
    errors,
  };
}
