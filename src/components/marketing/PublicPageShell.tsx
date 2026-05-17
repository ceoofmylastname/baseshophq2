/**
 * Phase 18.1 — PublicPageShell
 *
 * Small shared wrapper for public marketing-style pages (legal pages today;
 * possibly a "support" page later). Renders the sticky glass nav and a
 * minimal footer so legal pages match the visual aesthetic of Marketing.tsx
 * and Pricing.tsx without duplicating that chrome.
 *
 * Intentionally minimal: no scroll machinery, no intersection observers, no
 * demo-modal trigger. Pages that need richer chrome should use the full
 * surface layout from Marketing/Pricing instead.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BaseshopLogo } from "@/components/marketing/BaseshopLogo";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
};

export function PublicPageShell({ children }: Props) {
  const [navScrolled, setNavScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      {/* Sticky nav mirrors Marketing.tsx / Pricing.tsx */}
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
              className="rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:px-3"
            >
              Pricing
            </Link>
            <Link
              to="/login"
              className="rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:px-3"
            >
              Log in
            </Link>
          </div>
        </div>
      </nav>

      <main className="relative pt-24 sm:pt-32">{children}</main>

      <footer className="border-t border-white/[0.04] py-8 sm:py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <Link to="/" aria-label="Baseshop HQ home">
            <BaseshopLogo className="h-7 w-auto" />
          </Link>
          <nav className="flex items-center gap-4 text-[11px] text-muted-foreground">
            <Link to="/pricing" className="transition-colors hover:text-foreground">
              Pricing
            </Link>
            <Link to="/legal/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
            <Link to="/legal/privacy" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
          </nav>
          <p className="text-[11px] text-muted-foreground">
            &copy; {new Date().getFullYear()} Baseshop HQ. Built in Las Vegas.
          </p>
        </div>
      </footer>
    </div>
  );
}
