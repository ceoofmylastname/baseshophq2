/**
 * Pure tests for the billing-mutate action builders (Phase 17 PR 3c).
 *
 * Covers:
 *   - classifyChange: upgrade / downgrade / lateral / noop matrix
 *   - resolveBasePriceId / resolveWhiteLabelPriceId: monthly + annual selection
 *   - findCurrentItems: base + WL item ID discovery, ignored unknown items
 *   - buildChangeTierUpdate: swaps the base line item, preserves WL
 *   - buildToggleWhiteLabelUpdate: add vs remove patches
 *   - buildChangeIntervalUpdate: monthly→annual flips base + WL prices
 *   - buildScheduledPhaseItems: phase-2 item construction for deferred changes
 *   - buildPreviewParams: shape contract
 */

import { describe, expect, test } from "bun:test";
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
  type CurrentStateSnapshot,
  type PriceCatalog,
} from "../supabase/functions/_shared/billing-mutate-actions.ts";

const CATALOG: PriceCatalog = {
  starter: "price_starter_m",
  growth: "price_growth_m",
  pro: "price_pro_m",
  enterprise_active_agent_unit: "price_enterprise_unit",
  white_label_addon: "price_wl_m",
  starter_annual: "price_starter_a",
  growth_annual: "price_growth_a",
  pro_annual: "price_pro_a",
  white_label_addon_annual: "price_wl_a",
};

describe("classifyChange", () => {
  test("starter monthly → growth monthly is upgrade", () => {
    expect(classifyChange({
      current: { tier: "starter", interval: "monthly", whiteLabel: false },
      target:  { tier: "growth",  interval: "monthly", whiteLabel: false },
    })).toBe("upgrade");
  });
  test("pro → growth is downgrade", () => {
    expect(classifyChange({
      current: { tier: "pro",    interval: "monthly", whiteLabel: false },
      target:  { tier: "growth", interval: "monthly", whiteLabel: false },
    })).toBe("downgrade");
  });
  test("monthly → annual same tier is upgrade", () => {
    expect(classifyChange({
      current: { tier: "growth", interval: "monthly", whiteLabel: false },
      target:  { tier: "growth", interval: "annual",  whiteLabel: false },
    })).toBe("upgrade");
  });
  test("annual → monthly same tier is downgrade", () => {
    expect(classifyChange({
      current: { tier: "growth", interval: "annual",  whiteLabel: false },
      target:  { tier: "growth", interval: "monthly", whiteLabel: false },
    })).toBe("downgrade");
  });
  test("adding white-label same tier is upgrade", () => {
    expect(classifyChange({
      current: { tier: "growth", interval: "monthly", whiteLabel: false },
      target:  { tier: "growth", interval: "monthly", whiteLabel: true },
    })).toBe("upgrade");
  });
  test("removing white-label same tier is downgrade", () => {
    expect(classifyChange({
      current: { tier: "growth", interval: "monthly", whiteLabel: true },
      target:  { tier: "growth", interval: "monthly", whiteLabel: false },
    })).toBe("downgrade");
  });
  test("identical state is noop", () => {
    expect(classifyChange({
      current: { tier: "growth", interval: "monthly", whiteLabel: false },
      target:  { tier: "growth", interval: "monthly", whiteLabel: false },
    })).toBe("noop");
  });
});

describe("resolveBasePriceId", () => {
  test("starter monthly", () => {
    expect(resolveBasePriceId(CATALOG, "starter", "monthly")).toBe("price_starter_m");
  });
  test("growth annual", () => {
    expect(resolveBasePriceId(CATALOG, "growth", "annual")).toBe("price_growth_a");
  });
  test("pro annual", () => {
    expect(resolveBasePriceId(CATALOG, "pro", "annual")).toBe("price_pro_a");
  });
  test("enterprise always returns the metered unit (ignores interval)", () => {
    expect(resolveBasePriceId(CATALOG, "enterprise", "monthly")).toBe("price_enterprise_unit");
    expect(resolveBasePriceId(CATALOG, "enterprise", "annual")).toBe("price_enterprise_unit");
  });
  test("returns null when catalog entry is missing", () => {
    const missing: PriceCatalog = { ...CATALOG, growth_annual: null };
    expect(resolveBasePriceId(missing, "growth", "annual")).toBeNull();
  });
});

describe("resolveWhiteLabelPriceId", () => {
  test("monthly", () => {
    expect(resolveWhiteLabelPriceId(CATALOG, "monthly")).toBe("price_wl_m");
  });
  test("annual", () => {
    expect(resolveWhiteLabelPriceId(CATALOG, "annual")).toBe("price_wl_a");
  });
});

describe("findCurrentItems", () => {
  test("finds base + WL ids and ignores unknown items", () => {
    const snap: CurrentStateSnapshot = {
      tier: "growth",
      interval: "monthly",
      whiteLabel: true,
      items: [
        { id: "si_base", price_id: "price_growth_m" },
        { id: "si_wl",   price_id: "price_wl_m" },
        { id: "si_x",    price_id: "price_unknown" },
      ],
    };
    const found = findCurrentItems(snap, CATALOG);
    expect(found.baseItemId).toBe("si_base");
    expect(found.whiteLabelItemId).toBe("si_wl");
  });
  test("returns null when no items match", () => {
    const snap: CurrentStateSnapshot = {
      tier: "starter",
      interval: "monthly",
      whiteLabel: false,
      items: [{ id: "si_x", price_id: "price_unknown" }],
    };
    const found = findCurrentItems(snap, CATALOG);
    expect(found.baseItemId).toBeNull();
    expect(found.whiteLabelItemId).toBeNull();
  });
});

