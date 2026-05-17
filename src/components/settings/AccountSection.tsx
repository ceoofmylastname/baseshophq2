import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useAuth } from "@/contexts/AuthContext";
import { useHasPassword } from "@/hooks/useHasPassword";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SetInitialPasswordForm } from "./SetInitialPasswordForm";
import { Mail, Lock, Check, Eye, EyeOff, ArrowRight, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Phase 16.0: Account section in Settings (email + password change).
 * Phase 18.1: extended in place to support the "set initial password" path
 * for users who signed up through the public Stripe-checkout flow and
 * entered via magic link without ever setting a password.
 *
 * Email change: calls supabase.auth.updateUser({ email }). Supabase sends
 * a confirmation email to the NEW address; the change only takes effect
 * after the user clicks the link in that email. Until then they continue
 * to log in with the old email.
 *
 * Password form smart-branches on useHasPassword():
 *   - hasPassword === false → "Set Your Password" mode. New + Confirm
 *     only, no current-password prompt, no re-auth. There is no current
 *     credential to verify; the existing session (granted by magic link)
 *     is the proof of identity.
 *   - hasPassword === true → "Change Password" mode. Preserves the
 *     Phase 16.0 manual re-auth check (signInWithPassword against the
 *     current email + entered current password) before calling
 *     updateUser({ password }). This guardrail must remain whenever the
 *     user already has a password set; updateUser does not natively gate
 *     on the old password and we will not weaken that.
 *   - hasPassword === null (loading) → render a minimal skeleton.
 *
 * Hash anchor (Phase 18.1 inline pattern, no generic helper):
 * if the URL hash is "#password" on mount, switch to the password tab and
 * smooth-scroll the section into view. The Settings.tsx host renders an
 * id="password" anchor that we target.
 */

function EmailChangeForm({ currentEmail }: { currentEmail: string }) {
  const [newEmail, setNewEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed || !/^.+@.+\..+$/.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    if (trimmed === currentEmail.toLowerCase()) {
      setError("That's already your email.");
      return;
    }
    setSubmitting(true);
    const { error: err } = await supabase.auth.updateUser({ email: trimmed });
    setSubmitting(false);
    if (err) { setError(err.message); return; }
    setPending(true);
  }

  if (pending) {
    return (
      <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/[0.05] p-4">
        <div className="flex items-start gap-3">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          <div>
            <p className="text-sm font-semibold text-shadow-soft">
              Confirmation link sent to <span className="text-primary">{newEmail}</span>.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Open the email and click the link to confirm the change. Until then you continue to log in with <span className="font-medium text-foreground">{currentEmail}</span>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="ac-current-email" className="text-xs text-muted-foreground">Current email</Label>
        <Input
          id="ac-current-email"
          value={currentEmail}
          readOnly
          className="h-10 cursor-not-allowed border-white/10 bg-white/[0.02] text-muted-foreground"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ac-new-email">New email</Label>
        <Input
          id="ac-new-email"
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          inputMode="email"
          autoCapitalize="none"
          autoComplete="email"
          placeholder="new@email.com"
          className="h-11 border-white/10 bg-white/[0.03] focus-visible:ring-primary sm:h-10"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={submitting || !newEmail.trim()}>
        {submitting ? "Sending confirmation..." : <>Send confirmation link <ArrowRight className="ml-1.5 h-4 w-4" /></>}
      </Button>
    </form>
  );
}

/**
 * "Change Password" branch (used when hasPassword === true). Preserves the
 * Phase 16.0 manual re-auth check before calling updateUser({password}).
 * Supabase does not natively gate updateUser on the current password; we
 * add the check by trying signInWithPassword against the session email. If
 * that fails the user typed the wrong current password and we abort. This
 * guardrail is NOT optional for the has-password branch.
 */
function PasswordChangeForm({ currentEmail, onSuccess }: { currentEmail: string; onSuccess: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset-via-email escape hatch (Phase 16.0). Catches the case where the
  // user honestly doesn't remember the current password.
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  async function handleResetViaEmail() {
    setResetError(null);
    setResetSubmitting(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(currentEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetSubmitting(false);
    if (err) {
      setResetError(err.message);
      return;
    }
    setResetSent(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must be different from your current password.");
      return;
    }

    setSubmitting(true);

    // Manual re-auth: Supabase does NOT require old-password verification
    // on updateUser. The signInWithPassword call below adds that gate. Do
    // NOT remove this for the hasPassword === true branch.
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: currentEmail,
      password: currentPassword,
    });
    if (signInErr) {
      setSubmitting(false);
      setError("Current password is incorrect.");
      return;
    }

    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
    setSubmitting(false);
    if (updateErr) {
      setError(updateErr.message);
      return;
    }

    setDone(true);
    setCurrentPassword("");
    setNewPassword("");
    setConfirm("");
    onSuccess();
    setTimeout(() => setDone(false), 4500);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="ac-current-pw">Current password</Label>
        <div className="relative">
          <Input
            id="ac-current-pw"
            type={showCurrent ? "text" : "password"}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="h-11 border-white/10 bg-white/[0.03] pr-10 focus-visible:ring-primary sm:h-10"
          />
          <button
            type="button"
            onClick={() => setShowCurrent((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground"
            aria-label={showCurrent ? "Hide password" : "Show password"}
          >
            {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ac-new-pw">New password</Label>
        <div className="relative">
          <Input
            id="ac-new-pw"
            type={showNew ? "text" : "password"}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            className="h-11 border-white/10 bg-white/[0.03] pr-10 focus-visible:ring-primary sm:h-10"
          />
          <button
            type="button"
            onClick={() => setShowNew((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground"
            aria-label={showNew ? "Hide password" : "Show password"}
          >
            {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">At least 8 characters.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ac-confirm-pw">Confirm new password</Label>
        <Input
          id="ac-confirm-pw"
          type={showNew ? "text" : "password"}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className="h-11 border-white/10 bg-white/[0.03] focus-visible:ring-primary sm:h-10"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {done && (
        <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-300">
          <Check className="h-4 w-4" />
          Password updated.
        </p>
      )}
      <Button type="submit" disabled={submitting || !currentPassword || !newPassword || !confirm}>
        {submitting ? "Updating..." : "Update password"}
      </Button>

      <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-sm font-semibold">Don&apos;t know your current password?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Common if you joined through an invite link and never set one.
              We&apos;ll email <span className="font-medium text-foreground">{currentEmail}</span> a
              link to set a new password without needing the old one.
            </p>
            {resetError && <p className="mt-2 text-sm text-destructive">{resetError}</p>}
            {resetSent ? (
              <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-emerald-300">
                <Check className="h-4 w-4" />
                Link sent. Check your inbox.
              </p>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleResetViaEmail()}
                disabled={resetSubmitting}
                className="mt-3"
              >
                {resetSubmitting ? "Sending..." : "Send me a reset link"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

export function AccountSection() {
  const { currentAgent, session } = useAuth();
  const { hasPassword, refetch } = useHasPassword();
  const [tab, setTab] = useState<"email" | "password">("email");
  const passwordSectionRef = useRef<HTMLDivElement | null>(null);

  // Hash anchor scroll. If the URL is /settings#password (e.g. from the
  // PasswordSetupBanner CTA), flip to the password tab and smooth-scroll
  // the password block into view. Inline per locked D4; no generic helper.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#password") return;
    setTab("password");
    // Defer the scroll one tick so the password subtree has rendered.
    const t = window.setTimeout(() => {
      passwordSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const userEmail = session?.user?.email ?? currentAgent?.email ?? "";

  const passwordTitle = hasPassword === false ? "Set Your Password" : "Change Password";

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold tracking-tight">Your account</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Update your email address or password. Email changes require confirmation; password changes apply immediately.
        </p>
      </div>

      {/* Tab toggle */}
      <div className="flex items-center gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5 text-xs sm:w-fit">
        <button
          type="button"
          onClick={() => setTab("email")}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors sm:flex-none",
            tab === "email"
              ? "bg-white/[0.06] text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Mail className="h-3.5 w-3.5" />
          Change email
        </button>
        <button
          type="button"
          onClick={() => setTab("password")}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors sm:flex-none",
            tab === "password"
              ? "bg-white/[0.06] text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Lock className="h-3.5 w-3.5" />
          {passwordTitle}
        </button>
      </div>

      <div ref={passwordSectionRef} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        {tab === "email" ? (
          <EmailChangeForm currentEmail={userEmail} />
        ) : hasPassword === null ? (
          <div className="h-32 animate-pulse rounded-lg bg-white/[0.03]" />
        ) : hasPassword === false ? (
          <SetInitialPasswordForm onSuccess={refetch} />
        ) : (
          <PasswordChangeForm currentEmail={userEmail} onSuccess={refetch} />
        )}
      </div>
    </div>
  );
}
