import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { BillingStatusBanner } from "@/components/billing/BillingStatusBanner";
import { cn } from "@/lib/utils";

/**
 * Mobile-first shell.
 *
 * <  md (768px):
 *   Single column. TopBar pinned at the top with a hamburger trigger
 *   on the left. Sidebar lives in a slide-in drawer with backdrop.
 *   Tapping a nav item routes and auto-closes the drawer.
 *
 * >= md (768px):
 *   The original two-column grid: 240px sidebar (static), TopBar +
 *   content on the right. No hamburger.
 */
export function DashboardShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Close the drawer on route change so a nav-item tap returns the user
  // to the content view on mobile without an extra tap.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [drawerOpen]);

  return (
    <div className="flex h-screen flex-col md:grid md:grid-cols-[240px_1fr] md:grid-rows-[64px_1fr]">
      {/* Desktop sidebar (hidden on mobile) */}
      <div className="hidden border-r border-white/[0.06] glass-strong md:row-span-2 md:block">
        <Sidebar />
      </div>

      {/* TopBar — always visible. On mobile gets a hamburger trigger. */}
      <div className="flex h-14 shrink-0 items-center border-b border-white/[0.06] glass-strong md:h-auto">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="flex h-14 w-14 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground md:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <TopBar />
        </div>
      </div>

      {/* Main content.
          overflow-y-auto handles vertical scrolling; overflow-x-hidden
          prevents any page from forcing horizontal scroll on the whole
          viewport (the org chart, master grid, and book of business
          tables all have their OWN internal overflow-x-auto containers
          that still scroll horizontally inside their bounds — so wide
          tables work, but no page can blow out the page edge). */}
      <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
        <BillingStatusBanner />
        <Outlet />
      </main>

      {/* Mobile drawer + backdrop. Rendered always but visually hidden when closed. */}
      <div
        className={cn(
          "fixed inset-0 z-40 md:hidden",
          drawerOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        {/* Backdrop */}
        <div
          aria-hidden
          onClick={() => setDrawerOpen(false)}
          className={cn(
            "absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200",
            drawerOpen ? "opacity-100" : "opacity-0",
          )}
        />

        {/* Drawer panel */}
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          className={cn(
            "absolute inset-y-0 left-0 w-[280px] max-w-[85vw] glass-strong border-r border-white/[0.08] shadow-2xl transition-transform duration-300 ease-out",
            drawerOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-end border-b border-white/[0.06] px-3 py-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="rounded-md p-2 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <Sidebar />
        </aside>
      </div>
    </div>
  );
}
