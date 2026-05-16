/**
 * Phase 18 PR 2 + PR 3 — /signup/success
 *
 * Reads ?session_id= and renders a personalized "We sent a magic link to
 * <email>" line. Email-source preference order:
 *   1. sessionStorage `bsq_signup_email` (set by /signup before redirecting
 *      to Stripe — covers the same-tab same-device path).
 *   2. PR 3 fallback: fetch /functions/v1/signup-checkout-status?session_id=…
 *      (covers cross-device + cleared-storage cases). Silent on failure.
 *   3. Generic "Check your inbox..." copy.
 *
 * Sole CTA: "I didn't receive the email" → ContactSupportModal.
 *
 * We do NOT clear sessionStorage on mount — the user may refresh.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, MailCheck } from "lucide-react";
import { BaseshopLogo } from "@/components/marketing/BaseshopLogo";
import { Button } from "@/components/ui/button";
import { ContactSupportModal } from "@/components/signup/ContactSupportModal";
import { supabase } from "@/lib/supabase-browser";

export function SignupSuccessPage() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id"); // surfaced in markup only as a debug attribute
  const [supportOpen, setSupportOpen] = useState(false);
  const [resolvedEmail, setResolvedEmail] = useState<string>("");

  const stashedEmail = useMemo(() => {
    try {
      return sessionStorage.getItem("bsq_signup_email") ?? "";
    } catch {
      return "";
    }
  }, []);

  // Phase 18 PR 3: when sessionStorage is empty but the URL carries
  // ?session_id=cs_..., fetch the customer_email from the
  // signup-checkout-status function and upgrade the copy in place. All
  // failures are silent — the magic link gets delivered by Resend regardless.
  useEffect(() => {
    if (stashedEmail) return;
    if (!sessionId || !sessionId.startsWith("cs_")) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("signup-checkout-status", {
          method: "POST",
          body: { session_id: sessionId },
        });
        if (cancelled) return;
        if (error) return;
        const email = (data as { ok?: boolean; customer_email?: string | null } | null)?.customer_email;
        if (email && typeof email === "string") {
          setResolvedEmail(email);
        }
      } catch {
        // Swallow — fallback copy is rendered already.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stashedEmail, sessionId]);

  const displayEmail = stashedEmail || resolvedEmail;

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      <header className="border-b border-white/[0.04]">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="Baseshop HQ home">
            <BaseshopLogo className="h-7 w-auto sm:h-9" />
          </Link>
        </div>
      </header>

      <main className="relative px-4 py-14 sm:px-6 sm:py-20">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-50 gradient-rim" />
        <div className="relative mx-auto max-w-xl text-center" data-session-id={sessionId ?? undefined}>
          {/* Subtle illustration: concentric glow + check icon */}
          <div className="relative mx-auto h-24 w-24">
            <div className="absolute inset-0 animate-ping rounded-full bg-emerald-400/15" />
            <div className="absolute inset-2 rounded-full bg-emerald-400/10" />
            <div className="absolute inset-4 flex items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/15 text-emerald-300 shadow-[0_0_36px_hsl(150_70%_55%/0.5)]">
              <CheckCircle2 className="h-10 w-10" />
            </div>
          </div>

          <h1 className="mt-8 text-3xl font-semibold tracking-tight text-shadow-hero sm:text-4xl">
            Payment received.
          </h1>

          <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground sm:text-base">
            {displayEmail ? (
              <>
                We sent a magic link to{" "}
                <span className="font-medium text-foreground">{displayEmail}</span>.
                Open it to enter your new dashboard.
              </>
            ) : (
              <>Check your inbox for the magic link to enter your new dashboard.</>
            )}
          </p>

          <div className="mt-10 flex flex-col items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSupportOpen(true)}
              className="text-muted-foreground hover:text-foreground"
            >
              <MailCheck className="mr-2 h-4 w-4" />
              I didn&apos;t receive the email
            </Button>
          </div>
        </div>
      </main>

      <ContactSupportModal
        open={supportOpen}
        onClose={() => setSupportOpen(false)}
        defaultEmail={displayEmail}
      />
    </div>
  );
}
