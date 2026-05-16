/**
 * Phase 18 PR 2 — Extracted handler for the signup-checkout Edge Function.
 *
 * Lives under _shared/ with zero Deno-specific imports so tests/ can import
 * it under bun's tsconfig. The Deno entrypoint
 * (supabase/functions/signup-checkout/index.ts) wires real admin + stripe
 * clients into this pure function.
 *
 * Body shape (locked):
 *   { tier, interval, whiteLabel, agencyName, ownerEmail, ownerFirstName,
 *     ownerLastName, timeZone, slugHint? }
 *
 * Error codes returned by this handler (6 total):
 *   - validation_failed
 *   - enterprise_not_self_serve
 *   - starter_white_label_combination
 *   - email_already_registered  (with hint: "Already have an account? Sign in instead.")
 *   - stripe_init_failed
 *   - stripe_call_failed
 *
 * Pattern matches billing-mutate-handler.ts. The thin Deno wrapper does env
 * reads + dependency construction and is not directly tested.
 */

import {
  slugifyAgencyName,
  validateEmailFormat,
  validateInterval,
  validateNonEmpty,
  validateTier,
  validateTimeZone,
  type SignupInterval,
  type SignupTier,
} from "./signup-validation.ts";

// ---------------------------------------------------------------------------
// Admin + Stripe surfaces (mockable). Mirrors the BillingMutate*Like pattern.
// ---------------------------------------------------------------------------

/** Subset of the supabase-js admin client we exercise. */
export type SignupCheckoutAdminLike = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => Promise<{
        data: Array<Record<string, unknown>> | null;
        error: { message: string } | null;
      }>;
    };
  };
};

/** Subset of the Stripe SDK we exercise. */
export type SignupCheckoutStripeLike = {
  checkout: {
    sessions: {
      create: (params: StripeCheckoutSessionCreateParams) => Promise<{ id: string; url: string | null }>;
    };
  };
};

