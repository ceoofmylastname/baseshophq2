# Schema Drift Audit — 2026-05-12

Run after: 600a40c
Project: `oarstmxbgdczytwzpyxj`

## Counts audited

| Category | Remote count | Captured | Drift |
|---|---|---|---|
| 1. Functions in `public` (DEFINER + INVOKER, non-extension) | 57 | 57 | 0 |
| 2. Event triggers | 7 | 1 app + 6 Supabase platform | 0 |
| 3. Table triggers on `public` (user, non-internal) | 22 | 22 | 0 |
| 4. Extensions | 5 | 1 captured + 4 Supabase defaults | 0 app, 2 ambiguous (see below) |
| 5. Custom types/domains/enums in `public` | 5 | 5 | 0 |
| 6. Views and matviews in `public` | 2 | 2 | 0 |
| 7. RLS policies in `public` | 56 | 56 | 0 |
| 8. Roles outside the platform allow-list | 3 | 0 (all Supabase/PG platform) | 0 |
| **Total app objects audited** | **152** | **152** | **0** |

**Drift items found: 0** (with 2 ambiguous extension entries flagged for triage)

## Findings

No app-level drift. All audited objects on remote are captured by migration history.

Two extension entries are AMBIGUOUS — they exist on remote but are Supabase project-provisioning defaults rather than app DDL. They are listed in the "Ambiguous" section below for the parent session to triage (capture vs ignore for reproducibility from a fresh `supabase db reset`).

## Ambiguous

### `uuid-ossp` (extension)
- **Type:** extension
- **Lives on:** remote DB, in schema `extensions`, version `1.1`
- **Captured by:** NONE
- **Source query:** `SELECT extname, extversion, n.nspname FROM pg_extension e JOIN pg_namespace n ON e.extnamespace = n.oid;`
- **Status:** Installed by Supabase at project provisioning. Not referenced anywhere in the app — all migrations use `gen_random_uuid()` from `pgcrypto` (which IS captured at `20260503120000_phase1_auth_tenants_agents.sql`). Functionally unused by Base Shop HQ.
- **Risk if not captured:** Fresh `supabase db reset` produces a stack without `uuid-ossp`. Since the app doesn't call `uuid_generate_v4()` etc., this has zero functional impact. Only matters if a future migration starts using it.
- **Proposed fix:** Either (a) leave uncaptured and rely on Supabase project defaults for this extension, or (b) add a one-line baseline migration `supabase/migrations/<timestamp>_baseline_uuid_ossp_extension.sql` containing `CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;` for reproducibility, formatted matching `20260101000000_baseline_rls_auto_enable.sql`. Recommend (a) — leave uncaptured — since extension is unused.

### `pg_stat_statements` (extension)
- **Type:** extension
- **Lives on:** remote DB, in schema `extensions`, version `1.11`
- **Captured by:** NONE
- **Source query:** `SELECT extname, extversion, n.nspname FROM pg_extension e JOIN pg_namespace n ON e.extnamespace = n.oid;`
- **Status:** Standard Supabase default extension for query performance monitoring. Not used by app DDL. Owned by Supabase platform tooling, not by the app.
- **Risk if not captured:** Local stack from `supabase db reset` is missing query-stats observability. Zero functional impact on app behavior.
- **Proposed fix:** Same as `uuid-ossp` — recommend leaving uncaptured. If desired for reproducibility, add a one-line baseline migration formatted matching `20260101000000_baseline_rls_auto_enable.sql`.

## Notes

- **Commission-trigger rename pending deploy.** Commit `600a40c` (today) renamed the `policies_recalc_on_issued` trigger function and trigger to `policies_recalc_on_status_change` via migration `20260512130000_fix_commission_trigger_to_fire_on_all_status_changes.sql`. That migration has not yet been pushed to remote — remote still shows the OLD name (`policies_recalc_on_issued`) in `pg_proc` and `pg_trigger`. The new migration file references the NEW name. Per the audit charter, this is a **pending-deploy gap**, not drift. Captured by the pending migration; will reconcile on next `supabase db push`.

- **Six Supabase-managed event triggers (not drift).** Remote has 7 event triggers; only `ensure_rls` is the app's. The other 6 (`issue_graphql_placeholder`, `issue_pg_cron_access`, `issue_pg_graphql_access`, `issue_pg_net_access`, `pgrst_ddl_watch`, `pgrst_drop_watch`) are owned by `supabase_admin` and invoke functions in the Supabase platform layer (`set_graphql_placeholder`, `grant_pg_cron_access`, `grant_pg_graphql_access`, `grant_pg_net_access`, `pgrst_ddl_watch`, `pgrst_drop_watch`). These are part of the Supabase managed infrastructure for PostgREST schema cache invalidation and extension permission grants — they exist on every Supabase project by default and should NOT be captured as app migrations.

