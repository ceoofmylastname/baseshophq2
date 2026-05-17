/**
 * Phase 18 PR 3 — new-signup provisioning handler.
 *
 * Called by the stripe-webhook dispatcher on checkout.session.completed when
 * the session's `metadata.flow === 'new_signup'`. Performs the 11-step
 * provisioning sequence:
 *
 *   a. Read 10-key metadata from session OR retrieve subscription
 *   b. Validate metadata shape
 *   c. Idempotency check at each step (auth.users, agencies, tenants, agents)
 *   d. Create auth.users (with retry-on-exists fallback to SELECT)
 *   e. Create agencies row
 *   f. Create tenants row (13 columns; agent_cap auto-synced by trigger)
 *   g. Create agents row (owner; 7 columns)
 *   h. Set tenants.owner_agent_id = newAgent.id
 *   i. Send magic link via SMTP (POST /auth/v1/magiclink; redirect_to /home)
 *   j. Mark audit row processed
 *   k. Structured success log
 *
 * Failure handling (locked D7 + Phase 18.3 override on step i):
 *   - Validation failure (step b): UPDATE error + processed_at; return 200
 *     (NOT 500 — Stripe retries are wasteful on our own validation bug).
 *   - Idempotency short-circuit (tenants by stripe_subscription_id): mark
 *     processed, return 200 without rollback.
 *   - Any step d-h throw: UPDATE error with chain-of-failures summary, run
 *     rollback (strict reverse order: agents → tenants.owner_agent_id NULL →
 *     tenants → agencies → auth.users LAST), return 500 (processed_at stays
 *     NULL so Stripe retries).
 *   - Step i (magic-link send) failure: log + UPDATE error + return 500 so
 *     Stripe retries. NO rollback — the customer paid, all rows stay. Recovery
 *     is the Stripe redelivery or a manual resend from Supabase Dashboard.
 *
 * Returns a full Response object so the dispatcher can pass it through.
 *
 * Pure module (no Deno imports). The webhook wrapper injects the real admin +
 * stripe clients + magic-link sender; tests inject mocks.
 */

// ---------------------------------------------------------------------------
// Mockable client surfaces
// ---------------------------------------------------------------------------

/** Subset of supabase-js admin we exercise. */
export type ProvisioningAdminLike = {
  auth: {
    admin: {
      createUser: (params: { email: string; email_confirm: boolean }) => Promise<{
        data: { user: { id: string } | null };
        error: { message: string; status?: number } | null;
      }>;
      deleteUser: (id: string) => Promise<{
        data: unknown;
        error: { message: string } | null;
      }>;
    };
  };
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => {
        single: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{
        data: unknown;
        error: { message: string } | null;
      }>;
    };
    delete: () => {
      eq: (col: string, val: string) => Promise<{
        data: unknown;
        error: { message: string } | null;
      }>;
    };
  };
  /** Used to SELECT auth.users by lowercase(email). Implemented in real client
   *  via a SECURITY DEFINER RPC; tests mock the same signature. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

/** Subset of the Stripe SDK we exercise. */
export type ProvisioningStripeLike = {
  subscriptions: {
    retrieve: (id: string) => Promise<{
      id: string;
      metadata: Record<string, string>;
      current_period_end: number;
    }>;
  };
};

/**
 * Sends a magic link via the Supabase Auth `POST /auth/v1/magiclink` endpoint,
 * which routes through the project's Custom SMTP config (Resend in prod).
 * Returns `{ok:true}` on 2xx, `{ok:false,...}` on any non-2xx or network error.
 *
 * The pure helper does not import Deno; the webhook wrapper injects a
 * fetch-based implementation, tests inject a capture mock.
 */
export type MagicLinkSender = (params: {
  email: string;
  redirect_to: string;
}) => Promise<{ ok: true } | { ok: false; status?: number; error: string }>;

/** Minimal Stripe event shape we read. */
export type ProvisioningEvent = {
  id: string;
  type: string;
  data: {
    object: {
      metadata?: Record<string, string> | null;
      customer?: string | null;
      subscription?: string | null;
    };
  };
};

// ---------------------------------------------------------------------------
// Metadata + validation
// ---------------------------------------------------------------------------

