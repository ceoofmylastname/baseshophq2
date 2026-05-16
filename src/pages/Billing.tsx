import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useBillingState } from "@/hooks/useBillingState";
import { useBillingMutate } from "@/hooks/useBillingMutate";
import { gateBilling, type BillingInterval } from "@/lib/billing/helpers";
import { TierCard } from "@/components/billing/TierCard";
import { WhiteLabelCard } from "@/components/billing/WhiteLabelCard";
import { IntervalToggle } from "@/components/billing/IntervalToggle";
import { MutationConfirmDialog } from "@/components/billing/MutationConfirmDialog";
import { SnapshotHistoryCard } from "@/components/billing/SnapshotHistoryCard";

/**
 * Owner-facing /billing page (Phase 17 PR 3c).
 *
 * Layout (top to bottom):
 *   1. Page header
 *   2. TierCard — animated gradient backdrop, current tier + price + caps
 *      + "Change tier" CTA (opens TierChangeDrawer) + portal CTA
 *   3. IntervalToggle — monthly/annual segmented control (PR 3c). Hidden for
 *      Enterprise (no annual variant).
 *   4. WhiteLabelCard — eligible on Growth, Pro, Enterprise. Toggle CTA opens
 *      MutationConfirmDialog.
 *   5. SnapshotHistoryCard — last 6 metered periods; enterprise-only
 *
 * Mutation entry points (PR 3c):
 *   - TierChangeDrawer (from TierCard) → change_tier
 *   - WhiteLabelCard toggle → toggle_white_label
 *   - IntervalToggle + confirm dialog → change_interval
 *   - Stripe portal button → external (no app mutation)
 *
 * Non-owner gating: gateBilling(isOwner) drives a side-effecting redirect
 * to /home (with a toast). gateBilling treats undefined as 'redirect' too,
 * so we hold the redirect until the auth loading flag clears.
 */
export function BillingPage() {
  const navigate = useNavigate();
  const { isOwner, loading: authLoading } = useAuth();
  const { state, loading: stateLoading, error, refresh } = useBillingState();

  const [intervalDialogOpen, setIntervalDialogOpen] = useState(false);
  const [pendingInterval, setPendingInterval] = useState<BillingInterval | null>(null);

  const { changeInterval, mutating: intervalMutating } = useBillingMutate(() => {
    setIntervalDialogOpen(false);
    setPendingInterval(null);
    void refresh();
  });

  useEffect(() => {
    if (authLoading) return;
    if (gateBilling(isOwner) === "redirect") {
      toast.error("Owner access required.");
      navigate("/home", { replace: true });
    }
  }, [authLoading, isOwner, navigate]);

  if (authLoading || !isOwner) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (stateLoading || !state) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Loading billing…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-5 text-sm text-red-200">
        Could not load billing: {error}
      </div>
    );
  }

  const showIntervalToggle = state.tier !== "enterprise";
  const showWhiteLabelCard = state.tier !== "starter";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-shadow-soft">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your plan, payment method, and usage. Plan changes apply immediately on upgrade; downgrades take effect at the next billing period.
        </p>
      </div>

      <TierCard state={state} onMutated={() => void refresh()} />

      {showIntervalToggle && (
        <section className="rounded-2xl border border-white/[0.08] bg-card p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold tracking-tight">Billing interval</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Switch between monthly and annual. Annual saves two months vs monthly.
              </p>
            </div>
            <IntervalToggle
              value={state.billingInterval}
              onChange={(next) => {
                if (next === state.billingInterval) return;
                setPendingInterval(next);
                setIntervalDialogOpen(true);
              }}
              disabled={intervalMutating}
            />
          </div>
        </section>
      )}

      {showWhiteLabelCard && <WhiteLabelCard state={state} onMutated={() => void refresh()} />}

      <SnapshotHistoryCard tier={state.tier} snapshots={state.snapshots} />

      <MutationConfirmDialog
        open={intervalDialogOpen}
        onOpenChange={(next) => {
          setIntervalDialogOpen(next);
          if (!next) setPendingInterval(null);
        }}
        title={pendingInterval === "annual" ? "Switch to annual billing?" : "Switch to monthly billing?"}
        body={
          pendingInterval === "annual"
            ? "Annual billing charges the full year today, prorated against any remaining monthly balance."
            : "Monthly switch takes effect at the end of the current annual period."
        }
        prorationLabel={
          pendingInterval === "annual"
            ? "Prorated today against your remaining monthly balance."
            : "$0 due today. Change applies at next renewal."
        }
        confirmLabel={pendingInterval === "annual" ? "Switch to annual" : "Switch to monthly"}
        onConfirm={() => {
          if (pendingInterval) void changeInterval(pendingInterval);
        }}
        loading={intervalMutating}
      />
    </div>
  );
}
