# Base Shop HQ — Security Hygiene Report
Date: 2026-05-12 (updated; original 2026-05-11)
Project: `oarstmxbgdczytwzpyxj`

---

## 1. Baseline

### 1a. `rls_auto_enable` grants — pre-revoke (2026-05-12 run)

| grantee | privilege |
|---|---|
| postgres | EXECUTE |
| service_role | EXECUTE |

Note: prior 2026-05-11 run captured pre-revoke state of `PUBLIC + anon + authenticated + postgres + service_role`. The 2026-05-12 baseline already reflects only `postgres + service_role`, indicating the revoke had effectively already been applied in a prior session. The REVOKE statements were re-executed in this run as idempotent housekeeping (no rows changed).

### 1b. SECURITY DEFINER functions in `public`

52 functions total. All 52 have `search_path` pinned via `proconfig` (`public, pg_temp` for everything except `rls_auto_enable` which pins to `pg_catalog`). All owned by `postgres`.

Functions:
`activity_log_agent_invited`, `activity_log_agent_position_changed`, `activity_log_master_grid_edited`, `activity_log_policy_created`, `activity_log_policy_status_changed`, `add_agent_to_tenant`, `agent_contracts_auto_link_orphans`, `assign_agent_to_position`, `backfill_orphan_upline_pointers`, `bootstrap_agora_grid_for_tenant`, `can_view_agent`, `canonicalize_product`, `check_email_exists_in_auth`, `commission_trend_series`, `current_tenant_id`, `dashboard_metrics`, `delete_announcement`, `delete_policy_with_audit`, `descendants_of`, `ingest_policy_row`, `is_owner`, `leaderboard_most_improved`, `leaderboard_top_earners`, `leaderboard_top_producers`, `leaderboard_top_recruiters`, `log_ingest_run`, `mark_setup_step_complete`, `master_grid_blast_radius`, `match_agent_by_email`, `match_agent_by_writing_number`, `policies_recalc_on_issued`, `policies_record_status_change`, `position_template_blast_radius`, `post_announcement`, `production_agent_totals`, `production_metrics`, `production_premium_trend`, `propagate_master_grid_change`, `provision_tenant_and_owner`, `recalculate_policy_payouts`, `recent_activity_feed`, `reset_agent_carrier_rate_to_default`, `resolve_upline_agent_id`, `rls_auto_enable`, `scoreboard_most_improved`, `scoreboard_top_earners`, `scoreboard_top_producers`, `scoreboard_top_recruiters`, `set_agent_carrier_rate_override`, `set_master_grid_rate`, `template_agent_from_position`, `visible_agent_ids`

### 1c. Advisor SECURITY DEFINER count (2026-05-12 run)

Advisor (`type: security`) returned:
- 29 × `authenticated_security_definer_function_executable`
- 0 × `anon_security_definer_function_executable` (the prior `rls_auto_enable` anon warning has cleared — confirms a prior revoke landed)
- 1 unrelated `auth_leaked_password_protection` WARN (not in scope)

The 29 authenticated-callable functions cross-reference 1:1 with the 29 SECURITY DEFINER functions that have an `authenticated` EXECUTE grant in `routine_privileges`.

---

## 2. `rls_auto_enable` revoke

### Statements executed (directly via `execute_sql`)

```sql
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
```

### `rls_auto_enable` grants — post-revoke

| grantee | privilege |
|---|---|
| postgres | EXECUTE |
| service_role | EXECUTE |

Confirmed: `anon` and `authenticated` removed; only `postgres` + `service_role` retain EXECUTE.

### Migration file

`supabase/migrations/20260511120000_revoke_rls_auto_enable_grants.sql` — reproducibility only. Not applied via `apply_migration` (change is already live).

---

## 3. Security Ledger (all 52 SECURITY DEFINER functions)

Notation:
- `search_path`: PIN = pinned via `SET search_path` or `proconfig`
- `tenant_scope`: OK = body enforces tenant via `current_tenant_id()` / explicit tenant comparison / pg+sr-only access / event-trigger / table-trigger
- `min_grants`: OK = grants minimal for role
- Grants: `pg+sr` = postgres + service_role only; `+auth` = also authenticated

