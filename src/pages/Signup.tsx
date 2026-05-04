import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { supabase, SUPABASE_FUNCTIONS_URL } from "@/lib/supabase-browser";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/**
 * Map provision_tenant_and_owner error_code values to friendly user copy.
 * - validation_failed → surface the server's error_message detail
 * - slug_collision    → ask for a different slug
 * - user_already_has_tenant → suggest sign in
 * - auth_user_not_found / auth_create_failed / provision_threw → generic;
 *   internal details are intentionally hidden
 */
function mapErrorCode(code: string | null | undefined, detail?: string | null): string {
  switch (code) {
    case "validation_failed":
      return detail ? `Please check your input and try again. ${detail}` : "Please check your input and try again.";
    case "slug_collision":
      return "That agency slug is already taken. Try a different one.";
    case "user_already_has_tenant":
      return "An account with this email already exists. Try logging in.";
    case "auth_create_failed":
      return detail ?? "Signup failed. Please try again.";
    case "auth_user_not_found":
    case "provision_threw":
      return "Signup failed. Please try again.";
    default:
      return detail ?? "Signup failed.";
  }
}

export function SignupPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [agencyName, setAgencyName]     = useState("");
  const [agencySlug, setAgencySlug]     = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [firstName, setFirstName]       = useState("");
  const [lastName, setLastName]         = useState("");
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState<string | null>(null);

  // Auto-derive slug from agency name unless the user edited it
  useEffect(() => {
    if (!slugManuallyEdited) setAgencySlug(slugify(agencyName));
  }, [agencyName, slugManuallyEdited]);

  if (!loading && session) return <Navigate to="/dashboard" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          agencyName,
          agencySlug,
          ownerFirstName: firstName,
          ownerLastName: lastName,
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) {
        setError(mapErrorCode(result.error_code, result.error_message ?? result.error));
        return;
      }
      // Auto-sign-in with the password they just set
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) {
        setError(`Account created, but auto-sign-in failed: ${signInErr.message}`);
        return;
      }
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Create your agency</CardTitle>
          <CardDescription>You'll be the owner. Master grid auto-seeds.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="new-password" required minLength={8}
                value={password} onChange={(e) => setPassword(e.target.value)} />
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agencyName">Agency name</Label>
              <Input id="agencyName" required value={agencyName} onChange={(e) => setAgencyName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agencySlug">Agency URL slug</Label>
              <Input id="agencySlug" required value={agencySlug}
                onChange={(e) => { setAgencySlug(e.target.value); setSlugManuallyEdited(true); }}
                pattern="^[a-z0-9]+(-[a-z0-9]+)*$"
                title="Lowercase letters, digits, and hyphens; no leading/trailing hyphens." />
              <p className="text-xs text-muted-foreground">Auto-generated from agency name. Edit if needed.</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Creating…" : "Create agency"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already have one?{" "}
              <Link to="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
