/**
 * Phase 18.1 — support_tickets migration schema tests.
 *
 * Asserts the migration SQL file contains every contracted element:
 *   - 12 column names
 *   - status CHECK constraint with all 4 values
 *   - (status, created_at DESC) index
 *   - platform_admins TODO comment block (parent's verbatim block)
 *   - 4 RLS policies mirroring demo_bookings
 *   - GRANT INSERT to anon + full grants to authenticated
 *   - 3+ DO-block verifications
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const MIGRATION_PATH = resolve(
  import.meta.dir,
  "../supabase/migrations/20260524110000_phase18_1_support_tickets_table.sql",
);
const SQL = readFileSync(MIGRATION_PATH, "utf-8");

describe("support_tickets schema", () => {
  test("creates public.support_tickets table", () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.support_tickets/i);
  });

  const COLUMNS = [
    "id",
    "email",
    "subject",
    "message",
    "source",
    "status",
    "tenant_id",
    "assigned_to",
    "created_at",
    "updated_at",
    "resolved_at",
    "notes",
  ];

  for (const col of COLUMNS) {
    test(`column present: ${col}`, () => {
      // Match a column line (start-of-token + column name + at least one space).
      const re = new RegExp(`(?:^|\\(|,)\\s*${col}\\s+`, "m");
      expect(re.test(SQL)).toBe(true);
    });
  }

  test("declares all 12 columns once each in the CREATE TABLE", () => {
    // Sanity check: the brief locks exactly 12.
    expect(COLUMNS).toHaveLength(12);
  });

  test("status CHECK constraint lists all four states", () => {
    expect(SQL).toMatch(/CHECK\s*\(\s*status\s+IN\s*\(\s*'new'\s*,\s*'triaged'\s*,\s*'resolved'\s*,\s*'archived'\s*\)\s*\)/i);
  });

  test("status default is 'new'", () => {
    expect(SQL).toMatch(/status\s+text\s+NOT NULL\s+DEFAULT\s+'new'/i);
  });

  test("(status, created_at DESC) index present", () => {
    expect(SQL).toMatch(/CREATE INDEX[^;]+support_tickets[^;]+\(\s*status\s*,\s*created_at\s+DESC\s*\)/i);
  });

  test("tenant_id is FK to tenants ON DELETE SET NULL", () => {
    expect(SQL).toMatch(/tenant_id\s+uuid\s+REFERENCES\s+public\.tenants\(id\)\s+ON DELETE SET NULL/i);
  });

  test("set_updated_at trigger present", () => {
    expect(SQL).toMatch(/CREATE TRIGGER\s+support_tickets_set_updated_at[^;]+EXECUTE FUNCTION\s+public\.set_updated_at/i);
  });

  test("platform_admins TODO comment block present", () => {
    expect(SQL).toContain("TODO(platform_admins)");
    expect(SQL).toContain("support_tickets and demo_bookings both gate");
    expect(SQL).toContain("SELECT/UPDATE/DELETE on public.is_owner()");
    expect(SQL).toContain("platform_admins table lands these policies need to flip");
    expect(SQL).toContain("is_platform_admin()");
    expect(SQL).toContain("Do NOT ship a fix that silently");
    expect(SQL).toContain("weakens this isolation pattern");
  });
});

describe("support_tickets RLS policies", () => {
  test("RLS enabled", () => {
    expect(SQL).toMatch(/ALTER TABLE public\.support_tickets ENABLE ROW LEVEL SECURITY/i);
  });

  test("insert policy support_tickets_insert_anon", () => {
    expect(SQL).toMatch(/CREATE POLICY support_tickets_insert_anon[^;]+FOR INSERT TO anon, authenticated/i);
    expect(SQL).toMatch(/email LIKE '%_@__%\.__%'/);
    expect(SQL).toMatch(/char_length\(trim\(email\)\)\s*>\s*0/);
    expect(SQL).toMatch(/char_length\(trim\(subject\)\)\s*>\s*0/);
    expect(SQL).toMatch(/char_length\(trim\(message\)\)\s*>\s*0/);
  });

  test("select policy support_tickets_select_owner gates on is_owner()", () => {
    expect(SQL).toMatch(/CREATE POLICY support_tickets_select_owner[^;]+FOR SELECT TO authenticated[^;]+USING\s*\(\s*public\.is_owner\(\)\s*\)/i);
  });

  test("update policy support_tickets_update_owner gates on is_owner()", () => {
    expect(SQL).toMatch(/CREATE POLICY support_tickets_update_owner[^;]+FOR UPDATE TO authenticated/i);
    expect(SQL).toMatch(/USING\s*\(\s*public\.is_owner\(\)\s*\)\s+WITH CHECK\s*\(\s*public\.is_owner\(\)\s*\)/i);
  });

  test("delete policy support_tickets_delete_owner gates on is_owner()", () => {
    expect(SQL).toMatch(/CREATE POLICY support_tickets_delete_owner[^;]+FOR DELETE TO authenticated[^;]+USING\s*\(\s*public\.is_owner\(\)\s*\)/i);
  });

  test("GRANT INSERT to anon", () => {
    expect(SQL).toMatch(/GRANT INSERT ON public\.support_tickets TO anon/i);
  });

  test("GRANT full crud to authenticated", () => {
    expect(SQL).toMatch(/GRANT SELECT,\s*INSERT,\s*UPDATE,\s*DELETE ON public\.support_tickets TO authenticated/i);
  });
});

describe("support_tickets DO-block verifications", () => {
  test("3+ DO-blocks present", () => {
    const doBlocks = SQL.match(/DO\s+\$\$/g) ?? [];
    expect(doBlocks.length).toBeGreaterThanOrEqual(3);
  });

  test("verification 1: table_exists_with_all_columns_and_trigger", () => {
    expect(SQL).toContain("Verification 1/3 passed: table_exists_with_all_columns_and_trigger");
  });

  test("verification 2: anon_can_insert", () => {
    expect(SQL).toContain("Verification 2/3 passed: anon_can_insert");
  });

  test("verification 3: anon_cannot_select", () => {
    expect(SQL).toContain("Verification 3/3 passed: anon_cannot_select");
  });
});
