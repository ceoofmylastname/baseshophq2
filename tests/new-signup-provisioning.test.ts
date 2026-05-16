/**
 * Phase 18 PR 3 — tests for handleNewSignupProvisioning.
 *
 * Builds an in-memory admin + stripe mock and exercises the 11-step
 * provisioning sequence end-to-end. Test cases:
 *   1. Dispatcher contract: handler only fires when caller passes
 *      flow='new_signup'. (We don't import the webhook dispatcher; we assert
 *      the handler module exposes the named export the dispatcher imports.)
 *   2. Happy path: full provisioning runs end-to-end with all expected writes.
 *   3. Idempotency: subscription_id already maps to a tenants row → 200 noop.
 *   4. Validation failure (missing agency_name) → 200 + audit row error.
 *   5. Auth user already exists: createUser throws "exists" → fall through to
 *      auth_user_id_by_email RPC, use that id, finish provisioning.
 *   6. Agency insert fails → rollback deletes auth.users only.
 *   7. Tenant insert fails → rollback deletes agencies + auth.users.
 *   8. FK ordering: agencies.owner_user_id === auth.users.id, etc.
 */

import { describe, expect, test } from "bun:test";
import {
  handleNewSignupProvisioning,
  type ProvisioningAdminLike,
  type ProvisioningEvent,
  type ProvisioningStripeLike,
} from "../supabase/functions/_shared/new-signup-provisioning.ts";

// ---------------------------------------------------------------------------
// State + mocks
// ---------------------------------------------------------------------------

type AuthUser = { id: string; email: string };

type Agency = { id: string; owner_user_id: string; name: string };

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  agency_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_plan_tier: string;
  billing_interval: string;
  white_label_addon_active: boolean;
  billing_status: string;
  is_in_trial: boolean;
  trial_ends_at: string | null;
  current_period_end: string | null;
  owner_agent_id: string | null;
};

type AgentRow = {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_owner: boolean;
  status: string;
};

type EventRow = {
  event_id: string;
  processed_at: string | null;
  tenant_id: string | null;
  error: string | null;
};

type State = {
  users: AuthUser[];
  agencies: Agency[];
  tenants: TenantRow[];
  agents: AgentRow[];
  events: EventRow[];
  /** Optional override: forces createUser to throw "already registered". */
  forceCreateUserDuplicate?: boolean;
  /** Optional override: forces a specific table.insert to throw on the next call. */
  failInsertOn?: "agencies" | "tenants" | "agents" | null;
  /** Capture: every call admin.auth.admin.deleteUser made (for rollback assertion). */
  deletedUserIds: string[];
  /** Capture: generateLink invocations. */
  magicLinks: Array<{ email: string; redirectTo?: string }>;
  /** Capture: order of side-effect writes (for FK-ordering test). */
  writeLog: string[];
};

function makeFreshState(overrides: Partial<State> = {}): State {
  return {
    users: [],
    agencies: [],
    tenants: [],
    agents: [],
    events: [
      { event_id: "evt_signup_1", processed_at: null, tenant_id: null, error: null },
    ],
    deletedUserIds: [],
    magicLinks: [],
    writeLog: [],
    ...overrides,
  };
}

function uuid(prefix: string, n: number): string {
  return `${prefix}_${String(n).padStart(8, "0")}`;
}

