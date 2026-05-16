/**
 * Pure helpers for the Phase 17 PR 3b owner-facing Billing page.
 *
 * All six functions are pure (no DOM, no Supabase, no Date.now in business
 * logic — formatPastDueDeadline takes the past_due_since timestamp directly
 * and returns the deadline date string). Tested in
 * tests/billing-helpers.test.ts. The hook layer (useBillingState) wraps
 * composeBillingState; everything else is consumed by leaf components.
 */

export type BillingStatus = "active" | "past_due" | "suspended" | "cancelled";
export type PlanTier = "starter" | "growth" | "pro" | "enterprise";
export type BillingInterval = "monthly" | "annual";

export type BillingSnapshot = {
  id: string;
  period_start: string;
  period_end: string;
  active_agent_count: number;
  tier_at_snapshot: PlanTier;
  stripe_usage_record_id: string | null;
  created_at: string;
};

export type TenantBillingRow = {
  id: string;
  current_plan_tier: PlanTier;
  white_label_addon_active: boolean;
  agent_cap: number;
  billing_status: BillingStatus;
  is_in_trial: boolean;
  trial_ends_at: string | null;
  current_period_end: string | null;
  past_due_since: string | null;
  suspended_at: string | null;
  stripe_customer_id: string | null;
  /** Phase 17 PR 3c. Defaults to 'monthly' for any tenant predating PR 3c. */
  billing_interval: BillingInterval;
};

export type BillingState = {
  tier: PlanTier;
  whiteLabel: boolean;
  agentCap: number;
  agentCount: number;
  usagePct: number;
  billingStatus: BillingStatus;
  isInTrial: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  pastDueSince: string | null;
  suspendedAt: string | null;
  hasStripeCustomer: boolean;
  snapshots: BillingSnapshot[];
  /** Phase 17 PR 3c. */
  billingInterval: BillingInterval;
};

/**
 * Gate routing decision for the /billing page.
 *
 *   - while auth is still loading (isOwner === undefined) → 'redirect' so the
 *     caller renders nothing while the auth state resolves; the
 *     non-owner-redirect side-effect should be guarded against running until
 *     the value is firm.
 *   - explicit false → 'redirect'
 *   - explicit true  → 'render'
 *
 * The hook contract: callers should hold the redirect intent until `loading`
 * is false; this helper only describes the steady-state policy.
 */
export function gateBilling(isOwner: boolean | undefined): "redirect" | "render" {
  return isOwner === true ? "render" : "redirect";
}

export type BannerKind = "past_due" | "suspended" | "cancelled";
export type BannerColor = "amber" | "red" | "neutral";

export type BannerVariant = {
  kind: BannerKind;
  color: BannerColor;
  icon: "AlertTriangle" | "Ban" | "XCircle";
  copy: string;
  cta?: { label: string; href: string };
};

/**
 * Resolve the banner shape for the current billing_status + viewer role.
 *
 *   active     → null (no banner)
 *   past_due   → amber, owner sees "Update payment method" CTA → /billing
 *   suspended  → red, owner sees "Update payment method" CTA → /billing
 *   cancelled  → neutral, owner sees "Choose a plan" CTA → /billing
 *
 * Agents (isOwner=false) see the same copy + icon but no CTA — they cannot
 * act on billing, so we don't dangle a button that would do nothing.
 */
