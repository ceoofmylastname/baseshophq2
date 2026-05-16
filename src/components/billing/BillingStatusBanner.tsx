import { Link } from "react-router-dom";
import { AlertTriangle, Ban, XCircle, ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useBillingState } from "@/hooks/useBillingState";
import { bannerVariant, formatPastDueDeadline } from "@/lib/billing/helpers";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Global billing-status banner. Rendered once at the top of <main> in
 * DashboardShell so every authenticated route surfaces lifecycle warnings.
 *
 *   active     → renders nothing
 *   past_due   → amber banner; owners see "Update payment method" CTA;
 *                non-owners see copy only
 *   suspended  → red banner; same CTA gating
 *   cancelled  → neutral banner; owners see "Choose a plan"
 *
 * Past-due banners include the suspension cutoff date (past_due_since + 14d)
 * via the formatPastDueDeadline pure helper.
 */

const ICONS = {
  AlertTriangle,
  Ban,
  XCircle,
};

const COLOR_CLASSES = {
  amber: {
    container: "border-amber-400/30 bg-amber-400/[0.06]",
    icon: "text-amber-300",
    title: "text-amber-200",
  },
  red: {
    container: "border-red-500/30 bg-red-500/[0.06]",
    icon: "text-red-300",
    title: "text-red-200",
  },
  neutral: {
    container: "border-white/[0.12] bg-white/[0.04]",
    icon: "text-muted-foreground",
    title: "text-foreground",
  },
} as const;

export function BillingStatusBanner() {
  const { isOwner } = useAuth();
  const { state } = useBillingState();

  if (!state) return null;

  const variant = bannerVariant(state.billingStatus, isOwner);
  if (!variant) return null;

  const Icon = ICONS[variant.icon];
  const styles = COLOR_CLASSES[variant.color];

  const deadlineHint =
    variant.kind === "past_due" && state.pastDueSince
      ? ` Your team goes read-only after ${formatPastDueDeadline(state.pastDueSince)}.`
      : "";

  return (
    <div
      className={cn(
        "mb-4 rounded-2xl border p-4 glass",
        styles.container,
        "flex flex-col items-start gap-3 md:flex-row md:items-center md:justify-between",
      )}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", styles.icon)} />
        <div className="min-w-0">
          <p className={cn("text-sm font-semibold", styles.title)}>
            {variant.copy}
          </p>
          {deadlineHint && (
            <p className="mt-0.5 text-xs text-muted-foreground">{deadlineHint.trim()}</p>
          )}
        </div>
      </div>

      {variant.cta && (
        <Button asChild size="sm" variant="outline" className="shrink-0 self-stretch md:self-auto">
          <Link to={variant.cta.href}>
            {variant.cta.label}
            <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      )}
    </div>
  );
}
