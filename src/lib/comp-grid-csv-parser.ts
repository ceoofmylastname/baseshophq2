/**
 * Agora master grid CSV parser.
 *
 * Parses the bundled Life and Annuity CSVs into a normalized shape ready for
 * the bootstrap orchestrator (`comp-grid-bootstrap.ts`) to insert into:
 *   - comp_grid_positions
 *   - comp_grid_carriers
 *   - comp_grid_products
 *   - comp_grid_rates
 *
 * CSV layout (per agora-life.csv and agora-annuity.csv):
 *   - Leading blank rows (typically 3) get skipped.
 *   - Carrier row: column 0 is "Agora Level" (life) or "Agora Annuity Grid"
 *     (annuity). Carrier names appear sparsely; each spreads RIGHT until the
 *     next non-empty carrier name.
 *   - Product row: same sparse-spread pattern. May span multiple physical
 *     lines because of embedded newlines in quoted fields (Lincoln
 *     "TermAccelerator 20&30", AIG "Guaranteed Issue Whole Life"). papaparse
 *     handles the multi-line collapse.
 *   - Column-type row: each cell is "Commission", "Schedule", an age band
 *     marker like "0-60" or "Age 0-75", or "Bonus" (Lincoln only).
 *   - Data rows: column 0 is the position name (e.g. "130 Division
 *     Executive"). Subsequent cells are the values for each (carrier, product,
 *     column type) tuple. The last position (80 Associate) is non-commissioned
 *     and contains either empty cells (life) or "LOA" (annuity) — both yield
 *     zero rate rows.
 *
 * Schedule pairing rule (carrier-scoped, since-previous-Schedule):
 *   Within each carrier's column block, a Schedule column applies to ALL rate
 *   columns since the previous Schedule in the same carrier (or since the
 *   start of the carrier block if no prior Schedule exists in this carrier).
 *   This matches the Annuity layout (Athene's two products share GA, Nassau's
 *   two products share their schedule) and Life Liberty Bankers (SIMPL
 *   Preferred + SIMPL Standard share CD).
 *
 *   Trade-off: in the Life Foresters block, this rule assigns the MGA3
 *   schedule to Strong Foundation, Smart UL, and BrightFuture JWL even though
 *   the wiki notes those three products as "no schedule code." schedule_code
 *   is metadata only — not used in commission math — so this over-assignment
 *   is a soft mismatch the owner can correct via the Master Comp Grid edit
 *   UI later. The rate values themselves are unaffected.
 *
 * Embedded age band rule:
 *   If a product NAME ends with a numeric range like "Advantage Plus 100 0-65"
 *   (regex: /\b\d+-\d+$/), the parser splits it into product "Advantage Plus
 *   100" with variant "Age 0-65". This handles the Foresters case where the
 *   age band lives in the product name rather than the column-type row.
 */

import Papa from "papaparse";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type ProductType = "life" | "annuity";

export type ParsedPosition = {
  position_code: string;          // "130", "125", ... "80"
  position_name: string;          // "Division Executive", "Associate"
  sort_order: number;             // 130, 125, ... 80
  is_commissioned: boolean;       // false only for "80 Associate"
};

export type ParsedCarrier = {
  carrier_name: string;
  product_type: ProductType;
};

export type ParsedProduct = {
  carrier_name: string;
  product_name: string;
  product_variant: string | null;
  product_type: ProductType;
  has_bonus_column: boolean;
};

export type ParsedRate = {
  position_code: string;
  carrier_name: string;
  product_name: string;
  product_variant: string | null;
  commission_pct: number;          // 100.00 for 100%, 7.50 for 7.5%
  schedule_code: string | null;
  product_type: ProductType;
};

export type ParsedAgora = {
  product_type: ProductType;
  positions: ParsedPosition[];
  carriers: ParsedCarrier[];
  products: ParsedProduct[];
  rates: ParsedRate[];
};

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Parse one Agora master grid CSV into the normalized shape.
 *
 * @param csv  Raw CSV string (papaparse handles quoted multi-line fields).
 * @param productType  'life' or 'annuity' — determines column-type
 *                     interpretation and the product_type tag on every row.
 */
