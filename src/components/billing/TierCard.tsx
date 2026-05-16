import { useState } from "react";
import { Sparkles, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CapUsageBar } from "@/components/billing/CapUsageBar";
import { TierChangeDrawer } from "@/components/billing/TierChangeDrawer";
import { useBillingPortal } from "@/hooks/useBillingPortal";
import { cn } from "@/lib/utils";
import type { BillingState } from "@/lib/billing/helpers";

/**
 * Top tier card: animated gradient rim backdrop + tier name, price, billing
 * cadence, status pills, and CapUsageBar.
 *
 * Pricing copy (Phase 17 PR 3c):
 *   The "$X/mo" or "$X/yr" label is computed from state.tier + state.billingInterval.
 *   TIER_META carries the canonical pricing from wiki/pricing-and-checkout.md:
 *     Starter $97/mo or $970/yr
 *     Growth  $297/mo or $2,970/yr
 *     Pro     $497/mo or $4,970/yr
 *     Enterprise Custom (no annual variant)
 *
 * CTAs:
 *   - "Change tier" opens the TierChangeDrawer (PR 3c).
 *   - "Open billing portal" routes to Stripe-hosted portal. Enabled only when
 *     the tenant has a Stripe customer on file (post-checkout).
 */

type TierPriceCopy = {
  label: string;
  monthly: string;
  annual: string;
  accent: string;
};

const TIER_META: Record<BillingState["tier"], TierPriceCopy> = {
  starter:    { label: "Starter",    monthly: "$97",     annual: "$970",      accent: "text-foreground" },
  growth:     { label: "Growth",     monthly: "$297",    annual: "$2,970",    accent: "text-primary"    },
  pro:        { label: "Pro",        monthly: "$497",    annual: "$4,970",    accent: "text-primary"    },
  enterprise: { label: "Enterprise", monthly: "Custom",  annual: "Custom",    accent: "text-primary"    },
};

function formatPeriodEnd(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

type Props = {
  state: BillingState;
  onMutated?: () => void;
};

export function TierCard({ state, onMutated }: Props) {
  const meta = TIER_META[state.tier];
  const { openPortal, opening } = useBillingPortal();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Enterprise has no annual variant; always show its monthly column.
  // For Starter / Growth / Pro: pick the column from billingInterval and
  // append /yr or /mo accordingly.
  const isEnterprise = state.tier === "enterprise";
  const useAnnual = !isEnterprise && state.billingInterval === "annual";
  const priceText = useAnnual ? meta.annual : meta.monthly;
  const priceSuffix = isEnterprise ? "" : useAnnual ? "/yr" : "/mo";

  return (
    <section className="relative overflow-hidden rounded-2xl glass p-6">
      {/* Animated kinetic gradient backdrop */}
      <div aria-hidden className="absolute inset-0 opacity-60 gradient-rim" />

      <div className="relative">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Current plan
            </p>
            <h2 className={cn("mt-1 text-2xl font-semibold tracking-tight text-shadow-soft", meta.accent)}>
              {meta.label}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="text-foreground text-shadow-soft">{priceText}</span>
              {priceSuffix && <span className="ml-1">{priceSuffix}</span>}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {state.isInTrial && (
                <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  <Sparkles className="h-2.5 w-2.5" />
                  Trial
                </span>
              )}
              {state.whiteLabel && (
                <span className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  White-label
                </span>
              )}
              {state.currentPeriodEnd && (
                <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  <Calendar className="h-2.5 w-2.5" />
                  Renews {formatPeriodEnd(state.currentPeriodEnd)}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-2 md:items-end">
            <Button
              size="sm"
              onClick={() => setDrawerOpen(true)}
              disabled={!state.hasStripeCustomer}
            >
              Change tier
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void openPortal()}
              disabled={opening || !state.hasStripeCustomer}
            >
              {opening ? "Opening…" : "Open billing portal"}
            </Button>
            {!state.hasStripeCustomer && (
              <p className="text-[11px] text-muted-foreground md:text-right">
                Subscribe to a paid plan to manage payments in the portal.
              </p>
            )}
          </div>
        </div>

        {/* Cap usage */}
        <div className="mt-5 border-t border-white/[0.06] pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold tracking-tight">
              Active agents
            </p>
            <p className="text-sm tabular-nums text-muted-foreground">
              {state.agentCount}
              {state.tier !== "enterprise" && <> of {state.agentCap}</>}
            </p>
          </div>
          {state.tier !== "enterprise" && (
            <div className="mt-2">
              <CapUsageBar usagePct={state.usagePct} />
            </div>
          )}
          {state.tier === "enterprise" && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Enterprise plans bill per active agent per month. See monthly snapshots below.
            </p>
          )}
        </div>
      </div>

      <TierChangeDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        state={state}
        onSuccess={() => onMutated?.()}
      />
    </section>
  );
}
