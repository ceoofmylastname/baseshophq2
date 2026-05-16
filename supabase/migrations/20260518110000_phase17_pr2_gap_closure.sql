-- =============================================================================
-- Phase 17 PR 2 — Gap closure migration
--
-- Closes 8 spec gaps surfaced in a post-ship audit. SCHEMA-LEVEL CHANGES ONLY
-- live in this migration; the matching Edge Function / Stripe handler changes
-- live in supabase/functions/* and tests/* in the same PR.
--
-- ITEMS ADDRESSED HERE (the SQL-layer subset):
--   1. New table public.stripe_webhook_events for event_id-based idempotency,
--      RLS-enabled, service-role-only writer (no INSERT/UPDATE/DELETE
--      policy — service_role bypasses RLS).
--   2. public.tenants.payment_failure_count integer NOT NULL DEFAULT 0,
--      CHECK (payment_failure_count >= 0). Increment / reset / threshold
--      logic lives in the webhook handler.
--   3. pg_cron schedule swap: drop monthly `phase17_active_agent_snapshot`,
--      install daily `phase17_enterprise_snapshot` at 00:05 UTC. The Edge
--      Function itself gates on "is today the 1st OR is any prior-month
--      snapshot missing".
--   4. Edge Function rename active-agent-snapshot → enterprise-snapshot
--      (URL change reflected in this migration's cron schedule body).
--   6. Inline `-- SECURITY DEFINER required because: [reason]` comments on
--      the two helper RPCs from PR 2. We re-declare both functions here so
--      the comment can live immediately above each function block.
--
-- ITEMS ADDRESSED IN THE TS LAYER (out of this file, in this PR):
--   5. stripe-webhook bad-signature returns 401 (was 400).
--   7. enterprise-snapshot uses .upsert(..., { ignoreDuplicates: true }) on
--      billing_snapshots writes.
--   8. enterprise-snapshot filters tenants to billing_status IN
--      ('active','past_due'); skips cancelled / suspended.
--
-- ROLL-FORWARD ONLY: this migration does not attempt to undo state created
-- by the prior PR 2 migration. Re-applying is safe (everything is idempotent
-- via IF NOT EXISTS / DO EXCEPTION blocks).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. public.stripe_webhook_events — event_id-based webhook audit / idempotency
--
-- The webhook handler INSERTs one row per signature-verified event. The PK
-- is event_id, so Stripe redelivery → 23505 unique_violation, which the
-- handler interprets as "look at processed_at to decide whether to re-run".
-- processed_at is stamped only after the handler's state mutation commits.
-- raw is the full event JSON so we can replay or forensically inspect any
-- past delivery without a Stripe round-trip.
--
-- RLS model matches public.billing_snapshots: enable RLS, SELECT policy for
-- owners, no INSERT/UPDATE/DELETE policy. service_role bypasses RLS and is
-- the only writer; authenticated/anon cannot mutate.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id      text PRIMARY KEY,
  event_type    text NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  tenant_id     uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  raw           jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS stripe_webhook_events_type_received
  ON public.stripe_webhook_events (event_type, received_at DESC);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

-- Owner-only SELECT so an authenticated owner can audit their own tenant's
-- webhook delivery history if we ever surface it in-app. No mutation
-- policy → service_role is the only writer.
DROP POLICY IF EXISTS stripe_webhook_events_owner_select ON public.stripe_webhook_events;
CREATE POLICY stripe_webhook_events_owner_select ON public.stripe_webhook_events
  FOR SELECT
  USING (
    public.is_owner()
    AND tenant_id = public.current_tenant_id()
  );

-- -----------------------------------------------------------------------------
-- 2. public.tenants.payment_failure_count
--
-- Tracks the running tally of consecutive invoice.payment_failed events
-- since the last successful invoice.paid. Incremented in the webhook
-- handler; once the running count >= 3 the same UPDATE also flips
-- billing_status to 'past_due'. invoice.paid resets it back to 0.
-- -----------------------------------------------------------------------------
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS payment_failure_count integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.tenants
    ADD CONSTRAINT tenants_payment_failure_count_nonneg
    CHECK (payment_failure_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- 3. pg_cron: swap the schedule from monthly to daily with internal gate.
--
-- New schedule name: phase17_enterprise_snapshot (the Edge Function is also
-- renamed under supabase/functions/enterprise-snapshot/). The function body
-- itself decides whether to skip — daily cron is just a cheap heartbeat
-- that catches up if the 1st-of-month run errored.
--
-- On a fresh `supabase db reset --local` neither pg_cron nor pg_net is
-- enabled, so we gate the whole block on pg_namespace lookups. The DROP
-- (unschedule) for the old name might also raise on a fresh stack — handled
-- inside its own EXCEPTION block.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_project_url  text := 'https://oarstmxbgdczytwzpyxj.functions.supabase.co';
  v_cron_present boolean;
  v_net_present  boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') INTO v_cron_present;
  SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'net')  INTO v_net_present;

  IF NOT v_cron_present OR NOT v_net_present THEN
    RAISE NOTICE 'pg_cron present=% / pg_net present=% — skipping cron schedule swap. Operator must enable both extensions then re-apply.',
      v_cron_present, v_net_present;
    RETURN;
  END IF;

  -- Drop the OLD monthly schedule (PR 2). If it doesn't exist (fresh stack
  -- or already swapped), pg_cron raises "could not find schedule" — we
  -- swallow it.
  BEGIN
    PERFORM cron.unschedule('phase17_active_agent_snapshot');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Idempotency: also drop the new name first in case this migration is
  -- re-applied after a prior successful swap.
  BEGIN
    PERFORM cron.unschedule('phase17_enterprise_snapshot');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Install the new daily schedule. 00:05 UTC every day. The Edge Function
  -- gates on UTC day-of-month internally — non-1st-of-month runs fast-skip
  -- when no enterprise tenant is missing its prior-month snapshot.
  PERFORM cron.schedule(
    'phase17_enterprise_snapshot',
    '5 0 * * *',
    format($cron$
      SELECT net.http_post(
        url     := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Snapshot-Secret', COALESCE(public.get_vault_secret('active_agent_snapshot_secret'), '')
        ),
        body    := '{}'::jsonb
      );
    $cron$, v_project_url || '/enterprise-snapshot')
  );

  RAISE NOTICE 'phase17 cron schedule swapped to daily/enterprise-snapshot';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron swap failed: % (likely the old schedule never existed; safe to ignore on fresh stacks)', SQLERRM;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Re-declare the two SECURITY DEFINER helper RPCs with inline justification
--    comments. Bodies identical to PR 2; only the comment above each is new.
--
--    The comments lock in the *reason* the function is SECURITY DEFINER so a
--    future reviewer doesn't strip the qualifier without thinking. CREATE OR
--    REPLACE keeps the existing grant state (PostgreSQL preserves grants
--    across CREATE OR REPLACE), but we re-issue the REVOKE+GRANT pair anyway
--    for belt-and-braces.
-- -----------------------------------------------------------------------------

-- SECURITY DEFINER required because: needs to read vault.decrypted_secrets which only postgres / supabase_auth_admin own.
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

-- SECURITY DEFINER required because: called from Edge Functions running as service_role; pins the canonical 30-day predicate from wiki/active-agent-billing-model.md in one definition.
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
-- 5. Internal verification — runs at apply time. A failure aborts the migration.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_col_count     integer;
  v_default_text  text;
  v_grant_count   integer;
  v_func_exists   boolean;
  v_cron_present  boolean;
  v_new_present   boolean;
  v_old_present   boolean;
  v_test_tid      uuid;
  v_caught        boolean;
BEGIN
  -- Test 1: stripe_webhook_events table exists with all expected columns
  SELECT COUNT(*) INTO v_col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'stripe_webhook_events'
    AND column_name IN ('event_id','event_type','received_at','processed_at','tenant_id','raw');
  IF v_col_count <> 6 THEN
    RAISE EXCEPTION 'Test 1 FAILED: stripe_webhook_events missing one or more expected columns (found %)', v_col_count;
  END IF;

  -- Test 2: tenants.payment_failure_count exists with default 0
  SELECT column_default INTO v_default_text
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'tenants'
    AND column_name  = 'payment_failure_count';
  IF v_default_text IS NULL OR v_default_text NOT LIKE '0%' THEN
    RAISE EXCEPTION 'Test 2 FAILED: payment_failure_count default missing or not 0 (got %)', v_default_text;
  END IF;

  -- Test 3: CHECK constraint blocks payment_failure_count = -1.
  -- A PL/pgSQL BEGIN ... EXCEPTION block implicitly establishes an internal
  -- savepoint, so the bad UPDATE inside the inner BEGIN does NOT abort the
  -- enclosing DO transaction — exactly the SAVEPOINT pattern we want.
  v_test_tid := gen_random_uuid();
  INSERT INTO public.tenants (id, name, slug, current_plan_tier)
  VALUES (v_test_tid, 'gap-closure-verify', 'gap-closure-verify-' || replace(v_test_tid::text, '-', ''), 'starter');

  v_caught := false;
  BEGIN
    UPDATE public.tenants SET payment_failure_count = -1 WHERE id = v_test_tid;
    -- if no exception fired, the CHECK didn't block us
    RAISE EXCEPTION 'Test 3 FAILED: CHECK constraint did not block payment_failure_count = -1';
  EXCEPTION WHEN check_violation THEN
    v_caught := true;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'Test 3 FAILED: check_violation was not raised';
  END IF;

  DELETE FROM public.tenants WHERE id = v_test_tid;

  -- Test 4: both helper functions exist + service_role has EXECUTE + no anon/authenticated/PUBLIC
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_vault_secret'
  ) INTO v_func_exists;
  IF NOT v_func_exists THEN
    RAISE EXCEPTION 'Test 4 FAILED: public.get_vault_secret does not exist';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'compute_active_agent_count'
  ) INTO v_func_exists;
  IF NOT v_func_exists THEN
    RAISE EXCEPTION 'Test 4 FAILED: public.compute_active_agent_count does not exist';
  END IF;

  -- get_vault_secret: service_role only
  SELECT COUNT(*) INTO v_grant_count
  FROM information_schema.role_routine_grants
  WHERE specific_schema = 'public'
    AND routine_name    = 'get_vault_secret'
    AND grantee         = 'service_role'
    AND privilege_type  = 'EXECUTE';
  IF v_grant_count = 0 THEN
    RAISE EXCEPTION 'Test 4 FAILED: service_role missing EXECUTE on get_vault_secret';
  END IF;

  SELECT COUNT(*) INTO v_grant_count
  FROM information_schema.role_routine_grants
  WHERE specific_schema = 'public'
    AND routine_name    = 'get_vault_secret'
    AND grantee IN ('anon','authenticated','PUBLIC')
    AND privilege_type  = 'EXECUTE';
  IF v_grant_count > 0 THEN
    RAISE EXCEPTION 'Test 4 FAILED: anon/authenticated/PUBLIC has unexpected EXECUTE on get_vault_secret';
  END IF;

  -- compute_active_agent_count: service_role only
  SELECT COUNT(*) INTO v_grant_count
  FROM information_schema.role_routine_grants
  WHERE specific_schema = 'public'
    AND routine_name    = 'compute_active_agent_count'
    AND grantee         = 'service_role'
    AND privilege_type  = 'EXECUTE';
  IF v_grant_count = 0 THEN
    RAISE EXCEPTION 'Test 4 FAILED: service_role missing EXECUTE on compute_active_agent_count';
  END IF;

  SELECT COUNT(*) INTO v_grant_count
  FROM information_schema.role_routine_grants
  WHERE specific_schema = 'public'
    AND routine_name    = 'compute_active_agent_count'
    AND grantee IN ('anon','authenticated','PUBLIC')
    AND privilege_type  = 'EXECUTE';
  IF v_grant_count > 0 THEN
    RAISE EXCEPTION 'Test 4 FAILED: anon/authenticated/PUBLIC has unexpected EXECUTE on compute_active_agent_count';
  END IF;

  -- Test 5: if pg_cron is present, the new schedule is in cron.job and the
  -- old one is not. On a fresh stack (no pg_cron extension) we skip this
  -- assertion since the DO block above also skipped the install.
  SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') INTO v_cron_present;
  IF v_cron_present THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = $1)' INTO v_new_present USING 'phase17_enterprise_snapshot';
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = $1)' INTO v_old_present USING 'phase17_active_agent_snapshot';
    IF NOT v_new_present THEN
      RAISE EXCEPTION 'Test 5 FAILED: cron.job missing phase17_enterprise_snapshot schedule';
    END IF;
    IF v_old_present THEN
      RAISE EXCEPTION 'Test 5 FAILED: cron.job still contains phase17_active_agent_snapshot (should have been unscheduled)';
    END IF;
  END IF;

  RAISE NOTICE 'Phase 17 PR 2 gap closure verification passed.';
END $$;

COMMIT;