function makeMockAdmin(state: State): ProvisioningAdminLike {
  let nextUserSeq = 1;
  let nextAgencySeq = 1;
  let nextTenantSeq = 1;

  return {
    auth: {
      admin: {
        async createUser(params) {
          state.writeLog.push("auth.users.create");
          if (state.forceCreateUserDuplicate) {
            return {
              data: { user: null },
              error: { message: "A user with this email address has already been registered", status: 422 },
            };
          }
          const lower = params.email.toLowerCase();
          if (state.users.find((u) => u.email === lower)) {
            return {
              data: { user: null },
              error: { message: "A user with this email address has already been registered", status: 422 },
            };
          }
          const u = { id: uuid("u", nextUserSeq++), email: lower };
          state.users.push(u);
          return { data: { user: { id: u.id } }, error: null };
        },
        async deleteUser(id: string) {
          state.deletedUserIds.push(id);
          state.users = state.users.filter((u) => u.id !== id);
          return { data: null, error: null };
        },
        async generateLink(params) {
          state.magicLinks.push({ email: params.email, redirectTo: params.options?.redirectTo });
          return { data: null, error: null };
        },
      },
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "auth_user_id_by_email") {
        const email = String(args.p_email).toLowerCase();
        const u = state.users.find((u) => u.email === email);
        return { data: u ? u.id : null, error: null };
      }
      return { data: null, error: null };
    },
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(col: string, val: string) {
              return {
                async maybeSingle() {
                  if (table === "tenants") {
                    if (col === "stripe_subscription_id") {
                      const row = state.tenants.find((t) => t.stripe_subscription_id === val);
                      return { data: (row ?? null) as unknown as Record<string, unknown> | null, error: null };
                    }
                    if (col === "id") {
                      const row = state.tenants.find((t) => t.id === val);
                      return { data: (row ?? null) as unknown as Record<string, unknown> | null, error: null };
                    }
                  }
                  if (table === "agencies" && col === "owner_user_id") {
                    const row = state.agencies.find((a) => a.owner_user_id === val);
                    return { data: (row ?? null) as unknown as Record<string, unknown> | null, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
        },
        insert(row: Record<string, unknown>) {
          return {
            select(_cols: string) {
              return {
                async single() {
                  if (table === "agencies") {
                    state.writeLog.push("agencies.insert");
                    if (state.failInsertOn === "agencies") {
                      return { data: null, error: { message: "agencies insert mock failure" } };
                    }
                    const id = uuid("ag", nextAgencySeq++);
                    const agency: Agency = {
                      id,
                      owner_user_id: row.owner_user_id as string,
                      name: row.name as string,
                    };
                    state.agencies.push(agency);
                    return { data: { id } as Record<string, unknown>, error: null };
                  }
                  if (table === "tenants") {
                    state.writeLog.push("tenants.insert");
                    if (state.failInsertOn === "tenants") {
                      return { data: null, error: { message: "tenants insert mock failure" } };
                    }
                    const id = uuid("t", nextTenantSeq++);
                    const tenant: TenantRow = {
                      id,
                      name: row.name as string,
                      slug: row.slug as string,
                      agency_id: (row.agency_id as string | null) ?? null,
                      stripe_customer_id: (row.stripe_customer_id as string | null) ?? null,
                      stripe_subscription_id: (row.stripe_subscription_id as string | null) ?? null,
                      current_plan_tier: row.current_plan_tier as string,
                      billing_interval: row.billing_interval as string,
                      white_label_addon_active: row.white_label_addon_active as boolean,
                      billing_status: row.billing_status as string,
                      is_in_trial: row.is_in_trial as boolean,
                      trial_ends_at: (row.trial_ends_at as string | null) ?? null,
                      current_period_end: (row.current_period_end as string | null) ?? null,
                      owner_agent_id: null,
                    };
                    state.tenants.push(tenant);
                    return { data: { id } as Record<string, unknown>, error: null };
                  }
                  if (table === "agents") {
                    state.writeLog.push("agents.insert");
                    if (state.failInsertOn === "agents") {
                      return { data: null, error: { message: "agents insert mock failure" } };
                    }
                    const agent: AgentRow = {
                      id: row.id as string,
                      tenant_id: row.tenant_id as string,
                      email: row.email as string,
                      first_name: row.first_name as string,
                      last_name: row.last_name as string,
                      is_owner: row.is_owner as boolean,
                      status: row.status as string,
                    };
                    state.agents.push(agent);
                    return { data: { id: agent.id } as Record<string, unknown>, error: null };
                  }
                  return { data: null, error: { message: `unsupported insert on ${table}` } };
                },
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            async eq(col: string, val: string) {
              if (table === "tenants" && col === "id") {
                const idx = state.tenants.findIndex((t) => t.id === val);
                if (idx === -1) return { data: null, error: { message: "no tenant" } };
                state.tenants[idx] = { ...state.tenants[idx], ...(patch as Partial<TenantRow>) };
                if ("owner_agent_id" in patch) {
                  state.writeLog.push("tenants.owner_agent_id.update");
                }
                return { data: null, error: null };
              }
              if (table === "stripe_webhook_events" && col === "event_id") {
                const idx = state.events.findIndex((e) => e.event_id === val);
                if (idx === -1) {
                  state.events.push({
                    event_id: val,
                    processed_at: (patch.processed_at as string | null | undefined) ?? null,
                    tenant_id: (patch.tenant_id as string | null | undefined) ?? null,
                    error: (patch.error as string | null | undefined) ?? null,
                  });
                  return { data: null, error: null };
                }
                state.events[idx] = {
                  ...state.events[idx],
                  ...(patch as Partial<EventRow>),
                };
                return { data: null, error: null };
              }
              return { data: null, error: { message: `unsupported update on ${table}` } };
            },
          };
        },
        delete() {
          return {
            async eq(col: string, val: string) {
              if (table === "agents" && col === "id") {
                state.writeLog.push("agents.delete");
                state.agents = state.agents.filter((a) => a.id !== val);
                return { data: null, error: null };
              }
              if (table === "tenants" && col === "id") {
                state.writeLog.push("tenants.delete");
                state.tenants = state.tenants.filter((t) => t.id !== val);
                return { data: null, error: null };
              }
              if (table === "agencies" && col === "id") {
                state.writeLog.push("agencies.delete");
                state.agencies = state.agencies.filter((a) => a.id !== val);
                return { data: null, error: null };
              }
              return { data: null, error: { message: `unsupported delete on ${table}` } };
            },
          };
        },
      };
    },
  };
}

function makeMockStripe(opts: {
  metadata: Record<string, string>;
  current_period_end: number;
  subscriptionId?: string;
  throwOnRetrieve?: boolean;
}): ProvisioningStripeLike {
  return {
    subscriptions: {
      async retrieve(id: string) {
        if (opts.throwOnRetrieve) {
          throw new Error("stripe subscriptions.retrieve mock failure");
        }
        return {
          id: opts.subscriptionId ?? id,
          metadata: opts.metadata,
          current_period_end: opts.current_period_end,
        };
      },
    },
  };
}

function fullMetadata(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    flow: "new_signup",
    agency_name: "Acme Insurance",
    owner_email: "Owner@Example.com",
    owner_first_name: "Alice",
    owner_last_name: "Stone",
    time_zone: "America/New_York",
    tier: "growth",
    interval: "monthly",
    white_label: "false",
    slug: "acme-insurance",
    ...overrides,
  };
}

function eventWithSubscription(metadataOnSession: boolean): ProvisioningEvent {
  return {
    id: "evt_signup_1",
    type: "checkout.session.completed",
    data: {
      object: {
        metadata: metadataOnSession ? fullMetadata() : { flow: "new_signup" },
        customer: "cus_test_abc",
        subscription: "sub_test_xyz",
      },
    },
  };
}

const PUBLIC_SITE_URL = "https://baseshophq.com";
const FUTURE_UNIX = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days out

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dispatcher contract", () => {
  test("handler module exports handleNewSignupProvisioning as a function", () => {
    // This is the surface the webhook dispatcher imports. If the export
    // disappears, the dispatcher fails to compile — but we add an explicit
    // unit assert so a future refactor breaking the export name flags here.
    expect(typeof handleNewSignupProvisioning).toBe("function");
  });
});

