/**
 * Phase 18 PR 3 — tests for handleSignupCheckoutStatusRequest.
 *
 * 4 cases covering the documented error/happy paths.
 */

import { describe, expect, test } from "bun:test";
import {
  handleSignupCheckoutStatusRequest,
  type StatusStripeLike,
} from "../supabase/functions/_shared/signup-checkout-status-handler.ts";

function makeStripe(opts: {
  customer_email?: string | null;
  status?: string | null;
  throwLike404?: boolean;
  throwLikeGeneric?: boolean;
}): StatusStripeLike {
  return {
    checkout: {
      sessions: {
        async retrieve(id: string) {
          if (opts.throwLike404) {
            throw Object.assign(new Error("No such checkout.session: cs_bogus"), {
              statusCode: 404,
              code: "resource_missing",
              type: "StripeInvalidRequestError",
            });
          }
          if (opts.throwLikeGeneric) {
            throw new Error("Stripe API connection error");
          }
          return {
            id,
            customer_email: opts.customer_email ?? null,
            status: opts.status ?? null,
          };
        },
      },
    },
  };
}

describe("handleSignupCheckoutStatusRequest", () => {
  test("missing session_id → 400 validation_failed", async () => {
    const out = await handleSignupCheckoutStatusRequest({
      stripe: makeStripe({}),
      sessionId: undefined,
    });
    expect(out.status).toBe(400);
    if (out.status === 400) {
      expect(out.body.error_code).toBe("validation_failed");
      expect(out.body.error_message).toContain("required");
    }
  });

  test("invalid prefix (not cs_) → 400 validation_failed", async () => {
    const out = await handleSignupCheckoutStatusRequest({
      stripe: makeStripe({}),
      sessionId: "sub_does_not_belong_here",
    });
    expect(out.status).toBe(400);
    if (out.status === 400) {
      expect(out.body.error_code).toBe("validation_failed");
      expect(out.body.error_message).toContain("cs_");
    }
  });

  test("happy path: returns customer_email + status", async () => {
    const out = await handleSignupCheckoutStatusRequest({
      stripe: makeStripe({ customer_email: "alice@example.com", status: "complete" }),
      sessionId: "cs_test_abc123",
    });
    expect(out.status).toBe(200);
    if (out.status === 200) {
      expect(out.body.ok).toBe(true);
      expect(out.body.customer_email).toBe("alice@example.com");
      expect(out.body.status).toBe("complete");
    }
  });

  test("Stripe 404 → 404 session_not_found", async () => {
    const out = await handleSignupCheckoutStatusRequest({
      stripe: makeStripe({ throwLike404: true }),
      sessionId: "cs_test_doesnotexist",
    });
    expect(out.status).toBe(404);
    if (out.status === 404) {
      expect(out.body.error_code).toBe("session_not_found");
    }
  });
});
