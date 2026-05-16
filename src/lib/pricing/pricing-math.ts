/**
 * Phase 18 PR 1: shared pricing helpers + canonical tier metadata.
 *
 * Consumers:
 *   - `src/pages/Pricing.tsx` + sibling pricing components (public marketing
 *     pricing page).
 *   - `src/components/billing/TierCard.tsx` (authenticated billing page).
 *
 * Everything here is pure (no React, no DOM, no Supabase) and tested in
 * `tests/pricing-math.test.ts`. The shape of `TIER_CONFIG` is a superset of
 * the legacy `TIER_META` formerly inlined in TierCard.tsx — Billing's
 * TierCard reads only `label`, `monthly`, `annual`, `accent`; the public
 * Pricing page additionally consumes `monthlyNumber`, `agentCap`, and `cta`.
 *
 * Canonical pricing comes from wiki/pricing-and-checkout.md:
 *   Starter    $97/mo  / $970/yr   — cap 3 agents
 *   Growth     $297/mo / $2,970/yr — cap 10 agents
 *   Pro        $497/mo / $4,970/yr — cap 50 agents
 *   Enterprise Custom              — 51+ agents (sales-led)
 *   White-label add-on $97/mo / $970/yr (Growth, Pro, Enterprise)
 */

export type PricingTier = "starter" | "growth" | "pro" | "enterprise";
export type SelfServeTier = Exclude<PricingTier, "enterprise">;
export type BillingIntervalLite = "monthly" | "annual";

type TierConfigEntry = {
  label: string;
  monthly: string;
  annual: string;
  /** Numeric monthly price; `null` for Enterprise (custom quote). */
  monthlyNumber: number | null;
  /** Self-serve cap; `null` for Enterprise (no hard cap, per-agent billed). */
  agentCap: number | null;
  /** CTA pattern. `"signup"` routes to /signup with query params; `"demo"`
   *  opens the demo booking modal in-place. */
  cta: "signup" | "demo";
  accent: string;
};

export const TIER_CONFIG: Record<PricingTier, TierConfigEntry> = {
  starter:    { label: "Starter",    monthly: "$97",    annual: "$970",   monthlyNumber: 97,   agentCap: 3,    cta: "signup", accent: "text-foreground" },
  growth:     { label: "Growth",     monthly: "$297",   annual: "$2,970", monthlyNumber: 297,  agentCap: 10,   cta: "signup", accent: "text-primary"    },
  pro:        { label: "Pro",        monthly: "$497",   annual: "$4,970", monthlyNumber: 497,  agentCap: 50,   cta: "signup", accent: "text-primary"    },
  enterprise: { label: "Enterprise", monthly: "Custom", annual: "Custom", monthlyNumber: null, agentCap: null, cta: "demo",   accent: "text-primary"    },
} as const;

export const WHITE_LABEL_PRICE = { monthly: 97, annual: 970 } as const;

/**
 * Per-tier feature bullets shown on the public pricing page. Parent-approved
 * in S-1 §4. NOTE: Starter bullet was edited from "Production Dashboard
 * (basic)" → "Basic Production Dashboard" (no parens) per decision #2.
 */
export const TIER_BULLETS: Record<PricingTier, readonly string[]> = {
  starter: [
    "Up to 3 active agents",
    "Org chart and hierarchy",
    "Carrier CSV ingest (writing-number matching)",
    "Book of Business with full audit trail",
    "Basic Production Dashboard",
    "Email support",
  ],
  growth: [
    "Up to 10 active agents",
    "Everything in Starter",
    "Full Production Dashboard (Pipeline, Booked, Realized, At-Risk)",
    "Scoreboard and rankings",
    "Master Grid with effective-dated rates",
    "Priority email support",
    "White-label add-on available",
  ],
  pro: [
    "Up to 50 active agents",
    "Everything in Growth",
    "Team Production view for managers",
    "Bulk policy status changes",
    "Advanced ingest controls (orphan resolution, missing-product policies)",
    "Priority chat support",
    "White-label add-on available",
  ],
  enterprise: [
    "51+ active agents (per-agent active-agent billing)",
    "Everything in Pro",
    "Dedicated onboarding and migration support",
    "Custom carrier integrations on request",
    "SSO and SAML support",
    "Volume pricing and annual contracting",
    "White-label add-on available",
  ],
} as const;

export type FaqItem = { id: string; q: string; a: string };

/**
 * FAQ entries shown on the public pricing page. Parent-approved in S-1 §4.
 * NOTE: the white-label answer was edited from
 *   "+$97/mo on Growth, Pro, or Enterprise"
 *   → "Available on Growth, Pro, and Enterprise at $97/mo."
 * per decision #3.
 */
export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    id: "active-agent",
    q: "What counts as an active agent?",
    a: "Any agent who wrote at least one policy in the last 30 days. The platform recounts active agents continuously, so dormant agents on your roster do not count toward your tier cap.",
  },
  {
    id: "white-label",
    q: "Is white-label included?",
    a: "Available on Growth, Pro, and Enterprise at $97/mo. White-label lets you swap the Baseshop HQ brand for yours across the app, email notifications, and PDF exports. Starter does not include the white-label option.",
  },
  {
    id: "annual-savings",
    q: "How does annual billing work?",
    a: "Annual plans are billed upfront for the full year and priced at ten months of the monthly rate. That is two months free vs paying month to month. You can switch between monthly and annual at any time from the Billing page.",
  },
  {
    id: "trial",
    q: "Is there a free trial?",
    a: "Yes. Every paid tier starts with a 14-day free trial. No credit card required to start. If you do not convert within 14 days, your tenant moves to a read-only state until you pick a plan.",
  },
] as const;

/**
 * Map an agent count to the recommended self-serve tier. Thresholds match
 * the published agent caps:
 *   1-3   → starter
 *   4-10  → growth
 *   11-50 → pro
 *   51+   → enterprise
 */
export function tierForAgentCount(n: number): PricingTier {
  if (n <= 3)  return "starter";
  if (n <= 10) return "growth";
  if (n <= 50) return "pro";
  return "enterprise";
}

/**
 * Annual price for a given monthly figure. Annual = 10 months of the
 * monthly rate (the "2 months free" promise).
 */
export function annualPrice(monthly: number): number {
  return monthly * 10;
}

/**
 * Savings (in dollars) of paying annually instead of 12x monthly. Equal to
 * 2x the monthly price (the "2 months free" amount).
 */
export function annualSavings(monthly: number): number {
  return monthly * 2;
}

/**
 * Compose a deep-link to /signup with tier + interval + white-label query
 * params. PR 2 will wire the signup page to read these. PR 1 just emits
 * them so a click is debuggable end-to-end via URL inspection.
 */
export function buildSignupUrl(args: {
  tier: SelfServeTier;
  interval: BillingIntervalLite;
  whiteLabel: boolean;
}): string {
  const params = new URLSearchParams({
    tier: args.tier,
    interval: args.interval,
    wl: args.whiteLabel ? "true" : "false",
  });
  return `/signup?${params.toString()}`;
}
