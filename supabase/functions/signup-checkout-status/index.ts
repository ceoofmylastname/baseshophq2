/**
 * Supabase Edge Function: signup-checkout-status (Phase 18 PR 3)
 *
 * verify_jwt = false. Public, read-only lookup that returns the
 * customer_email + status for a given Stripe Checkout Session ID. The
 * /signup/success page calls this when sessionStorage is empty (cross-device
 * flow, or the user cleared their session) so we can still render a
 * personalized "We sent a magic link to <email>" line.
 *
 * Accepts BOTH request shapes:
 *   - GET  ?session_id=<id>
 *   - POST { session_id: string }
 *
 * Error codes (4):
 *   - validation_failed
 *   - session_not_found
 *   - stripe_call_failed
 *   - database_error
 *
 * CORS: the shared CORS_HEADERS in _shared/stripe-client.ts only allows
 * POST+OPTIONS. This function additionally accepts GET, so the wrapper emits
 * a custom `Access-Control-Allow-Methods: GET, POST, OPTIONS` header rather
 * than mutating the shared constant.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { getStripeClient } from "../_shared/stripe-client.ts";
import {
  handleSignupCheckoutStatusRequest,
  type StatusStripeLike,
} from "../_shared/signup-checkout-status-handler.ts";

const CORS_HEADERS_WITH_GET: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResp(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS_WITH_GET },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS_WITH_GET });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResp(405, { ok: false, error: "method not allowed" });
  }

  // Build Stripe client. The handler accepts null and returns
  // stripe_call_failed when init fails, but we surface a more specific log.
  let stripe: StatusStripeLike | null = null;
  try {
    stripe = (await getStripeClient()) as unknown as StatusStripeLike;
  } catch {
    stripe = null;
  }

  // Extract session_id from the appropriate request shape.
  let sessionId: unknown;
  if (req.method === "GET") {
    const url = new URL(req.url);
    sessionId = url.searchParams.get("session_id");
  } else {
    try {
      const body = await req.json();
      sessionId = (body as { session_id?: unknown }).session_id;
    } catch {
      return jsonResp(400, {
        ok: false,
        error_code: "validation_failed",
        error_message: "invalid JSON body",
      });
    }
  }

  const result = await handleSignupCheckoutStatusRequest({ stripe, sessionId });
  return jsonResp(result.status, result.body as unknown as Record<string, unknown>);
});
