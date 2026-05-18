/**
 * Phase 19.2 -- tests for validateAnnouncementInput.
 *
 * Mirrors the server-side gates in upsert_announcement (title non-empty after
 * trim) plus the L-4 length caps (title 80, body 2000). Body is not required.
 */

import { describe, expect, test } from "bun:test";
import {
  BODY_MAX,
  TITLE_MAX,
  validateAnnouncementInput,
} from "../src/lib/announcements-validation";

describe("validateAnnouncementInput", () => {
  test("valid title + body returns no errors", () => {
    expect(validateAnnouncementInput({ title: "Welcome", body: "Hello team" })).toEqual([]);
  });

  test("empty title is an error", () => {
    const errors = validateAnnouncementInput({ title: "", body: "Body OK" });
    expect(errors).toEqual([{ field: "title", message: "Title is required." }]);
  });

  test("whitespace-only title is an error (trimmed before length check)", () => {
    const errors = validateAnnouncementInput({ title: "    ", body: "" });
    expect(errors.map((e) => e.field)).toEqual(["title"]);
  });

  test("title exactly at TITLE_MAX is valid", () => {
    const title = "a".repeat(TITLE_MAX);
    expect(validateAnnouncementInput({ title, body: "" })).toEqual([]);
  });

  test("title over TITLE_MAX is an error citing the cap", () => {
    const title = "a".repeat(TITLE_MAX + 1);
    const errors = validateAnnouncementInput({ title, body: "" });
    expect(errors).toEqual([
      { field: "title", message: `Title must be ${TITLE_MAX} characters or fewer.` },
    ]);
  });

  test("empty body is valid (body is optional, only length-capped)", () => {
    expect(validateAnnouncementInput({ title: "OK", body: "" })).toEqual([]);
  });

  test("body exactly at BODY_MAX is valid", () => {
    const body = "x".repeat(BODY_MAX);
    expect(validateAnnouncementInput({ title: "OK", body })).toEqual([]);
  });

  test("body over BODY_MAX is an error citing the cap", () => {
    const body = "x".repeat(BODY_MAX + 1);
    const errors = validateAnnouncementInput({ title: "OK", body });
    expect(errors).toEqual([
      { field: "body", message: `Body must be ${BODY_MAX} characters or fewer.` },
    ]);
  });

  test("both fields invalid -> both errors returned in deterministic order", () => {
    const errors = validateAnnouncementInput({
      title: "",
      body: "x".repeat(BODY_MAX + 1),
    });
    expect(errors.map((e) => e.field)).toEqual(["title", "body"]);
  });

  test("TITLE_MAX and BODY_MAX constants are exported with locked values", () => {
    expect(TITLE_MAX).toBe(80);
    expect(BODY_MAX).toBe(2000);
  });
});
