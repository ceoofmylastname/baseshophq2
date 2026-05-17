-- =============================================================================
-- Phase 18.1 — public.support_tickets
--
-- Single-table support funnel that supersedes the demo_bookings-as-support
-- shim used in Phase 18 PR 2 ContactSupportModal. Anonymous + authenticated
-- visitors can INSERT; reads/updates/deletes gated to public.is_owner() for
-- now (single-platform-admin scenario; see TODO(platform_admins) below).
--
-- RLS mirrors demo_bookings exactly (locked D13). Owner-side triage UI is
-- deferred to a follow-up phase; this migration just establishes the table
-- and capture surface.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.support_tickets (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email        text NOT NULL,
    subject      text NOT NULL,
    message      text NOT NULL,
    source       text,
    status       text NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new', 'triaged', 'resolved', 'archived')),
    tenant_id    uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
    assigned_to  text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    resolved_at  timestamptz,
    notes        text
);

CREATE INDEX IF NOT EXISTS support_tickets_status_created_idx
    ON public.support_tickets (status, created_at DESC);

COMMENT ON TABLE public.support_tickets IS
    'Phase 18.1. Support requests captured from the marketing surface, signup-success page, and (future) in-app support widgets. Anon + authenticated INSERT; reads/updates/deletes gated to platform admins.';

COMMENT ON COLUMN public.support_tickets.tenant_id IS
    'Optional FK to the requester''s tenant. Nullable so unauthenticated submissions still work; ON DELETE SET NULL so tickets survive if a tenant is later deleted.';

DROP TRIGGER IF EXISTS support_tickets_set_updated_at ON public.support_tickets;
CREATE TRIGGER support_tickets_set_updated_at
    BEFORE UPDATE ON public.support_tickets
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- TODO(platform_admins): support_tickets and demo_bookings both gate
-- SELECT/UPDATE/DELETE on public.is_owner(), which returns true for any
-- owner of any tenant. In a multi-tenant world this means every tenant
-- owner can read every other tenant's support tickets. Today the platform
-- only has the operator's own test tenants so blast radius is zero, but
-- when the platform_admins table lands these policies need to flip from
-- is_owner() to is_platform_admin(). Do NOT ship a fix that silently
-- weakens this isolation pattern. Track context in this comment.

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

-- Anonymous + authenticated visitors can both insert. Treat this as a
-- public support-capture endpoint. Mirrors demo_bookings_insert_anon.
DROP POLICY IF EXISTS support_tickets_insert_anon ON public.support_tickets;
CREATE POLICY support_tickets_insert_anon ON public.support_tickets
    FOR INSERT TO anon, authenticated
    WITH CHECK (
        char_length(trim(email))   > 0
        AND char_length(trim(subject)) > 0
        AND char_length(trim(message)) > 0
        AND email LIKE '%_@__%.__%'
    );

-- Reads are platform-admin only. See TODO(platform_admins) above.
DROP POLICY IF EXISTS support_tickets_select_owner ON public.support_tickets;
CREATE POLICY support_tickets_select_owner ON public.support_tickets
    FOR SELECT TO authenticated
    USING (public.is_owner());

DROP POLICY IF EXISTS support_tickets_update_owner ON public.support_tickets;
CREATE POLICY support_tickets_update_owner ON public.support_tickets
    FOR UPDATE TO authenticated
    USING (public.is_owner())
    WITH CHECK (public.is_owner());

DROP POLICY IF EXISTS support_tickets_delete_owner ON public.support_tickets;
CREATE POLICY support_tickets_delete_owner ON public.support_tickets
    FOR DELETE TO authenticated
    USING (public.is_owner());

GRANT INSERT ON public.support_tickets TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_tickets TO authenticated;


-- -----------------------------------------------------------------------------
-- Verification 1/3: table_exists_with_all_columns_and_trigger
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_col_count   integer;
    v_check_exists integer;
    v_trigger_exists integer;
    v_index_exists integer;
