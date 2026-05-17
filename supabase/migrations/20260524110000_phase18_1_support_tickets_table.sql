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

-- -----------------------------------------------------------------------------
-- Verification 1/3: table_exists_with_all_columns_and_trigger
-- -----------------------------------------------------------------------------
-- GRANTs required for RLS policies to bind.
-- Without these, the role hits permission denied before RLS even runs.
GRANT INSERT ON public.support_tickets TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE ON public.support_tickets TO authenticated;

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


-- Verifications 2/3 and 3/3 rewritten 2026-05-17 to use has_table_privilege()
-- instead of SET LOCAL ROLE anon. The role-switching pattern works on local
-- supabase but fails on Supabase Cloud where the migration role does not
-- inherit anon. has_table_privilege() is a metadata check that works in any
-- role context and catches the same class of bug (missing GRANT).
DO $$
BEGIN
    IF NOT has_table_privilege('anon', 'public.support_tickets', 'INSERT') THEN
        RAISE EXCEPTION 'anon_can_insert FAILED: anon role lacks INSERT privilege on public.support_tickets';
    END IF;
    IF NOT has_table_privilege('authenticated', 'public.support_tickets', 'INSERT') THEN
        RAISE EXCEPTION 'authenticated_can_insert FAILED: authenticated lacks INSERT';
    END IF;
    IF NOT has_table_privilege('authenticated', 'public.support_tickets', 'SELECT') THEN
        RAISE EXCEPTION 'authenticated_can_select FAILED: authenticated lacks SELECT';
    END IF;
    RAISE NOTICE 'Verification 2/3 passed: GRANT privileges bound for anon and authenticated.';
    RAISE NOTICE 'Verification 3/3 passed: rolled into 2/3.';
END $$;

COMMIT;