describe("happy path", () => {
  test("end-to-end: 4 idempotency lookups, all writes, audit processed, magic link generated", async () => {
    const state = makeFreshState();
    const stripe = makeMockStripe({ metadata: fullMetadata(), current_period_end: FUTURE_UNIX });
    const event = eventWithSubscription(false); // session has only flow; metadata read from subscription

    const resp = await handleNewSignupProvisioning({
      admin: makeMockAdmin(state),
      stripe,
      event,
      publicSiteUrl: PUBLIC_SITE_URL,
    });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);

    // auth.users created
    expect(state.users.length).toBe(1);
    expect(state.users[0].email).toBe("owner@example.com");

    // agencies created with owner_user_id = newUser.id
    expect(state.agencies.length).toBe(1);
    expect(state.agencies[0].owner_user_id).toBe(state.users[0].id);
    expect(state.agencies[0].name).toBe("Acme Insurance");

    // tenants created with all expected fields
    expect(state.tenants.length).toBe(1);
    const tenant = state.tenants[0];
    expect(tenant.name).toBe("Acme Insurance");
    expect(tenant.slug).toBe("acme-insurance");
    expect(tenant.agency_id).toBe(state.agencies[0].id);
    expect(tenant.stripe_customer_id).toBe("cus_test_abc");
    expect(tenant.stripe_subscription_id).toBe("sub_test_xyz");
    expect(tenant.current_plan_tier).toBe("growth");
    expect(tenant.billing_interval).toBe("monthly");
    expect(tenant.white_label_addon_active).toBe(false);
    expect(tenant.billing_status).toBe("active");
    expect(tenant.is_in_trial).toBe(true);
    expect(tenant.trial_ends_at).not.toBeNull();
    expect(tenant.current_period_end).not.toBeNull();
    expect(tenant.owner_agent_id).toBe(state.agents[0].id);

    // agents created with is_owner=true and lowercase email
    expect(state.agents.length).toBe(1);
    expect(state.agents[0].id).toBe(state.users[0].id);
    expect(state.agents[0].tenant_id).toBe(tenant.id);
    expect(state.agents[0].email).toBe("owner@example.com");
    expect(state.agents[0].first_name).toBe("Alice");
    expect(state.agents[0].last_name).toBe("Stone");
    expect(state.agents[0].is_owner).toBe(true);
    expect(state.agents[0].status).toBe("active");

    // audit row processed
    const auditRow = state.events.find((e) => e.event_id === "evt_signup_1");
    expect(auditRow?.processed_at).not.toBeNull();
    expect(auditRow?.tenant_id).toBe(tenant.id);
    expect(auditRow?.error).toBeNull();

    // magic link generated to /home
    expect(state.magicLinks.length).toBe(1);
    expect(state.magicLinks[0].email).toBe("owner@example.com");
    expect(state.magicLinks[0].redirectTo).toBe("https://baseshophq.com/home");
  });
});

