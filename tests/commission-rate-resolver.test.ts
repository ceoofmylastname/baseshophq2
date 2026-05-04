/**
 * Pure rate resolver tests.
 *
 * Fixture-based, no DB. Covers:
 *   - Lincoln TermAccelerator 20&30 Bonus math (the headline edge case)
 *   - Time-stamped rate window resolution (closed window vs open window)
 *   - Missing-rate behavior (returns null cleanly for engine to skip upline)
 *   - source / schedule_code passthrough
 *   - Negative cases that lock in correct behavior:
 *       * non-bonus product at the same position must NOT pick up bonus
 *       * has_bonus_column=true with bonus_variant_product_id=null must NOT
 *         attempt a lookup
 *       * has_bonus_column=true with no Bonus rate row in rateRows must
 *         degrade gracefully (parent rate only)
 *   - Edge inclusivity: applicationDate == start_date and == end_date both match
 */

import { describe, expect, test } from "bun:test";
import {
  resolveAgentRate,
  type AgentRateRow,
  type ProductMetadata,
} from "../src/lib/commission-rate-resolver.ts";

// -----------------------------------------------------------------------------
// Fixture UUIDs (deterministic so tests are easy to read)
// -----------------------------------------------------------------------------

const AGENT = "00000000-0000-0000-0000-00000000aaaa";
const TERM_ACCEL_PARENT = "00000000-0000-0000-0000-000000000010";
const TERM_ACCEL_BONUS  = "00000000-0000-0000-0000-000000000011";
const WEALTH_ACCEL      = "00000000-0000-0000-0000-000000000020";
const SENIOR_CHOICE     = "00000000-0000-0000-0000-000000000030";

const TERM_ACCEL_META: ProductMetadata = {
  id: TERM_ACCEL_PARENT,
  has_bonus_column: true,
  bonus_variant_product_id: TERM_ACCEL_BONUS,
};

const WEALTH_ACCEL_META: ProductMetadata = {
  id: WEALTH_ACCEL,
  has_bonus_column: false,
  bonus_variant_product_id: null,
};

const SENIOR_CHOICE_META: ProductMetadata = {
  id: SENIOR_CHOICE,
  has_bonus_column: false,
  bonus_variant_product_id: null,
};

const TODAY = "2026-05-03";
const D90_AGO = "2026-02-02";
const D30_AGO = "2026-04-03";
const D60_AGO = "2026-03-04";

function row(
  product_id: string,
  rate: number,
  source: AgentRateRow["source"] = "position_default",
  start_date: string = TODAY,
  end_date: string | null = null,
  schedule_code: string | null = null,
): AgentRateRow {
  return { product_id, rate, source, start_date, end_date, schedule_code };
}

// =============================================================================
// Lincoln Bonus math — the 5 position-specific cases
// =============================================================================

describe("Lincoln Bonus math", () => {
  test("130 Division Executive: parent 100 + bonus 10 = 110", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: TERM_ACCEL_PARENT,
      applicationDate: TODAY,
      rateRows: [row(TERM_ACCEL_PARENT, 100), row(TERM_ACCEL_BONUS, 10)],
      productMetadata: TERM_ACCEL_META,
    });
    expect(result?.rate).toBe(110);
    expect(result?.source).toBe("position_default");
  });

  test("125 Regional Executive: parent 100 + bonus 5 = 105", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: TERM_ACCEL_PARENT,
      applicationDate: TODAY,
      rateRows: [row(TERM_ACCEL_PARENT, 100), row(TERM_ACCEL_BONUS, 5)],
      productMetadata: TERM_ACCEL_META,
    });
    expect(result?.rate).toBe(105);
  });

  test("120 Executive Advisor: parent 100, no Bonus rate row → 100 (null treated as 0)", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: TERM_ACCEL_PARENT,
      applicationDate: TODAY,
      rateRows: [row(TERM_ACCEL_PARENT, 100)], // no Bonus row at this position
      productMetadata: TERM_ACCEL_META,
    });
    expect(result?.rate).toBe(100);
  });

  test("115 Agency Director: parent 95, no Bonus rate row → 95", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: TERM_ACCEL_PARENT,
      applicationDate: TODAY,
      rateRows: [row(TERM_ACCEL_PARENT, 95)],
      productMetadata: TERM_ACCEL_META,
    });
    expect(result?.rate).toBe(95);
  });

  test("90 Assurance Advisor: parent 70, no Bonus rate row → 70", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: TERM_ACCEL_PARENT,
      applicationDate: TODAY,
      rateRows: [row(TERM_ACCEL_PARENT, 70)],
      productMetadata: TERM_ACCEL_META,
    });
    expect(result?.rate).toBe(70);
  });
});

// =============================================================================
// Negative locks: non-bonus products MUST NOT pick up the Bonus
// =============================================================================

