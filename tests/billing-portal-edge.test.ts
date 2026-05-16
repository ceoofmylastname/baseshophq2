/**
 * Unit tests for the extracted billing-portal Edge handler.
 *
 * Mirrors the pattern from tests/stripe-webhook-handler.test.ts: build a
 * minimal admin-client mock plus a fake stripe client and assert the four
 * required cases per the locked file plan:
 *   1. missing JWT → 401 invalid_token
 *   2. caller not owner → 403 caller_not_owner
 *   3. tenant has no stripe_customer_id → 400 no_stripe_customer
 *   4. happy path → 200 with portal URL
 *
 * The handler is pure with respect to these mocks (no Deno or npm imports
 * pulled in here), so `bun test` runs it without an Edge runtime.
 */

import { describe, expect, test } from "bun:test";
import {
  handleBillingPortalRequest,
  type BillingPortalAdminLike,
  type BillingPortalStripeLike,
} from "../supabase/functions/_shared/billing-portal-handler.ts";

type AgentRow = { id: string; is_owner: boolean; tenant_id: string };
type TenantRow = { id: string; stripe_customer_id: string | null };
type UserRow = { id: string };

type MockState = {
  users: Map<string, UserRow>; // token → user
  agents: Map<string, AgentRow>; // user_id → agent
  tenants: Map<string, TenantRow>;
};

function makeMockAdmin(state: MockState): BillingPortalAdminLike {
  return {
    auth: {
      async getUser(token: string) {
        const u = state.users.get(token) ?? null;
        if (!u) {
          return { data: { user: null }, error: { message: "invalid token" } };
        }
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
                    const row = state.agents.get(val) ?? null;
                    return { data: row as unknown as Record<string, unknown> | null, error: null };
                  }
                  if (table === "tenants") {
                    const row = state.tenants.get(val) ?? null;
                    return { data: row as unknown as Record<string, unknown> | null, error: null };
                  }
                  return { data: null, error: { message: `unsupported table ${table}` } };
                },
              };
            },
          };
        },
      };
    },
  };
}

function makeMockStripe(): BillingPortalStripeLike {
  return {
    billingPortal: {
      sessions: {
        async create(params) {
          return {
            id: "bps_test_123",
            url: `https://billing.stripe.com/p/session/${params.customer}`,
          };
        },
      },
    },
  };
}

const RETURN_URL = "https://baseshophq.com/billing";

describe("handleBillingPortalRequest", () => {
  test("missing JWT → 401 invalid_token", async () => {
    const state: MockState = {
      users: new Map(),
      agents: new Map(),
      tenants: new Map(),
    };
    const result = await handleBillingPortalRequest({
      admin: makeMockAdmin(state),
      stripe: makeMockStripe(),
      accessToken: "",
      returnUrl: RETURN_URL,
    });
    expect(result.status).toBe(401);
    if (result.status === 401) {
      expect(result.body.ok).toBe(false);
      expect(result.body.error_code).toBe("invalid_token");
    }
  });

  test("non-owner → 403 caller_not_owner", async () => {
    const state: MockState = {
      users: new Map([["tok_agent", { id: "u_agent" }]]),
      agents: new Map([["u_agent", { id: "u_agent", is_owner: false, tenant_id: "t_x" }]]),
      tenants: new Map(),
    };
    const result = await handleBillingPortalRequest({
      admin: makeMockAdmin(state),
      stripe: makeMockStripe(),
      accessToken: "tok_agent",
      returnUrl: RETURN_URL,
    });
    expect(result.status).toBe(403);
    if (result.status === 403) {
      expect(result.body.error_code).toBe("caller_not_owner");
    }
  });

  test("caller with no agent row → 403 caller_no_agent_record", async () => {
    const state: MockState = {
      users: new Map([["tok_orphan", { id: "u_orphan" }]]),
      agents: new Map(),
      tenants: new Map(),
    };
    const result = await handleBillingPortalRequest({
      admin: makeMockAdmin(state),
      stripe: makeMockStripe(),
      accessToken: "tok_orphan",
      returnUrl: RETURN_URL,
    });
    expect(result.status).toBe(403);
    if (result.status === 403) {
      expect(result.body.error_code).toBe("caller_no_agent_record");
    }
  });

  test("tenant has no stripe_customer_id → 400 no_stripe_customer", async () => {
    const state: MockState = {
      users: new Map([["tok_owner", { id: "u_owner" }]]),
      agents: new Map([["u_owner", { id: "u_owner", is_owner: true, tenant_id: "t_nocust" }]]),
      tenants: new Map([["t_nocust", { id: "t_nocust", stripe_customer_id: null }]]),
    };
    const result = await handleBillingPortalRequest({
      admin: makeMockAdmin(state),
      stripe: makeMockStripe(),
      accessToken: "tok_owner",
      returnUrl: RETURN_URL,
    });
    expect(result.status).toBe(400);
    if (result.status === 400) {
      expect(result.body.error_code).toBe("no_stripe_customer");
    }
  });

  test("happy path → 200 with url + session_id", async () => {
    const state: MockState = {
      users: new Map([["tok_owner", { id: "u_owner" }]]),
      agents: new Map([["u_owner", { id: "u_owner", is_owner: true, tenant_id: "t_ok" }]]),
      tenants: new Map([["t_ok", { id: "t_ok", stripe_customer_id: "cus_abc123" }]]),
    };
    const result = await handleBillingPortalRequest({
      admin: makeMockAdmin(state),
      stripe: makeMockStripe(),
      accessToken: "tok_owner",
      returnUrl: RETURN_URL,
    });
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.ok).toBe(true);
      expect(result.body.url).toContain("cus_abc123");
      expect(result.body.session_id).toBe("bps_test_123");
    }
  });
});
