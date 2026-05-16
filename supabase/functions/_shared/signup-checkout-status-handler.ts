/**
 * Phase 18 PR 3 — Pure handler for the signup-checkout-status Edge Function.
 *
 * Public, read-only lookup that returns the customer_email + status for a
 * given Stripe Checkout Session ID. Used by /signup/success to render a
 * personalized "We sent a magic link to <email>" line when sessionStorage is
 * empty (cross-device flow, or the user cleared storage).
 *
 * Returns only two fields the caller already proved they know about:
 *   - customer_email — the email the user typed into the signup form
 *   - status — checkout session status (open|complete|expired)
 *
 * verify_jwt = false on the wrapper. Anyone can call this. The session ID is
 * a 28+ char opaque token only the success-redirect would have, so practical
 * abuse surface is "can guess a session ID someone else just used", which is
 * a non-credential.
 *
 * Error codes (4):
 *   - validation_failed     — missing or malformed session_id
 *   - session_not_found     — Stripe 404 (cs_ prefix valid but unknown)
 *   - stripe_call_failed    — any other Stripe SDK throw
 *   - database_error        — defensive; reserved for any pre-Stripe DB read
 */

// ---------------------------------------------------------------------------
// Stripe surface (mockable)
// ---------------------------------------------------------------------------

export type StatusStripeLike = {
  checkout: {
    sessions: {
      retrieve: (id: string) => Promise<{
        id: string;
        customer_email: string | null;
        status: string | null;
      }>;
    };
  };
};

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export type SignupCheckoutStatusResult =
  | { status: 200; body: { ok: true; customer_email: string | null; status: string | null } }
  | {
      status: 400 | 404 | 500;
      body: {
        ok: false;
        error_code: "validation_failed" | "session_not_found" | "stripe_call_failed" | "database_error";
        error_message: string;
      };
    };

// ---------------------------------------------------------------------------
// Stripe error-shape heuristics
// ---------------------------------------------------------------------------

function looksLike404(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const o = e as { statusCode?: unknown; code?: unknown; type?: unknown; message?: unknown };
  if (typeof o.statusCode === "number" && o.statusCode === 404) return true;
  if (typeof o.code === "string" && o.code === "resource_missing") return true;
  if (typeof o.type === "string" && o.type === "StripeInvalidRequestError") return true;
  if (typeof o.message === "string" && /no such checkout\.session|not found/i.test(o.message)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleSignupCheckoutStatusRequest(args: {
  stripe: StatusStripeLike | null;
  sessionId: unknown;
}): Promise<SignupCheckoutStatusResult> {
  const { stripe, sessionId } = args;

  // Validate session_id
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return {
      status: 400,
      body: {
        ok: false,
        error_code: "validation_failed",
        error_message: "session_id is required",
      },
    };
  }
  if (!sessionId.startsWith("cs_")) {
    return {
      status: 400,
      body: {
        ok: false,
        error_code: "validation_failed",
        error_message: "session_id must start with cs_",
      },
    };
  }

  // Stripe init check
  if (!stripe) {
    return {
      status: 500,
      body: {
        ok: false,
        error_code: "stripe_call_failed",
        error_message: "Stripe is not initialized; Vault is missing stripe_secret_key",
      },
    };
  }

  // Retrieve the session
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return {
      status: 200,
      body: {
        ok: true,
        customer_email: session.customer_email,
        status: session.status,
      },
    };
  } catch (e) {
    if (looksLike404(e)) {
      return {
        status: 404,
        body: {
          ok: false,
          error_code: "session_not_found",
          error_message: e instanceof Error ? e.message : "session not found",
        },
      };
    }
    return {
      status: 500,
      body: {
        ok: false,
        error_code: "stripe_call_failed",
        error_message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}
