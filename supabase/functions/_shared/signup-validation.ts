/**
 * Phase 18 PR 2 — pure validators shared by the signup-checkout Edge Function
 * handler. No Deno/npm imports. Importable from bun tests.
 *
 * Exports (per locked D2):
 *   - validateTier
 *   - validateInterval
 *   - validateEmailFormat
 *   - validateNonEmpty
 *   - validateTimeZone
 *   - slugifyAgencyName
 *   - TIMEZONE_WHITELIST (Set<string>)
 *
 * NOTE on duplication (decision D1, surfaced under Deviations):
 *   The same IANA whitelist is duplicated as a `TIMEZONE_OPTIONS` array in
 *   src/components/signup/TimeZoneSelect.tsx for browser-side use. Module
 *   sharing across Deno (`jsr:` / `npm:`) and the Vite browser bundle is not
 *   practical without a bundler-level shim; the list is curated and stable,
 *   so we accept the duplication. Both lists must stay in sync; the file in
 *   each location names this constraint at the top.
 */

export type SignupTier = "starter" | "growth" | "pro";
export type SignupTierWithEnterprise = SignupTier | "enterprise";
export type SignupInterval = "monthly" | "annual";

// ---------------------------------------------------------------------------
// Curated IANA timezone whitelist (~120 entries; D1)
// Regions: US/Canada/Mexico, Central + South America, Europe/UK/Iceland,
// Africa, Middle East, Asia, Australia/NZ, Pacific.
// ---------------------------------------------------------------------------
export const TIMEZONE_WHITELIST_ARRAY: readonly string[] = [
  // North America (US/Canada/Mexico)
  "America/New_York",
  "America/Detroit",
  "America/Kentucky/Louisville",
  "America/Indiana/Indianapolis",
  "America/Chicago",
  "America/Indiana/Knox",
  "America/Menominee",
  "America/Denver",
  "America/Boise",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Juneau",
  "America/Sitka",
  "America/Nome",
  "America/Adak",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Halifax",
  "America/St_Johns",
  "America/Winnipeg",
  "America/Edmonton",
  "America/Vancouver",
  "America/Regina",
  "America/Whitehorse",
  "America/Yellowknife",
  "America/Mexico_City",
  "America/Cancun",
  "America/Merida",
  "America/Monterrey",
  "America/Chihuahua",
  "America/Hermosillo",
  "America/Mazatlan",
  "America/Tijuana",
  // Central / South America
  "America/Belize",
  "America/Costa_Rica",
  "America/El_Salvador",
  "America/Guatemala",
  "America/Managua",
  "America/Panama",
  "America/Tegucigalpa",
  "America/Bogota",
  "America/Caracas",
  "America/Lima",
  "America/Guayaquil",
  "America/La_Paz",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Recife",
  "America/Fortaleza",
  "America/Montevideo",
  "America/Asuncion",
  "America/Cuiaba",
  // Europe / UK / Iceland
  "Europe/London",
  "Europe/Dublin",
  "Atlantic/Reykjavik",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/Amsterdam",
  "Europe/Luxembourg",
  "Europe/Berlin",
  "Europe/Zurich",
  "Europe/Vienna",
  "Europe/Rome",
  "Europe/Copenhagen",
  "Europe/Oslo",
  "Europe/Stockholm",
  "Europe/Helsinki",
  "Europe/Tallinn",
  "Europe/Riga",
  "Europe/Vilnius",
  "Europe/Warsaw",
  "Europe/Prague",
  "Europe/Bratislava",
  "Europe/Budapest",
  "Europe/Bucharest",
  "Europe/Sofia",
  "Europe/Athens",
  "Europe/Belgrade",
  "Europe/Zagreb",
  "Europe/Sarajevo",
  "Europe/Ljubljana",
  "Europe/Istanbul",
  "Europe/Kiev",
  "Europe/Moscow",
  // Africa
  "Africa/Casablanca",
  "Africa/Algiers",
  "Africa/Tunis",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Africa/Accra",
  "Africa/Addis_Ababa",
  // Middle East
  "Asia/Jerusalem",
  "Asia/Beirut",
  "Asia/Amman",
  "Asia/Damascus",
  "Asia/Baghdad",
  "Asia/Riyadh",
  "Asia/Qatar",
  "Asia/Dubai",
  "Asia/Tehran",
  // Asia
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Kathmandu",
  "Asia/Yangon",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Manila",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  // Australia / NZ
  "Australia/Perth",
  "Australia/Adelaide",
  "Australia/Darwin",
  "Australia/Brisbane",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Hobart",
  "Pacific/Auckland",
  "Pacific/Chatham",
  // Pacific
  "Pacific/Fiji",
  "Pacific/Guam",
  "Pacific/Port_Moresby",
  "Pacific/Tahiti",
  "Pacific/Pago_Pago",
  "Pacific/Apia",
  "Pacific/Tongatapu",
  // UTC reference
  "UTC",
];