describe("Lincoln non-bonus products do not accidentally sum Bonus", () => {
  test("WealthAccelerate IUL at position 130: returns 100 only", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: WEALTH_ACCEL,
      applicationDate: TODAY,
      rateRows: [
        row(WEALTH_ACCEL, 100),
        row(TERM_ACCEL_PARENT, 100),
        row(TERM_ACCEL_BONUS, 10),
      ],
      productMetadata: WEALTH_ACCEL_META,
    });
    expect(result?.rate).toBe(100);
  });

  test("Bonus variant looked up directly returns its own rate (no double-count)", () => {
    // This is the Bonus variant product itself (e.g. resolver called for Bonus
    // product id directly). Caller treats it as a non-bonus product (its own
    // metadata has has_bonus_column=false). Should return 10, not 110.
    const bonusVariantMeta: ProductMetadata = {
      id: TERM_ACCEL_BONUS,
      has_bonus_column: false,
      bonus_variant_product_id: null,
    };
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: TERM_ACCEL_BONUS,
      applicationDate: TODAY,
      rateRows: [row(TERM_ACCEL_PARENT, 100), row(TERM_ACCEL_BONUS, 10)],
      productMetadata: bonusVariantMeta,
    });
    expect(result?.rate).toBe(10);
  });

  test("has_bonus_column=true but bonus_variant_product_id=null: no lookup attempted", () => {
    const meta: ProductMetadata = {
      id: TERM_ACCEL_PARENT,
      has_bonus_column: true,
      bonus_variant_product_id: null,
    };
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: TERM_ACCEL_PARENT,
      applicationDate: TODAY,
      rateRows: [row(TERM_ACCEL_PARENT, 100), row(TERM_ACCEL_BONUS, 10)],
      productMetadata: meta,
    });
    expect(result?.rate).toBe(100);
  });
});

// =============================================================================
// Time-stamping
// =============================================================================

describe("time-stamped rate windows", () => {
  test("application_date in the closed window picks the closed row", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: SENIOR_CHOICE,
      applicationDate: D60_AGO,
      rateRows: [
        row(SENIOR_CHOICE, 75, "position_default", D90_AGO, D30_AGO),
        row(SENIOR_CHOICE, 100, "position_default", D30_AGO, null),
      ],
      productMetadata: SENIOR_CHOICE_META,
    });
    expect(result?.rate).toBe(75);
  });

  test("application_date in the open window picks the open row", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: SENIOR_CHOICE,
      applicationDate: TODAY,
      rateRows: [
        row(SENIOR_CHOICE, 75, "position_default", D90_AGO, D30_AGO),
        row(SENIOR_CHOICE, 100, "position_default", D30_AGO, null),
      ],
      productMetadata: SENIOR_CHOICE_META,
    });
    expect(result?.rate).toBe(100);
  });

  test("application_date BEFORE all windows returns null", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: SENIOR_CHOICE,
      applicationDate: "2025-12-25",
      rateRows: [row(SENIOR_CHOICE, 100, "position_default", D90_AGO, null)],
      productMetadata: SENIOR_CHOICE_META,
    });
    expect(result).toBeNull();
  });

  test("application_date == start_date is INCLUSIVE (matches the open row)", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: SENIOR_CHOICE,
      applicationDate: D30_AGO,
      rateRows: [row(SENIOR_CHOICE, 100, "position_default", D30_AGO, null)],
      productMetadata: SENIOR_CHOICE_META,
    });
    expect(result?.rate).toBe(100);
  });

  test("application_date == end_date is INCLUSIVE (matches the closed row)", () => {
    // Edge case: at the boundary, both windows could match. The closed row is
    // first in the array; the resolver returns the first match. In production,
    // the partial unique index on agent_carrier_rates should prevent two open
    // rows for the same product, but the closed-end-date == open-start-date
    // boundary is data-allowed, so this test locks in resolver behavior.
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: SENIOR_CHOICE,
      applicationDate: D30_AGO,
      rateRows: [
        row(SENIOR_CHOICE, 75, "position_default", D90_AGO, D30_AGO),
        row(SENIOR_CHOICE, 100, "position_default", D30_AGO, null),
      ],
      productMetadata: SENIOR_CHOICE_META,
    });
    expect(result?.rate).toBe(75); // first match wins; closed row is first
  });
});

// =============================================================================
// Missing rate / null handling
// =============================================================================

describe("missing-rate behavior", () => {
  test("no rate rows for the product returns null cleanly", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: SENIOR_CHOICE,
      applicationDate: TODAY,
      rateRows: [row(WEALTH_ACCEL, 100)], // wrong product
      productMetadata: SENIOR_CHOICE_META,
    });
    expect(result).toBeNull();
  });

  test("empty rateRows array returns null", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: SENIOR_CHOICE,
      applicationDate: TODAY,
      rateRows: [],
      productMetadata: SENIOR_CHOICE_META,
    });
    expect(result).toBeNull();
  });

  test("rate row exists but applicationDate is past end_date returns null", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: SENIOR_CHOICE,
      applicationDate: TODAY,
      rateRows: [row(SENIOR_CHOICE, 100, "position_default", D90_AGO, D30_AGO)],
      productMetadata: SENIOR_CHOICE_META,
    });
    expect(result).toBeNull();
  });
});

// =============================================================================
// Source + schedule_code passthrough
// =============================================================================