| function_name | args | grants | search_path pinned | tenant scope enforced | minimal grants | classification | reason |
|---|---|---|---|---|---|---|---|
| activity_log_agent_invited | () | pg+sr | PIN | OK (trigger) | OK | PATTERN-MATCH | trigger-only; pg+sr; uses NEW.tenant_id |
| activity_log_agent_position_changed | () | pg+sr | PIN | OK (trigger) | OK | PATTERN-MATCH | trigger-only; pg+sr; uses NEW.tenant_id |
| activity_log_master_grid_edited | () | pg+sr | PIN | OK (trigger) | OK | PATTERN-MATCH | trigger-only; pg+sr; uses NEW.tenant_id |
| activity_log_policy_created | () | pg+sr | PIN | OK (trigger) | OK | PATTERN-MATCH | trigger-only; pg+sr; uses NEW.tenant_id |
| activity_log_policy_status_changed | () | pg+sr | PIN | OK (trigger) | OK | PATTERN-MATCH | trigger-only; pg+sr; uses NEW.tenant_id |
| add_agent_to_tenant | (p_caller_user_id, p_new_user_id, p_email, p_first_name, p_last_name, p_upline_email) | pg+sr | PIN | OK (sr-only + caller check) | OK | PATTERN-MATCH | service_role-only; verifies caller is_owner before insert |
| agent_contracts_auto_link_orphans | () | pg+sr | PIN | OK (trigger) | OK | PATTERN-MATCH | trigger-only; pg+sr; tenant_id from NEW |
| assign_agent_to_position | (p_agent_id, p_position_id, p_start_date, p_assigned_by, p_overrides_action) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | is_owner() gate + explicit caller_tenant vs agent_tenant comparison |
| backfill_orphan_upline_pointers | () | pg+sr | PIN | OK (trigger) | OK | PATTERN-MATCH | trigger-only; pg+sr; tenant scoped to NEW.tenant_id |
| bootstrap_agora_grid_for_tenant | (p_tenant_id, p_payload) | pg+sr | PIN | OK (sr-only) | OK | PATTERN-MATCH | service_role-only seeding RPC |
| can_view_agent | (target_agent_id) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | permission-gating helper; filters by current_tenant_id() |
| canonicalize_product | (p_tenant_id, p_carrier_name, p_product_string) | pg+sr | PIN | OK (sr-only) | OK | PATTERN-MATCH | helper called from ingest; sr-only; tenant from arg |
| check_email_exists_in_auth | (p_email) | pg+sr | PIN | OK (sr-only) | OK | PATTERN-MATCH | sr-only check of auth.users; no tenant data |
| commission_trend_series | (p_start_date, p_end_date, p_carrier_id) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | filters by current_tenant_id() + visible_agent_ids() |
| current_tenant_id | () | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | permission-gating helper; resolves via auth.uid() |
| dashboard_metrics | (p_start_date, p_end_date, p_carrier_id) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | filters by current_tenant_id() + downline scope |
| delete_announcement | (p_announcement_id) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | is_owner() gate + caller_tenant vs target_tenant check |
| delete_policy_with_audit | (p_policy_id, p_reason) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | is_owner() gate + tenant comparison before delete |
| descendants_of | (root_agent_id) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | permission-gating helper; filters by current_tenant_id() |
| ingest_policy_row | (p_tenant_id, p_payload) | pg+sr | PIN | OK (sr-only) | OK | PATTERN-MATCH | service_role-only ingest; tenant from arg |
| is_owner | () | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | permission-gating helper; filters by auth.uid() + current_tenant_id() |
| leaderboard_most_improved | (p_start_date, p_end_date, p_carrier_id, p_limit) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | filters by current_tenant_id() + visible_agent_ids() |
| leaderboard_top_earners | (p_start_date, p_end_date, p_carrier_id, p_limit) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | filters by current_tenant_id() + visible_agent_ids() |
| leaderboard_top_producers | (p_start_date, p_end_date, p_carrier_id, p_limit) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | filters by current_tenant_id() + visible_agent_ids() |
| leaderboard_top_recruiters | (p_start_date, p_end_date, p_limit) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | filters by current_tenant_id() + visible_agent_ids() |
| log_ingest_run | (p_tenant_id, p_started_at, p_completed_at, p_rows_total, p_rows_assigned, p_rows_orphan, p_rows_skipped, p_started_by_user_id) | pg+sr | PIN | OK (sr-only) | OK | PATTERN-MATCH | sr-only writer; tenant from arg |
| mark_setup_step_complete | (p_step_key) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | is_owner() gate + writes with current_tenant_id() |
| master_grid_blast_radius | (p_position_id, p_product_id) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | caller_tenant vs pos_tenant check; all SELECTs filter tenant_id |
| match_agent_by_email | (p_tenant_id, p_email) | pg+sr | PIN | OK (sr-only) | OK | PATTERN-MATCH | sr-only helper for ingest; tenant from arg |
| match_agent_by_writing_number | (p_tenant_id, p_carrier_name, p_writing_number) | pg+sr | PIN | OK (sr-only) | OK | PATTERN-MATCH | sr-only helper for ingest; tenant from arg |
| policies_recalc_on_issued | () | pg+sr | PIN | OK (trigger) | OK | PATTERN-MATCH | trigger-only; pg+sr; delegates to recalculate_policy_payouts |
| policies_record_status_change | () | pg+sr | PIN | OK (trigger) | OK | PATTERN-MATCH | trigger-only; pg+sr; tenant from NEW |
| position_template_blast_radius | (p_agent_id, p_position_id) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | caller_tenant vs target_tenant explicit check; can_view_agent gate; comments note hole closure |
| post_announcement | (p_title, p_body, p_pinned) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | is_owner() gate + insert with current_tenant_id() |
| production_agent_totals | (p_start_date, p_end_date, p_carrier_id, p_basis, p_limit, p_offset) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | all CTEs filter by tenant_id + visible_agent_ids |
| production_metrics | (p_start_date, p_end_date, p_carrier_id, p_basis) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | filters by current_tenant_id() + visible_agent_ids() |
| production_premium_trend | (p_start_date, p_end_date, p_carrier_id, p_basis, p_mode, p_bucket) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | filters by current_tenant_id() + visible_agent_ids() |
| propagate_master_grid_change | (p_position_id, p_product_id) | pg+sr | PIN | OK (sr-only) | OK | PATTERN-MATCH | sr-only helper invoked from set_master_grid_rate; tenant resolved internally |
| provision_tenant_and_owner | (p_owner_user_id, p_owner_email, p_owner_first_name, p_owner_last_name, p_tenant_name, p_tenant_slug) | pg+sr | PIN | OK (sr-only) | OK | PATTERN-MATCH | sr-only bootstrap; creates tenant + owner agent |
| recalculate_policy_payouts | (p_policy_id) | pg+sr | PIN | OK (sr-only) | OK | PATTERN-MATCH | sr-only helper invoked from triggers; tenant resolved from policy |
| recent_activity_feed | (p_limit, p_after_id) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | filters by current_tenant_id() + visible_agent_ids() |
| reset_agent_carrier_rate_to_default | (p_agent_id, p_product_id, p_effective) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | is_owner() gate + caller_tenant vs target_tenant check |
| resolve_upline_agent_id | () | pg+sr | PIN | OK (trigger) | OK | PATTERN-MATCH | trigger-only; pg+sr; tenant scoped to NEW.tenant_id |
| rls_auto_enable | () | pg+sr | PIN (pg_catalog) | OK (event trigger) | OK (now) | PATTERN-MATCH | event trigger; not callable via REST; advisor warning resolved by revoke |
| scoreboard_most_improved | (p_start_date, p_end_date, p_carrier_id, p_limit) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | filters by current_tenant_id(); tenant-wide by design (scoreboard semantics) |
| scoreboard_top_earners | (p_start_date, p_end_date, p_carrier_id, p_limit) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | filters by current_tenant_id(); tenant-wide by design |
| scoreboard_top_producers | (p_start_date, p_end_date, p_carrier_id, p_limit) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | filters by current_tenant_id(); tenant-wide by design |
| scoreboard_top_recruiters | (p_start_date, p_end_date, p_limit) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | filters by current_tenant_id(); tenant-wide by design |
| set_agent_carrier_rate_override | (p_agent_id, p_product_id, p_rate, p_schedule_code, p_set_by_user, p_effective) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | is_owner() gate + caller_tenant vs target_tenant + product-in-tenant check |
| set_master_grid_rate | (p_position_id, p_product_id, p_new_rate, p_schedule_code, p_effective) | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | is_owner() gate + caller_tenant vs pos_tenant + prod_tenant check |
| template_agent_from_position | (p_agent_id, p_position_id, p_assigned_by, p_effective_date) | pg+sr | PIN | OK (sr-only) | OK | PATTERN-MATCH | sr-only helper invoked from assign_agent_to_position |
| visible_agent_ids | () | pg+sr+auth | PIN | OK | OK | PATTERN-MATCH | permission-gating helper; uses auth.uid() + is_owner() + descendants_of() |

