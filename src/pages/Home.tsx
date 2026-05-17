/**
 * Phase 10F Home page. The daily-driver view every user lands on after login.
 *
 * Sections (top to bottom):
 *   1. Action banner row     — dismissible per-user banners
 *   2. Personal hero card    — name, position, promotion progress, annual goal
 *   3. Leadership broadcast  — single hero broadcast (owner-pushed)
 *   4. Leaderboards          — reused from Dashboard
 *   5. Recent activity feed  — reused from Dashboard
 *   6. Quick actions row     — reused from Dashboard
 *
 * Realtime: ActionBanner + BroadcastBanner subscribe to their source tables
 * filtered by tenant_id; LeaderboardsSection and RecentActivityFeed handle
 * their own subscriptions internally.
 *
 * Scope cut for v1: no owner-side CRUD UI for broadcasts or promotion targets
 * here. Data layer is in place (upsert_leadership_broadcast,
 * upsert_promotion_target). Settings page will surface the editors in a
 * follow-up so this page stays focused on the consumer view.
 */

import { useMemo } from "react";
import { ActionBanner } from "@/components/home/ActionBanner";
import { HeroCard } from "@/components/home/HeroCard";
import { BroadcastBanner } from "@/components/home/BroadcastBanner";
import { PasswordSetupBanner } from "@/components/dashboard/PasswordSetupBanner";
import { QuickActionButtons } from "@/components/dashboard/QuickActionButtons";
import { LeaderboardsSection } from "@/components/dashboard/LeaderboardsSection";
import { RecentActivityFeed } from "@/components/dashboard/RecentActivityFeed";

function startOfMonth(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function HomePage() {
  // Leaderboards take a date range; use month-to-date by default since the
  // home page doesn't expose a range picker (that's the Dashboard's job).
  const range = useMemo(() => ({ start: startOfMonth(new Date()), end: today() }), []);

  return (
    <div className="space-y-5">
      {/* Phase 18.1: render above ActionBanner so password setup is the
          first thing a Phase 18 self-serve signup sees. Hides itself if
          the user already has a password or has dismissed it this session. */}
      <PasswordSetupBanner />
      <ActionBanner />
      <HeroCard />
      <BroadcastBanner />

      <div className="flex justify-end">
        {/* Leaderboards + activity feed are realtime-subscribed; no manual refresh needed. */}
        <QuickActionButtons onActivity={() => { /* noop */ }} />
      </div>

      <LeaderboardsSection startDate={range.start} endDate={range.end} carrierId={null} />

      <RecentActivityFeed />
    </div>
  );
}
