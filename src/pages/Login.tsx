import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase-browser";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ForgotPasswordDialog } from "@/components/auth/ForgotPasswordDialog";

/**
 * Phase 16.0 — password sign-in (the default path).
 * Phase 18.1 — small magic-link escape hatch. A text link below the
 *   password field, plus an inline link on "Invalid login credentials"
 *   error toast, both call signInWithOtp({ email }). This covers the
 *   common Phase 18 self-serve case: a user who signed up via Stripe
 *   Checkout, entered the dashboard via magic link, never set a password,
 *   then comes back to /login a week later and hits the "no password set"
 *   wall. They can now request a fresh magic link without bouncing
 *   through the forgot-password flow.
 */

const EMAIL_RE = /^.+@.+\..+$/;

export function LoginPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/home";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [magicSubmitting, setMagicSubmitting] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noPasswordHint, setNoPasswordHint] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  if (!loading && session) return <Navigate to={from} replace />;

  const emailValid = EMAIL_RE.test(email.trim());

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNoPasswordHint(false);
    setSubmitting(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (err) {
      // "Invalid login credentials" is the message Supabase returns both
      // for wrong-password AND no-password-set. Surface a path forward.
      const isCredErr = /invalid login credentials/i.test(err.message);
      if (isCredErr) {
        setError("No password set, or wrong password. Try a magic link instead.");
        setNoPasswordHint(true);
      } else {
        setError(err.message);
      }
      return;
    }
    navigate(from, { replace: true });
  }

  async function sendMagicLink() {
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError("Enter a valid email address first.");
      return;
    }
    setError(null);
    setMagicSubmitting(true);
    const { error: err } = await supabase.auth.signInWithOtp({ email: trimmed });
    setMagicSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    setMagicLinkSent(true);
    toast.success(`Magic link sent to ${trimmed}.`);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-6 ambient-wash">
      {/* Slow animated gradient behind the auth card. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 gradient-rim opacity-70" />

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-shadow-hero">
            Baseshop <span className="text-primary">HQ</span>
          </h1>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Agency control plane
          </p>
        </div>

        <Card className="w-full">
          <CardHeader>
            <CardTitle className="tracking-tight">Sign in</CardTitle>
            <CardDescription>Continue to your dashboard</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="border-white/10 bg-white/[0.03] focus-visible:ring-primary"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button
                    type="button"
                    onClick={() => setForgotOpen(true)}
                    className="text-[11px] font-medium text-primary hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="border-white/10 bg-white/[0.03] focus-visible:ring-primary"
                />
                <div className="pt-0.5 text-right">
                  <button
                    type="button"
                    onClick={() => void sendMagicLink()}
                    disabled={!emailValid || magicSubmitting || magicLinkSent}
                    className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {magicLinkSent
                      ? "Magic link sent. Check your inbox."
                      : magicSubmitting
                        ? "Sending magic link..."
                        : "Email me a magic link instead"}
                  </button>
                </div>
              </div>
              {error && (
                <div className="text-sm text-destructive">
                  <p>{error}</p>
                  {noPasswordHint && !magicLinkSent && (
                    <button
                      type="button"
                      onClick={() => void sendMagicLink()}
                      disabled={!emailValid || magicSubmitting}
                      className="mt-1 font-medium text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {magicSubmitting ? "Sending..." : "Send me a magic link"}
                    </button>
                  )}
                </div>
              )}
              <Button
                type="submit"
                className="w-full shadow-[0_0_24px_hsl(38_92%_60%/0.3)]"
                disabled={submitting}
              >
                {submitting ? "Signing in..." : "Sign in"}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                No account?{" "}
                <Link to="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
                  Create one
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>

      <ForgotPasswordDialog
        open={forgotOpen}
        onClose={() => setForgotOpen(false)}
        defaultEmail={email}
      />
    </div>
  );
}
