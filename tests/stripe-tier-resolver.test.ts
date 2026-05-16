/**
 * Pure tests for resolveTierFromSubscriptionItems.
 *
 * Covers:
 *   - exactly one base-tier match (each of starter|growth|pro|enterprise)
 *     with no addon → tier set, whiteLabel=false, no errors
 *   - base tier + white-label addon → tier set, whiteLabel=true, no errors
 *     (except starter+addon, which IS an error)
 *   - zero matches → error no_base_tier_matched
 *   - two base-tier matches → error multiple_base_tiers_matched
 *   - white-label without base tier → error white_label_without_base_tier
 *   - enterprise with usage item exposed via enterpriseUsageItemId
 *   - missing price IDs in catalog (null) are silently un-matched
 *   - additional unknown line items (e.g. vanity domain) are silently ignored
 */

import { describe, expect, test } from "bun:test";
import {
  resolveTierFromSubscriptionItems,
  type PriceIdCatalog,
} from "../supabase/functions/_shared/tier-resolver.ts";

const FULL_CATALOG: PriceIdCatalog = {
  starter:                       "price_starter",
  growth:                        "price_growth",
  pro:                           "price_pro",
  enterprise_active_agent_unit:  "price_enterprise_unit",
  white_label_addon:             "price_white_label",
  starter_annual:                "price_starter_annual",
  growth_annual:                 "price_growth_annual",
  pro_annual:                    "price_pro_annual",
  white_label_addon_annual:      "price_white_label_annual",
};

describe("single base tier match", () => {
  test.each([
    ["starter",    "price_starter"],
    ["growth",     "price_growth"],
    ["pro",        "price_pro"],
    ["enterprise", "price_enterprise_unit"],
  ])("%s alone resolves cleanly", (expectedTier, priceId) => {
    const r = resolveTierFromSubscriptionItems(
      [{ id: "si_1", price: { id: priceId } }],
      FULL_CATALOG,
    );
    expect(r.tier).toBe(expectedTier as never);
    expect(r.whiteLabel).toBe(false);
    expect(r.whiteLabelAddonItemId).toBeNull();
    expect(r.errors).toEqual([]);
  });
});

describe("base tier + white-label addon", () => {
  test("growth + addon resolves to tier=growth, whiteLabel=true, addon item id exposed", () => {
    const r = resolveTierFromSubscriptionItems(
      [
        { id: "si_base",  price: { id: "price_growth" } },
        { id: "si_addon", price: { id: "price_white_label" } },
      ],
      FULL_CATALOG,
    );
    expect(r.tier).toBe("growth");
    expect(r.whiteLabel).toBe(true);
    expect(r.whiteLabelAddonItemId).toBe("si_addon");
    expect(r.errors).toEqual([]);
  });

  test("pro + addon resolves cleanly", () => {
    const r = resolveTierFromSubscriptionItems(
      [
        { id: "si_base",  price: { id: "price_pro" } },
        { id: "si_addon", price: { id: "price_white_label" } },
      ],
      FULL_CATALOG,
    );
    expect(r.tier).toBe("pro");
    expect(r.whiteLabel).toBe(true);
    expect(r.errors).toEqual([]);
  });

  test("enterprise + addon resolves cleanly AND exposes enterpriseUsageItemId", () => {
    const r = resolveTierFromSubscriptionItems(
      [
        { id: "si_unit",  price: { id: "price_enterprise_unit" } },
        { id: "si_addon", price: { id: "price_white_label" } },
      ],
      FULL_CATALOG,
    );
    expect(r.tier).toBe("enterprise");
    expect(r.whiteLabel).toBe(true);
    expect(r.enterpriseUsageItemId).toBe("si_unit");
    expect(r.errors).toEqual([]);
  });

  test("starter + addon is rejected with white_label_on_starter error", () => {
    const r = resolveTierFromSubscriptionItems(
      [
        { id: "si_base",  price: { id: "price_starter" } },
        { id: "si_addon", price: { id: "price_white_label" } },
      ],
      FULL_CATALOG,
    );
    expect(r.tier).toBe("starter");
    expect(r.whiteLabel).toBe(true);
    expect(r.errors.some(e => e.code === "white_label_on_starter")).toBe(true);
  });
});

