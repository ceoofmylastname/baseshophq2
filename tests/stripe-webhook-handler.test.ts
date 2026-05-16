/**
 * Tests for the stateful Stripe-webhook handlers extracted into
 * supabase/functions/_shared/payment-handlers.ts.
 *
 * The handlers depend on tenants.payment_failure_count, so they can't live
 * in the pure state-mapper. We mock a minimal admin-client surface
 * (chainable .from().select().eq().maybeSingle() / .insert() / .update())
 * with an in-memory `state` object so the tests can assert both the
 * returned shape AND the resulting writes.
 *
 * Five required cases (PR 2 gap closure):
 *   - payment_failure_count=0 + invoice.payment_failed → count=1, status='active'
 *   - payment_failure_count=2 + invoice.payment_failed → count=3, status='past_due'
 *   - payment_failure_count=5 + invoice.paid           → count=0, status='active'
 *   - audit redelivery, processed_at set                → already_processed=true
 *   - audit redelivery, processed_at null               → already_processed=false
 */

import { describe, expect, test } from "bun:test";
import {
  applyInvoicePaid,
  applyInvoicePaymentFailed,
  handleAuditInsert,
  type AdminLike,
} from "../supabase/functions/_shared/payment-handlers.ts";

type TenantRow = {
  id: string;
  payment_failure_count: number;
  billing_status: string;
  is_in_trial?: boolean;
};

type EventRow = {
  event_id: string;
  processed_at: string | null;
};

type MockState = {
  tenants: Map<string, TenantRow>;
  events: Map<string, EventRow>;
};

/**
 * Build a minimal admin-client mock backed by an in-memory state map. Only
 * implements the chains exercised by the handlers under test:
 *   - from('tenants').select(...).eq('id', tid).maybeSingle()
 *   - from('tenants').update(patch).eq('id', tid)
 *   - from('stripe_webhook_events').insert(row)
 *   - from('stripe_webhook_events').select(...).eq('event_id', e).maybeSingle()
 *   - from('stripe_webhook_events').update(patch).eq('event_id', e)
 */
function makeMockAdmin(state: MockState): AdminLike {
  return {
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(col: string, val: string) {
              return {
                async maybeSingle() {
                  if (table === "tenants") {
                    const row = state.tenants.get(val) ?? null;
                    return { data: row as unknown as Record<string, unknown> | null, error: null };
                  }
                  if (table === "stripe_webhook_events") {
                    if (col !== "event_id") {
                      return { data: null, error: { message: `unsupported eq col ${col}` } };
                    }
                    const row = state.events.get(val) ?? null;
                    return { data: row as unknown as Record<string, unknown> | null, error: null };
                  }
                  return { data: null, error: { message: `unsupported table ${table}` } };
                },
              };
            },
          };
        },
        async insert(row: Record<string, unknown>) {
          if (table === "stripe_webhook_events") {
            const id = row.event_id as string;
            if (state.events.has(id)) {
              return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
            }
            state.events.set(id, { event_id: id, processed_at: null });
            return { error: null };
          }
          return { error: { message: `unsupported insert into ${table}` } };
        },
        update(patch: Record<string, unknown>) {
          return {
            async eq(col: string, val: string) {
              if (table === "tenants") {
                const row = state.tenants.get(val);
                if (!row) return { error: { message: `no tenant ${val}` } };
                if (typeof patch.payment_failure_count === "number") row.payment_failure_count = patch.payment_failure_count as number;
                if (typeof patch.billing_status === "string") row.billing_status = patch.billing_status as string;
                if (typeof patch.is_in_trial === "boolean") row.is_in_trial = patch.is_in_trial as boolean;
                state.tenants.set(val, row);
                return { error: null };
              }
              if (table === "stripe_webhook_events") {
                if (col !== "event_id") return { error: { message: `unsupported update col ${col}` } };
                const row = state.events.get(val);
                if (!row) return { error: { message: `no event ${val}` } };
                if (typeof patch.processed_at === "string") row.processed_at = patch.processed_at as string;
                state.events.set(val, row);
                return { error: null };
              }
              return { error: { message: `unsupported update on ${table}` } };
            },
          };
        },
      };
    },
  };
}

describe("applyInvoicePaymentFailed", () => {
  test("payment_failure_count=0 + payment_failed → count=1, status stays 'active'", async () => {
    const state: MockState = {
      tenants: new Map([
        ["t1", { id: "t1", payment_failure_count: 0, billing_status: "active" }],
      ]),
      events: new Map(),
    };
    const admin = makeMockAdmin(state);

    const out = await applyInvoicePaymentFailed(admin, "t1");

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.new_count).toBe(1);
      expect(out.billing_status_set).toBeUndefined();
    }
    const t = state.tenants.get("t1");
    expect(t?.payment_failure_count).toBe(1);
    expect(t?.billing_status).toBe("active");
  });

  test("payment_failure_count=2 + payment_failed → count=3, status flips to 'past_due'", async () => {
    const state: MockState = {
      tenants: new Map([
        ["t2", { id: "t2", payment_failure_count: 2, billing_status: "active" }],
      ]),
      events: new Map(),
    };
    const admin = makeMockAdmin(state);

    const out = await applyInvoicePaymentFailed(admin, "t2");

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.new_count).toBe(3);
      expect(out.billing_status_set).toBe("past_due");
    }
    const t = state.tenants.get("t2");
    expect(t?.payment_failure_count).toBe(3);
    expect(t?.billing_status).toBe("past_due");
  });
});

describe("applyInvoicePaid", () => {
  test("payment_failure_count=5 + invoice.paid → count=0, status='active', is_in_trial=false", async () => {
    const state: MockState = {
      tenants: new Map([
        ["t3", { id: "t3", payment_failure_count: 5, billing_status: "past_due", is_in_trial: true }],
      ]),
      events: new Map(),
    };
    const admin = makeMockAdmin(state);

    const out = await applyInvoicePaid(admin, "t3");

    expect(out.ok).toBe(true);
    const t = state.tenants.get("t3");
    expect(t?.payment_failure_count).toBe(0);
    expect(t?.billing_status).toBe("active");
    expect(t?.is_in_trial).toBe(false);
  });
});

describe("handleAuditInsert (idempotency)", () => {
  test("redelivery: processed_at set on existing row → already_processed=true", async () => {
    const state: MockState = {
      tenants: new Map(),
      events: new Map([
        ["evt_existing", { event_id: "evt_existing", processed_at: "2026-05-15T00:00:00.000Z" }],
      ]),
    };
    const admin = makeMockAdmin(state);

    const out = await handleAuditInsert(admin, "evt_existing", "invoice.paid", { id: "evt_existing" });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.new_row).toBe(false);
      if (out.new_row === false) {
        expect(out.already_processed).toBe(true);
      }
    }
  });

  test("redelivery: processed_at null on existing row → already_processed=false (handler should re-run)", async () => {
    const state: MockState = {
      tenants: new Map(),
      events: new Map([
        ["evt_partial", { event_id: "evt_partial", processed_at: null }],
      ]),
    };
    const admin = makeMockAdmin(state);

    const out = await handleAuditInsert(admin, "evt_partial", "invoice.paid", { id: "evt_partial" });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.new_row).toBe(false);
      if (out.new_row === false) {
        expect(out.already_processed).toBe(false);
      }
    }
  });
});