const REQUIRED_KEYS = [
  "flow",
  "agency_name",
  "owner_email",
  "owner_first_name",
  "owner_last_name",
  "time_zone",
  "tier",
  "interval",
  "white_label",
  "slug",
] as const;

const VALID_TIERS = new Set(["starter", "growth", "pro"]);
const VALID_INTERVALS = new Set(["monthly", "annual"]);
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ValidatedMetadata = {
  flow: string;
  agency_name: string;
  owner_email: string;
  owner_first_name: string;
  owner_last_name: string;
  time_zone: string;
  tier: "starter" | "growth" | "pro";
  interval: "monthly" | "annual";
  white_label: boolean;
  slug: string;
};

function validateMetadata(raw: Record<string, string>): { ok: true; value: ValidatedMetadata } | { ok: false; reason: string } {
  for (const key of REQUIRED_KEYS) {
    if (typeof raw[key] !== "string" || raw[key].length === 0) {
      return { ok: false, reason: `missing or empty key: ${key}` };
    }
  }
  if (!VALID_TIERS.has(raw.tier)) {
    return { ok: false, reason: `invalid tier: ${raw.tier}` };
  }
  if (!VALID_INTERVALS.has(raw.interval)) {
    return { ok: false, reason: `invalid interval: ${raw.interval}` };
  }
  if (raw.white_label !== "true" && raw.white_label !== "false") {
    return { ok: false, reason: `invalid white_label (must be 'true'|'false'): ${raw.white_label}` };
  }
  if (!SLUG_RE.test(raw.slug)) {
    return { ok: false, reason: `invalid slug format: ${raw.slug}` };
  }
  if (!EMAIL_RE.test(raw.owner_email)) {
    return { ok: false, reason: `invalid owner_email format: ${raw.owner_email}` };
  }
  return {
    ok: true,
    value: {
      flow: raw.flow,
      agency_name: raw.agency_name,
      owner_email: raw.owner_email,
      owner_first_name: raw.owner_first_name,
      owner_last_name: raw.owner_last_name,
      time_zone: raw.time_zone,
      tier: raw.tier as "starter" | "growth" | "pro",
      interval: raw.interval as "monthly" | "annual",
      white_label: raw.white_label === "true",
      slug: raw.slug,
    },
  };
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonResp(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Audit helpers (inlined, do not depend on payment-handlers shape)
// ---------------------------------------------------------------------------

async function writeAuditError(
  admin: ProvisioningAdminLike,
  eventId: string,
  error: string,
  options: { markProcessed: boolean; tenantId?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = { error };
  if (options.markProcessed) {
    patch.processed_at = new Date().toISOString();
  }
  if (options.tenantId !== undefined && options.tenantId !== null) {
    patch.tenant_id = options.tenantId;
  }
  try {
    await admin.from("stripe_webhook_events").update(patch).eq("event_id", eventId);
  } catch (e) {
    // Best-effort; surface in logs only. The state mutation result is more
    // important than the audit row's metadata.
    console.error("writeAuditError swallowed:", e instanceof Error ? e.message : String(e));
  }
}

async function markAuditProcessed(
  admin: ProvisioningAdminLike,
  eventId: string,
  tenantId: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { processed_at: new Date().toISOString() };
  if (tenantId !== null) patch.tenant_id = tenantId;
  try {
    await admin.from("stripe_webhook_events").update(patch).eq("event_id", eventId);
  } catch (e) {
    console.error("markAuditProcessed swallowed:", e instanceof Error ? e.message : String(e));
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export type ProvisioningArgs = {
  admin: ProvisioningAdminLike;
  stripe: ProvisioningStripeLike;
  event: ProvisioningEvent;
  publicSiteUrl: string;
  magicLinkSender: MagicLinkSender;
};

export async function handleNewSignupProvisioning(args: ProvisioningArgs): Promise<Response> {
  const { admin, stripe, event, publicSiteUrl, magicLinkSender } = args;
  const session = event.data.object;

  // -------------------------------------------------------------------------
  // Step a: read metadata. Try session-level first; fall back to retrieving
  // the subscription (PR 2 writes the canonical 10-key metadata into
  // subscription_data.metadata). The retrieved subscription is CACHED in a
  // local variable so step (f) re-uses it for current_period_end — one Stripe
  // round-trip serves both purposes.
  // -------------------------------------------------------------------------
  let retrievedSub: { id: string; metadata: Record<string, string>; current_period_end: number } | null = null;

  const sessionMetadata = (session.metadata ?? {}) as Record<string, string>;
  const hasAllKeysOnSession = REQUIRED_KEYS.every(
    (k) => typeof sessionMetadata[k] === "string" && sessionMetadata[k].length > 0,
  );

  let rawMetadata: Record<string, string>;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;

  if (hasAllKeysOnSession) {
    rawMetadata = sessionMetadata;
    // We still need current_period_end and a stable subscription_id for step
    // (f) below. Retrieve unconditionally.
    if (!subscriptionId) {
      await writeAuditError(admin, event.id, "original: read_metadata: session.subscription missing", { markProcessed: true });
      return jsonResp(200, { ok: false, error_code: "validation_failed", error_message: "session.subscription is required" });
    }
    try {
      retrievedSub = await stripe.subscriptions.retrieve(subscriptionId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await writeAuditError(admin, event.id, `original: stripe_subscription_retrieve: ${msg}`, { markProcessed: false });
      return jsonResp(500, { ok: false, error_code: "stripe_call_failed", error_message: msg });
    }
  } else {
    if (!subscriptionId) {
      await writeAuditError(admin, event.id, "original: read_metadata: session.subscription missing", { markProcessed: true });
      return jsonResp(200, { ok: false, error_code: "validation_failed", error_message: "session.subscription is required" });
    }
    try {
      retrievedSub = await stripe.subscriptions.retrieve(subscriptionId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await writeAuditError(admin, event.id, `original: stripe_subscription_retrieve: ${msg}`, { markProcessed: false });
      return jsonResp(500, { ok: false, error_code: "stripe_call_failed", error_message: msg });
    }
    rawMetadata = (retrievedSub.metadata ?? {}) as Record<string, string>;
  }

  // -------------------------------------------------------------------------
  // Step b: validate metadata. On failure: mark processed + error, return 200
  // (NOT 500 — Stripe retries on our own bug would be wasteful; the operator
  // reads the `error` column to resolve manually).
  // -------------------------------------------------------------------------
  const validated = validateMetadata(rawMetadata);
  if (!validated.ok) {
    await writeAuditError(admin, event.id, `original: validate_metadata: ${validated.reason}`, { markProcessed: true });
    return jsonResp(200, {
      ok: false,
      error_code: "validation_failed",
      error_message: validated.reason,
    });
  }
  const md = validated.value;
  const lowerEmail = md.owner_email.toLowerCase();

  // -------------------------------------------------------------------------
  // Step c (idempotency): tenants by stripe_subscription_id. If exists, this
  // is a full retry of a completed provisioning — return 200 and mark
  // processed if not already.
  // -------------------------------------------------------------------------
  const subId = retrievedSub.id;
  const customerId = typeof session.customer === "string" ? session.customer : "";

  {
    const { data: existingTenant, error: tenantLookupErr } = await admin
      .from("tenants")
      .select("id")
      .eq("stripe_subscription_id", subId)
      .maybeSingle();
    if (tenantLookupErr) {
      await writeAuditError(admin, event.id, `original: tenants_lookup: ${tenantLookupErr.message}`, { markProcessed: false });
      return jsonResp(500, { ok: false, error_code: "database_error", error_message: tenantLookupErr.message });
    }
    if (existingTenant?.id) {
      // Already provisioned. Stamp audit if not already and return 200.
      await markAuditProcessed(admin, event.id, existingTenant.id as string);
      console.log(JSON.stringify({
        msg: "phase18_new_signup_idempotent_replay",
        event_id: event.id,
        tenant_id: existingTenant.id,
      }));
      return jsonResp(200, { ok: true, idempotent_replay: true, tenant_id: existingTenant.id });
    }
  }

  // Track what got created so rollback can target exactly those rows.
  let createdUserId: string | null = null;
  let userCreatedByUs = false; // distinguishes step-d create from step-c.i resolve
  let createdAgencyId: string | null = null;
  let agencyOwnedByUs = false; // true only when step e INSERTED (not when idempotency resolved)
  let createdTenantId: string | null = null;
  let createdAgentId: string | null = null;
  let agentOwnedByUs = false; // true only when step g INSERTED (not when idempotency resolved)
  let tenantOwnerAgentIdSet = false;

  // Stage label for chain-logging — set immediately before each side-effect.
  let currentStep = "init";

  const runRollback = async (originalErrorLine: string): Promise<string> => {
    const cleanupResults: string[] = [];

    // 1. Delete agents row (if step g INSERTED — not if it resolved to an
    // existing agent via idempotency).
    if (createdAgentId !== null && agentOwnedByUs) {
      try {
        const { error } = await admin.from("agents").delete().eq("id", createdAgentId);
        cleanupResults.push(`agents_delete=${error ? `failed: ${error.message}` : "ok"}`);
      } catch (e) {
        cleanupResults.push(`agents_delete=failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 2. Unset tenants.owner_agent_id (if step h succeeded).
    if (tenantOwnerAgentIdSet && createdTenantId !== null) {
      try {
        const { error } = await admin
          .from("tenants")
          .update({ owner_agent_id: null })
          .eq("id", createdTenantId);
        cleanupResults.push(`tenants_owner_unset=${error ? `failed: ${error.message}` : "ok"}`);
      } catch (e) {
        cleanupResults.push(`tenants_owner_unset=failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 3. Delete tenants row (if step f succeeded).
    if (createdTenantId !== null) {
      try {
        const { error } = await admin.from("tenants").delete().eq("id", createdTenantId);
        cleanupResults.push(`tenants_delete=${error ? `failed: ${error.message}` : "ok"}`);
      } catch (e) {
        cleanupResults.push(`tenants_delete=failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 4. Delete agencies row (if step e INSERTED — not if it resolved an
    // existing agency via idempotency).
    if (createdAgencyId !== null && agencyOwnedByUs) {
      try {
        const { error } = await admin.from("agencies").delete().eq("id", createdAgencyId);
        cleanupResults.push(`agencies_delete=${error ? `failed: ${error.message}` : "ok"}`);
      } catch (e) {
        cleanupResults.push(`agencies_delete=failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 5. Delete the auth.users row LAST (only if step d created it — never if
    // step d resolved to an existing user via idempotency fallback).
    if (createdUserId !== null && userCreatedByUs) {
      try {
        const { error } = await admin.auth.admin.deleteUser(createdUserId);
        cleanupResults.push(`auth_user_delete=${error ? `failed: ${error.message}` : "ok"}`);
      } catch (e) {
        cleanupResults.push(`auth_user_delete=failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const anyFailed = cleanupResults.some((r) => r.includes("failed:"));
    if (!anyFailed || cleanupResults.length === 0) {
      return originalErrorLine;
    }
    return `${originalErrorLine}\nrollback: ${cleanupResults.join("; ")}`;
  };

  // -------------------------------------------------------------------------
  // Step d: create auth.users. On duplicate-email error, fall through to
  // SELECT by LOWER(email) and use the existing user_id.
  // -------------------------------------------------------------------------
  currentStep = "auth_user_create";
  try {
    const { data, error } = await admin.auth.admin.createUser({
      email: lowerEmail,
      email_confirm: true,
    });
    if (error) {
      const msg = error.message ?? "";
      const isDuplicate = /already (been )?registered|exists|duplicate/i.test(msg);
      if (!isDuplicate) {
        throw new Error(`auth.users.create failed: ${msg}`);
      }
      // Idempotency fallback (c.i): SELECT auth.users by LOWER(email).
      const { data: existing, error: rpcErr } = await admin.rpc("auth_user_id_by_email", { p_email: lowerEmail });
      if (rpcErr) {
        throw new Error(`auth_user_id_by_email rpc failed after duplicate error: ${rpcErr.message}`);
      }
      if (typeof existing !== "string" || existing.length === 0) {
        throw new Error(`auth.users.create reported duplicate but lookup returned no id`);
      }
      createdUserId = existing;
      userCreatedByUs = false;
    } else if (data.user?.id) {
      createdUserId = data.user.id;
      userCreatedByUs = true;
    } else {
      throw new Error("auth.users.create returned no user.id");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const errorLine = `original: ${currentStep}: ${msg}`;
    const finalError = await runRollback(errorLine);
    await writeAuditError(admin, event.id, finalError, { markProcessed: false });
    return jsonResp(500, { ok: false, error_code: "database_error", error_message: msg });
  }
  const userId = createdUserId!;

  // -------------------------------------------------------------------------
  // Step e: create agencies row. Idempotency check (c.ii): SELECT by
  // owner_user_id; if exists, re-use it instead of inserting.
  // -------------------------------------------------------------------------
  currentStep = "agencies_insert";
  try {
    const { data: existingAgency, error: agencyLookupErr } = await admin
      .from("agencies")
      .select("id")
      .eq("owner_user_id", userId)
      .maybeSingle();
    if (agencyLookupErr) {
      throw new Error(`agencies lookup by owner_user_id failed: ${agencyLookupErr.message}`);
    }
    if (existingAgency?.id) {
      createdAgencyId = existingAgency.id as string;
      agencyOwnedByUs = false; // we did NOT create it; rollback must not delete it.
    } else {
      const { data: newAgency, error: agencyInsertErr } = await admin
        .from("agencies")
        .insert({ owner_user_id: userId, name: md.agency_name })
        .select("id")
        .single();
      if (agencyInsertErr) {
        throw new Error(`agencies insert failed: ${agencyInsertErr.message}`);
      }
      if (!newAgency?.id) {
        throw new Error("agencies insert returned no id");
      }
      createdAgencyId = newAgency.id as string;
      agencyOwnedByUs = true;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const errorLine = `original: ${currentStep}: ${msg}`;
    const finalError = await runRollback(errorLine);
    await writeAuditError(admin, event.id, finalError, { markProcessed: false });
    return jsonResp(500, { ok: false, error_code: "database_error", error_message: msg });
  }
  const agencyId = createdAgencyId!;

  // -------------------------------------------------------------------------
  // Step f: create tenants row. The Phase 17 trigger sets agent_cap from
  // current_plan_tier automatically; do NOT pass agent_cap.
  // -------------------------------------------------------------------------
  currentStep = "tenants_insert";
  try {
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const currentPeriodEnd = new Date(retrievedSub.current_period_end * 1000).toISOString();
    const isInTrial = md.tier !== ("enterprise" as unknown as string); // defensive — PR 2 already rejects enterprise

    const { data: newTenant, error: tenantInsertErr } = await admin
      .from("tenants")
      .insert({
        name: md.agency_name,
        slug: md.slug,
        agency_id: agencyId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subId,
        current_plan_tier: md.tier,
        billing_interval: md.interval,
        white_label_addon_active: md.white_label,
        billing_status: "active",
        is_in_trial: isInTrial,
        trial_ends_at: isInTrial ? trialEndsAt : null,
        current_period_end: currentPeriodEnd,
      })
      .select("id")
      .single();
    if (tenantInsertErr) {
      throw new Error(`tenants insert failed: ${tenantInsertErr.message}`);
    }
    if (!newTenant?.id) {
      throw new Error("tenants insert returned no id");
    }
    createdTenantId = newTenant.id as string;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const errorLine = `original: ${currentStep}: ${msg}`;
    const finalError = await runRollback(errorLine);
    await writeAuditError(admin, event.id, finalError, { markProcessed: false });
    return jsonResp(500, { ok: false, error_code: "database_error", error_message: msg });
  }
  const tenantId = createdTenantId!;

  // -------------------------------------------------------------------------
  // Step g: create agents row (owner). Idempotency check (c.iv): SELECT
  // WHERE id = <userId> first. The agent.id IS the auth user.id (Phase 1 FK),
  // so if a row already exists, the same user is already an owner of some
  // tenant — should not happen if our tenants short-circuit fired, but check
  // defensively per locked D2.
  // -------------------------------------------------------------------------
  currentStep = "agents_insert";
  try {
    const { data: existingAgent, error: agentLookupErr } = await admin
      .from("agents")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (agentLookupErr) {
      throw new Error(`agents lookup by id failed: ${agentLookupErr.message}`);
    }
    if (existingAgent?.id) {
      // Edge case: prior provisioning ran past step g but failed before step
      // h and the rollback could not delete this row. Re-use it. We did NOT
      // create it, so rollback must not delete it.
      createdAgentId = existingAgent.id as string;
      agentOwnedByUs = false;
    } else {
      const { data: newAgent, error: agentInsertErr } = await admin
        .from("agents")
        .insert({
          id: userId,
          tenant_id: tenantId,
          email: lowerEmail,
          first_name: md.owner_first_name,
          last_name: md.owner_last_name,
          is_owner: true,
          status: "active",
        })
        .select("id")
        .single();
      if (agentInsertErr) {
        throw new Error(`agents insert failed: ${agentInsertErr.message}`);
      }
      if (!newAgent?.id) {
        throw new Error("agents insert returned no id");
      }
      createdAgentId = newAgent.id as string;
      agentOwnedByUs = true;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const errorLine = `original: ${currentStep}: ${msg}`;
    const finalError = await runRollback(errorLine);
    await writeAuditError(admin, event.id, finalError, { markProcessed: false });
    return jsonResp(500, { ok: false, error_code: "database_error", error_message: msg });
  }

  // -------------------------------------------------------------------------
  // Step h: set tenants.owner_agent_id = newAgent.id.
  // -------------------------------------------------------------------------
  currentStep = "tenants_owner_set";
  try {
    const { error: updateErr } = await admin
      .from("tenants")
      .update({ owner_agent_id: createdAgentId })
      .eq("id", tenantId);
    if (updateErr) {
      throw new Error(`tenants.owner_agent_id update failed: ${updateErr.message}`);
    }
    tenantOwnerAgentIdSet = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const errorLine = `original: ${currentStep}: ${msg}`;
    const finalError = await runRollback(errorLine);
    await writeAuditError(admin, event.id, finalError, { markProcessed: false });
    return jsonResp(500, { ok: false, error_code: "database_error", error_message: msg });
  }

  // -------------------------------------------------------------------------
  // Step i: send magic link via SMTP (POST /auth/v1/magiclink). The previous
  // implementation called admin.auth.admin.generateLink, which only mints a URL
  // and never triggers the SMTP send — every signup since Phase 18 shipped was
  // locked out of their freshly-paid dashboard. The injected sender hits the
  // SMTP-sending endpoint that the Dashboard "Send magic link" button uses.
  //
  // redirect_to stays at /home (NOT /auth/callback) because AuthProvider mounts
  // at the route-tree root in src/App.tsx, so the URL fragment processes before
  // RequireAuth bounces to /login.
  //
  // Failure handling (locked Phase 18.3 override): NO rollback. Customer paid,
  // every row stays. Stripe retries via 500; manual resend from Supabase
  // Dashboard is the operator recovery path.
  // -------------------------------------------------------------------------
  currentStep = "magic_link_send";
  const redirectTo = `${publicSiteUrl}/home`;
  let sendResult: { ok: true } | { ok: false; status?: number; error: string };
  try {
    sendResult = await magicLinkSender({ email: lowerEmail, redirect_to: redirectTo });
  } catch (e) {
    sendResult = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!sendResult.ok) {
    const status = sendResult.status;
    const errMsg = sendResult.error;
    console.error("magic_link_send_failed", { email: lowerEmail, status, error: errMsg });
    const statusPrefix = status !== undefined ? `${status} ` : "";
    await writeAuditError(
      admin,
      event.id,
      `original: magic_link_send: ${statusPrefix}${errMsg}`,
      { markProcessed: false, tenantId },
    );
    return jsonResp(500, {
      ok: false,
      error_code: "magic_link_send_failed",
      error_message: errMsg,
    });
  }

  // -------------------------------------------------------------------------
  // Step j: mark audit row processed.
  // -------------------------------------------------------------------------
  await markAuditProcessed(admin, event.id, tenantId);

  // -------------------------------------------------------------------------
  // Step k: structured success log.
  // -------------------------------------------------------------------------
  console.log(JSON.stringify({
    msg: "phase18_new_signup_provisioned",
    event_id: event.id,
    tenant_id: tenantId,
    agency_id: agencyId,
    owner_user_id: userId,
    tier: md.tier,
    interval: md.interval,
  }));

  return jsonResp(200, {
    ok: true,
    tenant_id: tenantId,
    agency_id: agencyId,
    owner_user_id: userId,
  });
}

