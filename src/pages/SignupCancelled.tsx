/**
 * Phase 18 PR 2 — /signup/cancelled
 *
 * Stripe Checkout returns here when the user closes the payment flow. Two
 * CTAs:
 *   1. "Try again" → /pricing
 *   2. "Schedule a demo instead" → opens the existing DemoBookingModal.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { XCircle } from "lucide-react";
import { BaseshopLogo } from "@/components/marketing/BaseshopLogo";
import { Button } from "@/components/ui/button";
import { DemoBookingModal } from "@/components/marketing/DemoBookingModal";

export function SignupCancelledPage() {
  const [demoOpen, setDemoOpen] = useState(false);

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
        <div className="relative mx-auto max-w-xl text-center">
          <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-muted-foreground">
            <XCircle className="h-8 w-8" />
          </div>

          <h1 className="mt-8 text-3xl font-semibold tracking-tight text-shadow-hero sm:text-4xl">
            Checkout cancelled.
          </h1>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            No charge was made.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to="/pricing" className="inline-flex">
              <Button type="button" className="shadow-[0_0_24px_hsl(38_92%_60%/0.35)]">
                Try again
              </Button>
            </Link>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDemoOpen(true)}
            >
              Schedule a demo instead
            </Button>
          </div>
        </div>
      </main>

      <DemoBookingModal
        open={demoOpen}
        onClose={() => setDemoOpen(false)}
        source="signup-cancelled"
      />
    </div>
  );
}
