/**
 * Phase 18.1 — Legal pages section catalogues.
 *
 * Pure constants. The legal pages themselves are skeleton placeholders until
 * counsel-reviewed copy is ready; the catalogue here is the locked
 * structure for the eventual final pages.
 *
 * No em dashes anywhere in the copy below. The placeholder paragraph deliberately uses
 * a period instead of an em dash.
 */

export const LEGAL_TERMS_SECTIONS = [
  { id: "acceptance-of-terms",     title: "1. Acceptance of Terms" },
  { id: "description-of-service",  title: "2. Description of Service" },
  { id: "user-accounts",           title: "3. User Accounts and Responsibilities" },
  { id: "subscription-billing",    title: "4. Subscription and Billing" },
  { id: "acceptable-use",          title: "5. Acceptable Use" },
  { id: "intellectual-property",   title: "6. Intellectual Property" },
  { id: "termination",             title: "7. Termination" },
  { id: "limitation-of-liability", title: "8. Limitation of Liability" },
  { id: "indemnification",         title: "9. Indemnification" },
  { id: "changes-to-terms",        title: "10. Changes to These Terms" },
  { id: "contact",                 title: "11. Contact" },
] as const;

export const LEGAL_PRIVACY_SECTIONS = [
  { id: "information-we-collect",  title: "1. Information We Collect" },
  { id: "how-we-use",              title: "2. How We Use Your Information" },
  { id: "information-sharing",     title: "3. Information Sharing and Disclosure" },
  { id: "data-retention",          title: "4. Data Retention" },
  { id: "data-security",           title: "5. Data Security" },
  { id: "your-rights",             title: "6. Your Rights and Choices" },
  { id: "cookies-tracking",        title: "7. Cookies and Tracking Technologies" },
  { id: "third-party-services",    title: "8. Third-Party Services" },
  { id: "childrens-privacy",       title: "9. Children's Privacy" },
  { id: "international-transfers", title: "10. International Data Transfers" },
  { id: "changes-to-policy",       title: "11. Changes to This Policy" },
  { id: "contact",                 title: "12. Contact" },
] as const;

export const LEGAL_PLACEHOLDER_PARAGRAPH =
  "Placeholder content. This section will be replaced with counsel-reviewed terms before launch.";

export const LEGAL_LAST_UPDATED = "2026-05-17";

export type LegalSection = (typeof LEGAL_TERMS_SECTIONS)[number] | (typeof LEGAL_PRIVACY_SECTIONS)[number];
