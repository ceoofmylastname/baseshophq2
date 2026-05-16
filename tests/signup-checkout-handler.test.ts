/**
 * Phase 18 PR 2 — tests for handleSignupCheckoutRequest.
 *
 * Builds a minimal admin-client + stripe mock and exercises:
 *   - validation: enterprise rejection, invalid tier/interval, starter+WL,
 *     missing fields (validation_failed), invalid email, whitelist hit/miss
 *   - email_already_registered when RPC returns true
 *   - slug uniqueness loop (tenants slugs jrm, jrm-2 → request resolves jrm-3)
 *   - stripe_init_failed when stripe is null
 *   - happy path: growth + monthly + no-WL produces a 1-line-item session with
 *     full 10-key metadata + metadata.flow='new_signup'
 */

import { describe, expect, test } from "bun:test";
import {
  handleSignupCheckoutRequest,
  type SignupCheckoutAdminLike,
  type SignupCheckoutBody,
  type SignupCheckoutPriceCatalog,
  type SignupCheckoutStripeLike,
} from "../supabase/functions/_shared/signup-checkout-handler.ts";

const CATALOG: SignupCheckoutPriceCatalog = {
  starter: "price_starter_m",
  growth: "price_growth_m",
  pro: "price_pro_m",
  starter_annual: "price_starter_a",
  growth_annual: "price_growth_a",
  pro_annual: "price_pro_a",
  white_label_addon: "price_wl_m",
  white_label_addon_annual: "price_wl_a",
};

const EMPTY_CATALOG: SignupCheckoutPriceCatalog = {
  starter: null,
  growth: null,
  pro: null,
  starter_annual: null,
  growth_annual: null,
  pro_annual: null,
  white_label_addon: null,
  white_label_addon_annual: null,
};

type MockState = {
  emailRegistered: boolean;
  existingSlugs: Set<string>;
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  stripeCalls: Array<{ params: unknown }>;
};

function makeMockAdmin(state: MockState): SignupCheckoutAdminLike {
  return {
    async rpc(fn: string, args: Record<string, unknown>) {
      state.rpcCalls.push({ fn, args });
      if (fn === "auth_user_exists_by_email") {
        return { data: state.emailRegistered, error: null };
      }
      return { data: null, error: null };
    },
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            async eq(col: string, val: string) {
              if (table === "tenants" && col === "slug") {
                if (state.existingSlugs.has(val)) {
                  return { data: [{ slug: val }], error: null };
                }
                return { data: [], error: null };
              }
              return { data: [], error: null };
            },
          };
        },
      };
    },
  };
}

function makeMockStripe(state: MockState, opts?: { sessionId?: string; url?: string }): SignupCheckoutStripeLike {
  return {
    checkout: {
      sessions: {
        async create(params) {
          state.stripeCalls.push({ params });
          return { id: opts?.sessionId ?? "cs_test_xyz", url: opts?.url ?? "https://checkout.stripe.com/c/cs_test_xyz" };
        },
      },
    },
  };
}

function freshState(opts: Partial<MockState> = {}): MockState {
  return {
    emailRegistered: opts.emailRegistered ?? false,
    existingSlugs: opts.existingSlugs ?? new Set<string>(),
    rpcCalls: [],
    stripeCalls: [],
  };
}

function baseBody(overrides: Partial<SignupCheckoutBody> = {}): SignupCheckoutBody {
  return {
    tier: "growth",
    interval: "monthly",
    whiteLabel: false,
    agencyName: "JRM",
    ownerEmail: "alice@example.com",
    ownerFirstName: "Alice",
    ownerLastName: "Stone",
    timeZone: "America/New_York",
    ...overrides,
  };
}

const RUN = (state: MockState, body: SignupCheckoutBody, stripeOpts?: { stripe?: SignupCheckoutStripeLike | null }) =>
  handleSignupCheckoutRequest({
    admin: makeMockAdmin(state),
    stripe: stripeOpts && "stripe" in stripeOpts ? stripeOpts.stripe ?? null : makeMockStripe(state),
    catalog: CATALOG,
    publicSiteUrl: "https://baseshophq.com",
    body,
  });