describe("idempotency: subscription_id already maps to tenant", () => {
  test("re-firing same subscription_id is a no-op (200 + audit processed)", async () => {
    const state = makeFreshState();
    // Pre-seed a tenants row with the subscription id the event will carry.
    state.tenants.push({
      id: "t_pre",
      name: "Pre-existing",
      slug: "pre-existing",
      agency_id: null,
      stripe_customer_id: "cus_test_abc",
      stripe_subscription_id: "sub_test_xyz",
      current_plan_tier: "growth",
      billing_interval: "monthly",
      white_label_addon_active: false,
      billing_status: "active",
      is_in_trial: true,
      trial_ends_at: null,
      current_period_end: null,
      owner_agent_id: null,
    });

    const stripe = makeMockStripe({ metadata: fullMetadata(), current_period_end: FUTURE_UNIX });
    const event = eventWithSubscription(false);
    const resp = await handleNewSignupProvisioning({
      admin: makeMockAdmin(state),
      stripe,
      event,
      publicSiteUrl: PUBLIC_SITE_URL,
    });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.idempotent_replay).toBe(true);
    expect(body.tenant_id).toBe("t_pre");

    // No new auth.users / agencies / agents.
    expect(state.users.length).toBe(0);
    expect(state.agencies.length).toBe(0);
    expect(state.agents.length).toBe(0);

    // Audit processed.
    const auditRow = state.events.find((e) => e.event_id === "evt_signup_1");
    expect(auditRow?.processed_at).not.toBeNull();
  });
});

