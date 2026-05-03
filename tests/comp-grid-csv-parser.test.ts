/**
 * Parser unit tests against the actual bundled Agora CSVs.
 *
 * Per the user directive: "trust the parse output, not the spec text."
 *
 * Tests assert exact COUNTS (carriers, product entries, rate rows) against
 * `public/seed/agora-life.csv` and `public/seed/agora-annuity.csv`. They do
 * NOT assert specific rate values for individual cells (those are spot-checked
 * via separate integration tests once the bootstrap is wired).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAgoraCsv } from "../src/lib/comp-grid-csv-parser.ts";
import { mergeBootstrapPayload } from "../src/lib/comp-grid-bootstrap.ts";
import {
  canonicalizeCarrierName,
  canonicalizeProductName,
  stripCarrierPrefix,
} from "../src/lib/comp-grid-product-canonicalization.ts";

const ROOT = join(import.meta.dir, "..");
const LIFE_CSV = readFileSync(join(ROOT, "public/seed/agora-life.csv"), "utf-8");
const ANNUITY_CSV = readFileSync(join(ROOT, "public/seed/agora-annuity.csv"), "utf-8");

const COMMISSIONED_POSITION_COUNT = 9; // 130 down to 90

// -----------------------------------------------------------------------------
// Life CSV parser
// -----------------------------------------------------------------------------

describe("parseAgoraCsv — Life", () => {
  const parsed = parseAgoraCsv(LIFE_CSV, "life");

  test("identifies all 10 Agora positions (9 commissioned + 80 Associate)", () => {
    expect(parsed.positions).toHaveLength(10);
    const codes = parsed.positions.map((p) => p.position_code);
    expect(codes).toEqual(["130", "125", "120", "115", "110", "105", "100", "95", "90", "80"]);
    const associate = parsed.positions.find((p) => p.position_code === "80");
    expect(associate?.is_commissioned).toBe(false);
    expect(associate?.position_name).toBe("Associate");
    const division = parsed.positions.find((p) => p.position_code === "130");
    expect(division?.is_commissioned).toBe(true);
    expect(division?.position_name).toBe("Division Executive");
  });

  test("identifies 11 distinct Life carriers", () => {
    const expected = [
      "American Amicable", "F&G", "Foresters", "NLG", "North American",
      "Transamerica", "Assurity", "Mutual of Omaha", "Lincoln Financial Group",
      "Liberty Bankers", "AIG",
    ];
    expect(parsed.carriers.map((c) => c.carrier_name).sort()).toEqual(expected.sort());
    expect(parsed.carriers).toHaveLength(11);
    expect(parsed.carriers.every((c) => c.product_type === "life")).toBe(true);
  });

  test("Lincoln TermAccelerator 20&30 has Bonus variant + has_bonus_column flag on parent", () => {
    const lincolnProducts = parsed.products.filter(
      (p) => p.carrier_name === "Lincoln Financial Group",
    );
    const term = lincolnProducts.filter((p) => p.product_name.startsWith("TermAccelerator"));
    expect(term.length).toBe(2);

    const parent = term.find((p) => p.product_variant === null);
    const bonus = term.find((p) => p.product_variant === "Bonus");
    expect(parent).toBeDefined();
    expect(bonus).toBeDefined();
    expect(parent!.has_bonus_column).toBe(true);
    expect(bonus!.has_bonus_column).toBe(false);
  });

  test("Secure Life Plus splits into two age-band variants from column-type row", () => {
    const slp = parsed.products.filter(
      (p) => p.carrier_name === "American Amicable" && p.product_name === "Secure Life Plus",
    );
    expect(slp.length).toBe(2);
    const variants = slp.map((p) => p.product_variant).sort();
    expect(variants).toEqual(["Age 0-60", "Age 61-80"]);
  });

  test("Foresters Advantage Plus 100 0-65 splits via embedded age-band detection", () => {
    const ap = parsed.products.find(
      (p) =>
        p.carrier_name === "Foresters" &&
        p.product_name === "Advantage Plus 100" &&
        p.product_variant === "Age 0-65",
    );
    expect(ap).toBeDefined();
    // The pre-split string "Advantage Plus 100 0-65" should NOT exist as a product_name
    expect(
      parsed.products.some((p) => p.product_name === "Advantage Plus 100 0-65"),
    ).toBe(false);
  });

  test("80 Associate yields zero rate rows", () => {
    expect(parsed.rates.every((r) => r.position_code !== "80")).toBe(true);
  });

  test("every rate row references a known commissioned position", () => {
    const commissionedCodes = new Set(
      parsed.positions.filter((p) => p.is_commissioned).map((p) => p.position_code),
    );
    for (const r of parsed.rates) expect(commissionedCodes.has(r.position_code)).toBe(true);
  });

  test("rates are stored in PERCENTAGE units, bounded 0..200", () => {
    for (const r of parsed.rates) {
      expect(r.commission_pct).toBeGreaterThanOrEqual(0);
      expect(r.commission_pct).toBeLessThanOrEqual(200);
    }
  });

  test("every rate row's (carrier, product, variant) tuple appears in products[]", () => {
    const productKeys = new Set(
      parsed.products.map(
        (p) => `${p.carrier_name}|${p.product_name}|${p.product_variant ?? ""}`,
      ),
    );
    for (const r of parsed.rates) {
      const key = `${r.carrier_name}|${r.product_name}|${r.product_variant ?? ""}`;
      expect(productKeys.has(key)).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------
// Annuity CSV parser
// -----------------------------------------------------------------------------

describe("parseAgoraCsv — Annuity", () => {
  const parsed = parseAgoraCsv(ANNUITY_CSV, "annuity");

  test("identifies all 10 Agora positions (LOA cells on 80 Associate row)", () => {
    expect(parsed.positions).toHaveLength(10);
    const associate = parsed.positions.find((p) => p.position_code === "80");
    expect(associate?.is_commissioned).toBe(false);
  });

  test("identifies 8 distinct Annuity carriers", () => {
    const expected = [
      "Athene", "Fidelity & Guaranty", "Nationwide", "North American",
      "Corebridge", "Equitrust", "Oceanview", "Nassau",
    ];
    expect(parsed.carriers.map((c) => c.carrier_name).sort()).toEqual(expected.sort());
    expect(parsed.carriers).toHaveLength(8);
    expect(parsed.carriers.every((c) => c.product_type === "annuity")).toBe(true);
  });

  test("F&G Accelerator Plus 10 has 3 age-band variants", () => {
    const ap10 = parsed.products.filter(
      (p) =>
        p.carrier_name === "Fidelity & Guaranty" &&
        p.product_name === "Accelerator Plus 10",
    );
    const variants = ap10.map((p) => p.product_variant).sort();
    expect(variants).toEqual(["Age 0-75", "Age 76-80", "Age 81-85"]);
  });

  test("Equitrust MarketEdge Bonus Index has 2 age-band variants", () => {
    const me = parsed.products.filter(
      (p) =>
        p.carrier_name === "Equitrust" && p.product_name === "MarketEdge Bonus Index",
    );
    expect(me.map((p) => p.product_variant).sort()).toEqual(["Age 0-75", "Age 76-80"]);
  });

  test("80 Associate row (all LOA cells) yields zero rate rows", () => {
    expect(parsed.rates.every((r) => r.position_code !== "80")).toBe(true);
  });

  test("every rate row's (carrier, product, variant) tuple appears in products[]", () => {
    const productKeys = new Set(
      parsed.products.map(
        (p) => `${p.carrier_name}|${p.product_name}|${p.product_variant ?? ""}`,
      ),
    );
    for (const r of parsed.rates) {
      const key = `${r.carrier_name}|${r.product_name}|${r.product_variant ?? ""}`;
      expect(productKeys.has(key)).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------
// Combined bootstrap payload
// -----------------------------------------------------------------------------

describe("mergeBootstrapPayload — combined Life + Annuity", () => {
  const life = parseAgoraCsv(LIFE_CSV, "life");
  const annuity = parseAgoraCsv(ANNUITY_CSV, "annuity");
  const merged = mergeBootstrapPayload(life, annuity);

  test("positions deduplicated across Life and Annuity (10 unique codes)", () => {
    expect(merged.positions).toHaveLength(10);
    expect(merged.positions[0]!.position_code).toBe("130"); // sorted DESC by sort_order
    expect(merged.positions[9]!.position_code).toBe("80");
  });

  test("carriers concat to 11 + 8 = 19 (North American dual-listed Life + Annuity)", () => {
    expect(merged.carriers).toHaveLength(19);
    const naCount = merged.carriers.filter((c) => c.carrier_name === "North American").length;
    expect(naCount).toBe(2); // one Life, one Annuity row
  });

  test("rate counts match the actual CSV cell counts (parser-truth, not spec-text)", () => {
    // Life: 39 products × 9 commissioned positions = 351 MAX, minus 7 deliberate
    // null cells from Lincoln TermAccelerator 20&30 Bonus at positions 120 and
    // below = 344 actual rate rows.
    expect(life.products.length).toBe(39);
    expect(life.rates.length).toBe(344);

    // Annuity: 15 products × 9 commissioned positions = 135, fully populated.
    expect(annuity.products.length).toBe(15);
    expect(annuity.rates.length).toBe(15 * COMMISSIONED_POSITION_COUNT);

    // Total parser output across both CSVs.
    expect(merged.products.length).toBe(54);
    expect(merged.rates.length).toBe(479);
  });

  test("Lincoln Bonus is null at positions 120 and below (the 7 missing cells)", () => {
    const bonusRates = life.rates.filter(
      (r) =>
        r.carrier_name === "Lincoln Financial Group" &&
        r.product_name.startsWith("TermAccelerator") &&
        r.product_variant === "Bonus",
    );
    // Bonus has rate values only at positions 130 and 125
    expect(bonusRates.map((r) => r.position_code).sort()).toEqual(["125", "130"]);
    expect(bonusRates.find((r) => r.position_code === "130")?.commission_pct).toBe(10);
    expect(bonusRates.find((r) => r.position_code === "125")?.commission_pct).toBe(5);
  });

  test("merged payload printout (informational — counts surface in test log)", () => {
    // This assertion always passes; the console output is the point. Run with
    // `bun test` and check the line above the assertion summary for the
    // breakdown the user asked to review before applying.
    const lifeRateCols = life.rates.filter((r) => r.position_code === "130").length;
    const annuityRateCols = annuity.rates.filter((r) => r.position_code === "130").length;
    console.log(
      "\n[parser counts] " +
        `positions=${merged.positions.length} ` +
        `(commissioned=${merged.positions.filter((p) => p.is_commissioned).length}, ` +
        `non-commissioned=${merged.positions.filter((p) => !p.is_commissioned).length})  ` +
        `carriers=${merged.carriers.length} (life=${life.carriers.length}, annuity=${annuity.carriers.length})  ` +
        `products=${merged.products.length} (life=${life.products.length}, annuity=${annuity.products.length})  ` +
        `rates=${merged.rates.length} ` +
        `(life=${life.rates.length}=${lifeRateCols}cols×${COMMISSIONED_POSITION_COUNT}pos, ` +
        `annuity=${annuity.rates.length}=${annuityRateCols}cols×${COMMISSIONED_POSITION_COUNT}pos)\n`,
    );
    expect(true).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Canonicalization map
// -----------------------------------------------------------------------------

describe("canonicalization map", () => {
  test("carrier typo aliases resolve", () => {
    expect(canonicalizeCarrierName("Fidelity & Guarantee")).toBe("Fidelity & Guaranty");
    expect(canonicalizeCarrierName("Fidelity & Guaranty")).toBe("Fidelity & Guaranty");
  });

  test("product carrier-prefix strip", () => {
    expect(stripCarrierPrefix("Mutual of Omaha Term Life Express", "Mutual of Omaha")).toBe(
      "Term Life Express",
    );
    expect(stripCarrierPrefix("Term Life Express", "Mutual of Omaha")).toBe(
      "Term Life Express",
    );
  });

  test("auto-resolvable product aliases map to canonical names", () => {
    expect(canonicalizeProductName("Mutual of Omaha Income Advantage IUL")).toBe(
      "Income Advantage / Life Protection Advantage / IUL",
    );
    expect(canonicalizeProductName("Mutual of Omaha Term Life Express")).toBe(
      "Term Life Express",
    );
  });

  test("ambiguous strings flag for manual review (return null)", () => {
    expect(canonicalizeProductName("Moo Term")).toBeNull();
    expect(canonicalizeProductName("FE Express")).toBeNull();
    expect(canonicalizeProductName("IUL Express")).toBeNull();
  });

  test("unknown product strings pass through unchanged", () => {
    expect(canonicalizeProductName("Some Brand New Product")).toBe("Some Brand New Product");
  });
});