describe("zero base-tier matches", () => {
  test("empty items array → no_base_tier_matched", () => {
    const r = resolveTierFromSubscriptionItems([], FULL_CATALOG);
    expect(r.tier).toBeNull();
    expect(r.errors.some(e => e.code === "no_base_tier_matched")).toBe(true);
  });

  test("only unknown line items → no_base_tier_matched", () => {
    const r = resolveTierFromSubscriptionItems(
      [{ id: "si_x", price: { id: "price_unknown" } }],
      FULL_CATALOG,
    );
    expect(r.tier).toBeNull();
    expect(r.errors.some(e => e.code === "no_base_tier_matched")).toBe(true);
  });
});

describe("two base-tier matches", () => {
  test("starter + growth on the same subscription → multiple_base_tiers_matched", () => {
    const r = resolveTierFromSubscriptionItems(
      [
        { id: "si_a", price: { id: "price_starter" } },
        { id: "si_b", price: { id: "price_growth" } },
      ],
      FULL_CATALOG,
    );
    expect(r.errors.some(e => e.code === "multiple_base_tiers_matched")).toBe(true);
    // We still pick the first deterministically so logging has a value
    expect(r.tier).toBe("starter");
  });

  test("pro + enterprise → multiple_base_tiers_matched", () => {
    const r = resolveTierFromSubscriptionItems(
      [
        { id: "si_a", price: { id: "price_pro" } },
        { id: "si_b", price: { id: "price_enterprise_unit" } },
      ],
      FULL_CATALOG,
    );
    expect(r.errors.some(e => e.code === "multiple_base_tiers_matched")).toBe(true);
  });
});

describe("white-label without base tier", () => {
  test("only the addon line → white_label_without_base_tier AND no_base_tier_matched", () => {
    const r = resolveTierFromSubscriptionItems(
      [{ id: "si_addon", price: { id: "price_white_label" } }],
      FULL_CATALOG,
    );
    expect(r.tier).toBeNull();
    expect(r.whiteLabel).toBe(true);
    expect(r.errors.some(e => e.code === "no_base_tier_matched")).toBe(true);
    expect(r.errors.some(e => e.code === "white_label_without_base_tier")).toBe(true);
  });
});

describe("catalog gaps", () => {
  test("price ID missing from catalog is silently un-matched", () => {
    const catalog: PriceIdCatalog = { ...FULL_CATALOG, growth: null };
    const r = resolveTierFromSubscriptionItems(
      [{ id: "si_x", price: { id: "price_growth" } }],
      catalog,
    );
    expect(r.tier).toBeNull();
    expect(r.errors.some(e => e.code === "no_base_tier_matched")).toBe(true);
  });
});

describe("unrelated line items are ignored", () => {
  test("vanity-domain or custom unknown lines do not corrupt the resolution", () => {
    const r = resolveTierFromSubscriptionItems(
      [
        { id: "si_base",   price: { id: "price_growth" } },
        { id: "si_domain", price: { id: "price_vanity_domain_some_id" } },
        { id: "si_other",  price: { id: "price_random_extra" } },
      ],
      FULL_CATALOG,
    );
    expect(r.tier).toBe("growth");
    expect(r.whiteLabel).toBe(false);
    expect(r.errors).toEqual([]);
  });
});

