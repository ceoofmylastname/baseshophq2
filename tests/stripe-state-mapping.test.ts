/**
 * Pure tests for mapStripeEventToTenantUpdate.
 *
 * Covers every row of the S-1 §5 state table:
 *   - customer.subscription.created/updated × {trialing, active, past_due,
 *     unpaid, canceled, incomplete}
 *   - customer.subscription.deleted
 *   - invoice.paid
 *   - invoice.payment_failed × {attempt_count <3, =3, >3}
 *   - checkout.session.completed
 *
 * Plus edge cases:
 *   - unknown event type returns empty
 *   - subscription.created with no status returns empty
 *   - trialing with no trial_end returns trial_ends_at=null
 *   - trialing with trial_end=0 returns trial_ends_at=null
 */

import { describe, expect, test } from "bun:test";
import {
  mapStripeEventToTenantUpdate,
} from "../supabase/functions/_shared/state-mapping.ts";

describe("customer.subscription.created / .updated", () => {
  test.each([
    ["customer.subscription.created"],
    ["customer.subscription.updated"],
  ])("%s → trialing maps to active + is_in_trial=true + trial_ends_at ISO", (eventType) => {
    // 2026-06-01 00:00:00 UTC = 1780617600
    const trialEnd = Math.floor(Date.UTC(2026, 5, 1) / 1000);
    const out = mapStripeEventToTenantUpdate({
      eventType,
      subscriptionStatus: "trialing",
      subscriptionTrialEnd: trialEnd,
    });
    expect(out).toEqual({
      billing_status: "active",
      is_in_trial: true,
      trial_ends_at: new Date(trialEnd * 1000).toISOString(),
    });
  });

  test.each([
    ["customer.subscription.created"],
    ["customer.subscription.updated"],
  ])("%s → active maps to active + is_in_trial=false + trial_ends_at=null", (eventType) => {
    const out = mapStripeEventToTenantUpdate({
      eventType,
      subscriptionStatus: "active",
    });
    expect(out).toEqual({
      billing_status: "active",
      is_in_trial: false,
      trial_ends_at: null,
    });
  });

  test.each([
    ["customer.subscription.created", "past_due"],
    ["customer.subscription.updated", "past_due"],
    ["customer.subscription.created", "unpaid"],
    ["customer.subscription.updated", "unpaid"],
  ])("%s → %s maps to billing_status=past_due", (eventType, status) => {
    const out = mapStripeEventToTenantUpdate({
      eventType,
      subscriptionStatus: status,
    });
    expect(out).toEqual({ billing_status: "past_due" });
  });

  test("customer.subscription.updated → canceled maps to cancelled", () => {
    const out = mapStripeEventToTenantUpdate({
      eventType: "customer.subscription.updated",
      subscriptionStatus: "canceled",
    });
    expect(out).toEqual({ billing_status: "cancelled" });
  });

  test.each([
    ["incomplete"],
    ["incomplete_expired"],
    ["paused"],
  ])("status=%s returns empty (no state flip)", (status) => {
    const out = mapStripeEventToTenantUpdate({
      eventType: "customer.subscription.created",
      subscriptionStatus: status,
    });
    expect(out).toEqual({});
  });

  test("subscription event with no status returns empty", () => {
    const out = mapStripeEventToTenantUpdate({
      eventType: "customer.subscription.created",
    });
    expect(out).toEqual({});
  });

  test("trialing with trial_end=null returns trial_ends_at=null", () => {
    const out = mapStripeEventToTenantUpdate({
      eventType: "customer.subscription.created",
      subscriptionStatus: "trialing",
      subscriptionTrialEnd: null,
    });
    expect(out).toEqual({
      billing_status: "active",
      is_in_trial: true,
      trial_ends_at: null,
    });
  });

  test("trialing with trial_end=0 returns trial_ends_at=null", () => {
    const out = mapStripeEventToTenantUpdate({
      eventType: "customer.subscription.created",
      subscriptionStatus: "trialing",
      subscriptionTrialEnd: 0,
    });
    expect(out.trial_ends_at).toBeNull();
  });
});

