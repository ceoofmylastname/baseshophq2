/**
 * Phase 18 PR 1: pure tests for `src/lib/pricing/pricing-math.ts`.
 *
 * Covers the five test cases approved in the S-1 plan §14:
 *   1. tierForAgentCount boundary values
 *   2. annualPrice
 *   3. annualSavings
 *   4. buildSignupUrl query-param shape
 *   5. TIER_CONFIG CTA invariants
 */

import { describe, expect, test } from "bun:test";
import {
  TIER_CONFIG,
  annualPrice,
  annualSavings,
  buildSignupUrl,
  tierForAgentCount,
} from "../src/lib/pricing/pricing-math";

describe("tierForAgentCount", () => {
  test("1 agent → starter", () => {
    expect(tierForAgentCount(1)).toBe("starter");
  });
  test("3 agents → starter (upper boundary)", () => {
    expect(tierForAgentCount(3)).toBe("starter");
  });
  test("4 agents → growth (lower boundary)", () => {
    expect(tierForAgentCount(4)).toBe("growth");
  });
  test("5 agents → growth", () => {
    expect(tierForAgentCount(5)).toBe("growth");
  });
  test("10 agents → growth (upper boundary)", () => {
    expect(tierForAgentCount(10)).toBe("growth");
  });
  test("11 agents → pro (lower boundary)", () => {
    expect(tierForAgentCount(11)).toBe("pro");
  });
  test("25 agents → pro", () => {
    expect(tierForAgentCount(25)).toBe("pro");
  });
  test("50 agents → pro (upper boundary)", () => {
    expect(tierForAgentCount(50)).toBe("pro");
  });
  test("51 agents → enterprise (lower boundary)", () => {
    expect(tierForAgentCount(51)).toBe("enterprise");
  });
  test("75 agents → enterprise", () => {
    expect(tierForAgentCount(75)).toBe("enterprise");
  });
  test("100 agents → enterprise", () => {
    expect(tierForAgentCount(100)).toBe("enterprise");
  });
  test("200 agents → enterprise (slider max)", () => {
    expect(tierForAgentCount(200)).toBe("enterprise");
  });
});

describe("annualPrice", () => {
  test("Starter 97 → 970", () => {
    expect(annualPrice(97)).toBe(970);
  });
  test("Growth 297 → 2970", () => {
    expect(annualPrice(297)).toBe(2970);
  });
  test("Pro 497 → 4970", () => {
    expect(annualPrice(497)).toBe(4970);
  });
});

describe("annualSavings", () => {
  test("Starter 97 → 194 (97x2)", () => {
    expect(annualSavings(97)).toBe(194);
  });
  test("Growth 297 → 594", () => {
    expect(annualSavings(297)).toBe(594);
  });
  test("Pro 497 → 994", () => {
    expect(annualSavings(497)).toBe(994);
  });
});

describe("buildSignupUrl", () => {
  test("Growth + annual + WL=true → expected query string", () => {
    expect(
      buildSignupUrl({ tier: "growth", interval: "annual", whiteLabel: true }),
    ).toBe("/signup?tier=growth&interval=annual&wl=true");
  });
  test("Pro + monthly + WL=false → expected query string", () => {
    expect(
      buildSignupUrl({ tier: "pro", interval: "monthly", whiteLabel: false }),
    ).toBe("/signup?tier=pro&interval=monthly&wl=false");
  });
  test("Starter + monthly + WL=false (Starter never has WL but URL still valid)", () => {
    expect(
      buildSignupUrl({ tier: "starter", interval: "monthly", whiteLabel: false }),
    ).toBe("/signup?tier=starter&interval=monthly&wl=false");
  });
});

describe("TIER_CONFIG cta invariants", () => {
  test("starter cta === 'signup'", () => {
    expect(TIER_CONFIG.starter.cta).toBe("signup");
  });
  test("growth cta === 'signup'", () => {
    expect(TIER_CONFIG.growth.cta).toBe("signup");
  });
  test("pro cta === 'signup'", () => {
    expect(TIER_CONFIG.pro.cta).toBe("signup");
  });
  test("enterprise cta === 'demo'", () => {
    expect(TIER_CONFIG.enterprise.cta).toBe("demo");
  });
  test("enterprise monthlyNumber is null (custom quote)", () => {
    expect(TIER_CONFIG.enterprise.monthlyNumber).toBeNull();
  });
  test("enterprise agentCap is null (no hard cap)", () => {
    expect(TIER_CONFIG.enterprise.agentCap).toBeNull();
  });
});
