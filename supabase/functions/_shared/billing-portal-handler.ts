/**
 * Extracted handler for the billing-portal Edge Function (Phase 17 PR 3b).
 *
 * Lives under _shared/ with zero Deno-specific imports so tests/ can import
 * it under bun's tsconfig. The Deno entrypoint
 * (supabase/functions/billing-portal/index.ts) wires the real admin + stripe
 * clients into this pure function.
 *
 * RULES (S-1 §2 PR 3b):
 *   - Missing JWT → 401 invalid_token
 *   - Caller not owner → 403 caller_not_owner
 *   - Tenant has no stripe_customer_id → 400 no_stripe_customer
 *     (the page renders the upgrade-from-starter CTA instead of the portal
 *     button; this branch should rarely fire because the UI gates on
 *     hasStripeCustomer first)
 *   - Happy path → 200 { url, session_id }
 */

/**
 * Minimal admin-client surface needed by the handler. Matches the AdminLike
 * pattern in _shared/payment-handlers.ts so the test layer can fake it.
 */
export type BillingPortalAdminLike = {
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
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
  };
};

/**
 * Minimal Stripe surface needed by the handler.
 */
export type BillingPortalStripeLike = {
  billingPortal: {
    sessions: {
      create: (params: { customer: string; return_url: string }) => Promise<{
        id: string;
        url: string;
      }>;
    };
  };
};

export type BillingPortalResult =
  | { status: 200; body: { ok: true; url: string; session_id: string } }
  | {
      status: 400 | 401 | 403 | 500;
      body: { ok: false; error_code: string; error_message: string };
    };

export async function handleBillingPortalRequest(args: {
  admin: BillingPortalAdminLike;
  stripe: BillingPortalStripeLike;
  accessToken: string;
  returnUrl: string;
}): Promise<BillingPortalResult> {
  const { admin, stripe, accessToken, returnUrl } = args;

  if (!accessToken) {
    return {
      status: 401,
      body: { ok: false, error_code: "invalid_token", error_message: "missing bearer token" },
    };
  }

  const { data: { user: caller }, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !caller) {
    return {
      status: 401,
      body: { ok: false, error_code: "invalid_token", error_message: "could not resolve caller" },
    };
  }

  const { data: callerAgent, error: callerErr } = await admin
    .from("agents")
    .select("is_owner, tenant_id")
    .eq("id", caller.id)
    .maybeSingle();
  if (callerErr) {
    return {
      status: 500,
      body: { ok: false, error_code: "caller_lookup_failed", error_message: callerErr.message },
    };
  }
  if (!callerAgent) {
    return {
      status: 403,
      body: {
        ok: false,
        error_code: "caller_no_agent_record",
        error_message: "your account is not linked to a tenant",
      },
    };
  }
  if (callerAgent.is_owner !== true) {
    return {
      status: 403,
      body: {
        ok: false,
        error_code: "caller_not_owner",
        error_message: "only the tenant owner can open the billing portal",
      },
    };
  }

  const tenantId = callerAgent.tenant_id as string;

  const { data: tenantRow, error: tenantErr } = await admin
    .from("tenants")
    .select("id, stripe_customer_id")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantErr) {
    return {
      status: 500,
      body: { ok: false, error_code: "tenant_lookup_failed", error_message: tenantErr.message },
    };
  }
  if (!tenantRow) {
    return {
      status: 500,
      body: { ok: false, error_code: "tenant_not_found", error_message: "tenant row not found for caller" },
    };
  }

  const customerId = tenantRow.stripe_customer_id as string | null;
  if (!customerId) {
    return {
      status: 400,
      body: {
        ok: false,
        error_code: "no_stripe_customer",
        error_message: "this tenant has not run checkout yet; no Stripe customer exists",
      },
    };
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return {
      status: 200,
      body: { ok: true, url: session.url, session_id: session.id },
    };
  } catch (e) {
    return {
      status: 500,
      body: {
        ok: false,
        error_code: "stripe_portal_create_failed",
        error_message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}