type StripeCheckoutSessionCreateParams = {
  mode: "subscription";
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

/** Price catalog passed in by the wrapper. Identical keys to PR 1's
 *  loadPriceIdCatalog output. */
export type SignupCheckoutPriceCatalog = {
  starter: string | null;
  growth: string | null;
  pro: string | null;
  starter_annual: string | null;
  growth_annual: string | null;
  pro_annual: string | null;
  white_label_addon: string | null;
  white_label_addon_annual: string | null;
};

// ---------------------------------------------------------------------------
// Body + result shapes
// ---------------------------------------------------------------------------

export type SignupCheckoutBody = {
  tier?: unknown;
  interval?: unknown;
  whiteLabel?: unknown;
  agencyName?: unknown;
  ownerEmail?: unknown;
  ownerFirstName?: unknown;
  ownerLastName?: unknown;
  timeZone?: unknown;
  slugHint?: unknown;
};

export type SignupCheckoutResult =
  | { status: 200; body: { ok: true; url: string | null; session_id: string } }
  | {
      status: 400 | 500;
      body: {
        ok: false;
        error_code:
          | "validation_failed"
          | "enterprise_not_self_serve"
          | "starter_white_label_combination"
          | "email_already_registered"
          | "stripe_init_failed"
          | "stripe_call_failed";
        error_message: string;
        hint?: string;
      };
    };

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

export async function handleSignupCheckoutRequest(args: {
  admin: SignupCheckoutAdminLike;
  /** May be null when Vault is missing stripe_secret_key — returns
   *  stripe_init_failed without calling Stripe. */
  stripe: SignupCheckoutStripeLike | null;
  catalog: SignupCheckoutPriceCatalog;
  publicSiteUrl: string;
  body: SignupCheckoutBody;
}): Promise<SignupCheckoutResult> {
  const { admin, stripe, catalog, publicSiteUrl, body } = args;

  // ---- Validate body fields ----
  const tierResult = validateTier(body.tier);
  if (!tierResult.ok) {
    return { status: 400, body: { ok: false, error_code: tierResult.code, error_message: tierResult.message } };
  }
  const tier: SignupTier = tierResult.tier;

  const intervalResult = validateInterval(body.interval);
  if (!intervalResult.ok) {
    return { status: 400, body: { ok: false, error_code: intervalResult.code, error_message: intervalResult.message } };
  }
  const interval: SignupInterval = intervalResult.interval;

  const whiteLabel = body.whiteLabel === true;

  // Starter cannot combine with white-label (locked rule).
  if (tier === "starter" && whiteLabel) {
    return {
      status: 400,
      body: {
        ok: false,
        error_code: "starter_white_label_combination",
        error_message: "white-label add-on is not available on the Starter tier",
      },
    };
  }

  const agencyNameResult = validateNonEmpty(body.agencyName, "agencyName");
  if (!agencyNameResult.ok) {
    return { status: 400, body: { ok: false, error_code: agencyNameResult.code, error_message: agencyNameResult.message } };
  }
  const agencyName = agencyNameResult.value;

  const firstNameResult = validateNonEmpty(body.ownerFirstName, "ownerFirstName");
  if (!firstNameResult.ok) {
    return { status: 400, body: { ok: false, error_code: firstNameResult.code, error_message: firstNameResult.message } };
  }
  const ownerFirstName = firstNameResult.value;

  const lastNameResult = validateNonEmpty(body.ownerLastName, "ownerLastName");
  if (!lastNameResult.ok) {
    return { status: 400, body: { ok: false, error_code: lastNameResult.code, error_message: lastNameResult.message } };
  }
  const ownerLastName = lastNameResult.value;

  const emailResult = validateEmailFormat(body.ownerEmail);
  if (!emailResult.ok) {
    return { status: 400, body: { ok: false, error_code: emailResult.code, error_message: emailResult.message } };
  }
  const ownerEmail = emailResult.email;

  const tzResult = validateTimeZone(body.timeZone);
  if (!tzResult.ok) {
    return { status: 400, body: { ok: false, error_code: tzResult.code, error_message: tzResult.message } };
  }
  const timeZone = tzResult.timeZone;

  // slugHint is optional; if a non-string is passed, treat it as absent.
  const slugHint = typeof body.slugHint === "string" && body.slugHint.trim().length > 0
    ? body.slugHint.trim()
    : null;

  // ---- Email-uniqueness check via service-role RPC ----
  const { data: existsData, error: existsErr } = await admin.rpc("auth_user_exists_by_email", { p_email: ownerEmail });
  if (existsErr) {
    return {
      status: 500,
      body: {
        ok: false,
        error_code: "stripe_call_failed",
        error_message: `auth_user_exists_by_email RPC failed: ${existsErr.message}`,
      },
    };
  }
  if (existsData === true) {
    return {
      status: 400,
      body: {
        ok: false,
        error_code: "email_already_registered",
        error_message: "an account with this email already exists",
        hint: "Already have an account? Sign in instead.",
      },
    };
  }

  // ---- Slug uniqueness loop against tenants.slug ----
  const baseSlug = slugifyAgencyName(slugHint ?? agencyName);
  let chosenSlug = baseSlug;
  for (let i = 2; i < 1000; i++) {
    const { data: existing, error: slugErr } = await admin
      .from("tenants")
      .select("slug")
      .eq("slug", chosenSlug);
    if (slugErr) {
      return {
        status: 500,
        body: {
          ok: false,
          error_code: "stripe_call_failed",
          error_message: `tenants.slug lookup failed: ${slugErr.message}`,
        },
      };
    }
    if (!existing || existing.length === 0) {
      break;
    }
    chosenSlug = `${baseSlug}-${i}`;
  }

  // ---- Stripe init check ----
  if (!stripe) {
    return {
      status: 500,
      body: {
        ok: false,
        error_code: "stripe_init_failed",
        error_message: "Stripe is not initialized; Vault is missing stripe_secret_key",
      },
    };
  }

  // ---- Resolve price IDs from the catalog ----
  const tierPrice = pickTierPrice(catalog, tier, interval);
  if (!tierPrice) {
    return {
      status: 500,
      body: {
        ok: false,
        error_code: "stripe_init_failed",
        error_message: `Vault entry for ${tier}/${interval} is not set`,
      },
    };
  }
  let wlPrice: string | null = null;
  if (whiteLabel) {
    wlPrice = interval === "annual" ? catalog.white_label_addon_annual : catalog.white_label_addon;
    if (!wlPrice) {
      return {
        status: 500,
        body: {
          ok: false,
          error_code: "stripe_init_failed",
          error_message: "Vault entry for white_label_addon is not set",
        },
      };
    }
  }

  // ---- Build line items ----
  const line_items: Array<{ price: string; quantity: number }> = [
    { price: tierPrice, quantity: 1 },
  ];
  if (wlPrice) {
    line_items.push({ price: wlPrice, quantity: 1 });
  }

  // ---- Build the 10-key subscription_data.metadata (locked) ----
  const subscriptionMetadata: Record<string, string> = {
    flow: "new_signup",
    agency_name: agencyName,
    owner_email: ownerEmail,
    owner_first_name: ownerFirstName,
    owner_last_name: ownerLastName,
    time_zone: timeZone,
    tier,
    interval,
    white_label: whiteLabel ? "true" : "false",
    slug: chosenSlug,
  };

  // ---- Create Stripe Checkout Session ----
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: ownerEmail,
      line_items,
      allow_promotion_codes: true,
      success_url: `${publicSiteUrl}/signup/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${publicSiteUrl}/signup/cancelled`,
      subscription_data: {
        trial_period_days: 14,
        metadata: subscriptionMetadata,
      },
      // metadata on the session itself (Stripe Dashboard visibility).
      metadata: { flow: "new_signup" },
    });
  } catch (e) {
    return {
      status: 500,
      body: {
        ok: false,
        error_code: "stripe_call_failed",
        error_message: e instanceof Error ? e.message : String(e),
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      url: session.url,
      session_id: session.id,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickTierPrice(
  catalog: SignupCheckoutPriceCatalog,
  tier: SignupTier,
  interval: SignupInterval,
): string | null {
  if (interval === "annual") {
    if (tier === "starter") return catalog.starter_annual;
    if (tier === "growth")  return catalog.growth_annual;
    return catalog.pro_annual;
  }
  if (tier === "starter") return catalog.starter;
  if (tier === "growth")  return catalog.growth;
  return catalog.pro;
}