describe("buildChangeTierUpdate", () => {
  test("starter monthly → growth monthly swaps base item, no WL", () => {
    const snap: CurrentStateSnapshot = {
      tier: "starter",
      interval: "monthly",
      whiteLabel: false,
      items: [{ id: "si_base", price_id: "price_starter_m" }],
    };
    const out = buildChangeTierUpdate({ current: snap, targetTier: "growth", catalog: CATALOG });
    expect(out.items).toEqual([{ id: "si_base", price: "price_growth_m" }]);
    expect(out.proration_behavior).toBe("create_prorations");
  });
  test("growth annual → pro annual swaps to annual pro price", () => {
    const snap: CurrentStateSnapshot = {
      tier: "growth",
      interval: "annual",
      whiteLabel: false,
      items: [{ id: "si_base", price_id: "price_growth_a" }],
    };
    const out = buildChangeTierUpdate({ current: snap, targetTier: "pro", catalog: CATALOG });
    expect(out.items[0]).toEqual({ id: "si_base", price: "price_pro_a" });
  });
});

describe("buildToggleWhiteLabelUpdate", () => {
  test("add WL on growth monthly", () => {
    const snap: CurrentStateSnapshot = {
      tier: "growth",
      interval: "monthly",
      whiteLabel: false,
      items: [{ id: "si_base", price_id: "price_growth_m" }],
    };
    const out = buildToggleWhiteLabelUpdate({ current: snap, targetWhiteLabel: true, catalog: CATALOG });
    expect(out.items).toEqual([{ price: "price_wl_m", quantity: 1 }]);
    expect(out.proration_behavior).toBe("create_prorations");
  });
  test("remove WL on growth annual marks item deleted", () => {
    const snap: CurrentStateSnapshot = {
      tier: "growth",
      interval: "annual",
      whiteLabel: true,
      items: [
        { id: "si_base", price_id: "price_growth_a" },
        { id: "si_wl",   price_id: "price_wl_a" },
      ],
    };
    const out = buildToggleWhiteLabelUpdate({ current: snap, targetWhiteLabel: false, catalog: CATALOG });
    expect(out.items).toEqual([{ id: "si_wl", deleted: true }]);
    expect(out.proration_behavior).toBe("none");
  });
});

describe("buildChangeIntervalUpdate", () => {
  test("monthly → annual flips base + WL prices", () => {
    const snap: CurrentStateSnapshot = {
      tier: "growth",
      interval: "monthly",
      whiteLabel: true,
      items: [
        { id: "si_base", price_id: "price_growth_m" },
        { id: "si_wl",   price_id: "price_wl_m" },
      ],
    };
    const out = buildChangeIntervalUpdate({ current: snap, targetInterval: "annual", catalog: CATALOG });
    expect(out.items).toEqual([
      { id: "si_base", price: "price_growth_a" },
      { id: "si_wl",   price: "price_wl_a" },
    ]);
    expect(out.billing_cycle_anchor).toBe("now");
  });
  test("annual → monthly flips base only when no WL", () => {
    const snap: CurrentStateSnapshot = {
      tier: "growth",
      interval: "annual",
      whiteLabel: false,
      items: [{ id: "si_base", price_id: "price_growth_a" }],
    };
    const out = buildChangeIntervalUpdate({ current: snap, targetInterval: "monthly", catalog: CATALOG });
    expect(out.items).toEqual([{ id: "si_base", price: "price_growth_m" }]);
  });
});

describe("buildScheduledPhaseItems", () => {
  test("builds phase items for growth monthly + WL", () => {
    const items = buildScheduledPhaseItems({
      target: { tier: "growth", interval: "monthly", whiteLabel: true },
      catalog: CATALOG,
    });
    expect(items).toEqual([
      { price: "price_growth_m", quantity: 1 },
      { price: "price_wl_m",     quantity: 1 },
    ]);
  });
  test("builds phase items for starter monthly without WL", () => {
    const items = buildScheduledPhaseItems({
      target: { tier: "starter", interval: "monthly", whiteLabel: false },
      catalog: CATALOG,
    });
    expect(items).toEqual([{ price: "price_starter_m", quantity: 1 }]);
  });
  test("builds phase items for pro annual without WL", () => {
    const items = buildScheduledPhaseItems({
      target: { tier: "pro", interval: "annual", whiteLabel: false },
      catalog: CATALOG,
    });
    expect(items).toEqual([{ price: "price_pro_a", quantity: 1 }]);
  });
});

describe("buildPreviewParams", () => {
  test("passes through the patch + proration mode", () => {
    const params = buildPreviewParams({
      customerId: "cus_x",
      subscriptionId: "sub_y",
      itemsPatch: [{ id: "si_base", price: "price_growth_m" }],
      proration: "create_prorations",
    });
    expect(params.customer).toBe("cus_x");
    expect(params.subscription).toBe("sub_y");
    expect(params.subscription_items).toEqual([{ id: "si_base", price: "price_growth_m" }]);
    expect(params.subscription_proration_behavior).toBe("create_prorations");
  });
});
