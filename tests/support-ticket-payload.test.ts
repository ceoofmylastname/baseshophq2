/**
 * Phase 18.1 — buildSupportTicketPayload pure helper tests.
 *
 * Covers the four contracted behaviors:
 *   (1) email + message are trimmed of leading/trailing whitespace
 *   (2) subject is defaulted server-side to "Contact request from ${source}"
 *       and never surfaced as a form field (D11)
 *   (3) source is passed through verbatim
 *   (4) tenant_id null-coalesces when omitted or set to undefined/null
 */

import { describe, expect, test } from "bun:test";
import {
  buildSupportTicketPayload,
  type SupportTicketPayload,
} from "../src/lib/support-tickets/payload";

describe("buildSupportTicketPayload", () => {
  test("returns the canonical 5-field shape", () => {
    const out = buildSupportTicketPayload({
      email: "user@example.com",
      message: "Hello support",
      source: "signup-success-no-email",
      tenant_id: "11111111-1111-1111-1111-111111111111",
    });
    const expected: SupportTicketPayload = {
      email: "user@example.com",
      subject: "Contact request from signup-success-no-email",
      message: "Hello support",
      source: "signup-success-no-email",
      tenant_id: "11111111-1111-1111-1111-111111111111",
    };
    expect(out).toEqual(expected);
  });

  test("trims surrounding whitespace from email", () => {
    const out = buildSupportTicketPayload({
      email: "  spaced@example.com  ",
      message: "Hello",
      source: "homepage",
    });
    expect(out.email).toBe("spaced@example.com");
  });

  test("trims surrounding whitespace from message", () => {
    const out = buildSupportTicketPayload({
      email: "user@example.com",
      message: "   Multi line\n   message body.   ",
      source: "homepage",
    });
    expect(out.message).toBe("Multi line\n   message body.");
  });

  test("subject is defaulted server-side from source (D11)", () => {
    const out = buildSupportTicketPayload({
      email: "user@example.com",
      message: "Hi",
      source: "marketing-footer",
    });
    expect(out.subject).toBe("Contact request from marketing-footer");
  });

  test("source is passed through verbatim", () => {
    const out = buildSupportTicketPayload({
      email: "user@example.com",
      message: "Hi",
      source: "weird-source-with-dashes_and_underscores",
    });
    expect(out.source).toBe("weird-source-with-dashes_and_underscores");
  });

  test("omitted tenant_id null-coalesces", () => {
    const out = buildSupportTicketPayload({
      email: "user@example.com",
      message: "Hi",
      source: "homepage",
    });
    expect(out.tenant_id).toBeNull();
  });

  test("undefined tenant_id null-coalesces", () => {
    const out = buildSupportTicketPayload({
      email: "user@example.com",
      message: "Hi",
      source: "homepage",
      tenant_id: undefined,
    });
    expect(out.tenant_id).toBeNull();
  });

  test("explicit null tenant_id remains null", () => {
    const out = buildSupportTicketPayload({
      email: "user@example.com",
      message: "Hi",
      source: "homepage",
      tenant_id: null,
    });
    expect(out.tenant_id).toBeNull();
  });

  test("populated tenant_id is preserved", () => {
    const tenantId = "22222222-2222-2222-2222-222222222222";
    const out = buildSupportTicketPayload({
      email: "user@example.com",
      message: "Hi",
      source: "homepage",
      tenant_id: tenantId,
    });
    expect(out.tenant_id).toBe(tenantId);
  });

  test("payload has exactly the 5 expected keys (no leakage of extra fields)", () => {
    const out = buildSupportTicketPayload({
      email: "user@example.com",
      message: "Hi",
      source: "homepage",
    });
    expect(Object.keys(out).sort()).toEqual([
      "email",
      "message",
      "source",
      "subject",
      "tenant_id",
    ]);
  });

  test("does not surface a subject field as input (D11)", () => {
    // Compile-time + runtime: the input type has no `subject` key. Even if
    // a caller smuggles one in, it must not appear on the output.
    const out = buildSupportTicketPayload({
      email: "user@example.com",
      message: "Hi",
      source: "ui-source",
      // @ts-expect-error subject is not part of the input type
      subject: "Caller-supplied subject that must be ignored",
    });
    expect(out.subject).toBe("Contact request from ui-source");
  });
});
