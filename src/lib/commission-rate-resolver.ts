/**
 * Pure rate resolver — the math primitive of the commission engine.
 *
 * Given an agent, a product, and a date, returns the commission rate that
 * applies. Handles:
 *   - Time-stamped rate windows: picks the row where
 *     start_date <= applicationDate AND (end_date IS NULL OR end_date >= applicationDate).
 *   - Lincoln TermAccelerator 20&30 Bonus math: when productMetadata.has_bonus_column
 *     is true, looks up the matching Bonus variant rate row and SUMS its
 *     commission_pct into the effective rate.
 *   - Missing rates: returns null cleanly so the commission engine (Phase 4)
 *     can skip an upline without breaking the chain.
 *
 * Pure function. No DB access. No side effects. Caller fetches the agent's
 * rate rows + product metadata and passes them in. This makes the math layer
 * fully testable with fixtures, independent of Supabase.
 *
 * Rate units: PERCENTAGE (matches the schema CHECK on agent_carrier_rates and
 * the source CSVs). 100.00 means 100%, 7.50 means 7.5%. The commission engine
 * (Phase 4) divides by 100 when computing a payout amount.
 *
 * Bonus variant lookup: caller pre-resolves the Bonus variant's product_id
 * and passes it in productMetadata.bonus_variant_product_id. The resolver
 * does NOT scan the rate rows for products with the same parent name —
 * cleaner separation of concerns: resolver does math, caller does ID lookup.
 */

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type RateSource = "position_default" | "override";

/**
 * One row from agent_carrier_rates. The resolver only consumes the fields it
 * needs; tenant_id and other columns can be present and are ignored.
 */
export type AgentRateRow = {
  product_id: string;
  rate: number;                 // percentage units (100.00 = 100%)
  source: RateSource;
  schedule_code: string | null;
  start_date: string;           // ISO date "YYYY-MM-DD"
  end_date: string | null;      // null = open window
};

/**
 * Metadata about the product whose rate is being resolved.
 *
 * `has_bonus_column = true` means the product has a sibling "Bonus" variant
 * row in comp_grid_products that should be summed into the effective rate
 * (currently only Lincoln TermAccelerator 20&30 in the Agora master grid).
 *
 * `bonus_variant_product_id` is the UUID of that sibling Bonus variant row,
 * pre-resolved by the caller. Null when has_bonus_column is false or when
 * the Bonus variant happens not to exist for this tenant (defensive — should
 * not occur after a clean Phase 2 bootstrap).
 */
export type ProductMetadata = {
  id: string;
  has_bonus_column: boolean;
  bonus_variant_product_id: string | null;
};

export type ResolvedRate = {
  rate: number;                 // total effective rate in PERCENTAGE units
  source: RateSource;           // source of the parent product's rate
  scheduleCode: string | null;  // schedule code from the parent rate row
};

export type ResolveAgentRateInput = {
  agentId: string;
  productId: string;
  applicationDate: string;      // ISO date "YYYY-MM-DD"
  rateRows: AgentRateRow[];
  productMetadata: ProductMetadata;
};

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Resolve the effective commission rate for an agent on a specific product
 * at a specific date.
 *
 * Returns null when no rate row covers the application date (no templating
 * happened, the product was added after templating, or the agent's rate
 * window is closed and not re-opened). The Phase 4 commission engine treats
 * a null return as "skip this upline cleanly without breaking the chain."
 */
export function resolveAgentRate(input: ResolveAgentRateInput): ResolvedRate | null {
  const parentRate = findActiveRate(input.rateRows, input.productId, input.applicationDate);
  if (!parentRate) return null;

  let totalRate = parentRate.rate;

  // Lincoln TermAccelerator 20&30 Bonus math: sum the parent commission with
  // the matching Bonus variant rate, when both apply at applicationDate.
  // The has_bonus_column check is per-PARENT product, so resolving a
  // non-bonus Lincoln product (WealthAccelerate IUL) at the same position
  // does not accidentally pick up the Bonus variant — the metadata says
  // has_bonus_column=false for that product.
  if (input.productMetadata.has_bonus_column && input.productMetadata.bonus_variant_product_id) {
    const bonusRate = findActiveRate(
      input.rateRows,
      input.productMetadata.bonus_variant_product_id,
      input.applicationDate,
    );
    if (bonusRate) totalRate += bonusRate.rate;
  }

  return {
    rate: totalRate,
    source: parentRate.source,
    scheduleCode: parentRate.schedule_code,
  };
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

/**
 * Find the rate row for a specific product whose [start_date, end_date]
 * window covers the application date. Inclusive on both bounds.
 *
 * If multiple rows match (which violates the partial unique index
 * `agent_carrier_rates_one_active_per_product` and shouldn't happen in
 * practice), returns the first one found. Database invariants prevent this
 * outside of catastrophic data corruption.
 */
function findActiveRate(
  rows: AgentRateRow[],
  productId: string,
  applicationDate: string,
): AgentRateRow | null {
  for (const row of rows) {
    if (row.product_id !== productId) continue;
    if (row.start_date > applicationDate) continue;
    if (row.end_date !== null && row.end_date < applicationDate) continue;
    return row;
  }
  return null;
}
