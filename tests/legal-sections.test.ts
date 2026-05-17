/**
 * Phase 18.1 — Legal section catalogue tests.
 *
 * The 11 ToS + 12 Privacy section ids and titles are the parent's decision
 * surface. Locked structure assertions live here.
 */

import { describe, expect, test } from "bun:test";
import {
  LEGAL_LAST_UPDATED,
  LEGAL_PLACEHOLDER_PARAGRAPH,
  LEGAL_PRIVACY_SECTIONS,
  LEGAL_TERMS_SECTIONS,
} from "../src/lib/legal/sections";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("LEGAL_TERMS_SECTIONS", () => {
  test("has exactly 11 sections", () => {
    expect(LEGAL_TERMS_SECTIONS).toHaveLength(11);
  });

  test("ids are unique", () => {
    const ids = LEGAL_TERMS_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("ids are slug-formatted (lowercase alphanumeric + dashes only)", () => {
    for (const section of LEGAL_TERMS_SECTIONS) {
      expect(SLUG_RE.test(section.id)).toBe(true);
    }
  });

  test("titles match the locked brief numbered list", () => {
    expect(LEGAL_TERMS_SECTIONS.map((s) => s.title)).toEqual([
      "1. Acceptance of Terms",
      "2. Description of Service",
      "3. User Accounts and Responsibilities",
      "4. Subscription and Billing",
      "5. Acceptable Use",
      "6. Intellectual Property",
      "7. Termination",
      "8. Limitation of Liability",
      "9. Indemnification",
      "10. Changes to These Terms",
      "11. Contact",
    ]);
  });

  test("ids match the locked brief", () => {
    expect(LEGAL_TERMS_SECTIONS.map((s) => s.id)).toEqual([
      "acceptance-of-terms",
      "description-of-service",
      "user-accounts",
      "subscription-billing",
      "acceptable-use",
      "intellectual-property",
      "termination",
      "limitation-of-liability",
      "indemnification",
      "changes-to-terms",
      "contact",
    ]);
  });
});

describe("LEGAL_PRIVACY_SECTIONS", () => {
  test("has exactly 12 sections", () => {
    expect(LEGAL_PRIVACY_SECTIONS).toHaveLength(12);
  });

  test("ids are unique", () => {
    const ids = LEGAL_PRIVACY_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("ids are slug-formatted", () => {
    for (const section of LEGAL_PRIVACY_SECTIONS) {
      expect(SLUG_RE.test(section.id)).toBe(true);
    }
  });

  test("titles match the locked brief numbered list", () => {
    expect(LEGAL_PRIVACY_SECTIONS.map((s) => s.title)).toEqual([
      "1. Information We Collect",
      "2. How We Use Your Information",
      "3. Information Sharing and Disclosure",
      "4. Data Retention",
      "5. Data Security",
      "6. Your Rights and Choices",
      "7. Cookies and Tracking Technologies",
      "8. Third-Party Services",
      "9. Children's Privacy",
      "10. International Data Transfers",
      "11. Changes to This Policy",
      "12. Contact",
    ]);
  });

  test("ids match the locked brief", () => {
    expect(LEGAL_PRIVACY_SECTIONS.map((s) => s.id)).toEqual([
      "information-we-collect",
      "how-we-use",
      "information-sharing",
      "data-retention",
      "data-security",
      "your-rights",
      "cookies-tracking",
      "third-party-services",
      "childrens-privacy",
      "international-transfers",
      "changes-to-policy",
      "contact",
    ]);
  });
});

describe("LEGAL constants", () => {
  test("LEGAL_LAST_UPDATED is the locked date", () => {
    expect(LEGAL_LAST_UPDATED).toBe("2026-05-17");
  });

  test("LEGAL_PLACEHOLDER_PARAGRAPH contains no em dashes", () => {
    expect(LEGAL_PLACEHOLDER_PARAGRAPH).not.toContain("—");
  });

  test("LEGAL_PLACEHOLDER_PARAGRAPH is the locked copy", () => {
    expect(LEGAL_PLACEHOLDER_PARAGRAPH).toBe(
      "Placeholder content. This section will be replaced with counsel-reviewed terms before launch.",
    );
  });

  test("no section title contains an em dash", () => {
    for (const s of LEGAL_TERMS_SECTIONS) {
      expect(s.title).not.toContain("—");
    }
    for (const s of LEGAL_PRIVACY_SECTIONS) {
      expect(s.title).not.toContain("—");
    }
  });
});
