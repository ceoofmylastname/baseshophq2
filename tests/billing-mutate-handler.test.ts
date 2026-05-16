/**
 * Tests for handleBillingMutateRequest (Phase 17 PR 3c).
 *
 * Builds a minimal admin-client + stripe mock and asserts the handler
 * dispatches to the right path:
 *   - Happy paths: tier upgrade, tier downgrade (schedule), WL add, WL remove,
 *     interval flip monthly→annual, annual→monthly.
 *   - Validation errors: enterprise rejected, annual+enterprise rejected,
 *     starter+WL rejected, same_target_as_current.
 *   - Preview path: returns { ok: true, preview }.
 *   - Auth errors: missing token, not owner.
 */

import { describe, expect, test } from "bun:test";
import {
  handleBillingMutateRequest,
  type BillingMutateAdminLike,
  type BillingMutateStripeLike,
} from "../supabase/functions/_shared/billing-mutate-handler.ts";
import type { PriceCatalog } from "../supabase/functions/_shared/billing-mutate-actions.ts";

const CATALOG: PriceCatalog = {
  starter: "price_starter_m",
  growth: "price_growth_m",
  pro: "price_pro_m",
  enterprise_active_agent_unit: "price_enterprise_unit",
  white_label_addon: "price_wl_m",
  starter_annual: "price_starter_a",
  growth_annual: "price_growth_a",
  pro_annual: "price_pro_a",
  white_label_addon_annual: "price_wl_a",
};

type TenantRow = {
  id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_plan_tier: "starter" | "growth" | "pro" | "enterprise";
  white_label_addon_active: boolean;
  billing_interval: "monthly" | "annual";
};

type AgentRow = { id: string; is_owner: boolean; tenant_id: string };

type MockSubItem = { id: string; price: { id: string }; quantity?: number };
type MockSub = {
  id: string;
  customer: string;
  items: { data: MockSubItem[] };
  current_period_end: number;
};

type MockState = {
  users: Map<string, { id: string }>;
  agents: Map<string, AgentRow>;
  tenants: Map<string, TenantRow>;
  subs: Map<string, MockSub>;
  /** captures of every stripe call for assertions */
  calls: {
    subscriptionsUpdate: Array<{ id: string; params: unknown }>;
    schedulesCreate: Array<{ from_subscription: string }>;
    schedulesUpdate: Array<{ id: string; params: unknown }>;
    upcomingInvoices: Array<unknown>;
  };
};

function makeMockAdmin(state: MockState): BillingMutateAdminLike {
  return {
    auth: {
      async getUser(token: string) {
        const u = state.users.get(token) ?? null;
        if (!u) return { data: { user: null }, error: { message: "invalid token" } };
        return { data: { user: { id: u.id } }, error: null };
      },
    },
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, val: string) {
              return {
                async maybeSingle() {
                  if (table === "agents") {
                    return { data: (state.agents.get(val) ?? null) as Record<string, unknown> | null, error: null };
                  }
                  if (table === "tenants") {
                    return { data: (state.tenants.get(val) ?? null) as unknown as Record<string, unknown> | null, error: null };
                  }
                  return { data: null, error: { message: `unsupported table ${table}` } };
                },
              };
            },
          };
        },
      };
    },
    async rpc(_fn: string, _args: Record<string, unknown>) {
      return { data: null, error: null };
    },
  };
}

function makeMockStripe(state: MockState, opts?: { upcomingLines?: Array<{ amount: number; proration: boolean }> }): BillingMutateStripeLike {
  return {
    subscriptions: {
      async retrieve(id: string) {
        const sub = state.subs.get(id);
        if (!sub) throw Object.assign(new Error("subscription not found"), { type: "StripeInvalidRequestError" });
        return sub;
      },
      async update(id: string, params) {
        state.calls.subscriptionsUpdate.push({ id, params });
        return { id };
      },
    },
    subscriptionSchedules: {
      async create(params) {
        state.calls.schedulesCreate.push(params);
        return { id: "sub_sched_x", phases: [] };
      },
      async update(id, params) {
        state.calls.schedulesUpdate.push({ id, params });
        return { id };
      },
    },
    invoices: {
      async retrieveUpcoming(params) {
        state.calls.upcomingInvoices.push(params);
        return {
          amount_due: 5000,
          currency: "usd",
          lines: { data: opts?.upcomingLines ?? [{ amount: 5000, proration: true }] },
          period_start: 1_700_000_000,
          period_end: 1_702_000_000,
          total: 5000,
        };
      },
    },
  };
}

