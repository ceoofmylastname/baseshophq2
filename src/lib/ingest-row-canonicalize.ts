import { canonicalizeCarrierName, stripCarrierPrefix, canonicalizeProductName } from "./comp-grid-product-canonicalization";
import type { IngestPolicyPayload } from "./carrier-ingest";

export type CanonicalField =
  | "policy_number"
  | "writing_number"
  | "agent_email"
  | "carrier"
  | "product"
  | "client_first_name"
  | "client_last_name"
  | "client_dob"
  | "application_date"
  | "effective_date"
  | "annual_premium"
  | "status"
  | "notes";

export const CANONICAL_FIELDS: CanonicalField[] = [
  "policy_number",
  "writing_number",
  "agent_email",
  "carrier",
  "product",
  "client_first_name",
  "client_last_name",
  "client_dob",
  "application_date",
  "effective_date",
  "annual_premium",
  "status",
  "notes",
];

/** Map: { csv_header → canonical_field | "" } */
export type ColumnMap = Record<string, CanonicalField | "">;

/** Map: { (carrier, raw_status) → canonical policy_status enum value } */
export type StatusMap = Record<string, string>;

export function statusKey(carrier: string, rawStatus: string): string {
  return `${carrier.trim().toLowerCase()}::${rawStatus.trim().toLowerCase()}`;
}

/**
 * Per-row canonicalization pipeline:
 *   1. Apply column map → canonical fields
 *   2. canonicalizeCarrierName on carrier
 *   3. stripCarrierPrefix + canonicalizeProductName on product
 *      (null product_name = manual review required, surfaced in resolve step)
 *   4. Apply owner status mapping
 *   5. Coerce annual_premium to number
 */
export function canonicalizeRow(
  raw: Record<string, string>,
  columnMap: ColumnMap,
  statusMap: StatusMap,
): { payload: IngestPolicyPayload; needs_product_review: boolean } {
  const out: Partial<Record<CanonicalField, string>> = {};
  for (const [header, field] of Object.entries(columnMap)) {
    if (!field) continue;
    const v = raw[header]?.trim();
    if (v) out[field] = v;
  }

  let carrier = out.carrier ?? "";
  if (carrier) carrier = canonicalizeCarrierName(carrier);

  let product = out.product ?? "";
  let needs_product_review = false;
  if (product) {
    const stripped = carrier ? stripCarrierPrefix(product, carrier) : product;
    const canonical = canonicalizeProductName(stripped);
    if (canonical === null) {
      needs_product_review = true;
      product = stripped; // surface the stripped string for the dropdown
    } else {
      product = canonical;
    }
  }

  const rawStatus = out.status ?? "";
  const mapped = rawStatus ? statusMap[statusKey(carrier, rawStatus)] : undefined;
  const status = mapped ?? rawStatus;

  const payload: IngestPolicyPayload = {
    policy_number: out.policy_number ?? "",
    writing_number: out.writing_number,
    agent_email: out.agent_email,
    carrier: carrier || undefined,
    product: product || undefined,
    client_first_name: out.client_first_name,
    client_last_name: out.client_last_name,
    client_dob: out.client_dob,
    application_date: out.application_date,
    effective_date: out.effective_date,
    annual_premium: out.annual_premium ? Number(out.annual_premium) : undefined,
    status: status || undefined,
    notes: out.notes,
  };

  return { payload, needs_product_review };
}

export const POLICY_STATUS_VALUES = [
  "Draft",
  "Submitted",
  "Pending",
  "Issued",
  "Issue Paid",
  "Terminated",
  "Potential Lapse",
] as const;