BEGIN
    ASSERT to_regclass('public.support_tickets') IS NOT NULL,
        'table_exists FAILED: support_tickets table missing';

    SELECT count(*) INTO v_col_count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'support_tickets'
      AND column_name IN (
          'id', 'email', 'subject', 'message', 'source', 'status',
          'tenant_id', 'assigned_to', 'created_at', 'updated_at',
          'resolved_at', 'notes'
      );
    ASSERT v_col_count = 12,
        format('table_exists FAILED: expected 12 columns, found %s', v_col_count);

    SELECT count(*) INTO v_check_exists
    FROM pg_constraint c
    JOIN pg_class      t ON t.oid = c.conrelid
    JOIN pg_namespace  n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'support_tickets'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%status%new%triaged%resolved%archived%';
    ASSERT v_check_exists = 1,
        format('table_exists FAILED: expected status CHECK constraint with 4 values, found %s', v_check_exists);

    SELECT count(*) INTO v_trigger_exists
    FROM pg_trigger
    WHERE tgname = 'support_tickets_set_updated_at'
      AND NOT tgisinternal;
    ASSERT v_trigger_exists = 1,
        format('table_exists FAILED: expected support_tickets_set_updated_at trigger, found %s', v_trigger_exists);

    SELECT count(*) INTO v_index_exists
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'support_tickets'
      AND indexname  = 'support_tickets_status_created_idx';
    ASSERT v_index_exists = 1,
        format('table_exists FAILED: expected status,created_at DESC index, found %s', v_index_exists);

    RAISE NOTICE 'Verification 1/3 passed: table_exists_with_all_columns_and_trigger.';
END $$;


-- -----------------------------------------------------------------------------
-- Verification 2/3: anon_can_insert (positive case)
--
-- Switch to the anon role to confirm the policy's WITH CHECK allows valid
-- INSERTs and the GRANT INSERT actually applies. The transaction's
-- superuser context is restored by RESET ROLE before cleanup.
--
-- Migrations run as postgres which bypasses RLS unless we explicitly
-- switch role, so this is the only way to exercise the policy in-band.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_policy_count integer;
    v_inserted_count integer;
BEGIN
    -- Sanity: the INSERT policy exists in pg_policies for anon.
    SELECT count(*) INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'support_tickets'
      AND policyname = 'support_tickets_insert_anon'
      AND cmd        = 'INSERT'
      AND 'anon' = ANY(roles);
    ASSERT v_policy_count = 1,
        format('anon_can_insert FAILED: pg_policies missing INSERT/anon entry; count=%s', v_policy_count);

    -- Exercise the policy as the anon role. SET LOCAL ROLE binds the
    -- change to this transaction so other migrations aren't affected.
    --
    -- Important: we INSERT without RETURNING. RETURNING on INSERT also
    -- engages the SELECT policy on the returned row, and anon is not in
    -- the SELECT policy's role list (only authenticated owners are), so
    -- INSERT + RETURNING would fail with a misleading "row violates RLS"
    -- error even though the INSERT itself is policy-compliant. Real
    -- application code on supabase-js sends INSERT without RETURNING by
    -- default; the verification mirrors that path.
    SET LOCAL ROLE anon;
    BEGIN
        INSERT INTO public.support_tickets (email, subject, message)
        VALUES ('verif@example.com', 'Contact request from verification', 'Hello support.');
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        RAISE EXCEPTION 'anon_can_insert FAILED: anon INSERT raised % (SQLSTATE %)', SQLERRM, SQLSTATE;
    END;
    RESET ROLE;

    -- Confirm exactly one row landed.
    SELECT count(*) INTO v_inserted_count
    FROM public.support_tickets
    WHERE email = 'verif@example.com';
    ASSERT v_inserted_count = 1,
        format('anon_can_insert FAILED: expected exactly 1 inserted row, found %s', v_inserted_count);

    -- Clean up the synthetic row before the transaction commits.
    DELETE FROM public.support_tickets WHERE email = 'verif@example.com';
    RAISE NOTICE 'Verification 2/3 passed: anon_can_insert.';
END $$;


-- -----------------------------------------------------------------------------
-- Verification 3/3: anon_cannot_select (negative case)
--
-- Insert a row as postgres, then attempt to read it as anon. RLS should
-- silently return zero rows (no error — Postgres RLS filters on SELECT).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_id uuid;
    v_visible_count integer;
BEGIN
    INSERT INTO public.support_tickets (email, subject, message)
    VALUES ('rls-probe@example.com', 'rls-probe subject', 'rls-probe message')
    RETURNING id INTO v_id;

    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_visible_count
    FROM public.support_tickets
    WHERE id = v_id;
    RESET ROLE;

    ASSERT v_visible_count = 0,
        format('anon_cannot_select FAILED: expected 0 rows visible to anon, got %s', v_visible_count);

    -- Clean up
    DELETE FROM public.support_tickets WHERE id = v_id;
    RAISE NOTICE 'Verification 3/3 passed: anon_cannot_select.';
END $$;

COMMIT;
