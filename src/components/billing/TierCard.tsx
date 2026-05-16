import { Sparkles, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CapUsageBar } from "@/components/billing/CapUsageBar";
import { useBillingPortal } from "@/hooks/useBillingPortal";
import { cn } from "@/lib/utils";
import type { BillingState } from "@/lib/billing/helpers";

/**
 * Top tier card: animated gradient rim backdrop + tier name, price, billing
 * cadence, status pills, and CapUsageBar.
 *
 * Pricing copy: PR 3b assumes "/mo" since no annual tier exists in the
 * schema yet. PR 3c is expected to add a `billing_interval` column on
 * tenants and surface annual pricing.
 *   FLAG (per locked plan section 7): the "$X/mo" label is hardcoded; when
 *   billing_interval lands the price suffix should read from that column.
 *
 * The "Open billing portal" CTA is enabled only when the tenant has a Stripe
 * customer on file (i.e., they have run checkout at least once). Starter
 * tenants who haven't subscribed see a disabled-state explanation instead.
 */

const TIER_META = {
  starter:    { label: "Starter",    price: "$0",   accent: "text-foreground" },
  growth:     { label: "Growth",     price: "$49",  accent: "text-primary"    },
  pro:        { label: "Pro",        price: "$149", accent: "text-primary"    },
  enterprise: { label: "Enterprise", price: "Custom", accent: "text-primary"  },
} as const;

function formatPeriodEnd(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function TierCard({ state }: { state: BillingState }) {
  const meta = TIER_META[state.tier];
  const { openPortal, opening } = useBillingPortal();

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
              <span className="text-foreground text-shadow-soft">{meta.price}</span>
              {state.tier !== "enterprise" && state.tier !== "starter" && (
                <span className="ml-1">/mo</span>
              )}
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
    </section>
  );
}
