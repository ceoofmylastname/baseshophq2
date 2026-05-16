import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useBillingState } from "@/hooks/useBillingState";
import { gateBilling } from "@/lib/billing/helpers";
import { TierCard } from "@/components/billing/TierCard";
import { WhiteLabelCard } from "@/components/billing/WhiteLabelCard";
import { SnapshotHistoryCard } from "@/components/billing/SnapshotHistoryCard";

/**
 * Owner-facing /billing page (Phase 17 PR 3b).
 *
 * Layout (top to bottom):
 *   1. Page header
 *   2. TierCard — animated gradient backdrop, current tier + price + caps
 *      + portal CTA
 *   3. WhiteLabelCard — gold-accented; renders only when whiteLabel===true
 *   4. SnapshotHistoryCard — last 6 metered periods; enterprise-only
 *
 * Read-only: the only mutation entry point is the "Open billing portal"
 * button on TierCard, which routes to Stripe's hosted portal. Plan changes,
 * cancellation, and payment-method updates all happen there — this page
 * never PATCHes the tenant row.
 *
 * Non-owner gating: gateBilling(isOwner) drives a side-effecting redirect
 * to /home (with a toast). gateBilling treats undefined as 'redirect' too,
 * so we hold the redirect until the auth loading flag clears.
 */
export function BillingPage() {
  const navigate = useNavigate();
  const { isOwner, loading: authLoading } = useAuth();
  const { state, loading: stateLoading, error } = useBillingState();

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-shadow-soft">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your plan, payment method, and usage. Plan changes happen in the Stripe billing portal.
        </p>
      </div>

      <TierCard state={state} />

      {state.whiteLabel && <WhiteLabelCard />}

      <SnapshotHistoryCard tier={state.tier} snapshots={state.snapshots} />
    </div>
  );
}
