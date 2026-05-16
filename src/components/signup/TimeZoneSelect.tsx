/**
 * Phase 18 PR 2 — TimeZoneSelect
 *
 * Curated ~120-entry IANA whitelist as a <select>. The same list lives at
 * supabase/functions/_shared/signup-validation.ts (TIMEZONE_WHITELIST_ARRAY)
 * for server-side validation. Both lists must stay in sync.
 *
 * Duplication is intentional (locked D1) — no runtime sharing across the
 * Vite browser bundle and Deno is practical without a bundler shim, and the
 * list is curated + stable.
 *
 * Browser-detected default: Intl.DateTimeFormat().resolvedOptions().timeZone.
 * If the detected tz is not in the whitelist, fall back to America/New_York.
 */

import { useId } from "react";
import { Label } from "@/components/ui/label";

export const TIMEZONE_OPTIONS: readonly string[] = [
  // North America
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
  // UTC
  "UTC",
];

const TIMEZONE_OPTIONS_SET: ReadonlySet<string> = new Set(TIMEZONE_OPTIONS);

/**
 * Detect the browser's IANA tz, returning America/New_York if it's not in
 * the whitelist (or the API is unavailable).
 */
export function detectDefaultTimeZone(): string {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && TIMEZONE_OPTIONS_SET.has(detected)) return detected;
  } catch {
    // fall through
  }
  return "America/New_York";
}

type Props = {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  required?: boolean;
};

export function TimeZoneSelect({ value, onChange, label = "Time zone", required }: Props) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <select
        id={id}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-10 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {TIMEZONE_OPTIONS.map((tz) => (
          <option key={tz} value={tz} className="bg-background text-foreground">
            {tz}
          </option>
        ))}
      </select>
    </div>
  );
}
