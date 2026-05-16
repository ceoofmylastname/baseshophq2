-- =============================================================================
-- Phase 18 PR 2 — Agencies table + tenants.agency_id pointer + auth-email RPC
--
-- SCOPE:
--   1. public.agencies — one row per owner-of-tenants holding company. Created
--      by the stripe-webhook on checkout.session.completed (Phase 19). The
--      `owner_user_id` column points at the auth.users row that owns the
--      agency. Marked nullable so we can `ON DELETE SET NULL` the FK and
--      preserve the agency record if the auth user is later deleted.
--      (Picked option (a) from the brief: drop NOT NULL on owner_user_id.)
--   2. tenants.agency_id — nullable pointer FK to agencies(id) ON DELETE SET
--      NULL. Phase 19 backfills + provisions; we ship the column now so the
--      signup-checkout webhook (deferred to PR 3) can write the FK at the
--      same time it provisions the tenant.
--   3. public.auth_user_exists_by_email(text) RETURNS boolean — SECURITY
--      DEFINER, locked search_path, service_role only. Called by the
--      signup-checkout Edge Function pre-Stripe to short-circuit when an
--      email is already registered. Returns boolean ONLY — no PII leak.
--
-- LISTS HONOURED FROM THE LOCKED PLAN:
--   * agencies columns: id, owner_user_id, name, created_at, updated_at (5)
--   * RPC guardrails: SECURITY DEFINER, locked search_path, STABLE, REVOKE
--     from PUBLIC/anon/authenticated, GRANT EXECUTE to service_role
--   * 4 internal DO-block verifications: agencies_exists, agency_id_nullable,
--     fk_constraint, rpc_definer_grants
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. public.agencies
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agencies (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Nullable so the FK can `ON DELETE SET NULL` and keep the agency row.
    -- Application-level guarantee: signup-checkout webhook always sets this
    -- to a real auth.users id at creation time.
    owner_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    name            text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.agencies.owner_user_id IS
    'auth.users.id of the agency owner. Nullable so ON DELETE SET NULL preserves the agency record if the user is deleted. Application contract: signup-checkout webhook always sets this at insert time.';

CREATE INDEX IF NOT EXISTS agencies_owner_user_id_idx
    ON public.agencies (owner_user_id);

-- updated_at trigger — uses the existing public.set_updated_at() helper
-- shipped in Phase 1 (matches tenants/agents convention, decision D10).
DROP TRIGGER IF EXISTS agencies_set_updated_at ON public.agencies;
CREATE TRIGGER agencies_set_updated_at
    BEFORE UPDATE ON public.agencies
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS — only SELECT for the owner. No INSERT/UPDATE/DELETE policies;
-- service_role bypasses RLS for webhook provisioning.
ALTER TABLE public.agencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agencies_select_owner ON public.agencies;
CREATE POLICY agencies_select_owner
    ON public.agencies FOR SELECT
    TO authenticated
    USING (auth.uid() = owner_user_id);


-- -----------------------------------------------------------------------------
-- 2. tenants.agency_id — nullable FK to agencies(id) ON DELETE SET NULL
-- -----------------------------------------------------------------------------
ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS agency_id uuid;

DO $$ BEGIN
    ALTER TABLE public.tenants
        ADD CONSTRAINT tenants_agency_id_fkey
        FOREIGN KEY (agency_id) REFERENCES public.agencies(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS tenants_agency_id_idx
    ON public.tenants (agency_id);

COMMENT ON COLUMN public.tenants.agency_id IS
    'Pointer to the parent agency. Nullable; Phase 19 backfills + the signup-checkout webhook (PR 3) writes this at provisioning time.';


-- -----------------------------------------------------------------------------
-- 3. public.auth_user_exists_by_email(text) — SECURITY DEFINER, locked
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER required because: cross-schema read of auth.users which service_role owns; the public schema needs a clean boolean check without exposing auth.users selection rights.
CREATE OR REPLACE FUNCTION public.auth_user_exists_by_email(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp, pg_catalog
AS $$
    SELECT EXISTS(
        SELECT 1 FROM auth.users WHERE lower(email) = lower(p_email)
    );
$$;

REVOKE EXECUTE ON FUNCTION public.auth_user_exists_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.auth_user_exists_by_email(text) TO service_role;

COMMENT ON FUNCTION public.auth_user_exists_by_email(text) IS
    'Phase 18 PR 2. Returns boolean only — zero PII. Called by signup-checkout Edge Function pre-Stripe to short-circuit when an email is already registered.';


-- -----------------------------------------------------------------------------
-- 4. Verification (4 DO-blocks per locked plan)
-- -----------------------------------------------------------------------------

-- (a) agencies_exists — table + all expected columns present
DO $$
DECLARE
    v_count integer;
BEGIN
    ASSERT to_regclass('public.agencies') IS NOT NULL,
        'agencies_exists FAILED: agencies table missing';

    SELECT count(*) INTO v_count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'agencies'
      AND column_name IN ('id','owner_user_id','name','created_at','updated_at');
    ASSERT v_count = 5,
        format('agencies_exists FAILED: expected 5 columns, found %s', v_count);

    RAISE NOTICE 'Verification 1/4 passed: agencies_exists.';
END $$;

-- (b) agency_id_nullable — tenants.agency_id exists and is nullable
DO $$
DECLARE
    v_nullable text;
BEGIN
    SELECT is_nullable INTO v_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'tenants'
      AND column_name  = 'agency_id';
    ASSERT v_nullable = 'YES',
        format('agency_id_nullable FAILED: expected nullable, got is_nullable=%s', COALESCE(v_nullable, '<missing>'));
    RAISE NOTICE 'Verification 2/4 passed: agency_id_nullable.';
END $$;

-- (c) fk_constraint — tenants.agency_id FK exists with ON DELETE SET NULL
DO $$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*) INTO v_count
    FROM pg_constraint c
    JOIN pg_class      tcls ON tcls.oid = c.conrelid
    JOIN pg_namespace  n    ON n.oid    = tcls.relnamespace
    WHERE n.nspname = 'public'
      AND tcls.relname = 'tenants'
      AND c.conname = 'tenants_agency_id_fkey'
      AND c.contype = 'f'
      AND c.confdeltype = 'n';  -- 'n' = ON DELETE SET NULL
    ASSERT v_count = 1,
        format('fk_constraint FAILED: expected 1 tenants_agency_id_fkey with ON DELETE SET NULL, found %s', v_count);
    RAISE NOTICE 'Verification 3/4 passed: fk_constraint.';
END $$;

-- (d) rpc_definer_grants — RPC exists, is SECURITY DEFINER, EXECUTE only to service_role
DO $$
DECLARE
    v_prosecdef boolean;
    v_anon_can  boolean;
    v_authd_can boolean;
    v_svc_can   boolean;
BEGIN
    SELECT p.prosecdef INTO v_prosecdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'auth_user_exists_by_email';
    ASSERT v_prosecdef IS TRUE,
        'rpc_definer_grants FAILED: auth_user_exists_by_email is not SECURITY DEFINER (or missing)';

    v_anon_can  := has_function_privilege('anon',          'public.auth_user_exists_by_email(text)', 'EXECUTE');
    v_authd_can := has_function_privilege('authenticated', 'public.auth_user_exists_by_email(text)', 'EXECUTE');
    v_svc_can   := has_function_privilege('service_role',  'public.auth_user_exists_by_email(text)', 'EXECUTE');

    ASSERT v_anon_can  = FALSE,
        'rpc_definer_grants FAILED: anon should NOT have EXECUTE on auth_user_exists_by_email';
    ASSERT v_authd_can = FALSE,
        'rpc_definer_grants FAILED: authenticated should NOT have EXECUTE on auth_user_exists_by_email';
    ASSERT v_svc_can   = TRUE,
        'rpc_definer_grants FAILED: service_role should HAVE EXECUTE on auth_user_exists_by_email';

    RAISE NOTICE 'Verification 4/4 passed: rpc_definer_grants.';
END $$;

COMMIT;