export function parseAgoraCsv(
  csv: string,
  productType: ProductType,
): ParsedAgora {
  const matrix = parseCsvToMatrix(csv);

  const { carrierRow, productRow, columnTypeRow, dataStartIdx } =
    findHeaderRows(matrix);

  const carriersByCol = spreadFill(carrierRow);
  const rawProductsByCol = spreadFill(productRow);
  const columnTypes = columnTypeRow.map((c) => c.trim());

  // Split embedded age bands out of product names: "Advantage Plus 100 0-65"
  // → product "Advantage Plus 100" with variant "Age 0-65".
  const productInfoByCol = rawProductsByCol.map((p) => splitEmbeddedAgeBand(p));

  const positions = collectPositions(matrix, dataStartIdx);
  const carriers = collectDistinctCarriers(
    carriersByCol,
    columnTypes,
    productType,
  );
  const products = collectDistinctProducts(
    carriersByCol,
    productInfoByCol,
    columnTypes,
    productType,
  );
  const rates = collectRates(
    matrix,
    dataStartIdx,
    carriersByCol,
    productInfoByCol,
    columnTypes,
    productType,
  );

  return { product_type: productType, positions, carriers, products, rates };
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

function parseCsvToMatrix(csv: string): string[][] {
  const result = Papa.parse<string[]>(csv, {
    skipEmptyLines: false,
    dynamicTyping: false,
  });
  return result.data.map((row) => row.map((cell) => (cell ?? "").toString()));
}

/**
 * Find the carrier row, product row, and column-type row in the matrix.
 *
 * Strategy: scan top-down for the first row whose column 0 starts with "Agora"
 * — that's the carrier row. The next two non-empty rows are the product row
 * and the column-type row.
 */
function findHeaderRows(matrix: string[][]): {
  carrierRow: string[];
  productRow: string[];
  columnTypeRow: string[];
  dataStartIdx: number;
} {
  let carrierIdx = -1;
  for (let i = 0; i < matrix.length; i++) {
    const cell0 = matrix[i]?.[0]?.trim() ?? "";
    if (cell0.toLowerCase().startsWith("agora")) {
      carrierIdx = i;
      break;
    }
  }
  if (carrierIdx === -1) {
    throw new Error("Could not find carrier row (column 0 starting with 'Agora')");
  }

  // Next non-empty row is products
  let productIdx = -1;
  for (let i = carrierIdx + 1; i < matrix.length; i++) {
    if (rowIsNotBlank(matrix[i]!)) {
      productIdx = i;
      break;
    }
  }
  if (productIdx === -1) throw new Error("Could not find product row");

  // Next non-empty row is column types
  let typeIdx = -1;
  for (let i = productIdx + 1; i < matrix.length; i++) {
    if (rowIsNotBlank(matrix[i]!)) {
      typeIdx = i;
      break;
    }
  }
  if (typeIdx === -1) throw new Error("Could not find column-type row");

  // Normalize widths — every row pad/truncate to the carrier row width
  const width = matrix[carrierIdx]!.length;
  const norm = (row: string[]) =>
    row.length === width
      ? row
      : row.length < width
      ? [...row, ...new Array(width - row.length).fill("")]
      : row.slice(0, width);

  return {
    carrierRow: norm(matrix[carrierIdx]!),
    productRow: norm(matrix[productIdx]!),
    columnTypeRow: norm(matrix[typeIdx]!),
    dataStartIdx: typeIdx + 1,
  };
}

function rowIsNotBlank(row: string[]): boolean {
  return row.some((c) => (c ?? "").toString().trim().length > 0);
}

/**
 * Sparse-spread fill: replace empty cells with the most recent non-empty cell
 * to the LEFT. Column 0 is left as-is (it's the row label / position column).
 *
 * Also normalizes embedded newlines (from multi-line quoted CSV fields) into
 * a single space.
 */
function spreadFill(row: string[]): string[] {
  const out: string[] = [];
  let last = "";
  for (let i = 0; i < row.length; i++) {
    const raw = (row[i] ?? "").toString().replace(/\s+/g, " ").trim();
    if (i === 0) {
      out.push(raw);
      continue;
    }
    if (raw.length > 0) {
      last = raw;
      out.push(raw);
    } else {
      out.push(last);
    }
  }
  return out;
}

const POSITION_PATTERN = /^(\d+)\s+(.+)$/;

function collectPositions(
  matrix: string[][],
  dataStartIdx: number,
): ParsedPosition[] {
  const positions: ParsedPosition[] = [];
  for (let i = dataStartIdx; i < matrix.length; i++) {
    const cell0 = (matrix[i]?.[0] ?? "").toString().trim();
    if (!cell0) continue;
    const match = cell0.match(POSITION_PATTERN);
    if (!match) continue;
    const code = match[1]!;
    const name = match[2]!.trim();
    const sort_order = parseInt(code, 10);
    // 80 Associate is the only non-commissioned position in the Agora ladder
    const is_commissioned = sort_order >= 90;
    positions.push({
      position_code: code,
      position_name: name,
      sort_order,
      is_commissioned,
    });
  }
  return positions;
}

const RATE_COLUMN_TYPES = new Set(["Commission", "Bonus"]);
const SCHEDULE_COLUMN_TYPE = "Schedule";

/** Returns true if a column-type cell represents a rate column (commission, bonus, or age band). */
function isRateColumn(colType: string): boolean {
  if (!colType) return false;
  if (RATE_COLUMN_TYPES.has(colType)) return true;
  return looksLikeAgeBandLabel(colType);
}

/** "0-60", "61-80", "Age 0-75" → true. "Schedule", "Commission", "Bonus" → false. */
function looksLikeAgeBandLabel(s: string): boolean {
  return /^(?:Age\s+)?\d+-\d+$/i.test(s.trim());
}

function normalizeAgeBandLabel(s: string): string {
  const trimmed = s.trim();
  return /^Age\s+/i.test(trimmed) ? `Age ${trimmed.replace(/^Age\s+/i, "")}` : `Age ${trimmed}`;
}

/**
 * Detect "<product> <range>" pattern at the end of a name (e.g.
 * "Advantage Plus 100 0-65") and split into (name, "Age 0-65").
 *
 * Conservative: only triggers on " <digits>-<digits>" trailing exactly.
 * Won't false-positive on "Term/Builder +3 IUL(A)" or "20/30Yr Term".
 */
function splitEmbeddedAgeBand(productString: string): {
  product_name: string;
  embedded_variant: string | null;
} {
  const m = productString.match(/^(.+?)\s+(\d+-\d+)$/);
  if (!m) return { product_name: productString, embedded_variant: null };
  return { product_name: m[1]!.trim(), embedded_variant: `Age ${m[2]!}` };
}

function collectDistinctCarriers(
  carriersByCol: string[],
  columnTypes: string[],
  productType: ProductType,
): ParsedCarrier[] {
  const seen = new Set<string>();
  const out: ParsedCarrier[] = [];
  for (let col = 1; col < carriersByCol.length; col++) {
    const carrier = carriersByCol[col]?.trim() ?? "";
    if (!carrier) continue;
    // Only include carriers that have at least one rate column
    if (!isRateColumn(columnTypes[col] ?? "")) continue;
    if (seen.has(carrier)) continue;
    seen.add(carrier);
    out.push({ carrier_name: carrier, product_type: productType });
  }
  return out;
}

function collectDistinctProducts(
  carriersByCol: string[],
  productInfoByCol: { product_name: string; embedded_variant: string | null }[],
  columnTypes: string[],
  productType: ProductType,
): ParsedProduct[] {
  // First pass: identify which (carrier, product_name) tuples have a Bonus
  // column (so we can flag has_bonus_column on the parent row).
  const bonusParents = new Set<string>();
  for (let col = 1; col < columnTypes.length; col++) {
    if (columnTypes[col] === "Bonus") {
      const carrier = carriersByCol[col]?.trim() ?? "";
      const productName = productInfoByCol[col]?.product_name ?? "";
      if (carrier && productName) bonusParents.add(`${carrier}|||${productName}`);
    }
  }

  const seen = new Set<string>();
  const out: ParsedProduct[] = [];
  for (let col = 1; col < columnTypes.length; col++) {
    const colType = columnTypes[col] ?? "";
    if (!isRateColumn(colType)) continue;

    const carrier = carriersByCol[col]?.trim() ?? "";
    const info = productInfoByCol[col];
    if (!carrier || !info?.product_name) continue;

    const variant = computeVariant(colType, info.embedded_variant);
    const key = `${carrier}|||${info.product_name}|||${variant ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const isBonusVariant = colType === "Bonus";
    const has_bonus_column =
      !isBonusVariant && bonusParents.has(`${carrier}|||${info.product_name}`);

    out.push({
      carrier_name: carrier,
      product_name: info.product_name,
      product_variant: variant,
      product_type: productType,
      has_bonus_column,
    });
  }
  return out;
}

/** Resolve the variant for a rate column from its column-type and embedded age band. */
function computeVariant(
  colType: string,
  embeddedVariant: string | null,
): string | null {
  if (colType === "Bonus") return "Bonus";
  if (looksLikeAgeBandLabel(colType)) return normalizeAgeBandLabel(colType);
  // No column-type variant; fall back to embedded-name variant if present.
  return embeddedVariant;
}

function collectRates(
  matrix: string[][],
  dataStartIdx: number,
  carriersByCol: string[],
  productInfoByCol: { product_name: string; embedded_variant: string | null }[],
  columnTypes: string[],
  productType: ProductType,
): ParsedRate[] {
  const scheduleByCol = computeScheduleColumnAssignments(carriersByCol, columnTypes);

  const rates: ParsedRate[] = [];

  for (let rowIdx = dataStartIdx; rowIdx < matrix.length; rowIdx++) {
    const row = matrix[rowIdx]!;
    const cell0 = (row[0] ?? "").toString().trim();
    if (!cell0) continue;
    const positionMatch = cell0.match(POSITION_PATTERN);
    if (!positionMatch) continue;
    const positionCode = positionMatch[1]!;
    const sortOrder = parseInt(positionCode, 10);
    if (sortOrder < 90) continue; // 80 Associate is non-commissioned, skip rates

    for (let col = 1; col < columnTypes.length; col++) {
      const colType = columnTypes[col] ?? "";
      if (!isRateColumn(colType)) continue;

      const carrier = carriersByCol[col]?.trim() ?? "";
      const info = productInfoByCol[col];
      if (!carrier || !info?.product_name) continue;

      const cellValue = (row[col] ?? "").toString().trim();
      const commission = parsePercent(cellValue);
      if (commission === null) continue; // empty cell or "LOA" → no rate row

      const variant = computeVariant(colType, info.embedded_variant);
      const scheduleCol = scheduleByCol[col] ?? -1;
      const scheduleValue =
        scheduleCol >= 0 ? ((row[scheduleCol] ?? "").toString().trim() || null) : null;

      rates.push({
        position_code: positionCode,
        carrier_name: carrier,
        product_name: info.product_name,
        product_variant: variant,
        commission_pct: commission,
        schedule_code: scheduleValue && scheduleValue !== "LOA" ? scheduleValue : null,
        product_type: productType,
      });
    }
  }

  return rates;
}

/**
 * For each rate column, return the column index of the Schedule that applies
 * to it (or -1 if none in the same carrier block).
 *
 * Rule: within each carrier's column run, a Schedule column applies to ALL
 * preceding rate columns since the previous Schedule in the same carrier.
 */
function computeScheduleColumnAssignments(
  carriersByCol: string[],
  columnTypes: string[],
): number[] {
  const assignment = new Array<number>(columnTypes.length).fill(-1);

  // Walk left-to-right within each carrier group
  let col = 1;
  while (col < columnTypes.length) {
    const carrier = carriersByCol[col]?.trim() ?? "";
    if (!carrier) {
      col++;
      continue;
    }
    // Find the end of this carrier's column run
    let end = col;
    while (end < columnTypes.length && (carriersByCol[end]?.trim() ?? "") === carrier) {
      end++;
    }
    // end is exclusive — carrier columns are [col, end)
    assignSchedulesWithinCarrierBlock(col, end, columnTypes, assignment);
    col = end;
  }
  return assignment;
}

function assignSchedulesWithinCarrierBlock(
  start: number,
  end: number,
  columnTypes: string[],
  assignment: number[],
): void {
  // Within [start, end), pair each Schedule column with all preceding rate
  // columns since the previous Schedule (or start).
  let lastScheduleCol = -1;
  for (let i = start; i < end; i++) {
    if (columnTypes[i] === SCHEDULE_COLUMN_TYPE) {
      // This schedule applies to rate columns in (lastScheduleCol, i)
      for (let j = lastScheduleCol + 1 > start ? lastScheduleCol + 1 : start; j < i; j++) {
        if (isRateColumn(columnTypes[j] ?? "")) assignment[j] = i;
      }
      lastScheduleCol = i;
    }
  }
  // Rate columns after the last Schedule in this carrier block remain at -1
  // (no schedule), which is the correct behavior for products with no
  // schedule code (e.g. Foresters Strong Foundation, Lincoln WealthAccelerate
  // IUL).
}

function parsePercent(s: string): number | null {
  if (!s) return null;
  if (s.toUpperCase() === "LOA") return null; // 80 Associate annuity cells
  // Strip trailing % and parse. Accept "120%", "7.50%", "9.75%".
  const cleaned = s.replace(/%/g, "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100) / 100; // two-decimal precision
}
