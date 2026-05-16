/**
 * Phase 18 PR 1: tier-card grid for the public /pricing page.
 *
 * Renders four `<TierColumn />` side-by-side. The white-label toggle state
 * is OWNED here per-tier so the slider doesn't reset it on every value
 * change. The grid hands the recommended tier (from the slider) down to
 * each column so non-Pro columns can light up subtly when they match.
 */

import { useState } from "react";
import { TierColumn } from "./TierColumn";
import type {
  BillingIntervalLite,
  PricingTier,
  SelfServeTier,
} from "@/lib/pricing/pricing-math";

type Props = {
  agentCount: number;
  interval: BillingIntervalLite;
  tierHighlighted: PricingTier;
  onSignup: (args: { tier: SelfServeTier; interval: BillingIntervalLite; whiteLabel: boolean }) => void;
  onContactSales: () => void;
};

type WhiteLabelState = Record<PricingTier, boolean>;

const TIER_ORDER: readonly PricingTier[] = [
  "starter",
  "growth",
  "pro",
  "enterprise",
] as const;

export function TierGrid({
  agentCount,
  interval,
  tierHighlighted,
  onSignup,
  onContactSales,
}: Props) {
  // agentCount is currently unused inside the grid itself (the highlight
  // decision lives at the page level via tierHighlighted), but accepting it
  // here keeps the prop surface coherent and ready for future per-card
  // copy that varies by current value.
  void agentCount;

  const [wl, setWl] = useState<WhiteLabelState>({
    starter: false,
    growth: false,
    pro: false,
    enterprise: false,
  });

  return (
    <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
      {TIER_ORDER.map((tier) => (
        <TierColumn
          key={tier}
          tier={tier}
          interval={interval}
          tierHighlighted={tierHighlighted}
          whiteLabel={wl[tier]}
          onToggleWhiteLabel={(next) =>
            setWl((prev) => ({ ...prev, [tier]: next }))
          }
          onSignup={onSignup}
          onContactSales={onContactSales}
        />
      ))}
    </div>
  );
}
