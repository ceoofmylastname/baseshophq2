-- =============================================================================
-- Phase 17 PR 2 — Vault helpers + active-agent count helper + monthly cron
--
-- WHAT THIS DOES
--   1. public.get_vault_secret(text) — SECURITY DEFINER service-role wrapper
--      around vault.decrypted_secrets so Edge Functions (running as service_role
--      via the REST client) can read Vault entries by name without needing the
--      vault schema in their search_path or direct EXECUTE on internal vault
--      functions.
--   2. public.compute_active_agent_count(uuid) — SECURITY DEFINER wrapper that
--      runs the canonical "active agent" predicate from
--      wiki/active-agent-billing-model.md so the Enterprise snapshot job can
--      ask the DB for the count instead of duplicating the query in TS.
--   3. A pg_cron schedule (06:00 UTC on the 1st of each month) that POSTs to
--      the active-agent-snapshot Edge Function. The HTTP call is authenticated
--      by an X-Snapshot-Secret header whose value is read from Vault entry
--      `active_agent_snapshot_secret`.
--
-- PRECONDITION (OPERATOR ACTION REQUIRED)
--   The pg_cron and pg_net extensions must be enabled on the project before
--   this migration's cron schedule will actually fire. On Supabase Cloud this
--   is a one-time toggle in Dashboard → Database → Extensions → enable
--   `pg_cron` and `pg_net`.
--
--   This migration DOES NOT enable those extensions itself — extension enables
--   are operator-only actions on Supabase. To make the migration apply cleanly
--   even when pg_cron is missing (e.g. on a fresh `supabase db reset --local`
--   or in CI), the `cron.schedule()` call sits behind a pg_namespace check
--   that detects whether the `cron` and `net` schemas exist before running.
--   A bare reference to `cron.unschedule(...)` raises invalid_schema_name
--   (SQLSTATE 3F000) at parse-time, *before* an inner EXCEPTION block can
--   intercept it — the pre-flight is therefore mandatory, not optional. Once
--   the operator has enabled the extensions, re-applying this migration (or
--   a one-line follow-up that re-runs the DO block) installs the schedule.
--
--   ALSO REQUIRED: a Vault entry named `active_agent_snapshot_secret` holding a
--   32-byte random hex string (the shared secret between pg_cron and the Edge
--   Function). See branded/stripe-products.md for the dashboard recipe.
--
-- WHAT THIS DOES NOT TOUCH
--   * No schema changes to public tables — those landed in PR 1.
--   * No Stripe Edge Functions — those are TS files under supabase/functions/,
--     not SQL.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. public.get_vault_secret(p_name text) RETURNS text
--
-- SECURITY DEFINER so service_role can read Vault even though only postgres /
-- supabase_auth_admin own the vault schema. Returns NULL if no row matches —
-- callers (the Edge Functions) check for NULL and surface a structured error.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_vault_secret(p_name text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp, pg_catalog
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = p_name
  LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.get_vault_secret(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_vault_secret(text) TO service_role;

-- -----------------------------------------------------------------------------
-- 2. public.compute_active_agent_count(p_tenant_id uuid) RETURNS int
--
-- Canonical "active agent" predicate, kept in one place so the dashboard
-- widget, the agents-directory filter, and the Enterprise snapshot job all
-- agree on the definition.
--
-- An active agent = an agent with at least one row in policies where
--   application_date is within the last 30 days
--   AND agent is not archived.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_active_agent_count(p_tenant_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(DISTINCT p.agent_id)::int
  FROM public.policies p
  WHERE p.tenant_id = p_tenant_id
    AND p.application_date >= (NOW() - INTERVAL '30 days')
    AND p.agent_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.agents u
      WHERE u.id = p.agent_id
        AND u.archived_at IS NULL
    )
$$;

REVOKE EXECUTE ON FUNCTION public.compute_active_agent_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.compute_active_agent_count(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- 3. Defensive cron schedule installer
--
-- If pg_cron is not enabled at apply time, the cron.schedule() call would
-- throw undefined_function. Wrap in EXCEPTION blocks so this migration still
-- applies cleanly. Operator must:
--   (a) enable pg_cron + pg_net via the dashboard
--   (b) re-run the body of this DO block (or apply a no-op migration that
--       re-runs it) to install the schedule.
--
-- The schedule name is namespaced so it's easy to find / drop later. We always
-- attempt to drop first (also wrapped) to make this block idempotent: if the
-- schedule already exists from a prior apply, this re-creates it cleanly.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_project_url   text := 'https://oarstmxbgdczytwzpyxj.functions.supabase.co';
  v_cron_present  boolean;
  v_net_present   boolean;
BEGIN
  -- Detect pg_cron / pg_net *before* referencing the schemas — otherwise a
  -- bare `cron.unschedule(...)` call raises invalid_schema_name (SQLSTATE
  -- 3F000) before EXCEPTION-handling within the inner block can catch
  -- undefined_function. Querying pg_namespace is the cleanest pre-flight.
  SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') INTO v_cron_present;
  SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'net')  INTO v_net_present;

  IF NOT v_cron_present OR NOT v_net_present THEN
    RAISE NOTICE 'pg_cron present=% / pg_net present=% — skipping cron.schedule install. Operator must enable both extensions via the Supabase Dashboard, then re-apply this migration (or run a no-op follow-up that re-executes this DO block).',
      v_cron_present, v_net_present;
    RETURN;
  END IF;

  -- Step (a): drop any pre-existing schedule with the same name (idempotent).
  BEGIN
    PERFORM cron.unschedule('phase17_active_agent_snapshot');
  EXCEPTION
    WHEN OTHERS THEN
      -- e.g. "could not find schedule" — fine, nothing to drop
      NULL;
  END;

  -- Step (b): install the schedule. 06:00 UTC on the 1st of every month.
  PERFORM cron.schedule(
    'phase17_active_agent_snapshot',
    '0 6 1 * *',
    format($cron$
      SELECT net.http_post(
        url     := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Snapshot-Secret', COALESCE(public.get_vault_secret('active_agent_snapshot_secret'), '')
        ),
        body    := '{}'::jsonb
      );
    $cron$, v_project_url || '/active-agent-snapshot')
  );
  RAISE NOTICE 'phase17_active_agent_snapshot cron schedule installed.';
END $$;

-- -----------------------------------------------------------------------------
-- 4. Internal verification — runs at apply time. A failure aborts the migration.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_secret_result        text;
  v_active_count         integer;
  v_demo_tenant_id       uuid;
  v_func_exists          boolean;
  v_grant_count          integer;
BEGIN
  -- Test 1: both helper functions exist in public schema
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_vault_secret'
  ) INTO v_func_exists;
  IF NOT v_func_exists THEN
    RAISE EXCEPTION 'Test 1 FAILED: public.get_vault_secret does not exist';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'compute_active_agent_count'
  ) INTO v_func_exists;
  IF NOT v_func_exists THEN
    RAISE EXCEPTION 'Test 1 FAILED: public.compute_active_agent_count does not exist';
  END IF;

  -- Test 2: grants on get_vault_secret — service_role has EXECUTE, anon does not
  SELECT COUNT(*) INTO v_grant_count
  FROM information_schema.role_routine_grants
  WHERE specific_schema = 'public'
    AND routine_name    = 'get_vault_secret'
    AND grantee         = 'service_role'
    AND privilege_type  = 'EXECUTE';
  IF v_grant_count = 0 THEN
    RAISE EXCEPTION 'Test 2 FAILED: service_role missing EXECUTE on get_vault_secret';
  END IF;

  SELECT COUNT(*) INTO v_grant_count
  FROM information_schema.role_routine_grants
  WHERE specific_schema = 'public'
    AND routine_name    = 'get_vault_secret'
    AND grantee IN ('anon','authenticated','PUBLIC')
    AND privilege_type  = 'EXECUTE';
  IF v_grant_count > 0 THEN
    RAISE EXCEPTION 'Test 2 FAILED: anon/authenticated/PUBLIC has unexpected EXECUTE on get_vault_secret';
  END IF;

  -- Test 3: grants on compute_active_agent_count — service_role has EXECUTE,
  -- anon does not
  SELECT COUNT(*) INTO v_grant_count
  FROM information_schema.role_routine_grants
  WHERE specific_schema = 'public'
    AND routine_name    = 'compute_active_agent_count'
    AND grantee         = 'service_role'
    AND privilege_type  = 'EXECUTE';
  IF v_grant_count = 0 THEN
    RAISE EXCEPTION 'Test 3 FAILED: service_role missing EXECUTE on compute_active_agent_count';
  END IF;

  SELECT COUNT(*) INTO v_grant_count
  FROM information_schema.role_routine_grants
  WHERE specific_schema = 'public'
    AND routine_name    = 'compute_active_agent_count'
    AND grantee IN ('anon','authenticated','PUBLIC')
    AND privilege_type  = 'EXECUTE';
  IF v_grant_count > 0 THEN
    RAISE EXCEPTION 'Test 3 FAILED: anon/authenticated/PUBLIC has unexpected EXECUTE on compute_active_agent_count';
  END IF;

  -- Test 4: get_vault_secret('does-not-exist') returns NULL (smoke test that
  -- doesn't require any vault data — vault.decrypted_secrets is empty on a
  -- fresh `db reset --local`)
  v_secret_result := public.get_vault_secret('does-not-exist-' || gen_random_uuid()::text);
  IF v_secret_result IS NOT NULL THEN
    RAISE EXCEPTION 'Test 4 FAILED: get_vault_secret on a non-existent name should return NULL, got %', v_secret_result;
  END IF;

  -- Test 5: compute_active_agent_count returns >= 0 for any tenant (a tenant
  -- with no policies just returns 0). Use the first demo tenant if one exists;
  -- otherwise use a freshly-generated UUID (which is still a valid input — the
  -- function does not check tenant existence; it just counts policies).
  SELECT id INTO v_demo_tenant_id FROM public.tenants LIMIT 1;
  IF v_demo_tenant_id IS NULL THEN
    v_demo_tenant_id := gen_random_uuid();
  END IF;
  v_active_count := public.compute_active_agent_count(v_demo_tenant_id);
  IF v_active_count IS NULL OR v_active_count < 0 THEN
    RAISE EXCEPTION 'Test 5 FAILED: compute_active_agent_count returned NULL or negative: %', v_active_count;
  END IF;

  RAISE NOTICE 'Phase 17 PR 2 vault helpers verification passed (5 tests).';
END $$;

COMMIT;