describe("customer.subscription.deleted", () => {
  test("maps to billing_status=cancelled", () => {
    const out = mapStripeEventToTenantUpdate({
      eventType: "customer.subscription.deleted",
      subscriptionStatus: "canceled",
    });
    expect(out).toEqual({ billing_status: "cancelled" });
  });

  test("maps to cancelled even when status is missing", () => {
    const out = mapStripeEventToTenantUpdate({
      eventType: "customer.subscription.deleted",
    });
    expect(out).toEqual({ billing_status: "cancelled" });
  });
});

describe("invoice.paid", () => {
  test("maps to active + clears trial", () => {
    const out = mapStripeEventToTenantUpdate({
      eventType: "invoice.paid",
    });
    expect(out).toEqual({
      billing_status: "active",
      is_in_trial: false,
      trial_ends_at: null,
    });
  });
});

describe("invoice.payment_failed", () => {
  test.each([
    [0],
    [1],
    [2],
  ])("attempt_count=%i (< 3) returns empty (no state flip yet)", (attempt) => {
    const out = mapStripeEventToTenantUpdate({
      eventType: "invoice.payment_failed",
      invoiceAttemptCount: attempt,
    });
    expect(out).toEqual({});
  });

  test.each([
    [3],
    [4],
    [10],
  ])("attempt_count=%i (>= 3) maps to past_due", (attempt) => {
    const out = mapStripeEventToTenantUpdate({
      eventType: "invoice.payment_failed",
      invoiceAttemptCount: attempt,
    });
    expect(out).toEqual({ billing_status: "past_due" });
  });

  test("missing attempt_count returns empty (treated as 0)", () => {
    const out = mapStripeEventToTenantUpdate({
      eventType: "invoice.payment_failed",
    });
    expect(out).toEqual({});
  });
});

describe("checkout.session.completed", () => {
  test("returns empty (no direct tenant update)", () => {
    const out = mapStripeEventToTenantUpdate({
      eventType: "checkout.session.completed",
    });
    expect(out).toEqual({});
  });
});

describe("unknown / unhandled event types", () => {
  test("unknown event type returns empty", () => {
    const out = mapStripeEventToTenantUpdate({
      eventType: "customer.created",
    });
    expect(out).toEqual({});
  });

  test("empty string event type returns empty", () => {
    const out = mapStripeEventToTenantUpdate({
      eventType: "",
    });
    expect(out).toEqual({});
  });
});

describe("S-1 §5 invariants", () => {
  test("past_due → suspended is NEVER produced by this helper (out of scope for PR 2)", () => {
    // The flip to 'suspended' is a separate later cron after the 14-day
    // grace window. None of the six handled events should ever yield it.
    const eventCases = [
      { eventType: "customer.subscription.created",  subscriptionStatus: "trialing" },
      { eventType: "customer.subscription.created",  subscriptionStatus: "active" },
      { eventType: "customer.subscription.created",  subscriptionStatus: "past_due" },
      { eventType: "customer.subscription.created",  subscriptionStatus: "unpaid" },
      { eventType: "customer.subscription.created",  subscriptionStatus: "canceled" },
      { eventType: "customer.subscription.updated",  subscriptionStatus: "past_due" },
      { eventType: "customer.subscription.deleted" },
      { eventType: "invoice.paid" },
      { eventType: "invoice.payment_failed", invoiceAttemptCount: 3 },
      { eventType: "invoice.payment_failed", invoiceAttemptCount: 99 },
      { eventType: "checkout.session.completed" },
    ];
    for (const c of eventCases) {
      const out = mapStripeEventToTenantUpdate(c);
      expect(out.billing_status).not.toBe("suspended");
    }
  });
});
