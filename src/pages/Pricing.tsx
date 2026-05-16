import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BaseshopLogo } from "@/components/marketing/BaseshopLogo";
import { DemoBookingModal } from "@/components/marketing/DemoBookingModal";
import { AgentCountSlider } from "@/components/pricing/AgentCountSlider";
import { AnnualToggle } from "@/components/pricing/AnnualToggle";
import { TierGrid } from "@/components/pricing/TierGrid";
import { PricingFaq } from "@/components/pricing/PricingFaq";
import { Button } from "@/components/ui/button";
import {
  buildSignupUrl,
  tierForAgentCount,
  type BillingIntervalLite,
  type SelfServeTier,
} from "@/lib/pricing/pricing-math";
import { cn } from "@/lib/utils";

/**
 * Phase 18 PR 1: public pricing page at /pricing.
 *
 * Not wrapped in PublicOrRedirect — pricing is public to everyone, including
 * logged-in users. Layout mirrors Marketing.tsx so the marketing surface
 * reads as one continuous brand:
 *   1. Sticky glass nav (logo + Pricing + Sign in + Book a demo)
 *   2. Hero (subtitle is the wiki line 3 verbatim per decision #4)
 *   3. <AgentCountSlider /> + <AnnualToggle />
 *   4. <TierGrid /> (4 columns; Pro elevated)
 *   5. Reassurance copy (trial + no setup + cancel anytime)
 *   6. <PricingFaq />
 *   7. Footer
 *
 * Signup clicks emit a query-string URL (PR 2 wires the signup page to
 * read these params). Enterprise CTA opens the demo modal in-place.
 */

export function PricingPage() {
  const navigate = useNavigate();
  const [agentCount, setAgentCount] = useState(5);
  const [interval, setInterval] = useState<BillingIntervalLite>("monthly");
  const [demoOpen, setDemoOpen] = useState(false);
  const [navScrolled, setNavScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const recommendedTier = tierForAgentCount(agentCount);

  function handleSignup(args: { tier: SelfServeTier; interval: BillingIntervalLite; whiteLabel: boolean }) {
    navigate(buildSignupUrl(args));
  }

  function handleContactSales() {
    setDemoOpen(true);
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      {/* Sticky nav — mirrors Marketing.tsx */}
      <nav
        className={cn(
          "fixed inset-x-0 top-0 z-30 transition-all duration-300",
          navScrolled ? "border-b border-white/[0.06] glass-strong" : "bg-transparent",
        )}
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6">
          <Link to="/" aria-label="Baseshop HQ home">
            <BaseshopLogo className="h-7 w-auto sm:h-9" />
          </Link>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Link
              to="/pricing"
              className="rounded-md px-2 py-1.5 text-sm font-medium text-foreground sm:px-3"
            >
              Pricing
            </Link>
            <Link
              to="/login"
              className="rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:px-3"
            >
              Sign in
            </Link>
            <Button
              onClick={() => setDemoOpen(true)}
              className="shadow-[0_0_24px_hsl(38_92%_60%/0.35)]"
              size="sm"
            >
              Book a demo
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative px-4 pt-28 pb-12 sm:px-6 sm:pt-36">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-70 gradient-rim" />
        <div className="relative mx-auto max-w-4xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-primary sm:px-3 sm:text-[10px] sm:tracking-[0.18em]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
            Pricing
          </span>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-shadow-hero sm:mt-6 sm:text-6xl">
            <span className="gold-shimmer">Priced for growth</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm text-muted-foreground sm:mt-6 sm:text-base">
            Flat-rate tiered pricing capped by total agent count. Three
            self-serve tiers, one Enterprise tier, and one white-label add-on.
          </p>
        </div>
      </section>

      {/* Slider + interval toggle */}
      <section className="relative px-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-6">
          <AgentCountSlider value={agentCount} onChange={setAgentCount} />
          <AnnualToggle value={interval} onChange={setInterval} />
        </div>
      </section>

      {/* Tier grid */}
      <section className="relative px-4 pt-12 pb-8 sm:px-6 sm:pt-16">
        <TierGrid
          agentCount={agentCount}
          interval={interval}
          tierHighlighted={recommendedTier}
          onSignup={handleSignup}
          onContactSales={handleContactSales}
        />

        {/* Reassurance copy */}
        <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-muted-foreground sm:text-sm">
          All plans include a 14-day free trial. No setup fee. Cancel anytime.
        </p>
      </section>

      {/* FAQ */}
      <section className="relative border-t border-white/[0.04] py-16 sm:py-24">
        <div className="px-4 sm:px-6">
          <PricingFaq />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] py-8 sm:py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <Link to="/" aria-label="Baseshop HQ home">
            <BaseshopLogo className="h-7 w-auto" />
          </Link>
          <p className="text-[11px] text-muted-foreground">
            © {new Date().getFullYear()} Baseshop HQ. Built in Las Vegas.
          </p>
        </div>
      </footer>

      <DemoBookingModal
        open={demoOpen}
        onClose={() => setDemoOpen(false)}
        source="pricing"
      />
    </div>
  );
}