export const TIMEZONE_WHITELIST: ReadonlySet<string> = new Set(TIMEZONE_WHITELIST_ARRAY);

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export function validateTier(value: unknown): { ok: true; tier: SignupTier } | { ok: false; code: "enterprise_not_self_serve" | "validation_failed"; message: string } {
  if (value === "enterprise") {
    return { ok: false, code: "enterprise_not_self_serve", message: "Enterprise plans are sales-led. Contact sales to provision an Enterprise subscription." };
  }
  if (value === "starter" || value === "growth" || value === "pro") {
    return { ok: true, tier: value };
  }
  return { ok: false, code: "validation_failed", message: "tier must be one of starter|growth|pro" };
}

export function validateInterval(value: unknown): { ok: true; interval: SignupInterval } | { ok: false; code: "validation_failed"; message: string } {
  if (value === "monthly" || value === "annual") {
    return { ok: true, interval: value };
  }
  return { ok: false, code: "validation_failed", message: "interval must be monthly|annual" };
}

/**
 * Lightweight email format check. Mirrors the Phase 1 demo_bookings policy
 * CHECK (email LIKE '%_@__%.__%') logic but as a JS regex. Not exhaustive —
 * the Stripe email validator and Supabase auth schema enforce the real rules.
 */
export function validateEmailFormat(value: unknown): { ok: true; email: string } | { ok: false; code: "validation_failed"; message: string } {
  if (typeof value !== "string") {
    return { ok: false, code: "validation_failed", message: "email is required" };
  }
  const trimmed = value.trim();
  // a@b.c minimum; one @, at least one dot in the domain, no whitespace
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(trimmed)) {
    return { ok: false, code: "validation_failed", message: "email format is invalid" };
  }
  return { ok: true, email: trimmed };
}

/** Returns { ok: true, value } if the input trims to a non-empty string. */
export function validateNonEmpty(value: unknown, fieldLabel: string): { ok: true; value: string } | { ok: false; code: "validation_failed"; message: string } {
  if (typeof value !== "string") {
    return { ok: false, code: "validation_failed", message: `${fieldLabel} is required` };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, code: "validation_failed", message: `${fieldLabel} is required` };
  }
  return { ok: true, value: trimmed };
}

/**
 * Timezone validation: candidate MUST appear in TIMEZONE_WHITELIST.
 * Tightened from a loose prefix check per locked D1.
 */
export function validateTimeZone(value: unknown): { ok: true; timeZone: string } | { ok: false; code: "validation_failed"; message: string } {
  if (typeof value !== "string") {
    return { ok: false, code: "validation_failed", message: "timeZone is required" };
  }
  const trimmed = value.trim();
  if (!TIMEZONE_WHITELIST.has(trimmed)) {
    return { ok: false, code: "validation_failed", message: "timeZone is not in the supported list" };
  }
  return { ok: true, timeZone: trimmed };
}

// ---------------------------------------------------------------------------
// Slugify (D4)
// ---------------------------------------------------------------------------

const MAX_SLUG_LEN = 50;

function trimDashes(s: string): string {
  return s.replace(/^-+/, "").replace(/-+$/, "");
}

/**
 * Slugify rules (locked D4):
 *   1. Lowercase
 *   2. NFD-normalize + strip combining marks (so "José" → "Jose")
 *   3. Replace any non-[a-z0-9] with "-"
 *   4. Collapse consecutive dashes to one
 *   5. Strip leading/trailing dashes
 *   6. Truncate to MAX_SLUG_LEN (50); strip a trailing dash if truncate
 *      ended on one
 *   7. If empty after all of the above, return "agency-" + 8 hex chars
 *      (matches regex `^agency-[a-f0-9]{8}$`)
 */
export function slugifyAgencyName(input: string): string {
  if (typeof input !== "string") {
    return emptyFallback();
  }
  let s = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Drop apostrophes / quotes so "José's" becomes "joses" rather than
    // "jose-s". Then replace any other non-[a-z0-9] with a dash.
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-");
  s = s.replace(/-{2,}/g, "-");
  s = trimDashes(s);
  if (s.length > MAX_SLUG_LEN) {
    s = s.slice(0, MAX_SLUG_LEN);
    s = trimDashes(s);
  }
  if (s.length === 0) {
    return emptyFallback();
  }
  return s;
}

function emptyFallback(): string {
  // crypto.randomUUID exists on Deno, Bun, and modern browsers (and is
  // available via globalThis in all three). Slice 8 hex chars from the UUID
  // (UUIDs are hex+dashes, lowercase). Strip dashes first, then slice(0, 8)
  // so the result is exactly 8 hex chars matching ^[a-f0-9]{8}$.
  const u = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.()
    ?? // fallback if randomUUID is absent for some reason: build from Math.random hex
       Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const hex = u.replace(/-/g, "").slice(0, 8);
  return `agency-${hex}`;
}
