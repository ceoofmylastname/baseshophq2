/**
 * Pure mapping from a Stripe webhook event to the partial tenants-row update
 * the stripe-webhook Edge Function should apply.
 *
 * Lives under supabase/functions/_shared/ (Supabase underscore-prefix
 * convention for shared modules) but has zero Deno-specific imports, so it
 * can be `import`-ed from tests/ under bun's tsconfig.
 *
 * STATEFUL EVENTS (handled inline in the webhook, NOT here):
 *   invoice.paid and invoice.payment_failed both depend on the current
 *   tenants.payment_failure_count to decide the resulting state — they need
 *   to read the row before they can derive the patch. That cannot be a pure
 *   function, so the webhook handler routes those two event types into
 *   payment-handlers.ts (which talks to the admin client directly) and skips
 *   the merge with whatever this function returns. To keep the dispatch
 *   shape uniform we keep the cases here and return `{}` so the caller's
 *   `Object.keys(patch).length > 0` guard correctly skips the noop UPDATE.
 *
 * This implements the S-1 §5 state table as locked by the parent for PR 2:
 *
 *   ┌─────────────────────────────────────────┬────────────────────────────────────────────────────────────────┐
 *   │ Stripe event                            │ Effect on tenants row                                          │
 *   ├─────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
 *   │ customer.subscription.created           │ Derive billing_status from subscription.status                 │
 *   │   subscription.status = 'trialing'      │ billing_status='active', is_in_trial=true, trial_ends_at=…     │
 *   │   subscription.status = 'active'        │ billing_status='active', is_in_trial=false, trial_ends_at=null │
 *   │   subscription.status = 'past_due'      │ billing_status='past_due'                                      │
 *   │   subscription.status = 'unpaid'        │ billing_status='past_due'                                      │
 *   │   subscription.status = 'canceled'      │ billing_status='cancelled'                                     │
 *   │   subscription.status = 'incomplete*'   │ no status flip yet; webhook just logs                          │
 *   │                                         │                                                                │
 *   │ customer.subscription.updated           │ Same mapping as .created                                       │
 *   │                                         │                                                                │
 *   │ customer.subscription.deleted           │ billing_status='cancelled'                                     │
 *   │                                         │                                                                │
 *   │ invoice.paid                            │ STATEFUL — handler-level (returns {} here)                     │
 *   │ invoice.payment_failed                  │ STATEFUL — handler-level (returns {} here)                     │
 *   │                                         │                                                                │
 *   │ checkout.session.completed              │ no direct tenants update; the subscription.created event       │
 *   │                                         │ that follows is the one that flips state.                      │
 *   └─────────────────────────────────────────┴────────────────────────────────────────────────────────────────┘
 *
 * Unknown event types and unhandled subscription statuses return an empty
 * object — the caller persists nothing and falls through to logging.
 */

export type StateMappingInput = {
  eventType: string;
  subscriptionStatus?: string;
  invoiceAttemptCount?: number;
  /** UNIX seconds, as Stripe sends them */
  subscriptionTrialEnd?: number | null;
};

export type BillingStatus = "active" | "past_due" | "suspended" | "cancelled";

export type StateMappingOutput = {
  billing_status?: BillingStatus;
  is_in_trial?: boolean;
  trial_ends_at?: string | null;
};

/**
 * Convert UNIX seconds to ISO-8601 timestamptz string, or null when input is
 * null/undefined/0. Stripe sends `trial_end: null` for non-trialing subs and
 * positive ints for trialing ones.
 */
function unixSecondsToIso(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || seconds === 0) return null;
  return new Date(seconds * 1000).toISOString();
}

export function mapStripeEventToTenantUpdate(
  input: StateMappingInput
): StateMappingOutput {
  const { eventType, subscriptionStatus, subscriptionTrialEnd } = input;

  switch (eventType) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      switch (subscriptionStatus) {
        case "trialing":
          return {
            billing_status: "active",
            is_in_trial: true,
            trial_ends_at: unixSecondsToIso(subscriptionTrialEnd),
          };
        case "active":
          return {
            billing_status: "active",
            is_in_trial: false,
            trial_ends_at: null,
          };
        case "past_due":
        case "unpaid":
          return { billing_status: "past_due" };
        case "canceled":
          return { billing_status: "cancelled" };
        // incomplete, incomplete_expired, paused — no state flip; webhook
        // just logs and waits for the next event in the lifecycle.
        default:
          return {};
      }
    }

    case "customer.subscription.deleted":
      return { billing_status: "cancelled" };

    case "invoice.paid":
    case "invoice.payment_failed":
      // Stateful events. Handled inline in the webhook (see
      // payment-handlers.ts) because the result depends on
      // tenants.payment_failure_count. Returning {} so the caller's merge
      // path skips this branch entirely.
      return {};

    case "checkout.session.completed":
      // No direct tenants update; the customer.subscription.created event
      // that follows is the canonical source of truth for tenant state.
      return {};

    default:
      // Unknown event type — webhook silently ignores. Stripe sends a
      // wide variety of events; we only act on the six listed above.
      return {};
  }
}