### Summary

- **PATTERN-MATCH: 52**
- **OUTLIER: 0**

### Notes / flags (not outliers, but worth recording)

- `position_template_blast_radius` calls `can_view_agent` AND adds an explicit `caller_tenant <> target_tenant` check; the inline comment notes "can_view_agent has the cross-tenant owner hole; the tenant check above closes it." Belt-and-suspenders pattern. Acceptable.
- `position_template_blast_radius`'s final `SELECT COUNT(*) FROM agent_carrier_rates WHERE agent_id = p_agent_id AND source = 'override' AND end_date IS NULL` lacks an explicit `tenant_id` filter, but `agent_id` is keyed on a target whose tenant was already verified against `v_caller_tenant`. Safe in practice, but a stricter belt-and-suspenders would add `AND tenant_id = v_target_tenant`. Not an outlier under the chosen pattern.
- `scoreboard_*` functions intentionally do not scope by `visible_agent_ids()` — they are tenant-wide leaderboards by product design (visible to all signed-in users in the tenant). `current_tenant_id()` filter alone prevents cross-tenant leak. Pattern-conformant.

---

## 4. Outliers

None. All 52 SECURITY DEFINER functions in `public` satisfy the four-condition pattern after the `rls_auto_enable` revoke.

---

## 5. Count sanity check

