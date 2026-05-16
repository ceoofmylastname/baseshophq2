import { Crown } from "lucide-react";

/**
 * White-label add-on card. Rendered only when state.whiteLabel === true.
 *
 * For PR 3b this is a placeholder: it confirms the add-on is active and
 * states that custom-domain features will ship in a future release. The
 * gold accent (border-primary + text-primary) matches the brand tier so
 * it reads as a premium feature card.
 */
export function WhiteLabelCard() {
  return (
    <section className="rounded-2xl border border-primary/40 bg-primary/[0.04] p-5 backdrop-blur-md">
      <div className="flex items-start gap-3">
        <Crown className="mt-0.5 h-5 w-5 text-primary" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-primary">
            White-label add-on active
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Custom domains will ship in a future release. Your branding controls live in Settings under Agency profile.
          </p>
        </div>
      </div>
    </section>
  );
}