function buildHappyState(opts: {
  tier: TenantRow["current_plan_tier"];
  interval: TenantRow["billing_interval"];
  whiteLabel: boolean;
}): MockState {
  const items: MockSubItem[] = [];
  if (opts.tier === "starter") {
    items.push({ id: "si_base", price: { id: opts.interval === "annual" ? "price_starter_a" : "price_starter_m" } });
  } else if (opts.tier === "growth") {
    items.push({ id: "si_base", price: { id: opts.interval === "annual" ? "price_growth_a" : "price_growth_m" } });
  } else if (opts.tier === "pro") {
    items.push({ id: "si_base", price: { id: opts.interval === "annual" ? "price_pro_a" : "price_pro_m" } });
  } else {
    items.push({ id: "si_base", price: { id: "price_enterprise_unit" }, quantity: 50 });
  }
  if (opts.whiteLabel) {
    items.push({ id: "si_wl", price: { id: opts.interval === "annual" ? "price_wl_a" : "price_wl_m" } });
  }
  return {
    users: new Map([["tok_owner", { id: "u_owner" }]]),
    agents: new Map([["u_owner", { id: "u_owner", is_owner: true, tenant_id: "t_x" }]]),
    tenants: new Map([["t_x", {
      id: "t_x",
      stripe_customer_id: "cus_x",
      stripe_subscription_id: "sub_x",
      current_plan_tier: opts.tier,
      white_label_addon_active: opts.whiteLabel,
      billing_interval: opts.interval,
    }]]),
    subs: new Map([["sub_x", { id: "sub_x", customer: "cus_x", items: { data: items }, current_period_end: 1_702_000_000 }]]),
    calls: { subscriptionsUpdate: [], schedulesCreate: [], schedulesUpdate: [], upcomingInvoices: [] },
  };
}

const RUN = (state: MockState, body: Parameters<typeof handleBillingMutateRequest>[0]["body"]) =>
  handleBillingMutateRequest({
    admin: makeMockAdmin(state),
    stripe: makeMockStripe(state),
    catalog: CATALOG,
    accessToken: "tok_owner",
    body,
  });

describe("auth gates", () => {
  test("missing token → 401 invalid_token", async () => {
    const state = buildHappyState({ tier: "starter", interval: "monthly", whiteLabel: false });
    const out = await handleBillingMutateRequest({
      admin: makeMockAdmin(state),
      stripe: makeMockStripe(state),
      catalog: CATALOG,
      accessToken: "",
      body: { action: "change_tier", tier: "growth" },
    });
    expect(out.status).toBe(401);
  });

  test("non-owner → 403 caller_not_owner", async () => {
    const state = buildHappyState({ tier: "growth", interval: "monthly", whiteLabel: false });
    state.users.set("tok_agent", { id: "u_agent" });
    state.agents.set("u_agent", { id: "u_agent", is_owner: false, tenant_id: "t_x" });
    const out = await handleBillingMutateRequest({
      admin: makeMockAdmin(state),
      stripe: makeMockStripe(state),
      catalog: CATALOG,
      accessToken: "tok_agent",
      body: { action: "change_tier", tier: "pro" },
    });
    expect(out.status).toBe(403);
    if (out.status === 403) expect(out.body.error_code).toBe("caller_not_owner");
  });
});

describe("validation gates", () => {
  test("enterprise → 400 enterprise_not_self_serve", async () => {
    const state = buildHappyState({ tier: "growth", interval: "monthly", whiteLabel: false });
    const out = await RUN(state, { action: "change_tier", tier: "enterprise" });
    expect(out.status).toBe(400);
    if (out.status === 400) expect(out.body.error_code).toBe("enterprise_not_self_serve");
  });

  test("starter + add WL → 400 starter_white_label_combination", async () => {
    const state = buildHappyState({ tier: "starter", interval: "monthly", whiteLabel: false });
    const out = await RUN(state, { action: "toggle_white_label", active: true });
    expect(out.status).toBe(400);
    if (out.status === 400) expect(out.body.error_code).toBe("starter_white_label_combination");
  });

  test("annual on enterprise rejected (defensive — enterprise cannot be reached via change_interval)", async () => {
    // Set up an enterprise tenant currently on monthly; ask for annual via change_interval.
    const state = buildHappyState({ tier: "enterprise", interval: "monthly", whiteLabel: false });
    const out = await RUN(state, { action: "change_interval", interval: "annual" });
    expect(out.status).toBe(400);
    if (out.status === 400) expect(out.body.error_code).toBe("enterprise_annual_not_supported");
  });

  test("same target → 400 same_target_as_current", async () => {
    const state = buildHappyState({ tier: "growth", interval: "monthly", whiteLabel: false });
    const out = await RUN(state, { action: "change_tier", tier: "growth" });
    expect(out.status).toBe(400);
    if (out.status === 400) expect(out.body.error_code).toBe("same_target_as_current");
  });
});

