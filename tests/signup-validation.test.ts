/**
 * Phase 18 PR 2 — tests for the pure validators + slugifier in
 * supabase/functions/_shared/signup-validation.ts.
 *
 * Covers the brief's explicit requirements:
 *   - validateTier / validateInterval / validateEmailFormat / validateNonEmpty /
 *     validateTimeZone (whitelist hit + miss)
 *   - slugifyAgencyName edge cases:
 *       (a) Unicode normalization ("José's Agency" → "joses-agency")
 *       (b) consecutive-dash collapse
 *       (c) leading/trailing dash strip
 *       (d) empty fallback regex ^agency-[a-f0-9]{8}$
 *       (e) 50-char truncate
 */

import { describe, expect, test } from "bun:test";
import {
  slugifyAgencyName,
  TIMEZONE_WHITELIST,
  validateEmailFormat,
  validateInterval,
  validateNonEmpty,
  validateTier,
  validateTimeZone,
} from "../supabase/functions/_shared/signup-validation.ts";

describe("validateTier", () => {
  test("starter → ok", () => {
    const r = validateTier("starter");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tier).toBe("starter");
  });
  test("growth → ok", () => {
    const r = validateTier("growth");
    expect(r.ok).toBe(true);
  });
  test("pro → ok", () => {
    const r = validateTier("pro");
    expect(r.ok).toBe(true);
  });
  test("enterprise → enterprise_not_self_serve", () => {
    const r = validateTier("enterprise");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("enterprise_not_self_serve");
  });
  test("garbage string → validation_failed", () => {
    const r = validateTier("ultra");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("validation_failed");
  });
  test("undefined → validation_failed", () => {
    const r = validateTier(undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("validation_failed");
  });
});

describe("validateInterval", () => {
  test("monthly → ok", () => {
    const r = validateInterval("monthly");
    expect(r.ok).toBe(true);
  });
  test("annual → ok", () => {
    const r = validateInterval("annual");
    expect(r.ok).toBe(true);
  });
  test("yearly → validation_failed", () => {
    const r = validateInterval("yearly");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("validation_failed");
  });
  test("undefined → validation_failed", () => {
    const r = validateInterval(undefined);
    expect(r.ok).toBe(false);
  });
});

describe("validateEmailFormat", () => {
  test("valid: alice@example.com → ok", () => {
    const r = validateEmailFormat("alice@example.com");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.email).toBe("alice@example.com");
  });
  test("valid with subdomain: a@b.c.d → ok", () => {
    const r = validateEmailFormat("a@b.c.d");
    expect(r.ok).toBe(true);
  });
  test("invalid: no @ → validation_failed", () => {
    const r = validateEmailFormat("alice-at-example.com");
    expect(r.ok).toBe(false);
  });
  test("invalid: no domain dot → validation_failed", () => {
    const r = validateEmailFormat("alice@example");
    expect(r.ok).toBe(false);
  });
  test("trims surrounding whitespace", () => {
    const r = validateEmailFormat("  alice@example.com  ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.email).toBe("alice@example.com");
  });
  test("non-string → validation_failed", () => {
    const r = validateEmailFormat(42);
    expect(r.ok).toBe(false);
  });
});

describe("validateNonEmpty", () => {
  test("trims and accepts: '  Hello  ' → 'Hello'", () => {
    const r = validateNonEmpty("  Hello  ", "agencyName");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("Hello");
  });
  test("empty string → validation_failed", () => {
    const r = validateNonEmpty("", "agencyName");
    expect(r.ok).toBe(false);
  });
  test("whitespace only → validation_failed", () => {
    const r = validateNonEmpty("   ", "agencyName");
    expect(r.ok).toBe(false);
  });
  test("non-string → validation_failed", () => {
    const r = validateNonEmpty(null, "agencyName");
    expect(r.ok).toBe(false);
  });
});

describe("validateTimeZone (whitelist)", () => {
  test("whitelist hit: America/New_York → ok", () => {
    const r = validateTimeZone("America/New_York");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.timeZone).toBe("America/New_York");
  });
  test("whitelist hit: Europe/London → ok", () => {
    const r = validateTimeZone("Europe/London");
    expect(r.ok).toBe(true);
  });
  test("whitelist hit: UTC → ok", () => {
    const r = validateTimeZone("UTC");
    expect(r.ok).toBe(true);
  });
  test("whitelist miss: Mars/Olympus → validation_failed", () => {
    const r = validateTimeZone("Mars/Olympus");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("validation_failed");
  });
  test("non-string → validation_failed", () => {
    const r = validateTimeZone(null);
    expect(r.ok).toBe(false);
  });
  test("whitelist has at least 100 entries (sanity)", () => {
    expect(TIMEZONE_WHITELIST.size).toBeGreaterThanOrEqual(100);
  });
});

describe("slugifyAgencyName edge cases", () => {
  test("Unicode normalization: 'José's Agency' → 'joses-agency'", () => {
    expect(slugifyAgencyName("José's Agency")).toBe("joses-agency");
  });
  test("Consecutive-dash collapse: 'foo --- bar' → 'foo-bar'", () => {
    expect(slugifyAgencyName("foo --- bar")).toBe("foo-bar");
  });
  test("Leading/trailing dash strip: '---abc---' → 'abc'", () => {
    expect(slugifyAgencyName("---abc---")).toBe("abc");
  });
  test("Empty input → fallback regex ^agency-[a-f0-9]{8}$", () => {
    const s = slugifyAgencyName("");
    expect(s).toMatch(/^agency-[a-f0-9]{8}$/);
  });
  test("Whitespace only → fallback regex ^agency-[a-f0-9]{8}$", () => {
    const s = slugifyAgencyName("   ");
    expect(s).toMatch(/^agency-[a-f0-9]{8}$/);
  });
  test("All-punctuation → fallback regex ^agency-[a-f0-9]{8}$", () => {
    const s = slugifyAgencyName("!!!@@@###");
    expect(s).toMatch(/^agency-[a-f0-9]{8}$/);
  });
  test("50-char truncate: long input is truncated, no trailing dash", () => {
    const longInput = "a".repeat(40) + " " + "b".repeat(40);
    const out = slugifyAgencyName(longInput);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith("-")).toBe(false);
  });
  test("Simple case: 'JRM' → 'jrm'", () => {
    expect(slugifyAgencyName("JRM")).toBe("jrm");
  });
  test("Numbers preserved: 'Agency 2026' → 'agency-2026'", () => {
    expect(slugifyAgencyName("Agency 2026")).toBe("agency-2026");
  });
});
