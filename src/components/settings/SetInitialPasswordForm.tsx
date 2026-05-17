/**
 * Phase 18.1 — "Set Your Password" form.
 *
 * Renders the new-password + confirm-password fields used by Phase 18 self-
 * serve signups (who entered the dashboard via magic link without ever
 * setting a password). No current-password prompt, no re-auth check — the
 * existing session granted by the magic link is the proof of identity.
 *
 * Used in two places:
 *   1. Settings → Account section (AccountSection.tsx), when hasPassword
 *      resolves false. Renders without onCancel — there is no "back out"
 *      surface in Settings.
 *   2. Phase 18.4 WelcomeModal step 2. Renders with onCancel wired to the
 *      "Skip for now" text link below Save.
 *
 * On success the caller is responsible for refetching useHasPassword() so
 * dependent UI (PasswordSetupBanner, the AccountSection mode toggle) updates.
 *
 * Phase 18.4 extracted this from AccountSection.tsx unchanged in behavior;
 * only the onCancel surface is new. No fork.
 */

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff } from "lucide-react";

export type SetInitialPasswordFormProps = {
  onSuccess: () => void;
  onCancel?: () => void;
};

export function SetInitialPasswordForm({ onSuccess, onCancel }: SetInitialPasswordFormProps) {
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
    setSubmitting(false);
    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    toast.success("Password set successfully. You can now log in with email and password.");
    setNewPassword("");
    setConfirm("");
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Set a password to log in with email and password going forward. Magic links remain available.
      </p>
      <div className="space-y-2">
        <Label htmlFor="ac-set-new-pw">New password</Label>
        <div className="relative">
          <Input
            id="ac-set-new-pw"
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
        <Label htmlFor="ac-set-confirm-pw">Confirm password</Label>
        <Input
          id="ac-set-confirm-pw"
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
      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={submitting || !newPassword || !confirm}>
          {submitting ? "Saving..." : "Save password"}
        </Button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="self-center text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Skip for now
          </button>
        )}
      </div>
    </form>
  );
}
