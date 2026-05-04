/**
 * Pure spread calculator tests. Fixture-based, no DB.
 *
 * Mirrors the math the SQL `recalculate_policy_payouts` RPC implements. End-
 * to-end smoke runs the SQL RPC against a real bootstrapped tenant; these
 * unit tests lock in the math layer independently.
 */

import { describe, expect, test } from "bun:test";
import {
  computeChainPayouts,
  type ChainLink,
} from "../src/lib/commission-spread-calculator.ts";

const link = (
  agentId: string,
  rate: number | null,
  positionId: string | null = null,
  scheduleCode: string | null = null,
): ChainLink => ({ agentId, positionId, rate, scheduleCode });

// =============================================================================

describe("single agent, no uplines", () => {
  test("$1,200 × 100% = $1,200", () => {
    const result = computeChainPayouts({
      premium: 1200,
      chain: [link("writer", 100, "pos100")],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.amount).toBe(1200);
    expect(result[0]!.spread).toBe(100);
    expect(result[0]!.isOverride).toBe(false);
  });
});

// =============================================================================

describe("two-level chain", () => {
  test("writing 100, upline 120: writing $1,200 + upline $240 = $1,440", () => {
    const result = computeChainPayouts({
      premium: 1200,
      chain: [link("writer", 100), link("upline", 120)],
    });
    expect(result).toHaveLength(2);
    expect(result[0]!.amount).toBe(1200);
    expect(result[0]!.spread).toBe(100);
    expect(result[0]!.isOverride).toBe(false);
    expect(result[1]!.amount).toBe(240);
    expect(result[1]!.spread).toBe(20);
    expect(result[1]!.isOverride).toBe(true);
    expect(result[0]!.amount + result[1]!.amount).toBe(1440);
  });
});

// =============================================================================

describe("three-level chain with Lincoln Bonus already summed", () => {
  test("90 → 120 → 130 (Lincoln 100+10 bonus): $700 + $300 + $100 = $1,100", () => {
    // Caller has already summed Lincoln Bonus into the owner's rate (110).
    const result = computeChainPayouts({
      premium: 1000,
      chain: [
        link("writer", 70, "p90"),
        link("mid",    100, "p120"),
        link("owner",  110, "p130"),
      ],
    });
    expect(result).toHaveLength(3);
    expect(result[0]!.amount).toBe(700);
    expect(result[1]!.amount).toBe(300);
    expect(result[2]!.amount).toBe(100);
    expect(result.reduce((s, p) => s + p.amount, 0)).toBe(1100);
  });
});

// =============================================================================

describe("missing rates", () => {
  test("missing upline rate: chain continues to next level, no row for missing", () => {
    // Writing 100, mid no rate, owner 130 → writing $1,000, owner $300, mid skipped
    const result = computeChainPayouts({
      premium: 1000,
      chain: [
        link("writer", 100),
        link("mid",    null),
        link("owner",  130),
      ],
    });
    expect(result).toHaveLength(2);
    expect(result[0]!.agentId).toBe("writer");
    expect(result[0]!.amount).toBe(1000);
    expect(result[1]!.agentId).toBe("owner");
    expect(result[1]!.spread).toBe(30); // 130 - 100 (high_water from writer)
    expect(result[1]!.amount).toBe(300);
  });

  test("writing agent missing rate: no writing payout, uplines unaffected", () => {
    const result = computeChainPayouts({
      premium: 1000,
      chain: [link("writer", null), link("upline", 120)],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.agentId).toBe("upline");
    expect(result[0]!.spread).toBe(120); // full rate, high_water still 0
    expect(result[0]!.amount).toBe(1200);
  });
});

// =============================================================================

describe("negative spread clamps to zero", () => {
  test("upline rate lower than downline: no row written for upline", () => {
    const result = computeChainPayouts({
      premium: 1000,
      chain: [link("writer", 100), link("anomalous_upline", 80)],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.agentId).toBe("writer");
  });

  test("upline rate equal to downline: no row written for upline", () => {
    const result = computeChainPayouts({
      premium: 1000,
      chain: [link("writer", 100), link("equal_upline", 100)],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.agentId).toBe("writer");
  });
});

// =============================================================================

describe("high-water tracking through anomalous chains", () => {
  test("upline lower than downline doesn't lower high-water for next upline", () => {
    // Writing 100, mid 80 (anomaly, skipped), owner 130 → owner spread is
    // 130 - 100 (high_water held at writer's 100), not 130 - 80.
    const result = computeChainPayouts({
      premium: 1000,
      chain: [
        link("writer", 100),
        link("mid_anomaly", 80),
        link("owner", 130),
      ],
    });
    expect(result).toHaveLength(2);
    expect(result[1]!.agentId).toBe("owner");
    expect(result[1]!.spread).toBe(30);
    expect(result[1]!.amount).toBe(300);
  });
});

// =============================================================================

describe("idempotency", () => {
  test("pure function: same input → same output across calls", () => {
    const input = {
      premium: 1200,
      chain: [link("a", 100), link("b", 120)],
    };
    expect(computeChainPayouts(input)).toEqual(computeChainPayouts(input));
  });
});

// =============================================================================

describe("decimal precision", () => {
  test("$1,234.56 × 7.5% = $92.59 (rounded)", () => {
    const result = computeChainPayouts({
      premium: 1234.56,
      chain: [link("a", 7.5)],
    });
    expect(result[0]!.amount).toBe(92.59); // rounded from 92.592
  });

  test("two-decimal Lincoln rate sum: $1,000 × 107.5% = $1,075", () => {
    const result = computeChainPayouts({
      premium: 1000,
      chain: [link("a", 107.5)],
    });
    expect(result[0]!.amount).toBe(1075);
  });
});

// =============================================================================

describe("empty chain", () => {
  test("zero-length chain returns empty array", () => {
    const result = computeChainPayouts({ premium: 1000, chain: [] });
    expect(result).toEqual([]);
  });
});
