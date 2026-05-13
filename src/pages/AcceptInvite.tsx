import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase-browser";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Eye, EyeOff, Sparkles } from "lucide-react";

/**
 * Phase 16.0: Invite acceptance page.
 *
 * Supabase generates a magic link in the invite email. When the recipient
 * clicks it, Supabase auto-creates a session and redirects to this page.
 * The user is technically signed in already — but they still need to set
 * a password so they can log in normally next time.
 *
 * Flow:
 *   1. The page mounts. A session exists (verified by the magic link).
 *   2. Email is shown read-only (it was verified when they clicked the link).
 *   3. User types a password + confirmation.
 *   4. Submit: supabase.auth.updateUser({ password }) sets the password.
 *   5. Redirect to /home.
 *
 * If a logged-in user (with a password already set) somehow lands here,
 * we let them through — they can update their password from this screen
 * harmlessly. The page is safe to re-visit.
 */
export function AcceptInvitePage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If they land here without a session (someone shared the URL outside the
  // invite email), push them to login so they can't bypass auth.
  if (!loading && !session) {
    return <Navigate to="/login" replace />;
  }

  const userEmail = session?.user?.email ?? "";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (err) {
      setError(err.message);
      return;
    }

    navigate("/home", { replace: true });
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 sm:p-6 ambient-wash">
      <div aria-hidden className="pointer-events-none absolute inset-0 gradient-rim opacity-70" />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-shadow-hero">
            Baseshop <span className="text-primary">HQ</span>
          </h1>
          <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Welcome to the team
          </p>
        </div>

        <Card className="w-full">
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/15 text-primary shadow-[0_0_16px_hsl(38_92%_60%/0.3)]">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="tracking-tight">Set your password</CardTitle>
                <CardDescription>
                  One more step. Pick a password and you&apos;re in.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email — read-only, since the magic link already verified it */}
              <div className="space-y-2">
                <Label htmlFor="ai-email">Your email</Label>
                <Input
                  id="ai-email"
                  type="email"
                  value={userEmail}
                  readOnly
                  className="h-11 cursor-not-allowed border-white/10 bg-white/[0.02] text-muted-foreground sm:h-10"
                />
                <p className="text-[11px] text-muted-foreground">
                  Verified when you opened the invite link. You can change this from Settings later.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-password">Password</Label>
                <div className="relative">
                  <Input
                    id="ai-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    autoFocus
                    className="h-11 border-white/10 bg-white/[0.03] pr-10 focus-visible:ring-primary sm:h-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">At least 8 characters.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-confirm">Confirm password</Label>
                <Input
                  id="ai-confirm"
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="h-11 border-white/10 bg-white/[0.03] focus-visible:ring-primary sm:h-10"
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button
                type="submit"
                size="lg"
                className="w-full shadow-[0_0_24px_hsl(38_92%_60%/0.3)]"
                disabled={submitting || password.length < 8 || password !== confirmPassword}
              >
                {submitting ? "Saving…" : <>Set password and continue <Check className="ml-1.5 h-4 w-4" /></>}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
