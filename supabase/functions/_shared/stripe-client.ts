/**
 * Shared client wiring for the Stripe Edge Functions: lazy Stripe SDK init
 * with Vault-sourced secret key, service-role Supabase admin client factory,
 * and a small Vault read-through cache.
 *
 * This file imports Deno + npm: specifiers so it is NOT importable from the
 * repo's root TS project. State-mapping and tier-resolver live next to it
 * and stay pure for unit testing.
 *
 * Pricing IDs catalog convention: each Edge Function calls
 * `loadPriceIdCatalog(admin)` once at request-handling time and feeds the
 * result to `resolveTierFromSubscriptionItems`. Missing entries surface as
 * `null` in the catalog and the resolver flags them as
 * `no_base_tier_matched` so the call site can return a structured error.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@^17";

import type { PriceIdCatalog } from "./tier-resolver.ts";

// Module-scope caches. Edge Function workers are reused across requests
// (per the per_worker policy in supabase/config.toml), so caching at module
// scope eliminates redundant Vault round-trips within a worker's lifetime.
let cachedStripe: Stripe | null = null;
let cachedAdmin: SupabaseClient | null = null;
const vaultCache = new Map<string, string | null>();

/**
 * Service-role Supabase client. Cached at module scope; safe because every
 * Edge Function instance is single-tenant from the runtime's perspective.
 */
export function getAdminClient(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env");
  }
  cachedAdmin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedAdmin;
}

/**
 * Read a Supabase Vault secret via the public.get_vault_secret RPC. Returns
 * null if the secret is not set (so callers can surface a specific error).
 *
 * Module-scope cache: the same secret name returns the same value for the
 * worker's lifetime. Vault rotations require redeploying the worker (or
 * exhausting it through the runtime's normal recycling) — acceptable for
 * MVP given how infrequently these secrets change.
 */
export async function getVaultSecret(
  admin: SupabaseClient,
  name: string
): Promise<string | null> {
  if (vaultCache.has(name)) return vaultCache.get(name) ?? null;

  const { data, error } = await admin.rpc("get_vault_secret", { p_name: name });
  if (error) {
    // Do not cache failures — callers may want to retry.
    throw new Error(`vault read for ${name} failed: ${error.message}`);
  }
  const value: string | null = (data as string | null) ?? null;
  vaultCache.set(name, value);
  return value;
}

/**
 * Lazy Stripe SDK init. Reads `stripe_secret_key` from Vault on first call.
 *
 * The Edge runtime ships fetch; we wire Stripe through it explicitly with
 * `createFetchHttpClient()` to avoid the SDK's default Node http client
 * (which Deno does not provide).
 */
export async function getStripeClient(): Promise<Stripe> {
  if (cachedStripe) return cachedStripe;

  const admin = getAdminClient();
  const secretKey = await getVaultSecret(admin, "stripe_secret_key");
  if (!secretKey) {
    throw new Error("stripe_secret_key is not set in Supabase Vault");
  }

  cachedStripe = new Stripe(secretKey, {
    apiVersion: "2024-12-18.acacia",
    httpClient: Stripe.createFetchHttpClient(),
  });
  return cachedStripe;
}

/**
 * One round of Vault reads to assemble the full price ID catalog. Each name
 * is fetched independently so a missing entry leaves the others usable.
 *
 * Phase 17 PR 3c: now reads 9 entries — adds the four annual variants
 * (starter_annual, growth_annual, pro_annual, white_label_addon_annual).
 * Enterprise has no annual variant.
 */
export async function loadPriceIdCatalog(
  admin: SupabaseClient
): Promise<PriceIdCatalog> {
  const [
    starter,
    growth,
    pro,
    enterpriseUnit,
    whiteLabelAddon,
    starterAnnual,
    growthAnnual,
    proAnnual,
    whiteLabelAddonAnnual,
  ] = await Promise.all([
    getVaultSecret(admin, "stripe_price_starter"),
    getVaultSecret(admin, "stripe_price_growth"),
    getVaultSecret(admin, "stripe_price_pro"),
    getVaultSecret(admin, "stripe_price_enterprise_active_agent_unit"),
    getVaultSecret(admin, "stripe_price_white_label_addon"),
    getVaultSecret(admin, "stripe_price_starter_annual"),
    getVaultSecret(admin, "stripe_price_growth_annual"),
    getVaultSecret(admin, "stripe_price_pro_annual"),
    getVaultSecret(admin, "stripe_price_white_label_addon_annual"),
  ]);

  return {
    starter,
    growth,
    pro,
    enterprise_active_agent_unit: enterpriseUnit,
    white_label_addon: whiteLabelAddon,
    starter_annual: starterAnnual,
    growth_annual: growthAnnual,
    pro_annual: proAnnual,
    white_label_addon_annual: whiteLabelAddonAnnual,
  };
}

/**
 * Standard CORS + JSON helpers. All three Stripe functions speak JSON only;
 * the response shape is `{ ok, ... }` matching every other Edge Function in
 * this repo.
 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature, x-snapshot-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(
  status: number,
  body: Record<string, unknown>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