describe("enterprise usage item id is exposed only for enterprise", () => {
  test("growth alone → enterpriseUsageItemId is null", () => {
    const r = resolveTierFromSubscriptionItems(
      [{ id: "si_1", price: { id: "price_growth" } }],
      FULL_CATALOG,
    );
    expect(r.enterpriseUsageItemId).toBeNull();
  });

  test("enterprise alone → enterpriseUsageItemId = subscription_item id", () => {
    const r = resolveTierFromSubscriptionItems(
      [{ id: "si_xyz", price: { id: "price_enterprise_unit" } }],
      FULL_CATALOG,
    );
    expect(r.tier).toBe("enterprise");
    expect(r.enterpriseUsageItemId).toBe("si_xyz");
  });
});

// ---------------------------------------------------------------------------
// Phase 17 PR 3c — annual variants + mixed_intervals
// ---------------------------------------------------------------------------

describe("annual base tiers (PR 3c)", () => {
  test.each([
    ["starter", "price_starter_annual"],
    ["growth",  "price_growth_annual"],
    ["pro",     "price_pro_annual"],
  ])("%s annual alone resolves to tier + interval=annual", (expectedTier, priceId) => {
    const r = resolveTierFromSubscriptionItems(
      [{ id: "si_a", price: { id: priceId } }],
      FULL_CATALOG,
    );
    expect(r.tier).toBe(expectedTier as never);
    expect(r.interval).toBe("annual");
    expect(r.whiteLabel).toBe(false);
    expect(r.errors).toEqual([]);
  });

  test("growth annual + WL annual resolves cleanly with interval=annual", () => {
    const r = resolveTierFromSubscriptionItems(
      [
        { id: "si_base",  price: { id: "price_growth_annual" } },
        { id: "si_addon", price: { id: "price_white_label_annual" } },
      ],
      FULL_CATALOG,
    );
    expect(r.tier).toBe("growth");
    expect(r.interval).toBe("annual");
    expect(r.whiteLabel).toBe(true);
    expect(r.whiteLabelAddonItemId).toBe("si_addon");
    expect(r.errors).toEqual([]);
  });

  test("monthly tier alone has interval=monthly", () => {
    const r = resolveTierFromSubscriptionItems(
      [{ id: "si_a", price: { id: "price_growth" } }],
      FULL_CATALOG,
    );
    expect(r.interval).toBe("monthly");
  });

  test("starter annual + WL annual still rejected (white_label_on_starter)", () => {
    const r = resolveTierFromSubscriptionItems(
      [
        { id: "si_base",  price: { id: "price_starter_annual" } },
        { id: "si_addon", price: { id: "price_white_label_annual" } },
      ],
      FULL_CATALOG,
    );
    expect(r.tier).toBe("starter");
    expect(r.interval).toBe("annual");
    expect(r.whiteLabel).toBe(true);
    expect(r.errors.some(e => e.code === "white_label_on_starter")).toBe(true);
  });
});

describe("mixed_intervals (PR 3c)", () => {
  test("subscription with both monthly + annual line items → mixed_intervals error", () => {
    const r = resolveTierFromSubscriptionItems(
      [
        { id: "si_base", price: { id: "price_growth_annual" } },
        { id: "si_wl",   price: { id: "price_white_label" } }, // monthly WL with annual base
      ],
      FULL_CATALOG,
    );
    expect(r.errors.some(e => e.code === "mixed_intervals")).toBe(true);
  });

  test("two monthly items (base + WL) → no mixed_intervals error", () => {
    const r = resolveTierFromSubscriptionItems(
      [
        { id: "si_base", price: { id: "price_growth" } },
        { id: "si_wl",   price: { id: "price_white_label" } },
      ],
      FULL_CATALOG,
    );
    expect(r.errors.some(e => e.code === "mixed_intervals")).toBe(false);
  });

  test("two annual items → no mixed_intervals error, interval=annual", () => {
    const r = resolveTierFromSubscriptionItems(
      [
        { id: "si_base", price: { id: "price_pro_annual" } },
        { id: "si_wl",   price: { id: "price_white_label_annual" } },
      ],
      FULL_CATALOG,
    );
    expect(r.errors.some(e => e.code === "mixed_intervals")).toBe(false);
    expect(r.interval).toBe("annual");
  });
});
