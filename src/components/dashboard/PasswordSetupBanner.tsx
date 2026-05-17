/**
 * Phase 18.1 — PasswordSetupBanner
 *
 * Mounts at the top of /home (above <ActionBanner />) for users whose
 * auth.users.encrypted_password is NULL — typically Phase 18 self-serve
 * signups who entered the dashboard via magic link without ever setting a
 * password. Dismissible per session via sessionStorage.
 *
 * Visual style mirrors SetupWizardBanner.tsx: glass-strong card with a gold
 * accent and a Lucide Key icon. Copy locked per parent plan; no em dashes.
 */

import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Key, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHasPassword } from "@/hooks/useHasPassword";
import {
  PASSWORD_BANNER_DISMISSED_KEY,
  isPasswordBannerDismissed,
  setPasswordBannerDismissed,
} from "@/lib/password-banner-dismissal";

// Re-export so consumers (including tests) can keep importing through the
// component module if they prefer that surface.
export { PASSWORD_BANNER_DISMISSED_KEY, isPasswordBannerDismissed };

export function PasswordSetupBanner() {
  const { hasPassword } = useHasPassword();
  const [dismissed, setDismissed] = useState<boolean>(() => isPasswordBannerDismissed());

  // Re-read sessionStorage when hasPassword resolves. Covers the edge case
  // where the user dismisses, refreshes, and the initial state needs to
  // pick up the stored flag.
  useEffect(() => {
    setDismissed(isPasswordBannerDismissed());
  }, [hasPassword]);

  if (hasPassword !== false) return null;
  if (dismissed) return null;

  function handleDismiss() {
    setPasswordBannerDismissed();
    setDismissed(true);
  }

  return (
    <div className="relative rounded-2xl glass-strong p-5 ring-1 ring-primary/20">
      {/* Top accent bar matching SetupWizardBanner */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl bg-gradient-to-r from-primary via-amber-300 to-primary"
      />

      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary shadow-[0_0_18px_hsl(38_92%_60%/0.3)]">
          <Key className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            Finish your account setup
          </p>
          <h2 className="mt-0.5 text-sm font-semibold tracking-tight text-shadow-soft">
            Set a password to enable email and password login
          </h2>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Welcome to Base Shop HQ. Set a password to enable email and password login. You can still use magic links anytime.
          </p>
          <div className="mt-3">
            <Button asChild size="sm">
              <Link to="/settings#password">Set Password</Link>
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