export function bannerVariant(
  status: BillingStatus,
  isOwner: boolean,
): BannerVariant | null {
  if (status === "active") return null;

  if (status === "past_due") {
    const v: BannerVariant = {
      kind: "past_due",
      color: "amber",
      icon: "AlertTriangle",
      copy: "Payment failed. Update your payment method to keep the account active.",
    };
    if (isOwner) v.cta = { label: "Update payment method", href: "/billing" };
    return v;
  }

  if (status === "suspended") {
    const v: BannerVariant = {
      kind: "suspended",
      color: "red",
      icon: "Ban",
      copy: "Account suspended. Your team is read-only until billing is restored.",
    };
    if (isOwner) v.cta = { label: "Update payment method", href: "/billing" };
    return v;
  }

  // cancelled
  const v: BannerVariant = {
    kind: "cancelled",
    color: "neutral",
    icon: "XCircle",
    copy: "Subscription cancelled. Pick a plan to reactivate your team.",
  };
  if (isOwner) v.cta = { label: "Choose a plan", href: "/billing" };
  return v;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Given the timestamp at which the tenant entered past_due, return the
 * suspension cutoff date in "Mon DD" form. Aligns with the run_suspended_flip
 * cron logic (14-day grace period).
 *
 * Uses UTC math to keep the rendered date stable regardless of viewer
 * timezone. The Billing page displays this as "by May 27" — it's a coarse
 * deadline, not a wall-clock countdown, so day-level precision is fine.
 */
export function formatPastDueDeadline(past_due_since: string): string {
  const d = new Date(past_due_since);
  d.setUTCDate(d.getUTCDate() + 14);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Color tier for the agent-cap usage bar.
 *
 *   < 80    → green   (healthy headroom)
 *   80..94  → amber   (approaching cap)
 *   >= 95   → red     (at or near cap; consider upgrading)
 *
 * Enterprise (cap=9999) always renders green in practice because usagePct
 * will be near zero relative to the sentinel; the threshold logic here works
 * regardless.
 */
export function capColor(usagePct: number): "green" | "amber" | "red" {
  if (usagePct >= 95) return "red";
  if (usagePct >= 80) return "amber";
  return "green";
}

/**
 * Decide whether the SnapshotHistoryCard should render at all.
 *
 *   enterprise → always render (even with 0 rows; the card shows an empty
 *                table with a "No snapshots yet" hint so the owner knows
 *                metering is wired but no period has closed yet).
 *   non-enterprise → never render. Flat-rate tiers don't produce snapshots.
 */
export function shouldShowSnapshots(tier: string, snapshotCount: number): boolean {
  // snapshotCount is intentionally unused at non-enterprise tiers; for
  // enterprise we don't condition on count, so the parameter exists for
  // future expansion (e.g. hiding the card during a brand-new enterprise
  // tenant's first billing period) and to keep the helper testable.
  void snapshotCount;
  return tier === "enterprise";
}

/**
 * Compose the structured BillingState consumed by the page from raw DB rows.
 *
 *   - tenantRow comes straight off `select * from tenants where id = …`.
 *   - snapshots is the last six rows from billing_snapshots, newest first.
 *   - agentCount is the count of agents where archived_at IS NULL.
 *
 * usagePct is rounded to the nearest integer (so the progress bar renders a
 * stable, jitter-free width). Enterprise's 9999 sentinel produces a near-zero
 * pct for normal team sizes; the helper does not special-case it.
 */
export function composeBillingState(args: {
  tenantRow: TenantBillingRow;
  snapshots: BillingSnapshot[];
  agentCount: number;
}): BillingState {
  const { tenantRow, snapshots, agentCount } = args;
  const cap = tenantRow.agent_cap;
  const pct = cap > 0 ? Math.round((agentCount / cap) * 100) : 0;

  return {
    tier: tenantRow.current_plan_tier,
    whiteLabel: tenantRow.white_label_addon_active,
    agentCap: cap,
    agentCount,
    usagePct: pct,
    billingStatus: tenantRow.billing_status,
    isInTrial: tenantRow.is_in_trial,
    trialEndsAt: tenantRow.trial_ends_at,
    currentPeriodEnd: tenantRow.current_period_end,
    pastDueSince: tenantRow.past_due_since,
    suspendedAt: tenantRow.suspended_at,
    hasStripeCustomer: tenantRow.stripe_customer_id !== null,
    snapshots,
    billingInterval: tenantRow.billing_interval ?? "monthly",
  };
}
