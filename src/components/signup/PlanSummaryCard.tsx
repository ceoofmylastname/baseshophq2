/**
 * Phase 18 PR 2 — PlanSummaryCard
 *
 * Right-rail (desktop) / above-fold-below-form (mobile) recap of the chosen
 * plan: tier + WL + interval + monthly-equivalent price. Reads from
 * TIER_CONFIG + WHITE_LABEL_PRICE.
 */

import {
  TIER_CONFIG,
  WHITE_LABEL_PRICE,
  type BillingIntervalLite,
  type SelfServeTier,
} from "@/lib/pricing/pricing-math";

type Props = {
  tier: SelfServeTier;
  interval: BillingIntervalLite;
  whiteLabel: boolean;
};

export function PlanSummaryCard({ tier, interval, whiteLabel }: Props) {
  const cfg = TIER_CONFIG[tier];
  const tierMonthly = cfg.monthlyNumber ?? 0;
  const wlMonthly = whiteLabel ? WHITE_LABEL_PRICE.monthly : 0;
  const monthlyEquivalent = tierMonthly + wlMonthly;

  const priceLabel = interval === "annual"
    ? `${cfg.annual}/yr${whiteLabel ? ` + ${WHITE_LABEL_PRICE.annual}/yr white-label` : ""}`
    : `${cfg.monthly}/mo${whiteLabel ? ` + ${WHITE_LABEL_PRICE.monthly}/mo white-label` : ""}`;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
        Plan summary
      </p>
      <h3 className="mt-2 text-xl font-semibold tracking-tight text-shadow-soft">
        {cfg.label}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {interval === "annual" ? "Billed annually" : "Billed monthly"}
        {whiteLabel ? " · with white-label" : ""}
      </p>

      <div className="mt-5 space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{cfg.label} tier</span>
          <span className="font-medium text-foreground">
            {interval === "annual" ? cfg.annual : cfg.monthly}
            <span className="text-muted-foreground"> / {interval === "annual" ? "yr" : "mo"}</span>
          </span>
        </div>
        {whiteLabel && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">White-label add-on</span>
            <span className="font-medium text-foreground">
              ${interval === "annual" ? WHITE_LABEL_PRICE.annual : WHITE_LABEL_PRICE.monthly}
              <span className="text-muted-foreground"> / {interval === "annual" ? "yr" : "mo"}</span>
            </span>
          </div>
        )}

        <div className="border-t border-white/[0.06] pt-3">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Monthly equivalent</span>
            <span className="font-semibold text-foreground">
              ${monthlyEquivalent}
              <span className="text-muted-foreground"> / mo</span>
            </span>
          </div>
        </div>
      </div>

      <p className="mt-5 text-xs text-muted-foreground">
        14-day free trial. Cancel anytime before trial end and you will not be charged.
      </p>

      <p className="sr-only">Plan: {priceLabel}</p>
    </div>
  );
}