- **Three roles outside the user's exclusion list (not drift).**
  - `pg_maintain` — built into Postgres 16+ as a default role (user's exclusion list was PG15-era and omitted it; not app-owned).
  - `pgbouncer` — Supabase connection-pooler service role.
  - `supabase_privileged_role` — Supabase-managed elevated role.
  None have grants on the `public` schema (the `information_schema.role_table_grants` query returned 0 rows for non-default grantees). Not app drift.

- **52-function SECURITY DEFINER ledger remains intact.** Cross-referenced every DEFINER function on remote against the ledger in `docs/audit/security-hygiene-report.md`. Exactly 52 SECURITY DEFINER functions in `public`, all owned by `postgres`, all matching the ledger. The 5 INVOKER helpers on remote (`delete_agent_contract`, `enforce_comp_grid_rate_immutability`, `set_updated_at`, `sync_comp_grid_product_type`, `upsert_agent_contract`) are all defined in migration files and are not security-relevant.

- **All 56 RLS policies are tenant-scoped.** Every `qual` references either `current_tenant_id()`, `auth.uid()`, or both. No policy has `qual = 'true'`. No policy is permissive across tenants. Security posture is intact.

- **plpgsql and supabase_vault not flagged.** `plpgsql` is a core Postgres language extension installed in every Postgres database; never captured by migrations. `supabase_vault` (schema `vault`) is part of Supabase's managed secrets infrastructure; not an app concern.

## Cross-check matrix (for D-2 reviewer)

### Category 1 — Functions (57 total: 52 DEFINER + 5 INVOKER)

All 52 DEFINER functions hit ≥1 migration file via name grep. All 5 INVOKER functions hit ≥1 migration file:
- `delete_agent_contract` → `20260513100000_phase10e_contracts.sql`
- `enforce_comp_grid_rate_immutability` → `20260503140000_comp_grid_phase1_schema.sql`
- `set_updated_at` → `20260503130000_phase1_function_hardening.sql` (and 4 earlier table-creation files)
- `sync_comp_grid_product_type` → `20260503140000_comp_grid_phase1_schema.sql`
- `upsert_agent_contract` → `20260513100000_phase10e_contracts.sql`

### Category 2 — Event triggers (7 total)

- `ensure_rls` → `20260101000000_baseline_rls_auto_enable.sql` ✓
- Other 6: Supabase platform (see Notes).

### Category 3 — Table triggers (22 total)

All 22 triggers map to migration files via `TRIGGER <name>` grep. Includes 4 `updated_at` triggers, 5 `activity_*_trg` triggers, 2 upline-resolution triggers, 2 comp_grid_products sync triggers, 1 commission-rate immutability trigger, 2 policy commission/status triggers, and 6 other domain-specific triggers. Zero drift.

### Category 4 — Extensions (5 total)

- `pgcrypto` → `20260503120000_phase1_auth_tenants_agents.sql` ✓
- `plpgsql` → built-in (no migration needed)
- `pg_stat_statements` → AMBIGUOUS (see above)
- `uuid-ossp` → AMBIGUOUS (see above)
- `supabase_vault` → Supabase managed (no app migration needed)

### Category 5 — Types (5 total enums, no domains, no composites)

- `agent_status` → `20260503120000_phase1_auth_tenants_agents.sql` ✓
- `policy_status` → `20260503170000_phase4a_policies_schema.sql` ✓
- `policy_status_source` → `20260503170000_phase4a_policies_schema.sql` ✓
- `product_type` → `20260503140000_comp_grid_phase1_schema.sql` ✓
- `rate_source` → `20260503140000_comp_grid_phase1_schema.sql` ✓

### Category 6 — Views (2 total, 0 matviews)

- `agent_rates_with_product` → `20260504100000_phase6b_agent_overrides.sql` ✓
- `agents_with_current_position` → `20260503200000_phase6a_agents_directory.sql` ✓

### Category 7 — RLS policies (56 total)

All 56 policy names found via `POLICY <name>` grep in migrations. Span 19 tables: `activity_events`, `agent_carrier_rates`, `agent_contracts`, `agent_positions`, `agents`, `announcements`, `comp_grid_carriers`, `comp_grid_positions`, `comp_grid_products`, `comp_grid_rates`, `ingest_runs`, `policies`, `policy_commissions`, `policy_deletions_audit`, `policy_status_history`, `tenant_setup_state`, `tenants`. Zero drift. No security flags.

### Category 8 — Roles (3 extra)

- `pg_maintain`, `pgbouncer`, `supabase_privileged_role`: all platform-managed (see Notes). No grants on `public`. Not app drift.
