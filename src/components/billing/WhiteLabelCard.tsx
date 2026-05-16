import { useState } from "react";
import { Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MutationConfirmDialog } from "@/components/billing/MutationConfirmDialog";
import { useBillingMutate } from "@/hooks/useBillingMutate";
import type { BillingState } from "@/lib/billing/helpers";

/**
 * White-label add-on card. Renders in two modes (Phase 17 PR 3c):
 *
 *   1. Active  — gold border, status confirmation, "Remove white-label" CTA.
 *   2. Inactive (Growth / Pro only) — neutral card, "Add white-label" CTA.
 *
 * Starter never sees the card (the page filters it out for Starter), but we
 * also defensively reject Starter at the handler.
 *
 * On CTA click: open MutationConfirmDialog with a proration label like
 *   "+$97.00/mo, prorated today" (monthly) or "+$970.00/yr, prorated today"
 * Confirm fires toggleWhiteLabel through useBillingMutate.
 */

type Props = {
  state: BillingState;
  onMutated?: () => void;
};

function prorationLabelFor(state: BillingState, adding: boolean): string {
  // Static label; the real proration math is owned by Stripe at apply time.
  // We surface the list price as the indicative figure.
  if (state.billingInterval === "annual") {
    return adding
      ? "+$970.00/yr, prorated today."
      : "Removal takes effect at the end of the current period. Vanity domains stay attached until then.";
  }
  return adding
    ? "+$97.00/mo, prorated today."
    : "Removal takes effect at the end of the current period. Vanity domains stay attached until then.";
}

export function WhiteLabelCard({ state, onMutated }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toggleWhiteLabel, mutating } = useBillingMutate(() => {
    setDialogOpen(false);
    onMutated?.();
  });

  const active = state.whiteLabel;
  // Caller filters this card; but if it's somehow rendered on Starter, we
  // disable the CTA to be safe.
  const eligible = state.tier !== "starter";

  return (
    <>
      <section
        className={
          active
            ? "rounded-2xl border border-primary/40 bg-primary/[0.04] p-5 backdrop-blur-md"
            : "rounded-2xl border border-white/[0.08] bg-card p-5 backdrop-blur-md"
        }
      >
        <div className="flex items-start gap-3">
          <Crown className={active ? "mt-0.5 h-5 w-5 text-primary" : "mt-0.5 h-5 w-5 text-muted-foreground"} />
          <div className="min-w-0 flex-1">
            <h3 className={active ? "text-sm font-semibold tracking-tight text-primary" : "text-sm font-semibold tracking-tight"}>
              {active ? "White-label add-on active" : "White-label add-on"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {active
                ? "Custom domains will ship in a future release. Your branding controls live in Settings under Agency profile."
                : "Unlock vanity domains, full brand engine, and unlimited sub-accounts."}
            </p>
          </div>
          {eligible && (
            <Button
              size="sm"
              variant={active ? "outline" : "default"}
              onClick={() => setDialogOpen(true)}
              disabled={mutating}
            >
              {active ? "Remove" : "Add"}
            </Button>
          )}
        </div>
      </section>

      <MutationConfirmDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={active ? "Remove white-label add-on?" : "Add white-label add-on?"}
        body={
          active
            ? "Removing white-label will unbind vanity domains at the end of the current period."
            : "Adds the white-label add-on to your subscription. You'll be charged the prorated amount today."
        }
        prorationLabel={prorationLabelFor(state, !active)}
        confirmLabel={active ? "Remove" : "Add white-label"}
        onConfirm={() => void toggleWhiteLabel(!active)}
        loading={mutating}
      />
    </>
  );
}