describe("source and schedule_code passthrough", () => {
  test("source='override' is preserved in the result", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: SENIOR_CHOICE,
      applicationDate: TODAY,
      rateRows: [row(SENIOR_CHOICE, 88, "override")],
      productMetadata: SENIOR_CHOICE_META,
    });
    expect(result?.source).toBe("override");
    expect(result?.rate).toBe(88);
  });

  test("source='position_default' is preserved in the result", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: SENIOR_CHOICE,
      applicationDate: TODAY,
      rateRows: [row(SENIOR_CHOICE, 100, "position_default")],
      productMetadata: SENIOR_CHOICE_META,
    });
    expect(result?.source).toBe("position_default");
  });

  test("schedule_code is passed through from parent rate row", () => {
    const r: AgentRateRow = row(SENIOR_CHOICE, 100, "position_default");
    r.schedule_code = "FC15";
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: SENIOR_CHOICE,
      applicationDate: TODAY,
      rateRows: [r],
      productMetadata: SENIOR_CHOICE_META,
    });
    expect(result?.scheduleCode).toBe("FC15");
  });

  test("schedule_code null passes through as null", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: SENIOR_CHOICE,
      applicationDate: TODAY,
      rateRows: [row(SENIOR_CHOICE, 100)], // schedule_code defaults null
      productMetadata: SENIOR_CHOICE_META,
    });
    expect(result?.scheduleCode).toBeNull();
  });
});

// =============================================================================
// Override + Bonus combinations
// =============================================================================

describe("override + bonus combinations", () => {
  test("override on parent + position_default bonus at 130: 105 + 10 = 115", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: TERM_ACCEL_PARENT,
      applicationDate: TODAY,
      rateRows: [
        row(TERM_ACCEL_PARENT, 105, "override"),
        row(TERM_ACCEL_BONUS, 10, "position_default"),
      ],
      productMetadata: TERM_ACCEL_META,
    });
    expect(result?.rate).toBe(115);
    // The result.source reflects the PARENT's source (override), since the
    // bonus is treated as additive metadata, not a separate record.
    expect(result?.source).toBe("override");
  });

  test("override on Bonus variant + position_default parent: 100 + 12 = 112", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: TERM_ACCEL_PARENT,
      applicationDate: TODAY,
      rateRows: [
        row(TERM_ACCEL_PARENT, 100, "position_default"),
        row(TERM_ACCEL_BONUS, 12, "override"),
      ],
      productMetadata: TERM_ACCEL_META,
    });
    expect(result?.rate).toBe(112);
    // Result.source reflects PARENT's source. Bonus override doesn't change
    // the surfaced source — the parent is the canonical product.
    expect(result?.source).toBe("position_default");
  });
});

// =============================================================================
// Decimal precision
// =============================================================================

describe("Bonus variant respects its own time window independent of the parent", () => {
  test("parent open window + Bonus closed window at applicationDate → parent only", () => {
    // Parent rate row covers TODAY. Bonus rate row was active D90→D30 ago and
    // is now closed. Resolving at TODAY: parent matches, Bonus does not, so
    // the resolver returns parent.rate only without summing the stale Bonus.
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: TERM_ACCEL_PARENT,
      applicationDate: TODAY,
      rateRows: [
        row(TERM_ACCEL_PARENT, 100, "position_default", D30_AGO, null),
        row(TERM_ACCEL_BONUS, 10, "position_default", D90_AGO, D30_AGO),
      ],
      productMetadata: TERM_ACCEL_META,
    });
    expect(result?.rate).toBe(100); // bonus excluded — its window expired
  });

  test("backdated lookup hits historical Bonus when both windows cover the date", () => {
    // application_date 60 days ago. Both parent and Bonus had different rates
    // back then. Resolver sums the historical pair, not the current pair.
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: TERM_ACCEL_PARENT,
      applicationDate: D60_AGO,
      rateRows: [
        row(TERM_ACCEL_PARENT, 90, "position_default", D90_AGO, D30_AGO),
        row(TERM_ACCEL_PARENT, 100, "position_default", D30_AGO, null),
        row(TERM_ACCEL_BONUS, 8, "position_default", D90_AGO, D30_AGO),
        row(TERM_ACCEL_BONUS, 10, "position_default", D30_AGO, null),
      ],
      productMetadata: TERM_ACCEL_META,
    });
    expect(result?.rate).toBe(98); // 90 (historical parent) + 8 (historical bonus)
  });
});

describe("decimal precision", () => {
  test("two-decimal rates pass through unchanged (87.50%)", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: SENIOR_CHOICE,
      applicationDate: TODAY,
      rateRows: [row(SENIOR_CHOICE, 87.5)],
      productMetadata: SENIOR_CHOICE_META,
    });
    expect(result?.rate).toBe(87.5);
  });

  test("decimal rate with bonus: 100 + 7.5 = 107.5", () => {
    const result = resolveAgentRate({
      agentId: AGENT,
      productId: TERM_ACCEL_PARENT,
      applicationDate: TODAY,
      rateRows: [row(TERM_ACCEL_PARENT, 100), row(TERM_ACCEL_BONUS, 7.5)],
      productMetadata: TERM_ACCEL_META,
    });
    expect(result?.rate).toBe(107.5);
  });
});