describe("validation gates", () => {
  test("tier=enterprise → 400 enterprise_not_self_serve", async () => {
    const out = await RUN(freshState(), baseBody({ tier: "enterprise" }));
    expect(out.status).toBe(400);
    if (out.status === 400) expect(out.body.error_code).toBe("enterprise_not_self_serve");
  });

  test("tier=ultra (invalid) → 400 validation_failed", async () => {
    const out = await RUN(freshState(), baseBody({ tier: "ultra" as unknown as string }));
    expect(out.status).toBe(400);
    if (out.status === 400) expect(out.body.error_code).toBe("validation_failed");
  });

  test("interval=yearly (invalid) → 400 validation_failed", async () => {
    const out = await RUN(freshState(), baseBody({ interval: "yearly" as unknown as string }));
    expect(out.status).toBe(400);
    if (out.status === 400) expect(out.body.error_code).toBe("validation_failed");
  });

  test("tier=starter + whiteLabel=true → 400 starter_white_label_combination", async () => {
    const out = await RUN(freshState(), baseBody({ tier: "starter", whiteLabel: true }));
    expect(out.status).toBe(400);
    if (out.status === 400) expect(out.body.error_code).toBe("starter_white_label_combination");
  });

  test("missing agencyName → 400 validation_failed", async () => {
    const out = await RUN(freshState(), baseBody({ agencyName: "" }));
    expect(out.status).toBe(400);
    if (out.status === 400) expect(out.body.error_code).toBe("validation_failed");
  });

  test("missing ownerFirstName → 400 validation_failed", async () => {
    const out = await RUN(freshState(), baseBody({ ownerFirstName: "" }));
    expect(out.status).toBe(400);
    if (out.status === 400) expect(out.body.error_code).toBe("validation_failed");
  });

  test("missing ownerLastName → 400 validation_failed", async () => {
    const out = await RUN(freshState(), baseBody({ ownerLastName: "" }));
    expect(out.status).toBe(400);
    if (out.status === 400) expect(out.body.error_code).toBe("validation_failed");
  });

  test("invalid email format → 400 validation_failed", async () => {
    const out = await RUN(freshState(), baseBody({ ownerEmail: "not-an-email" }));
    expect(out.status).toBe(400);
    if (out.status === 400) expect(out.body.error_code).toBe("validation_failed");
  });

  test("valid timeZone (whitelist hit) is accepted", async () => {
    const out = await RUN(freshState(), baseBody({ timeZone: "Europe/London" }));
    expect(out.status).toBe(200);
  });

  test("invalid timeZone (whitelist miss) → 400 validation_failed", async () => {
    const out = await RUN(freshState(), baseBody({ timeZone: "Mars/Olympus" }));
    expect(out.status).toBe(400);
    if (out.status === 400) expect(out.body.error_code).toBe("validation_failed");
  });
});

describe("email_already_registered", () => {
  test("RPC returns true → 400 email_already_registered with hint", async () => {
    const out = await RUN(freshState({ emailRegistered: true }), baseBody());
    expect(out.status).toBe(400);
    if (out.status === 400) {
      expect(out.body.error_code).toBe("email_already_registered");
      expect(out.body.hint).toBe("Already have an account? Sign in instead.");
    }
  });
});

describe("slug uniqueness loop", () => {
  test("agencyName='JRM' with existing slugs {jrm, jrm-2} → resolves to jrm-3", async () => {
    const state = freshState({ existingSlugs: new Set(["jrm", "jrm-2"]) });
    const out = await RUN(state, baseBody({ agencyName: "JRM" }));
    expect(out.status).toBe(200);
    expect(state.stripeCalls.length).toBe(1);
    const params = state.stripeCalls[0].params as { subscription_data: { metadata: Record<string, string> } };
    expect(params.subscription_data.metadata.slug).toBe("jrm-3");
  });

  test("agencyName with no collision → uses base slug", async () => {
    const state = freshState();
    const out = await RUN(state, baseBody({ agencyName: "Unique Co" }));
    expect(out.status).toBe(200);
    const params = state.stripeCalls[0].params as { subscription_data: { metadata: Record<string, string> } };
    expect(params.subscription_data.metadata.slug).toBe("unique-co");
  });

  test("slugHint overrides agencyName-derived slug", async () => {
    const state = freshState();
    const out = await RUN(state, baseBody({ agencyName: "Different Name", slugHint: "Preferred-Slug" }));
    expect(out.status).toBe(200);
    const params = state.stripeCalls[0].params as { subscription_data: { metadata: Record<string, string> } };
    expect(params.subscription_data.metadata.slug).toBe("preferred-slug");
  });
});

describe("stripe init missing", () => {
  test("stripe=null → 500 stripe_init_failed", async () => {
    const out = await RUN(freshState(), baseBody(), { stripe: null });
    expect(out.status).toBe(500);
    if (out.status === 500) expect(out.body.error_code).toBe("stripe_init_failed");
  });

  test("catalog missing price for tier → 500 stripe_init_failed", async () => {
    const state = freshState();
    const out = await handleSignupCheckoutRequest({
      admin: makeMockAdmin(state),
      stripe: makeMockStripe(state),
      catalog: EMPTY_CATALOG,
      publicSiteUrl: "https://baseshophq.com",
      body: baseBody(),
    });
    expect(out.status).toBe(500);
    if (out.status === 500) expect(out.body.error_code).toBe("stripe_init_failed");
  });
});

