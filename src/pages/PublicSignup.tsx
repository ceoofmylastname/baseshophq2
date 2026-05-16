/**
 * Phase 18 PR 2 — Public /signup
 *
 * Reads ?tier=&interval=&wl= URL params. Missing/invalid values default to
 * Starter / Monthly / no-WL with an inline dismissible banner notice.
 *
 * On submit, validates client-side and POSTs to /functions/v1/signup-checkout.
 * 200 → window.location to Stripe URL (after stashing email in sessionStorage
 * for the /signup/success magic-link copy).
 *
 * Per locked rules:
 *   - sessionStorage write happens BEFORE the redirect, not after.
 *   - Inline banner uses no em dashes ("Plan not specified. Defaulted to
 *     Starter. Use the pricing page to pick a different plan.").
 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Info, X } from "lucide-react";
import { SUPABASE_FUNCTIONS_URL } from "@/lib/supabase-browser";
import { BaseshopLogo } from "@/components/marketing/BaseshopLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlanSummaryCard } from "@/components/signup/PlanSummaryCard";
import { TimeZoneSelect, detectDefaultTimeZone } from "@/components/signup/TimeZoneSelect";
import {
  TIER_CONFIG,
  type BillingIntervalLite,
  type SelfServeTier,
} from "@/lib/pricing/pricing-math";

const SELF_SERVE_TIERS = new Set<SelfServeTier>(["starter", "growth", "pro"]);

function parseTier(raw: string | null): { tier: SelfServeTier; ok: boolean } {
  if (raw && SELF_SERVE_TIERS.has(raw as SelfServeTier)) {
    return { tier: raw as SelfServeTier, ok: true };
  }
  return { tier: "starter", ok: raw === null };
}

function parseInterval(raw: string | null): { interval: BillingIntervalLite; ok: boolean } {
  if (raw === "monthly" || raw === "annual") return { interval: raw, ok: true };
  return { interval: "monthly", ok: raw === null };
}

function parseWhiteLabel(raw: string | null): { whiteLabel: boolean; ok: boolean } {
  if (raw === "true")  return { whiteLabel: true,  ok: true };
  if (raw === "false") return { whiteLabel: false, ok: true };
  return { whiteLabel: false, ok: raw === null };
}

type FormErrors = {
  agencyName?: string;
  ownerFirstName?: string;
  ownerLastName?: string;
  ownerEmail?: string;
  banner?: string;
};

export function PublicSignupPage() {
  const [params] = useSearchParams();
  const tierParsed     = useMemo(() => parseTier(params.get("tier")),       [params]);
  const intervalParsed = useMemo(() => parseInterval(params.get("interval")), [params]);
  const wlParsed       = useMemo(() => parseWhiteLabel(params.get("wl")),    [params]);

  // Starter + WL combo is invalid; force WL off if so.
  const effectiveTier = tierParsed.tier;
  const effectiveInterval = intervalParsed.interval;
  const effectiveWhiteLabel = effectiveTier === "starter" ? false : wlParsed.whiteLabel;

  const paramsAllValid = tierParsed.ok && intervalParsed.ok && wlParsed.ok &&
    !(tierParsed.tier === "starter" && wlParsed.whiteLabel);

  const [noticeDismissed, setNoticeDismissed] = useState(false);

  // Form state
  const [agencyName, setAgencyName]     = useState("");
  const [firstName, setFirstName]       = useState("");
  const [lastName, setLastName]         = useState("");
  const [email, setEmail]               = useState("");
  const [timeZone, setTimeZone]         = useState<string>(() => detectDefaultTimeZone());
  const [submitting, setSubmitting]     = useState(false);
  const [errors, setErrors]             = useState<FormErrors>({});

  // Reset banner notice when URL params change
  useEffect(() => { setNoticeDismissed(false); }, [params]);

  const cfg = TIER_CONFIG[effectiveTier];
  const subtitle = `${cfg.label} plan${effectiveWhiteLabel ? " with white-label" : ""} at ${effectiveInterval === "annual" ? cfg.annual + "/yr" : cfg.monthly + "/mo"}`;

  function handleClientValidate(): boolean {
    const next: FormErrors = {};
    if (!agencyName.trim()) next.agencyName = "Agency name is required.";
    if (!firstName.trim())  next.ownerFirstName = "First name is required.";
    if (!lastName.trim())   next.ownerLastName = "Last name is required.";
    const trimmedEmail = email.trim();
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!trimmedEmail || !emailRe.test(trimmedEmail)) {
      next.ownerEmail = "A valid email is required.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!handleClientValidate()) return;
    setSubmitting(true);
    setErrors({});

    const trimmedEmail = email.trim().toLowerCase();

    // Stash email BEFORE redirect so /signup/success can render the
    // magic-link copy with the actual address.
    try {
      sessionStorage.setItem("bsq_signup_email", trimmedEmail);
    } catch {
      // ignore — quota/iframe restrictions; success page falls back gracefully
    }

    try {
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/signup-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier: effectiveTier,
          interval: effectiveInterval,
          whiteLabel: effectiveWhiteLabel,
          agencyName: agencyName.trim(),
          ownerEmail: trimmedEmail,
          ownerFirstName: firstName.trim(),
          ownerLastName: lastName.trim(),
          timeZone,
        }),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));

      if (res.status === 200 && json?.ok && typeof json.url === "string") {
        window.location.href = json.url;
        return;
      }
      if (res.status === 400 && json?.error_code === "email_already_registered") {
        setErrors({ ownerEmail: "An account with this email already exists." });
        setSubmitting(false);
        return;
      }
      if (res.status === 400) {
        const code = String(json?.error_code ?? "");
        const msg  = String(json?.error_message ?? "Please review the form and try again.");
        if (code === "starter_white_label_combination") {
          setErrors({ banner: msg });
        } else if (/agencyName|agency name/i.test(msg)) {
          setErrors({ agencyName: msg });
        } else if (/firstName|first name/i.test(msg)) {
          setErrors({ ownerFirstName: msg });
        } else if (/lastName|last name/i.test(msg)) {
          setErrors({ ownerLastName: msg });
        } else if (/email/i.test(msg)) {
          setErrors({ ownerEmail: msg });
        } else {
          setErrors({ banner: msg });
        }
        setSubmitting(false);
        return;
      }
      // 500 or other
      setErrors({
        banner: "Something went wrong on our end. Please try again or contact support@baseshophq.com.",
      });
      setSubmitting(false);
    } catch {
      setErrors({
        banner: "Something went wrong on our end. Please try again or contact support@baseshophq.com.",
      });
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      {/* Top bar */}
      <header className="border-b border-white/[0.04]">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="Baseshop HQ home">
            <BaseshopLogo className="h-7 w-auto sm:h-9" />
          </Link>
          <Link
            to="/login"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="relative px-4 py-10 sm:px-6 sm:py-14">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-50 gradient-rim" />
        <div className="relative mx-auto max-w-5xl">
          <div className="mb-6 sm:mb-8">
            <h1 className="text-3xl font-semibold tracking-tight text-shadow-hero sm:text-4xl">
              Start your 14-day Baseshop HQ trial
            </h1>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              {subtitle}
            </p>
          </div>

          {/* Banner notice when URL params were missing/invalid (D11) */}
          {!paramsAllValid && !noticeDismissed && (
            <div
              role="status"
              className="mb-6 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/[0.06] p-3 text-sm sm:p-4"
            >
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="flex-1 text-foreground">
                Plan not specified. Defaulted to Starter. Use the
                {" "}
                <Link to="/pricing" className="font-medium text-primary underline-offset-4 hover:underline">
                  pricing page
                </Link>
                {" "}
                to pick a different plan.
              </p>
              <button
                type="button"
                onClick={() => setNoticeDismissed(true)}
                className="rounded-md p-1 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {errors.banner && (
            <div role="alert" className="mb-6 rounded-xl border border-destructive/40 bg-destructive/[0.06] p-3 text-sm text-foreground sm:p-4">
              {errors.banner}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setErrors((e) => ({ ...e, banner: undefined }))}
                className="ml-2"
              >
                Try again
              </Button>
            </div>
          )}

          <div className="grid gap-6 sm:gap-8 lg:grid-cols-[1fr_360px]">
            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-7">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="agencyName">
                    Agency name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="agencyName"
                    required
                    autoFocus
                    value={agencyName}
                    onChange={(e) => setAgencyName(e.target.value)}
                    className="border-white/10 bg-white/[0.03] focus-visible:ring-primary"
                  />
                  {errors.agencyName && <p className="text-xs text-destructive">{errors.agencyName}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="firstName">
                    First name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="firstName"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="given-name"
                    className="border-white/10 bg-white/[0.03] focus-visible:ring-primary"
                  />
                  {errors.ownerFirstName && <p className="text-xs text-destructive">{errors.ownerFirstName}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">
                    Last name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="lastName"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoComplete="family-name"
                    className="border-white/10 bg-white/[0.03] focus-visible:ring-primary"
                  />
                  {errors.ownerLastName && <p className="text-xs text-destructive">{errors.ownerLastName}</p>}
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="ownerEmail">
                    Email <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="ownerEmail"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    inputMode="email"
                    className="border-white/10 bg-white/[0.03] focus-visible:ring-primary"
                  />
                  {errors.ownerEmail && (
                    <p className="text-xs text-destructive">
                      {errors.ownerEmail}
                      {errors.ownerEmail.toLowerCase().includes("already") && (
                        <>
                          {" "}
                          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
                            Sign in instead.
                          </Link>
                        </>
                      )}
                    </p>
                  )}
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <TimeZoneSelect
                    value={timeZone}
                    onChange={setTimeZone}
                    label="Time zone"
                    required
                  />
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end">
                <Link to="/pricing" className="inline-flex">
                  <Button type="button" variant="ghost">Cancel</Button>
                </Link>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="shadow-[0_0_24px_hsl(38_92%_60%/0.35)]"
                >
                  {submitting ? "Redirecting..." : "Continue to payment"}
                </Button>
              </div>

              <p className="pt-2 text-center text-[11px] text-muted-foreground sm:text-left">
                By continuing you agree to the
                {" "}
                <Link to="/legal/terms" className="underline-offset-4 hover:underline">
                  Terms of Service
                </Link>
                {" "}and{" "}
                <Link to="/legal/privacy" className="underline-offset-4 hover:underline">
                  Privacy Policy
                </Link>
                .
              </p>
            </form>

            {/* Plan summary — right rail on desktop, below form on mobile */}
            <aside className="lg:sticky lg:top-6 lg:self-start">
              <PlanSummaryCard
                tier={effectiveTier}
                interval={effectiveInterval}
                whiteLabel={effectiveWhiteLabel}
              />
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
