/**
 * Pure spread-math calculator for the commission engine.
 *
 * Mirrors the algorithm in the SQL `recalculate_policy_payouts` RPC. Lives in
 * TypeScript for two reasons:
 *
 *   1. Unit testability — the SQL engine is tested via integration smoke, but
 *      the math itself is deterministic and worth fast-feedback unit tests
 *      against fixtures.
 *   2. UI previews — the eventual Phase 4 commission preview UI ("if this
 *      goes Issued, who gets what") can call this function client-side without
 *      hitting the database.
 *
 * This module is INTENTIONALLY isolated from rate resolution. The caller is
 * responsible for resolving each agent's rate at the policy's application_date
 * (using `commission-rate-resolver.ts` from Phase 3a) and passing the rates
 * pre-resolved. This keeps the spread math testable independent of the date /
 * rate-row plumbing.
 *
 * Invariants the SQL RPC also enforces:
 *   - Writing agent (chain[0]) payout = premium × rate / 100.
 *   - Each upline's payout = premium × max(0, rate − high_water) / 100, where
 *     high_water is the maximum rate of any agent below this upline in the
 *     chain that has already been processed.
 *   - Missing rate (null) → treated as 0%; chain continues, no payout for
 *     that link.
 *   - Negative or zero spread → no payout row written.
 */

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * One link in the upline chain. The caller resolves the rate at the policy's
 * application_date (via the Phase 3a resolver) before passing it in. The Lincoln
 * Bonus variant rate, when applicable, is already SUMMED into this `rate`
 * field — the spread calculator does not look at it separately.
 */
export type ChainLink = {
  agentId: string;
  positionId: string | null;
  rate: number | null;       // percentage units (100 = 100%); null = no rate at app date
  scheduleCode: string | null;
};

export type SpreadPayout = {
  agentId: string;
  positionId: string | null;
  rate: number;              // effective rate used (after Lincoln Bonus sum)
  scheduleCode: string | null;
  spread: number;            // payout rate (rate - high_water for uplines, full rate for writing agent)
  amount: number;            // dollar payout (premium × spread / 100)
  isOverride: boolean;       // false for writing agent, true for uplines
};

export type ComputeChainPayoutsInput = {
  premium: number;
  /**
   * Ordered chain. chain[0] is the writing agent. chain[1..N] are uplines in
   * upward order (immediate upline at index 1, top of chain at index N).
   */
  chain: ChainLink[];
};

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export function computeChainPayouts(input: ComputeChainPayoutsInput): SpreadPayout[] {
  const payouts: SpreadPayout[] = [];
  let highWater = 0;

  for (let i = 0; i < input.chain.length; i++) {
    const link = input.chain[i]!;
    const rate = link.rate ?? 0;

    let spread: number;
    let isOverride: boolean;
    if (i === 0) {
      spread = rate;
      isOverride = false;
    } else {
      spread = rate - highWater;
      isOverride = true;
    }

    if (rate > highWater) highWater = rate;

    if (spread <= 0) continue;

    const amount = round2(input.premium * (spread / 100));
    payouts.push({
      agentId: link.agentId,
      positionId: link.positionId,
      rate,
      scheduleCode: link.scheduleCode,
      spread,
      amount,
      isOverride,
    });
  }

  return payouts;
}

// Round to two decimals to match NUMERIC(14,2) on the column.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
