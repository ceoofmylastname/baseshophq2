import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/lib/supabase-browser";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Eye, EyeOff, KeyRound } from "lucide-react";

/**
 * Phase 16.0: Forgot-password reset page.
 *
 * When the user clicks the password-reset link in the email, Supabase
 * auto-creates a recovery session and redirects them here. The page reads
 * the email from the session, lets the user pick a new password, calls
 * updateUser({ password }), then routes to /home.
 *
 * If no session exists (someone hits /reset-password directly), bounce
 * to /login.
 */
export function ResetPasswordPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <div aria-hidden className="pointer-events-none absolute inset-0 gradient-rim opacity-60" />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-shadow-hero">
            Baseshop <span className="text-primary">HQ</span>
          </h1>
        </div>

        <Card className="w-full">
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/15 text-primary shadow-[0_0_16px_hsl(38_92%_60%/0.3)]">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="tracking-tight">Set a new password</CardTitle>
                <CardDescription>
                  {userEmail
                    ? <>Updating password for <span className="font-semibold text-foreground">{userEmail}</span>.</>
                    : "Choose a new password to finish resetting your account."}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="rp-password">New password</Label>
                <div className="relative">
                  <Input
                    id="rp-password"
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
                <Label htmlFor="rp-confirm">Confirm new password</Label>
                <Input
                  id="rp-confirm"
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
                {submitting ? "Updating…" : <>Update password <Check className="ml-1.5 h-4 w-4" /></>}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                <Link to="/login" className="font-medium text-primary hover:underline">
                  Back to sign in
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
