/**
 * Pure tests for the six Phase 17 PR 3b billing helpers exported from
 * src/lib/billing/helpers.ts.
 *
 * Each function is tested in isolation with explicit fixtures. The hook
 * layer (useBillingState) and React components are not exercised here —
 * those are integration concerns out of scope for bun's runtime-free
 * test setup.
 */

import { describe, expect, test } from "bun:test";
import {
  bannerVariant,
  capColor,
  composeBillingState,
  formatPastDueDeadline,
  gateBilling,
  shouldShowSnapshots,
  type TenantBillingRow,
  type BillingSnapshot,
} from "../src/lib/billing/helpers";

describe("gateBilling", () => {
  test("explicit true → render", () => {
    expect(gateBilling(true)).toBe("render");
  });
  test("explicit false → redirect", () => {
    expect(gateBilling(false)).toBe("redirect");
  });
  test("undefined (loading) → redirect (caller must hold redirect until loading false)", () => {
    expect(gateBilling(undefined)).toBe("redirect");
  });
});

describe("bannerVariant", () => {
  test("active → null", () => {
    expect(bannerVariant("active", true)).toBeNull();
    expect(bannerVariant("active", false)).toBeNull();
  });

  test("past_due owner → amber + CTA", () => {
    const v = bannerVariant("past_due", true);
    expect(v).not.toBeNull();
    expect(v!.kind).toBe("past_due");
    expect(v!.color).toBe("amber");
    expect(v!.icon).toBe("AlertTriangle");
    expect(v!.cta).toBeDefined();
    expect(v!.cta!.href).toBe("/billing");
  });

  test("past_due non-owner → amber, NO CTA", () => {
    const v = bannerVariant("past_due", false);
    expect(v).not.toBeNull();
    expect(v!.color).toBe("amber");
    expect(v!.cta).toBeUndefined();
  });

  test("suspended owner → red + CTA", () => {
    const v = bannerVariant("suspended", true);
    expect(v!.kind).toBe("suspended");
    expect(v!.color).toBe("red");
    expect(v!.cta).toBeDefined();
  });

  test("suspended non-owner → red, NO CTA", () => {
    const v = bannerVariant("suspended", false);
    expect(v!.color).toBe("red");
    expect(v!.cta).toBeUndefined();
  });

  test("cancelled owner → neutral + 'Choose a plan' CTA", () => {
    const v = bannerVariant("cancelled", true);
    expect(v!.kind).toBe("cancelled");
    expect(v!.color).toBe("neutral");
    expect(v!.cta).toBeDefined();
    expect(v!.cta!.label).toBe("Choose a plan");
  });

  test("cancelled non-owner → neutral, NO CTA", () => {
    const v = bannerVariant("cancelled", false);
    expect(v!.color).toBe("neutral");
    expect(v!.cta).toBeUndefined();
  });
});

describe("formatPastDueDeadline", () => {
  test("'2026-05-13T00:00:00Z' → 'May 27' (+14d)", () => {
    expect(formatPastDueDeadline("2026-05-13T00:00:00Z")).toBe("May 27");
  });

  test("month rollover: '2026-05-25T00:00:00Z' → 'Jun 8'", () => {
    expect(formatPastDueDeadline("2026-05-25T00:00:00Z")).toBe("Jun 8");
  });

  test("year rollover: '2026-12-25T00:00:00Z' → 'Jan 8'", () => {
    expect(formatPastDueDeadline("2026-12-25T00:00:00Z")).toBe("Jan 8");
  });
});

describe("capColor", () => {
  test("79 → green", () => { expect(capColor(79)).toBe("green"); });
  test("0  → green", () => { expect(capColor(0)).toBe("green"); });
  test("80 → amber", () => { expect(capColor(80)).toBe("amber"); });
  test("94 → amber", () => { expect(capColor(94)).toBe("amber"); });
  test("95 → red",   () => { expect(capColor(95)).toBe("red"); });
  test("100 → red",  () => { expect(capColor(100)).toBe("red"); });
  test("120 → red (over-cap is still red)", () => { expect(capColor(120)).toBe("red"); });
});

