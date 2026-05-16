/**
 * Phase 18 PR 1: a single tier column on the public /pricing page.
 *
 * Renders one tier card with:
 *   - Tier name + "Most popular" pill on the Pro column
 *   - Interval-aware price block (monthly shows "$X/mo"; annual shows the
 *     annual total prominently with a "Save $Y" callout and the implied
 *     monthly equivalent struck through)
 *   - Agent cap line
 *   - Feature bullet list (sourced from TIER_BULLETS)
 *   - Per-card white-label toggle (Growth / Pro only)
 *   - Primary CTA: "Start 14-day trial" (self-serve) or "Contact Sales"
 *     (Enterprise — opens the demo booking modal)
 *
 * The Pro column gets permanent gold elevation (border + ring + animated
 * gradient backdrop). Non-Pro columns that match the slider-recommended
 * tier get a subtle ring (white/20) so the slider feedback is visible but
 * doesn't compete with Pro's elevation.
 */

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  TIER_BULLETS,
  TIER_CONFIG,
  WHITE_LABEL_PRICE,
  annualSavings,
  type BillingIntervalLite,
  type PricingTier,
  type SelfServeTier,
} from "@/lib/pricing/pricing-math";
import { cn } from "@/lib/utils";

type Props = {
  tier: PricingTier;
  interval: BillingIntervalLite;
  /** Slider-recommended tier; if it matches this one (and not Pro), apply
   *  the subtle highlight ring. */
  tierHighlighted: PricingTier;
  /** Owned by parent (TierGrid) so toggling doesn't reset on every slider
   *  tick. Ignored for Starter and Enterprise. */
  whiteLabel: boolean;
  onToggleWhiteLabel: (next: boolean) => void;
  onSignup: (args: { tier: SelfServeTier; interval: BillingIntervalLite; whiteLabel: boolean }) => void;
  onContactSales: () => void;
};

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

export function TierColumn({
  tier,
  interval,
  tierHighlighted,
  whiteLabel,
  onToggleWhiteLabel,
  onSignup,
  onContactSales,
}: Props) {
  const cfg = TIER_CONFIG[tier];
  const bullets = TIER_BULLETS[tier];
  const isPro = tier === "pro";
  const isEnterprise = tier === "enterprise";
  const canHaveWL = tier === "growth" || tier === "pro";
  const isHighlighted = !isPro && tierHighlighted === tier;

  // Price block resolution. Enterprise stays "Custom" in both intervals.
  const monthlyNum = cfg.monthlyNumber;
  const showAnnual = interval === "annual" && monthlyNum !== null;
  const savings = monthlyNum !== null ? annualSavings(monthlyNum) : 0;

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-2xl glass p-6",
        isPro && "border border-primary/40 ring-1 ring-primary/30",
        isHighlighted && "ring-1 ring-white/20",
      )}
    >
      {isPro && (
        <>
          <div aria-hidden className="absolute inset-0 opacity-60 gradient-rim pointer-events-none" />
          <span className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 rounded-md border border-primary/30 bg-primary/[0.12] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary shadow-[0_0_16px_hsl(38_92%_60%/0.35)]">
            Most popular
          </span>
        </>
      )}

      <div className="relative flex h-full flex-col">
        <h3 className={cn("text-lg font-semibold tracking-tight text-shadow-soft", cfg.accent)}>
          {cfg.label}
        </h3>

        {/* Price block */}
        <div className="mt-3 min-h-[88px]">
          {isEnterprise ? (
            <div>
              <div className="text-3xl font-semibold tracking-tight text-shadow-soft">Custom</div>
              <p className="mt-1 text-xs text-muted-foreground">
                51+ agents, billed per active agent
              </p>
            </div>
          ) : showAnnual && monthlyNum !== null ? (
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight text-shadow-soft">
                  {cfg.annual}
                </span>
                <span className="text-sm text-muted-foreground">/yr</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="line-through">{fmtUsd(monthlyNum * 12)}/yr</span>
                <span className="ml-1.5 font-semibold text-primary">
                  Save {fmtUsd(savings)}
                </span>
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight text-shadow-soft">
                  {cfg.monthly}
                </span>
                <span className="text-sm text-muted-foreground">/mo</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Billed monthly. Cancel anytime.
              </p>
            </div>
          )}
        </div>

        {/* Agent cap line */}
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          {cfg.agentCap !== null
            ? `Up to ${cfg.agentCap} active agents`
            : "Unlimited agents (per-agent billed)"}
        </p>

        {/* Bullets */}
        <ul className="mt-5 space-y-2.5">
          {bullets.map((bullet) => (
            <li key={bullet} className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="text-foreground/90">{bullet}</span>
            </li>
          ))}
        </ul>

        {/* White-label toggle (Growth / Pro only) */}
        {canHaveWL && (
          <label className="mt-5 flex cursor-pointer items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs">
            <input
              type="checkbox"
              checked={whiteLabel}
              onChange={(e) => onToggleWhiteLabel(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-primary"
            />
            <span className="flex-1">
              <span className="font-semibold text-foreground">White-label add-on</span>
              <span className="ml-1 text-muted-foreground">
                +${WHITE_LABEL_PRICE.monthly}/mo
              </span>
              <p className="mt-0.5 text-muted-foreground">
                Swap the Baseshop HQ brand for yours across the app.
              </p>
            </span>
          </label>
        )}

        {/* CTA */}
        <div className="mt-6 flex-1" />
        <div className="pt-2">
          {isEnterprise ? (
            <Button
              variant="outline"
              size="lg"
              className="w-full"
              onClick={onContactSales}
            >
              Contact Sales
            </Button>
          ) : (
            <Button
              size="lg"
              className={cn(
                "w-full",
                isPro && "shadow-[0_0_24px_hsl(38_92%_60%/0.4)]",
              )}
              onClick={() =>
                onSignup({
                  tier: tier as SelfServeTier,
                  interval,
                  whiteLabel: canHaveWL ? whiteLabel : false,
                })
              }
            >
              Start 14-day trial
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
