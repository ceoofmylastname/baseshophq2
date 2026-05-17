/**
 * Phase 18.1 — migration tests for auth_user_has_password RPC.
 *
 * The function reads a column in the auth schema that only postgres /
 * supabase_auth_admin own. The hardening guardrails are encoded in the
 * migration file itself; this test asserts the file contains all of them
 * so a future drive-by edit can't silently weaken the contract.
 */

import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const MIGRATION_PATH = resolve(
  import.meta.dir,
  "../supabase/migrations/20260524100000_phase18_1_auth_user_has_password_rpc.sql",
);
const SQL = readFileSync(MIGRATION_PATH, "utf-8");

describe("auth_user_has_password migration guardrails", () => {
  test("function name + uuid arg present", () => {
    expect(SQL).toContain("CREATE OR REPLACE FUNCTION public.auth_user_has_password(p_user_id uuid)");
  });

  test("returns boolean", () => {
    expect(SQL).toMatch(/RETURNS\s+boolean/i);
  });

  test("LANGUAGE sql", () => {
    expect(SQL).toMatch(/LANGUAGE\s+sql/i);
  });

  test("STABLE volatility", () => {
    expect(SQL).toMatch(/\bSTABLE\b/);
  });

  test("SECURITY DEFINER", () => {
    expect(SQL).toContain("SECURITY DEFINER");
  });

  test("inline SECURITY DEFINER justification comment", () => {
    // Locked exact phrase from parent plan.
    expect(SQL).toContain("SECURITY DEFINER required because");
    expect(SQL).toContain("auth.users.encrypted_password");
    expect(SQL).toContain("no PII leak");
  });

  test("locked search_path", () => {
    expect(SQL).toContain("SET search_path = public, pg_temp, pg_catalog");
  });

  test("REVOKE EXECUTE FROM PUBLIC, anon", () => {
    expect(SQL).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.auth_user_has_password\(uuid\)\s+FROM\s+PUBLIC,\s*anon/i);
  });

  test("GRANT EXECUTE TO authenticated", () => {
    expect(SQL).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.auth_user_has_password\(uuid\)\s+TO\s+authenticated/i);
  });

  test("body inspects encrypted_password column", () => {
    expect(SQL).toContain("encrypted_password IS NOT NULL");
    expect(SQL).toContain("encrypted_password != ''");
    expect(SQL).toContain("FROM auth.users");
    expect(SQL).toContain("WHERE id = p_user_id");
  });

  test("includes 2+ DO-block verifications", () => {
    const doBlocks = SQL.match(/DO\s+\$\$/g) ?? [];
    expect(doBlocks.length).toBeGreaterThanOrEqual(2);
  });

  test("verification 1: rpc_signature_and_grants", () => {
    expect(SQL).toContain("Verification 1/2 passed: rpc_signature_and_grants");
  });

  test("verification 2: returns_expected_boolean", () => {
    expect(SQL).toContain("Verification 2/2 passed: returns_expected_boolean");
  });
});