describe("shouldShowSnapshots", () => {
  test("enterprise + 0 snapshots → true (empty table renders)", () => {
    expect(shouldShowSnapshots("enterprise", 0)).toBe(true);
  });
  test("enterprise + 6 snapshots → true", () => {
    expect(shouldShowSnapshots("enterprise", 6)).toBe(true);
  });
  test("starter → false", () => {
    expect(shouldShowSnapshots("starter", 0)).toBe(false);
    expect(shouldShowSnapshots("starter", 12)).toBe(false);
  });
  test("growth → false", () => {
    expect(shouldShowSnapshots("growth", 3)).toBe(false);
  });
  test("pro → false", () => {
    expect(shouldShowSnapshots("pro", 1)).toBe(false);
  });
});

describe("composeBillingState", () => {
  test("shape assertion on full fixture", () => {
    const tenantRow: TenantBillingRow = {
      id: "11111111-1111-1111-1111-111111111111",
      current_plan_tier: "growth",
      white_label_addon_active: true,
      agent_cap: 10,
      billing_status: "active",
      is_in_trial: false,
      trial_ends_at: null,
      current_period_end: "2026-06-15T00:00:00Z",
      past_due_since: null,
      suspended_at: null,
      stripe_customer_id: "cus_test_42",
    };
    const snapshots: BillingSnapshot[] = [
      {
        id: "s1",
        period_start: "2026-04-01",
        period_end: "2026-04-30",
        active_agent_count: 7,
        tier_at_snapshot: "growth",
        stripe_usage_record_id: "mbur_abc",
        created_at: "2026-05-01T00:00:00Z",
      },
    ];
    const out = composeBillingState({ tenantRow, snapshots, agentCount: 8 });
    expect(out.tier).toBe("growth");
    expect(out.whiteLabel).toBe(true);
    expect(out.agentCap).toBe(10);
    expect(out.agentCount).toBe(8);
    expect(out.usagePct).toBe(80); // 8/10 = 80%
    expect(out.billingStatus).toBe("active");
    expect(out.isInTrial).toBe(false);
    expect(out.trialEndsAt).toBeNull();
    expect(out.currentPeriodEnd).toBe("2026-06-15T00:00:00Z");
    expect(out.pastDueSince).toBeNull();
    expect(out.suspendedAt).toBeNull();
    expect(out.hasStripeCustomer).toBe(true);
    expect(out.snapshots).toHaveLength(1);
  });

  test("agent_cap=0 sentinel does not divide-by-zero (pct=0)", () => {
    const tenantRow: TenantBillingRow = {
      id: "tid",
      current_plan_tier: "starter",
      white_label_addon_active: false,
      agent_cap: 0,
      billing_status: "active",
      is_in_trial: true,
      trial_ends_at: null,
      current_period_end: null,
      past_due_since: null,
      suspended_at: null,
      stripe_customer_id: null,
    };
    const out = composeBillingState({ tenantRow, snapshots: [], agentCount: 5 });
    expect(out.usagePct).toBe(0);
    expect(out.hasStripeCustomer).toBe(false);
  });

  test("over-cap usage rounds correctly (12/10 → 120)", () => {
    const tenantRow: TenantBillingRow = {
      id: "tid",
      current_plan_tier: "growth",
      white_label_addon_active: false,
      agent_cap: 10,
      billing_status: "active",
      is_in_trial: false,
      trial_ends_at: null,
      current_period_end: null,
      past_due_since: null,
      suspended_at: null,
      stripe_customer_id: "cus_x",
    };
    const out = composeBillingState({ tenantRow, snapshots: [], agentCount: 12 });
    expect(out.usagePct).toBe(120);
  });
});