describe("happy path", () => {
  test("growth + monthly + no-WL → 200 with 1 line item + 10-key metadata + flow=new_signup", async () => {
    const state = freshState();
    const out = await RUN(state, baseBody({ tier: "growth", interval: "monthly", whiteLabel: false }));
    expect(out.status).toBe(200);
    if (out.status === 200) {
      expect(out.body.ok).toBe(true);
      expect(out.body.session_id).toBe("cs_test_xyz");
      expect(out.body.url).toBe("https://checkout.stripe.com/c/cs_test_xyz");
    }

    expect(state.stripeCalls.length).toBe(1);
    const params = state.stripeCalls[0].params as {
      mode: string;
      customer_email: string;
      line_items: Array<{ price: string; quantity: number }>;
      allow_promotion_codes: boolean;
      success_url: string;
      cancel_url: string;
      subscription_data: {
        trial_period_days: number;
        metadata: Record<string, string>;
      };
      metadata: Record<string, string>;
    };

    expect(params.mode).toBe("subscription");
    expect(params.customer_email).toBe("alice@example.com");
    expect(params.allow_promotion_codes).toBe(true);
    expect(params.success_url).toBe("https://baseshophq.com/signup/success?session_id={CHECKOUT_SESSION_ID}");
    expect(params.cancel_url).toBe("https://baseshophq.com/signup/cancelled");

    // 1 line item, growth monthly price
    expect(params.line_items.length).toBe(1);
    expect(params.line_items[0].price).toBe("price_growth_m");
    expect(params.line_items[0].quantity).toBe(1);

    // trial 14 days
    expect(params.subscription_data.trial_period_days).toBe(14);

    // 10-key subscription metadata, every key present
    const md = params.subscription_data.metadata;
    expect(md.flow).toBe("new_signup");
    expect(md.agency_name).toBe("JRM");
    expect(md.owner_email).toBe("alice@example.com");
    expect(md.owner_first_name).toBe("Alice");
    expect(md.owner_last_name).toBe("Stone");
    expect(md.time_zone).toBe("America/New_York");
    expect(md.tier).toBe("growth");
    expect(md.interval).toBe("monthly");
    expect(md.white_label).toBe("false");
    expect(md.slug).toBe("jrm");
    // exactly 10 keys
    expect(Object.keys(md).length).toBe(10);

    // session-level metadata.flow
    expect(params.metadata.flow).toBe("new_signup");
  });

  test("growth + annual + WL=true → 2 line items, annual prices, white_label='true'", async () => {
    const state = freshState();
    const out = await RUN(state, baseBody({ tier: "growth", interval: "annual", whiteLabel: true }));
    expect(out.status).toBe(200);
    const params = state.stripeCalls[0].params as {
      line_items: Array<{ price: string }>;
      subscription_data: { metadata: Record<string, string> };
    };
    expect(params.line_items.length).toBe(2);
    expect(params.line_items[0].price).toBe("price_growth_a");
    expect(params.line_items[1].price).toBe("price_wl_a");
    expect(params.subscription_data.metadata.white_label).toBe("true");
    expect(params.subscription_data.metadata.interval).toBe("annual");
  });

  test("pro + monthly + no-WL → uses pro monthly price", async () => {
    const state = freshState();
    const out = await RUN(state, baseBody({ tier: "pro" }));
    expect(out.status).toBe(200);
    const params = state.stripeCalls[0].params as { line_items: Array<{ price: string }> };
    expect(params.line_items[0].price).toBe("price_pro_m");
  });
});

describe("RPC failure", () => {
  test("RPC error → 500 stripe_call_failed", async () => {
    const state = freshState();
    const brokenAdmin: SignupCheckoutAdminLike = {
      async rpc() {
        return { data: null, error: { message: "rpc dead" } };
      },
      from() {
        return {
          select() {
            return {
              async eq() {
                return { data: [], error: null };
              },
            };
          },
        };
      },
    };
    const out = await handleSignupCheckoutRequest({
      admin: brokenAdmin,
      stripe: makeMockStripe(state),
      catalog: CATALOG,
      publicSiteUrl: "https://baseshophq.com",
      body: baseBody(),
    });
    expect(out.status).toBe(500);
    if (out.status === 500) expect(out.body.error_code).toBe("stripe_call_failed");
  });

  test("Stripe SDK throws → 500 stripe_call_failed", async () => {
    const state = freshState();
    const brokenStripe: SignupCheckoutStripeLike = {
      checkout: {
        sessions: {
          async create() {
            throw new Error("stripe is down");
          },
        },
      },
    };
    const out = await handleSignupCheckoutRequest({
      admin: makeMockAdmin(state),
      stripe: brokenStripe,
      catalog: CATALOG,
      publicSiteUrl: "https://baseshophq.com",
      body: baseBody(),
    });
    expect(out.status).toBe(500);
    if (out.status === 500) {
      expect(out.body.error_code).toBe("stripe_call_failed");
      expect(out.body.error_message).toContain("stripe is down");
    }
  });
});