describe("happy paths — immediate updates", () => {
  test("Starter → Growth (upgrade) calls subscriptions.update with new base price", async () => {
    const state = buildHappyState({ tier: "starter", interval: "monthly", whiteLabel: false });
    const out = await RUN(state, { action: "change_tier", tier: "growth" });
    expect(out.status).toBe(200);
    expect(state.calls.subscriptionsUpdate.length).toBe(1);
    expect(state.calls.schedulesCreate.length).toBe(0);
    const params = state.calls.subscriptionsUpdate[0].params as { items: Array<{ price: string }> };
    expect(params.items[0].price).toBe("price_growth_m");
  });

  test("Growth → WL add (upgrade) calls subscriptions.update with WL line", async () => {
    const state = buildHappyState({ tier: "growth", interval: "monthly", whiteLabel: false });
    const out = await RUN(state, { action: "toggle_white_label", active: true });
    expect(out.status).toBe(200);
    expect(state.calls.subscriptionsUpdate.length).toBe(1);
    const params = state.calls.subscriptionsUpdate[0].params as { items: Array<{ price?: string; quantity?: number }> };
    expect(params.items.some(i => i.price === "price_wl_m")).toBe(true);
  });

  test("monthly → annual flips interval", async () => {
    const state = buildHappyState({ tier: "growth", interval: "monthly", whiteLabel: false });
    const out = await RUN(state, { action: "change_interval", interval: "annual" });
    expect(out.status).toBe(200);
    const params = state.calls.subscriptionsUpdate[0].params as { items: Array<{ price?: string }> };
    expect(params.items[0].price).toBe("price_growth_a");
  });
});

describe("happy paths — scheduled downgrades", () => {
  test("Pro → Growth (downgrade) uses subscriptionSchedules.update with 2 phases", async () => {
    const state = buildHappyState({ tier: "pro", interval: "monthly", whiteLabel: false });
    const out = await RUN(state, { action: "change_tier", tier: "growth" });
    expect(out.status).toBe(200);
    expect(state.calls.subscriptionsUpdate.length).toBe(0);
    expect(state.calls.schedulesCreate.length).toBe(1);
    expect(state.calls.schedulesUpdate.length).toBe(1);
    const updateParams = state.calls.schedulesUpdate[0].params as { phases: Array<{ items: Array<{ price: string }> }> };
    expect(updateParams.phases.length).toBe(2);
    expect(updateParams.phases[0].items[0].price).toBe("price_pro_m");
    expect(updateParams.phases[1].items[0].price).toBe("price_growth_m");
  });

  test("annual → monthly (downgrade) uses schedule with both monthly phase items", async () => {
    const state = buildHappyState({ tier: "growth", interval: "annual", whiteLabel: false });
    const out = await RUN(state, { action: "change_interval", interval: "monthly" });
    expect(out.status).toBe(200);
    expect(state.calls.schedulesCreate.length).toBe(1);
    expect(state.calls.schedulesUpdate.length).toBe(1);
  });

  test("Remove WL (downgrade) schedules phase change", async () => {
    const state = buildHappyState({ tier: "growth", interval: "monthly", whiteLabel: true });
    const out = await RUN(state, { action: "toggle_white_label", active: false });
    expect(out.status).toBe(200);
    expect(state.calls.schedulesCreate.length).toBe(1);
  });
});

describe("preview path", () => {
  test("preview=true returns proration block and does NOT call subscriptions.update", async () => {
    const state = buildHappyState({ tier: "starter", interval: "monthly", whiteLabel: false });
    const out = await handleBillingMutateRequest({
      admin: makeMockAdmin(state),
      stripe: makeMockStripe(state, {
        upcomingLines: [
          { amount: -2000, proration: true },
          { amount: 5000,  proration: true },
        ],
      }),
      catalog: CATALOG,
      accessToken: "tok_owner",
      body: { action: "change_tier", tier: "growth", preview: true },
    });
    expect(out.status).toBe(200);
    if (out.status === 200 && out.body.ok) {
      expect(out.body.preview).toBeDefined();
      expect(out.body.preview?.prorated_credit).toBe(-2000);
      expect(out.body.preview?.prorated_charge).toBe(5000);
    }
    // No update was performed
    expect(state.calls.subscriptionsUpdate.length).toBe(0);
    expect(state.calls.schedulesCreate.length).toBe(0);
  });
});
