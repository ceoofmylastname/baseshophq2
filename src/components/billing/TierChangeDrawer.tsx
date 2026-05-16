import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { BillingState, PlanTier } from "@/lib/billing/helpers";
import { useBillingMutate } from "@/hooks/useBillingMutate";

/**
 * Right-side sheet that hosts the four tier cards (Phase 17 PR 3c).
 *
 * Selection state lives inside the drawer; on pick we fire a preview to
 * surface the proration block. The confirm CTA POSTs change_tier through
 * useBillingMutate. The drawer closes on success.
 *
 * Enterprise displays "Contact sales" and disables the picker — there is no
 * self-serve path to Enterprise.
 */

type TierMeta = {
  tier: PlanTier;
  label: string;
  monthly: string;   // "$97"
  annual: string;    // "$970/yr"
  highlights: string[];
};

const TIERS: TierMeta[] = [
  {
    tier: "starter",
    label: "Starter",
    monthly: "$97",
    annual: "$970",
    highlights: ["3 agents", "1 carrier", "Basic comp grid"],
  },
  {
    tier: "growth",
    label: "Growth",
    monthly: "$297",
    annual: "$2,970",
    highlights: ["10 agents", "Unlimited carriers", "Payroll page"],
  },
  {
    tier: "pro",
    label: "Pro",
    monthly: "$497",
    annual: "$4,970",
    highlights: ["50 agents", "Scoreboard + Book Valuation", "Phone support"],
  },
  {
    tier: "enterprise",
    label: "Enterprise",
    monthly: "Custom",
    annual: "Custom",
    highlights: ["50+ agents, metered", "Dedicated success manager", "SLA + security review"],
  },
];

function formatCurrency(cents: number, currency: string): string {
  const dollars = Math.abs(cents) / 100;
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${dollars.toFixed(2)} ${currency.toUpperCase()}`;
}

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  state: BillingState;
  onSuccess: () => void;
};

export function TierChangeDrawer({ open, onOpenChange, state, onSuccess }: Props) {
  const [selected, setSelected] = useState<PlanTier | null>(null);
  const {
    changeTier,
    previewChange,
    resetPreview,
    mutating,
    preview,
    previewLoading,
    error,
  } = useBillingMutate(() => {
    onOpenChange(false);
    onSuccess();
  });

  // Clear selection + preview whenever the drawer closes / re-opens.
  useEffect(() => {
    if (!open) {
      setSelected(null);
      resetPreview();
    }
  }, [open, resetPreview]);

  // Auto-preview whenever the selected tier changes (and is a self-serve tier).
  useEffect(() => {
    if (!open || !selected || selected === "enterprise" || selected === state.tier) return;
    void previewChange({ action: "change_tier", tier: selected });
  }, [open, selected, state.tier, previewChange]);

  function priceLabel(t: TierMeta): string {
    if (t.tier === "enterprise") return t.monthly;
    return state.billingInterval === "annual"
      ? `${t.annual}/yr`
      : `${t.monthly}/mo`;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Change plan</SheetTitle>
          <SheetDescription>
            Pick a tier. Upgrades apply immediately, prorated. Downgrades take effect at the next billing period.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-2 grid gap-3 overflow-y-auto pr-1">
          {TIERS.map((t) => {
            const isCurrent = t.tier === state.tier;
            const isSelected = selected === t.tier;
            const isEnterprise = t.tier === "enterprise";
            return (
              <button
                key={t.tier}
                onClick={() => !isEnterprise && setSelected(t.tier)}
                disabled={isEnterprise}
                className={cn(
                  "relative rounded-xl border bg-card p-4 text-left transition disabled:cursor-not-allowed",
                  isCurrent && "border-primary/40 bg-primary/[0.04]",
                  isSelected && !isCurrent && "border-primary/60 ring-1 ring-primary/40",
                  !isCurrent && !isSelected && "border-white/[0.08] hover:border-white/[0.16]",
                )}
              >
                {isCurrent && (
                  <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                    Current plan
                  </span>
                )}
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-base font-semibold tracking-tight">{t.label}</h3>
                  <p className="text-sm text-muted-foreground">
                    <span className="text-foreground">{priceLabel(t)}</span>
                  </p>
                </div>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {t.highlights.map((h) => (
                    <li key={h} className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-primary" />
                      {h}
                    </li>
                  ))}
                </ul>
                {isEnterprise && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Sales-led. Contact us to provision Enterprise.
                  </p>
                )}
              </button>
            );
          })}
        </div>

        {/* Proration preview block */}
        {selected && selected !== state.tier && selected !== "enterprise" && (
          <div className="mt-3 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 text-xs">
            {previewLoading && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Calculating proration…
              </p>
            )}
            {!previewLoading && preview && (
              <div className="space-y-1">
                <p className="font-medium text-foreground">Proration preview</p>
                <p className="text-muted-foreground">
                  Charge today: <span className="text-foreground">{formatCurrency(preview.amount_due, preview.currency)}</span>
                </p>
                {preview.prorated_credit !== 0 && (
                  <p className="text-muted-foreground">
                    Credit: <span className="text-foreground">{formatCurrency(preview.prorated_credit, preview.currency)}</span>
                  </p>
                )}
                {preview.prorated_charge !== 0 && (
                  <p className="text-muted-foreground">
                    Prorated charge: <span className="text-foreground">{formatCurrency(preview.prorated_charge, preview.currency)}</span>
                  </p>
                )}
              </div>
            )}
            {!previewLoading && !preview && error && (
              <p className="text-amber-200">Could not calculate proration ({error}).</p>
            )}
          </div>
        )}

        <SheetFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutating}>
            Cancel
          </Button>
          <Button
            onClick={() => selected && void changeTier(selected)}
            disabled={!selected || selected === state.tier || selected === "enterprise" || mutating}
          >
            {mutating ? "Working…" : "Confirm change"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
