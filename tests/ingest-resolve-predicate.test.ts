/**
 * Tests for IngestResolveStep's apply-gate predicate.
 *
 * Covers:
 *   - empty rows / no flags case (trivially resolved)
 *   - skip=true resolves any flag set
 *   - product_ambiguous requires non-empty trimmed product override
 *   - orphan/unmatched require agent_email in the valid-emails set
 *   - status_unknown requires status in the valid-status set
 *   - multi-flag rows require all flags satisfied
 */

import { describe, expect, test } from "bun:test";
import { isFlaggedRowResolved } from "../src/components/ingest/ingest-resolve-predicate";

const VALID_EMAILS = new Set(["alice@example.com", "bob@example.com"]);
const VALID_STATUS = new Set([
  "Draft", "Submitted", "Pending", "Issued", "Issue Paid",
  "Terminated", "Potential Lapse",
]);

describe("isFlaggedRowResolved", () => {
  test("empty flag list is always resolved", () => {
    expect(isFlaggedRowResolved([], {}, VALID_EMAILS, VALID_STATUS)).toBe(true);
  });

  test("skip=true resolves regardless of flags", () => {
    expect(
      isFlaggedRowResolved(
        ["orphan", "product_ambiguous", "status_unknown"],
        { skip: true },
        VALID_EMAILS,
        VALID_STATUS,
      ),
    ).toBe(true);
  });

  test("product_ambiguous needs a non-empty product override", () => {
    expect(isFlaggedRowResolved(["product_ambiguous"], {}, VALID_EMAILS, VALID_STATUS)).toBe(false);
    expect(isFlaggedRowResolved(["product_ambiguous"], { product: "  " }, VALID_EMAILS, VALID_STATUS)).toBe(false);
    expect(isFlaggedRowResolved(["product_ambiguous"], { product: "Term 20" }, VALID_EMAILS, VALID_STATUS)).toBe(true);
  });

  test("orphan needs a valid agent_email", () => {
    expect(isFlaggedRowResolved(["orphan"], {}, VALID_EMAILS, VALID_STATUS)).toBe(false);
    expect(isFlaggedRowResolved(["orphan"], { agent_email: "nobody@x.com" }, VALID_EMAILS, VALID_STATUS)).toBe(false);
    expect(isFlaggedRowResolved(["orphan"], { agent_email: "alice@example.com" }, VALID_EMAILS, VALID_STATUS)).toBe(true);
  });

  test("unmatched needs a valid agent_email", () => {
    expect(isFlaggedRowResolved(["unmatched"], { agent_email: "bob@example.com" }, VALID_EMAILS, VALID_STATUS)).toBe(true);
    expect(isFlaggedRowResolved(["unmatched"], { agent_email: "x@x.com" }, VALID_EMAILS, VALID_STATUS)).toBe(false);
  });

  test("status_unknown needs a valid status", () => {
    expect(isFlaggedRowResolved(["status_unknown"], {}, VALID_EMAILS, VALID_STATUS)).toBe(false);
    expect(isFlaggedRowResolved(["status_unknown"], { status: "Frob" }, VALID_EMAILS, VALID_STATUS)).toBe(false);
    expect(isFlaggedRowResolved(["status_unknown"], { status: "Issued" }, VALID_EMAILS, VALID_STATUS)).toBe(true);
  });

  test("multi-flag row requires every flag satisfied", () => {
    expect(
      isFlaggedRowResolved(
        ["orphan", "product_ambiguous"],
        { agent_email: "alice@example.com" },
        VALID_EMAILS,
        VALID_STATUS,
      ),
    ).toBe(false);
    expect(
      isFlaggedRowResolved(
        ["orphan", "product_ambiguous"],
        { agent_email: "alice@example.com", product: "Term 20" },
        VALID_EMAILS,
        VALID_STATUS,
      ),
    ).toBe(true);
  });

  test("three-row hand-trace from plan: skip + override + unresolved", () => {
    // Row A: flagged, resolved by skip
    const a = isFlaggedRowResolved(["orphan"], { skip: true }, VALID_EMAILS, VALID_STATUS);
    // Row B: flagged, resolved by override
    const b = isFlaggedRowResolved(
      ["product_ambiguous"],
      { product: "Term 30" },
      VALID_EMAILS,
      VALID_STATUS,
    );
    // Row C: flagged, unresolved
    const c = isFlaggedRowResolved(["status_unknown"], {}, VALID_EMAILS, VALID_STATUS);

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(c).toBe(false);

    // Resolved count over flaggedRows (3) = 2 → readyRows = (total - flagged) + 2
    // If total = 3 and flagged = 3, readyRows = 2, allReady = false (matches plan)
    const flaggedCount = 3;
    const totalRows = 3;
    const resolvedFlagged = [a, b, c].filter(Boolean).length;
    const readyRows = (totalRows - flaggedCount) + resolvedFlagged;
    expect(readyRows).toBe(2);
    expect(readyRows === totalRows).toBe(false);
  });
});