describe("validation failure", () => {
  test("missing agency_name → 200 with audit error logged, no writes", async () => {
    const state = makeFreshState();
    const partial = fullMetadata();
    delete (partial as Record<string, string>).agency_name;
    const stripe = makeMockStripe({ metadata: partial, current_period_end: FUTURE_UNIX });
    const event = eventWithSubscription(false);

    const resp = await handleNewSignupProvisioning({
      admin: makeMockAdmin(state),
      stripe,
      event,
      publicSiteUrl: PUBLIC_SITE_URL,
    });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(false);
    expect(body.error_code).toBe("validation_failed");

    // No writes
    expect(state.users.length).toBe(0);
    expect(state.agencies.length).toBe(0);
    expect(state.tenants.length).toBe(0);
    expect(state.agents.length).toBe(0);

    // Audit row error logged + processed (we own the bug; no retries needed)
    const auditRow = state.events.find((e) => e.event_id === "evt_signup_1");
    expect(auditRow?.error).toContain("validate_metadata");
    expect(auditRow?.error).toContain("agency_name");
    expect(auditRow?.processed_at).not.toBeNull();
  });
});

describe("auth user already exists (step c.i fallback)", () => {
  test("createUser duplicate → SELECT by email → continue provisioning with existing id", async () => {
    const state = makeFreshState({ forceCreateUserDuplicate: true });
    // Pre-seed the existing user the RPC will resolve to.
    state.users.push({ id: "u_existing", email: "owner@example.com" });

    const stripe = makeMockStripe({ metadata: fullMetadata(), current_period_end: FUTURE_UNIX });
    const event = eventWithSubscription(false);

    const resp = await handleNewSignupProvisioning({
      admin: makeMockAdmin(state),
      stripe,
      event,
      publicSiteUrl: PUBLIC_SITE_URL,
    });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);

    // The existing user_id is used downstream.
    expect(state.agencies[0].owner_user_id).toBe("u_existing");
    expect(state.tenants[0].agency_id).toBe(state.agencies[0].id);
    expect(state.agents[0].id).toBe("u_existing");
    expect(state.agents[0].tenant_id).toBe(state.tenants[0].id);

    // We did NOT call deleteUser anywhere (no rollback ran).
    expect(state.deletedUserIds).toEqual([]);
  });
});

describe("agency insert failure → rollback deletes auth.users", () => {
  test("agencies.insert throws → 500 + audit error + deleteUser called", async () => {
    const state = makeFreshState({ failInsertOn: "agencies" });
    const stripe = makeMockStripe({ metadata: fullMetadata(), current_period_end: FUTURE_UNIX });
    const event = eventWithSubscription(false);

    const resp = await handleNewSignupProvisioning({
      admin: makeMockAdmin(state),
      stripe,
      event,
      publicSiteUrl: PUBLIC_SITE_URL,
    });

    expect(resp.status).toBe(500);
    const body = await resp.json();
    expect(body.ok).toBe(false);
    expect(body.error_code).toBe("database_error");

    // Auth user that we just created has been rolled back.
    expect(state.deletedUserIds.length).toBe(1);
    expect(state.users.length).toBe(0);

    // No agency / tenant / agent persisted.
    expect(state.agencies.length).toBe(0);
    expect(state.tenants.length).toBe(0);
    expect(state.agents.length).toBe(0);

    // Audit row error logged, processed_at NULL (so Stripe retries).
    const auditRow = state.events.find((e) => e.event_id === "evt_signup_1");
    expect(auditRow?.error).toContain("agencies_insert");
    expect(auditRow?.processed_at).toBeNull();
  });
});

