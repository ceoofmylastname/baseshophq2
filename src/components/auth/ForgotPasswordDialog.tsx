import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Mail, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  defaultEmail?: string;
};

/**
 * Phase 16.0: Forgot-password modal.
 *
 * Opens from the "Forgot password?" link on /login. User types their email,
 * Supabase sends a reset-password email via Resend, the email contains a
 * link that lands on /reset-password where they pick a new password.
 *
 * The success state is intentionally vague about whether the email exists.
 * Standard security pattern: don't confirm/deny account existence to a
 * non-authenticated visitor.
 */
export function ForgotPasswordDialog({ open, onClose, defaultEmail = "" }: Props) {
  const [email, setEmail] = useState(defaultEmail);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEmail(defaultEmail);
    setSubmitting(false);
    setSent(false);
    setError(null);
  }

  function handleClose() {
    onClose();
    // Reset after the close animation so the form doesn't flash on close.
    setTimeout(reset, 300);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSent(true);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden
        onClick={handleClose}
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Reset password"
        className={cn(
          "fixed inset-0 z-50 flex flex-col glass-strong shadow-2xl transition-all duration-300",
          "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
          open
            ? "translate-y-0 opacity-100 sm:scale-100"
            : "pointer-events-none translate-y-4 opacity-0 sm:translate-y-0 sm:scale-95",
        )}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
              Reset password
            </p>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight text-shadow-soft">
              {sent ? "Check your inbox" : "Forgot your password?"}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {sent ? (
            <div className="space-y-4 py-2 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/15 text-emerald-300 shadow-[0_0_24px_hsl(150_70%_55%/0.4)]">
                <Check className="h-7 w-7" />
              </div>
              <div>
                <p className="text-sm font-semibold text-shadow-soft">
                  We sent a reset link to <span className="text-primary">{email}</span>.
                </p>
                <p className="mx-auto mt-2 max-w-sm text-xs text-muted-foreground">
                  Open the email and click the link to set a new password.
                  If you don&apos;t see it within a few minutes, check your spam folder.
                  The link expires in 1 hour.
                </p>
              </div>
              <Button type="button" onClick={handleClose} size="lg">
                Got it
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <Mail className="h-4 w-4 shrink-0 text-primary" />
                <p className="text-xs text-muted-foreground">
                  Type the email you signed up with. We&apos;ll email you a link to set a new password.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fp-email">Your email</Label>
                <Input
                  id="fp-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  inputMode="email"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoFocus
                  className="h-11 border-white/10 bg-white/[0.03] focus-visible:ring-primary sm:h-10"
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button
                type="submit"
                size="lg"
                disabled={submitting || !email.trim()}
                className="w-full shadow-[0_0_24px_hsl(38_92%_60%/0.3)]"
              >
                {submitting ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
