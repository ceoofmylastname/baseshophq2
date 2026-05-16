import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Upload, Sparkles, Network, TrendingUp, Trophy, Users, BarChart3, FileText,
  ArrowRight, CheckCircle2, Zap,
} from "lucide-react";
import { BaseshopLogo } from "@/components/marketing/BaseshopLogo";
import { VideoShowcase } from "@/components/marketing/VideoShowcase";
import { DemoBookingModal } from "@/components/marketing/DemoBookingModal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Phase 14.0: public marketing homepage. Routed at "/" for unauthenticated
 * visitors; logged-in users get redirected to /home in App.tsx.
 *
 * Layout (top to bottom):
 *   1. Sticky glass nav bar (logo + sign in + book a demo)
 *   2. Scroll-driven video hero (220vh tall, sticky stage with canvas)
 *   3. "What is it" intro band (one-line positioning + 3 trust pillars)
 *   4. Features grid (7 cards covering the core surfaces)
 *   5. How it works (4-step numbered flow)
 *   6. Stats band (4 animated counters)
 *   7. Closing CTA
 *   8. Footer
 *
 * All sections render with the existing glass + kinetic gradient aesthetic
 * so the marketing page reads as one continuous brand surface with the app.
 */

/** Animated counter that ticks from 0 to target when scrolled into view. */
function AnimatedStat({ value, suffix = "", label }: { value: number; suffix?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        const duration = 1400;
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          // ease-out cubic
          const eased = 1 - Math.pow(1 - t, 3);
          setShown(Math.round(value * eased));
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        obs.disconnect();
      }
    }, { threshold: 0.4 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [value]);

  return (
    <div ref={ref} className="text-center">
      <div className="text-4xl font-semibold tabular-nums tracking-tight text-shadow-hero sm:text-5xl">
        <span className="bg-gradient-to-b from-amber-200 via-primary to-amber-500 bg-clip-text text-transparent">
          {shown.toLocaleString()}{suffix}
        </span>
      </div>
      <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

const FEATURES = [
  {
    Icon: Network,
    title: "Org chart that knows everyone",
    body: "Drop in your full hierarchy with one writing-number ingest. Owners and managers see only their downline. The tree shows who's writing this week, who's dormant, and where chargeback risk is brewing.",
    tier: "primary",
  },
  {
    Icon: BarChart3,
    title: "Master Grid built for your shop",
    body: "Set carrier rates per position, with effective dates that respect history. New rate next month doesn't break the commission already booked. AGENT to MASTER, you decide the ladder.",
    tier: "primary",
  },
  {
    Icon: Upload,
    title: "Carrier CSVs that auto-route",
    body: "Drop a carrier report from Mutual of Omaha, F&G, American Amicable, anyone. Writing numbers match to agents. Statuses flip Submitted to Pending to Issued. Commissions recalculate in seconds.",
    tier: "primary",
  },
  {
    Icon: FileText,
    title: "Book of business, end to end",
    body: "Every policy your agency has ever written, searchable, filterable, status-pillable. Bulk status changes when you need them, full audit trail when the carrier disputes it.",
    tier: "secondary",
  },
  {
    Icon: TrendingUp,
    title: "Production dashboard that doesn't lie",
    body: "Pipeline, Booked, Realized, At-Risk, Terminated. Submitted basis or Issue-Paid basis. By carrier, by date range, by agent. Real numbers. Real-time. Your hierarchy automatically respected.",
    tier: "secondary",
  },
  {
    Icon: Trophy,
    title: "Scoreboard that drives behavior",
    body: "Top producers, top recruiters, most improved. Tenant-wide rankings so a new agent sees what good looks like on day one. The kind of weekly leaderboard that becomes a culture.",
    tier: "secondary",
  },
  {
    Icon: Users,
    title: "Active agents that bill themselves",
    body: "Anyone who wrote business in the last 30 days. The platform's billing unit, surfaced as a live count so you always know what you're paying for and what your floor producers look like.",
    tier: "secondary",
  },
];

const STEPS = [
  {
    title: "Sign up and seed your shop",
    body: "Owner account, position ladder, carriers, products. Master Grid auto-populates. Five minutes from zero to ready.",
  },
  {
    title: "Invite your agents",
    body: "Bulk invite by email. Agents accept, fill in writing numbers per carrier, you're done. Hierarchy auto-resolves.",
  },
  {
    title: "Upload your first carrier CSV",
    body: "One drag and drop. Auto-match by writing number. Auto-status. Auto-commission. The whole book stitches together.",
  },
  {
    title: "Run the agency live",
    body: "Dashboard, org chart, scoreboard, production. Everything reads from the same source of truth, everything updates the moment someone posts a deal.",
  },
];

export function MarketingPage() {
  const [demoOpen, setDemoOpen] = useState(false);
  const [navScrolled, setNavScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      {/* Sticky nav — compact on mobile, full on desktop */}
      <nav
        className={cn(
          "fixed inset-x-0 top-0 z-30 transition-all duration-300",
          navScrolled
            ? "border-b border-white/[0.06] glass-strong"
            : "bg-transparent",
        )}
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6">
          <BaseshopLogo className="h-7 w-auto sm:h-9" />
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Link
              to="/pricing"
              className="rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:px-3"
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

      {/* Hero — text only, centered, ~100vh.
          Mobile: tighter padding, smaller headline, full-width CTAs.
          Desktop: large dramatic typography, max-w container. */}
      <section className="relative flex min-h-screen items-center justify-center px-4 pt-24 pb-12 sm:px-6 sm:pt-32">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(at 50% 30%, hsl(38 92% 60% / 0.10) 0px, transparent 50%), " +
              "radial-gradient(at 20% 70%, hsl(280 60% 50% / 0.06) 0px, transparent 50%), " +
              "radial-gradient(at 80% 80%, hsl(200 80% 50% / 0.05) 0px, transparent 50%)",
          }}
        />

        <div className="relative w-full max-w-4xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-primary sm:px-3 sm:text-[10px] sm:tracking-[0.18em]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
            Built for life insurance agencies
          </span>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-shadow-hero sm:mt-6 sm:text-6xl md:text-7xl">
            Run your agency
            <br />
            like it&apos;s {" "}
            <span className="gold-shimmer">already won.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-sm text-muted-foreground sm:mt-7 sm:max-w-2xl sm:text-lg">
            Track every policy. Auto-route every carrier CSV. See every agent&apos;s rank in real time.
            One platform for small shops and 500-agent operations alike.
          </p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-2.5 sm:mt-10 sm:flex-row sm:items-center sm:gap-3">
            <Button
              size="lg"
              onClick={() => setDemoOpen(true)}
              className="shadow-[0_0_32px_hsl(38_92%_60%/0.45)]"
            >
              Book a private demo <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
            <a
              href="#showcase"
              className="rounded-full border border-white/10 bg-white/[0.02] px-5 py-2.5 text-center text-sm font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
            >
              See it in action
            </a>
          </div>
        </div>
      </section>

      {/* Video showcase */}
      <section id="showcase" className="relative pb-16 sm:pb-24">
        <VideoShowcase />
      </section>

      {/* Intro band — positioning + 3 trust pillars */}
      <section className="relative border-t border-white/[0.04] bg-background py-16 sm:py-24">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(at 50% 0%, hsl(38 92% 60% / 0.08) 0px, transparent 50%)",
          }}
        />
        <div className="relative mx-auto max-w-5xl px-4 text-center sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-4xl">
            One platform.
            <br />
            <span className="text-muted-foreground">Every report, every carrier, every agent.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-muted-foreground sm:mt-5 sm:text-base">
            Built from the ground up for insurance agencies that need real numbers,
            not just dashboards. Hierarchy-aware permissions, writing-number-first carrier ingest,
            and a commission engine that knows your contract rates.
          </p>

          <div className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-3">
            {[
              { Icon: Zap,           title: "Carrier-agnostic ingest",   body: "Drop a CSV from any carrier. The system auto-matches by writing number, falls back to email, and flags orphans." },
              { Icon: CheckCircle2,  title: "Hierarchy-aware",          body: "Owners see everything. Managers see their downline. Agents see themselves. Never sideways, never up." },
              { Icon: Sparkles,      title: "Real-time across the app", body: "When a deal posts anywhere in your tree, every dashboard updates within seconds. No reload required." },
            ].map(({ Icon, title, body }) => (
              <div key={title} className="rounded-2xl glass p-5 text-left">
                <Icon className="h-5 w-5 text-primary" />
                <h3 className="mt-3 text-sm font-semibold tracking-tight">{title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section id="features" className="relative border-t border-white/[0.04] py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
              The surfaces
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-4xl text-shadow-soft">
              Seven views.
              <br />
              One source of truth.
            </h2>
            <p className="mt-4 text-sm text-muted-foreground sm:text-base">
              Every page reads from the same policies and commissions tables.
              Click between Org Chart, Production, and Book of Business and the numbers always agree.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:mt-14 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ Icon, title, body, tier }) => (
              <div
                key={title}
                className={cn(
                  "relative overflow-hidden rounded-2xl glass p-6 transition-transform hover:-translate-y-0.5",
                  tier === "primary" && "ring-1 ring-primary/20",
                )}
              >
                {/* Tier ribbon at top */}
                <div
                  aria-hidden
                  className={cn(
                    "absolute inset-x-0 top-0 h-[2px]",
                    tier === "primary"
                      ? "bg-gradient-to-r from-primary via-amber-300 to-primary"
                      : "bg-gradient-to-r from-white/10 via-white/20 to-white/10",
                  )}
                />
                <Icon className={cn("h-6 w-6", tier === "primary" ? "text-primary" : "text-muted-foreground")} />
                <h3 className="mt-3.5 text-base font-semibold tracking-tight text-shadow-soft">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="relative border-t border-white/[0.04] py-16 sm:py-24">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            background:
              "radial-gradient(at 10% 50%, hsl(38 92% 60% / 0.06) 0px, transparent 40%), " +
              "radial-gradient(at 90% 50%, hsl(280 60% 50% / 0.05) 0px, transparent 40%)",
          }}
        />
        <div className="relative mx-auto max-w-5xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
              How it works
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-4xl text-shadow-soft">
              Zero to running in one sitting.
            </h2>
          </div>

          <ol className="mt-10 grid gap-4 sm:mt-14 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="relative rounded-2xl glass p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/15 text-sm font-semibold text-primary shadow-[0_0_16px_hsl(38_92%_60%/0.3)]">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold tracking-tight">{step.title}</h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Stats band */}
      <section className="relative border-t border-white/[0.04] py-16 sm:py-24">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="grid grid-cols-2 gap-8 sm:gap-10 lg:grid-cols-4">
            <AnimatedStat value={7}     suffix=""    label="Policy statuses tracked" />
            <AnimatedStat value={500}   suffix="+"   label="Agents per agency, scale-ready" />
            <AnimatedStat value={30}    suffix="-day" label="Active-agent billing window" />
            <AnimatedStat value={0}     suffix=""    label="Drag-and-drop chrome on this page" />
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="relative border-t border-white/[0.04] py-20 sm:py-28">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-90 gradient-rim"
        />
        <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl text-shadow-hero">
            See it run live.
          </h2>
          <p className="mt-4 text-sm text-muted-foreground sm:mt-5 sm:text-lg">
            Forty-five minutes. Your screen, my screen. Real data, real workflows.
            By the end you&apos;ll know exactly how it would feel running your agency on Baseshop HQ.
          </p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-2.5 sm:mt-10 sm:flex-row sm:items-center sm:gap-3">
            <Button
              size="lg"
              onClick={() => setDemoOpen(true)}
              className="shadow-[0_0_40px_hsl(38_92%_60%/0.5)]"
            >
              Book a private demo <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
            <Link
              to="/pricing"
              className="rounded-full border border-white/10 bg-white/[0.02] px-5 py-2.5 text-center text-sm font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] py-8 sm:py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <BaseshopLogo className="h-7 w-auto" />
          <p className="text-[11px] text-muted-foreground">
            © {new Date().getFullYear()} Baseshop HQ. Built in Las Vegas.
          </p>
        </div>
      </footer>

      <DemoBookingModal open={demoOpen} onClose={() => setDemoOpen(false)} source="homepage" />
    </div>
  );
}