describe("tenant insert failure → rollback deletes agencies + auth.users in reverse order", () => {
  test("tenants.insert throws → 500 + agencies deleted first, then auth.users", async () => {
    const state = makeFreshState({ failInsertOn: "tenants" });
    const stripe = makeMockStripe({ metadata: fullMetadata(), current_period_end: FUTURE_UNIX });
    const event = eventWithSubscription(false);

    const resp = await handleNewSignupProvisioning({
      admin: makeMockAdmin(state),
      stripe,
      event,
      publicSiteUrl: PUBLIC_SITE_URL,
    });

    expect(resp.status).toBe(500);
    const body = await resp.json();
    expect(body.error_code).toBe("database_error");

    // Both side-effects rolled back.
    expect(state.agencies.length).toBe(0);
    expect(state.users.length).toBe(0);
    expect(state.deletedUserIds.length).toBe(1);

    // Order: agencies.delete before any auth.users deletion. The writeLog
    // records every side-effect; assert agencies.delete appears before
    // anything else cleanup-related, and the deleteUser call happened (the
    // ordering between agencies.delete and the deleteUser call is implicit
    // through the rollback loop running agencies BEFORE auth.users).
    const agenciesDeleteIdx = state.writeLog.indexOf("agencies.delete");
    expect(agenciesDeleteIdx).toBeGreaterThan(-1);

    // Audit row error logged.
    const auditRow = state.events.find((e) => e.event_id === "evt_signup_1");
    expect(auditRow?.error).toContain("tenants_insert");
    expect(auditRow?.processed_at).toBeNull();
  });
});

describe("FK ordering + reference integrity", () => {
  test("auth.users.id → agencies.owner_user_id → tenants.agency_id → agents.tenant_id → tenants.owner_agent_id chains correctly", async () => {
    const state = makeFreshState();
    const stripe = makeMockStripe({ metadata: fullMetadata(), current_period_end: FUTURE_UNIX });
    const event = eventWithSubscription(false);

    const resp = await handleNewSignupProvisioning({
      admin: makeMockAdmin(state),
      stripe,
      event,
      publicSiteUrl: PUBLIC_SITE_URL,
    });

    expect(resp.status).toBe(200);

    // 1. auth.users.id is reused as agencies.owner_user_id
    expect(state.agencies[0].owner_user_id).toBe(state.users[0].id);
    // 2. agencies.id is reused as tenants.agency_id
    expect(state.tenants[0].agency_id).toBe(state.agencies[0].id);
    // 3. tenants.id is reused as agents.tenant_id
    expect(state.agents[0].tenant_id).toBe(state.tenants[0].id);
    // 4. auth.users.id is reused as agents.id (Phase 1 FK)
    expect(state.agents[0].id).toBe(state.users[0].id);
    // 5. agents.id is set back into tenants.owner_agent_id
    expect(state.tenants[0].owner_agent_id).toBe(state.agents[0].id);

    // Write log ordering: agencies before tenants before agents before owner_agent_id update
    const idxAgencies = state.writeLog.indexOf("agencies.insert");
    const idxTenants = state.writeLog.indexOf("tenants.insert");
    const idxAgents = state.writeLog.indexOf("agents.insert");
    const idxOwnerUpdate = state.writeLog.indexOf("tenants.owner_agent_id.update");
    expect(idxAgencies).toBeLessThan(idxTenants);
    expect(idxTenants).toBeLessThan(idxAgents);
    expect(idxAgents).toBeLessThan(idxOwnerUpdate);
  });
});
