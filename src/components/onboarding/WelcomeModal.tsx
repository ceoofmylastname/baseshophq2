/**
 * Phase 18.4 — first-sign-in welcome modal.
 *
 * Mounts on /home alongside PasswordSetupBanner. Triggers when a tenant owner
 * lands on /home for the first time without a password set (see
 * useWelcomeModalTrigger for the triple-gate). Walks the user through a
 * three-step flow:
 *
 *   1. Welcome  — kinetic gradient header, "Get started" CTA
 *   2. Password — reuses SetInitialPasswordForm with a "Skip for now" footer
 *   3. Done     — "Go to dashboard" CTA, closes the modal
 *
 * Dismissal persists per-user in localStorage so a refresh or future sign-in
 * never reopens it. PasswordSetupBanner remains the long-tail safety net for
 * users who skip the password step here.
 *
 * Accessibility comes free from Radix Dialog: role=dialog, aria-modal=true,
 * focus trap, ESC dismiss, scroll lock. The auto-rendered X button at the
 * top-right of DialogContent routes through onOpenChange so any of those
 * three exit paths (X, ESC, overlay click) fires the same markSeen path as
 * "Skip for now."
 *
 * Visual style mirrors PasswordSetupBanner: glass-strong, top accent gradient,
 * Lucide icons, text-shadow-soft.
 */

import { useEffect, useState } from "react";
import { Sparkles, ShieldCheck, Check } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useHasPassword } from "@/hooks/useHasPassword";
import { useWelcomeModalTrigger } from "@/hooks/useWelcomeModalTrigger";
import { SetInitialPasswordForm } from "@/components/settings/SetInitialPasswordForm";
import { nextStep, type WelcomeStep } from "@/lib/welcome-modal-state";

export function WelcomeModal() {
  const { shouldShow, markSeen } = useWelcomeModalTrigger();
  const { refetch } = useHasPassword();
  const { currentAgent } = useAuth();
  const [step, setStep] = useState<WelcomeStep>("welcome");
  const [open, setOpen] = useState(false);

  // One-shot mount-up. When the triple-gate first reports eligibility we open
  // at step 1. After close() runs, markSeen flips shouldShow to false in the
  // same tick, so this effect never re-fires for the same user/session.
  useEffect(() => {
    if (shouldShow && !open) {
      setStep("welcome");
      setOpen(true);
    }
  }, [shouldShow, open]);

  function close() {
    markSeen();
    setOpen(false);
  }

  function advance(action: "next" | "skip" | "close") {
    const next = nextStep(step, action);
    if (next === null) {
      close();
    } else {
      setStep(next);
    }
  }

  // Password just saved. Evict the hasPassword cache so PasswordSetupBanner
  // unmounts before the user even sees step 3.
  function handlePasswordSet() {
    refetch();
    advance("next");
  }

  const firstName = currentAgent?.first_name?.trim() || "there";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-lg overflow-hidden border-white/[0.08] bg-[#0B0B0C]/95 p-0 sm:rounded-2xl">
        {/* Top accent bar — same gold gradient palette as PasswordSetupBanner. */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 z-10 h-[2px] bg-gradient-to-r from-primary via-amber-300 to-primary"
        />

        {step === "welcome" && (
          <StepWelcome
            firstName={firstName}
            onStart={() => advance("next")}
            onSkip={() => advance("skip")}
          />
        )}
        {step === "password" && (
          <StepPassword
            onSuccess={handlePasswordSet}
            onSkip={() => advance("skip")}
          />
        )}
        {step === "done" && (
          <StepDone firstName={firstName} onClose={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function StepWelcome({
  firstName,
  onStart,
  onSkip,
}: {
  firstName: string;
  onStart: () => void;
  onSkip: () => void;
}) {
  return (
    <div>
      {/* Kinetic gradient header. Two radial layers, slow pulse on the inner
          glow. Reads as luxury Webflow rather than CRM. */}
      <div className="relative h-32 overflow-hidden bg-[radial-gradient(120%_120%_at_0%_0%,hsl(38_92%_60%/0.35),transparent_60%),radial-gradient(120%_120%_at_100%_100%,hsl(38_92%_60%/0.25),transparent_60%)]">
        <div
          aria-hidden
          className="absolute inset-0 animate-pulse bg-[radial-gradient(60%_60%_at_50%_50%,hsl(38_92%_60%/0.18),transparent_70%)]"
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15 text-primary shadow-[0_0_28px_hsl(38_92%_60%/0.35)]">
            <Sparkles className="h-7 w-7" />
          </div>
        </div>
      </div>

      <div className="space-y-4 p-6">
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            Welcome to Base Shop HQ
          </p>
          <h2 className="text-xl font-semibold tracking-tight text-shadow-soft">
            Your dashboard is ready, {firstName}.
          </h2>
          <p className="text-sm text-muted-foreground">
            One quick step and you&apos;re in.
          </p>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <Button autoFocus onClick={onStart} size="lg">
            Get started
          </Button>
          <button
            type="button"
            onClick={onSkip}
            className="self-center text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}

function StepPassword({
  onSuccess,
  onSkip,
}: {
  onSuccess: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="space-y-4 p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary shadow-[0_0_18px_hsl(38_92%_60%/0.3)]">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold tracking-tight text-shadow-soft">
            Set a password for faster sign-in
          </h2>
          <p className="text-xs text-muted-foreground">
            Magic links keep working. A password gives you a second way in.
          </p>
        </div>
      </div>

      <SetInitialPasswordForm onSuccess={onSuccess} onCancel={onSkip} />
    </div>
  );
}

function StepDone({
  firstName,
  onClose,
}: {
  firstName: string;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4 p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-400/15 text-emerald-300 shadow-[0_0_18px_hsl(160_70%_50%/0.3)]">
          <Check className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
            You&apos;re all set
          </p>
          <h2 className="text-xl font-semibold tracking-tight text-shadow-soft">
            Welcome aboard, {firstName}.
          </h2>
          <p className="text-sm text-muted-foreground">
            Your dashboard is ready.
          </p>
        </div>
      </div>

      <Button autoFocus onClick={onClose} size="lg" className="w-full">
        Go to dashboard
      </Button>
    </div>
  );
}