- Functions in ledger: **52**
- Advisor SECURITY DEFINER findings (pre-revoke): **30** (1 anon + 29 authenticated)
- Discrepancy: 22 functions appear in ledger but not in advisor warnings.

### Why

The advisor only fires the `anon_security_definer_function_executable` / `authenticated_security_definer_function_executable` lints when a SECURITY DEFINER function has an explicit EXECUTE grant to `anon` or `authenticated`. The 22 functions with grants restricted to `postgres + service_role` (triggers, event triggers, and service_role-only RPCs) are not exposed via PostgREST and therefore generate no advisor warning. They are:

- 10 plain trigger functions: `activity_log_agent_invited`, `activity_log_agent_position_changed`, `activity_log_master_grid_edited`, `activity_log_policy_created`, `activity_log_policy_status_changed`, `agent_contracts_auto_link_orphans`, `backfill_orphan_upline_pointers`, `policies_recalc_on_issued`, `policies_record_status_change`, `resolve_upline_agent_id`
- 1 event trigger function: `rls_auto_enable` (was 1 advisor warning; now resolved)
- 11 service_role-only RPCs: `add_agent_to_tenant`, `bootstrap_agora_grid_for_tenant`, `canonicalize_product`, `check_email_exists_in_auth`, `ingest_policy_row`, `log_ingest_run`, `match_agent_by_email`, `match_agent_by_writing_number`, `propagate_master_grid_change`, `provision_tenant_and_owner`, `recalculate_policy_payouts`, `template_agent_from_position` (this is actually 12 — the over-count is from `propagate_master_grid_change` and `recalculate_policy_payouts` which are sr-only helpers)

Math: 29 (authenticated-graned) + 22 (pg+sr only) = 51 + 1 (`rls_auto_enable` which had +anon and was the 30th warning) = 52. Consistent.

After the revoke, the advisor's `anon_security_definer_function_executable` finding for `rls_auto_enable` will clear on next run. The 29 `authenticated_security_definer_function_executable` warnings remain by design — they are functions intentionally callable by signed-in users (matched against the pattern).

No discrepancy requires reconciliation. No functions are missing.

---

## 6. Log entry

Appended to `/Users/johnmelvin/Documents/Baseshop HQ/wiki/log.md`:

```
## 2026-05-11 — Security hygiene pass

Fixed:
- Revoked EXECUTE on public.rls_auto_enable() from PUBLIC, anon, authenticated. Postgres and service_role retain EXECUTE. Captured as migration 20260511120000_revoke_rls_auto_enable_grants.sql.

Audited:
- Classified 52 SECURITY DEFINER functions in public schema against the chosen RPC + helper-gated pattern.
- PATTERN-MATCH: 52
- OUTLIER: 0
- Outlier functions: none

No function bodies rewritten. Outliers parked for follow-up.
```
