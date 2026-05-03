/**
 * Carrier and product name canonicalization.
 *
 * Used by the carrier ingest pipeline (Phase 4) to normalize incoming
 * carrier-statement product strings against the master grid. NOT used by the
 * bootstrap parser — the bootstrap preserves CSV names as-is per the user
 * directive "trust the parse output."
 *
 * Three categories of entries:
 *   1. Carrier-name aliases (e.g. typos in carrier statements).
 *   2. Product-name aliases (auto-resolvable to a unique master grid entry).
 *   3. Ambiguous strings that should be flagged for manual review (return
 *      null from canonicalizeProductName; caller surfaces the row in the
 *      Resolve Agents wizard step).
 *
 * Extensible: when a new alias is observed during ingest reconciliation, add
 * it here. When an ambiguous case is resolved by the owner, add it to the
 * AUTO map (or leave in REVIEW if it really is ambiguous).
 */

// -----------------------------------------------------------------------------
// Carrier name aliases
// -----------------------------------------------------------------------------

const CARRIER_ALIASES: Record<string, string> = {
  "Fidelity & Guarantee": "Fidelity & Guaranty", // typo seen in incoming statements
};

export function canonicalizeCarrierName(input: string): string {
  const trimmed = input.trim();
  return CARRIER_ALIASES[trimmed] ?? trimmed;
}

// -----------------------------------------------------------------------------
// Product name aliases (auto-resolvable)
// -----------------------------------------------------------------------------

const PRODUCT_AUTO_ALIASES: Record<string, string> = {
  "Mutual of Omaha Income Advantage IUL":
    "Income Advantage / Life Protection Advantage / IUL",
  "Mutual of Omaha Term Life Express": "Term Life Express",
};

// -----------------------------------------------------------------------------
// Product strings that require manual review
// -----------------------------------------------------------------------------

const PRODUCT_REVIEW_STRINGS = new Set<string>([
  "Moo Term",      // could be Term Life Express OR Term Life Answers
  "FE Express",    // could be Trendsetter LB OR Immediate Solutions on Transamerica
  "IUL Express",   // could be IULE on Mutual of Omaha
]);

/**
 * Strip a leading carrier prefix from a product string if present.
 *
 * Examples:
 *   stripCarrierPrefix("Mutual of Omaha Term Life Express", "Mutual of Omaha")
 *   → "Term Life Express"
 */
export function stripCarrierPrefix(productString: string, carrierName: string): string {
  const normalized = productString.trim();
  const prefix = carrierName.trim();
  if (!prefix) return normalized;
  if (normalized.toLowerCase().startsWith(prefix.toLowerCase() + " ")) {
    return normalized.slice(prefix.length + 1).trim();
  }
  return normalized;
}

/**
 * Canonicalize an incoming product name against the master grid.
 *
 * @returns the canonical product name, OR null if the string requires manual
 *          review (caller should surface in the Resolve Agents UI step).
 */
export function canonicalizeProductName(input: string): string | null {
  const trimmed = input.trim();
  if (PRODUCT_REVIEW_STRINGS.has(trimmed)) return null;
  return PRODUCT_AUTO_ALIASES[trimmed] ?? trimmed;
}

/**
 * Convenience: full canonicalization pass on a (carrier_string, product_string)
 * pair. Returns null product_name if review is required.
 */
export function canonicalize(
  carrierString: string,
  productString: string,
): { carrier_name: string; product_name: string | null } {
  const carrier_name = canonicalizeCarrierName(carrierString);
  const stripped = stripCarrierPrefix(productString, carrier_name);
  const product_name = canonicalizeProductName(stripped);
  return { carrier_name, product_name };
}
