-- =============================================================================
-- Phase 19.1 -- announcements: audit columns + read RPC
--
-- Renamed in intent (not in filename). The original brief called this PR a
-- "tighten RLS" pass. Checkpoint S-2 reconnaissance proved RLS is already at
-- the target state:
--   * Phase 10A shipped is_owner()-only INSERT/UPDATE/DELETE policies
--     (phase10a_dashboard_schema.sql, lines 85 through 99).
--   * Phase 17 PR 3a layered tenant_writes_allowed() billing-lifecycle guards
--     on top (phase17_pr3a_billing_lifecycle.sql, lines 271 through 292).
-- This migration adds only the audit columns and the read RPC that the
-- upcoming Settings UI (PR 19.2) and home-page card rewrite (PR 19.3) need.
--
-- See wiki/announcements-authoring.md for the full lock list (D-1 through D-8).
--
-- -----------------------------------------------------------------------------
-- Deliberate omissions (per Phase 19.1 locks):
--
-- This migration does NOT:
--   * Rewrite or modify RLS policies. Existing is_owner() + tenant_writes_allowed()
--     are correct; the DO-block at section 3 verifies they still bind.
--   * Rename the pinned column. The frontend (useAnnouncements.ts line 70) has
--     a direct-update path keyed on that name; rename would break it.
--   * Add is_active, start_at, end_at, image_url, cta_text, cta_url, or
--     targeting columns. Deferred until the Settings UI actually needs them.
--   * Redefine the existing post_announcement(text,text,boolean) or
--     delete_announcement(uuid) RPCs. PR 19.2 swaps the frontend over to
--     upsert_announcement, after which a small cleanup will retire
--     post_announcement once nothing references it.
--   * Introduce an admin role, an audit_log table, or an is_admin_or_owner
--     helper. Those are separate future phases.
--
-- -----------------------------------------------------------------------------
-- FK target divergence from the brief (deliberate):
--
-- Brief specified updated_by_user_id REFERENCES auth.users(id). Project
-- convention on operating tables is REFERENCES public.agents(id), evidenced by
-- the same-table column posted_by_user_id and by ingest_runs.started_by_user_id,
-- comp_grid_rates.set_by_user_id, policies.deleted_by_user_id, and
-- activity_events.actor_user_id. Mirroring the same-table convention preserves
-- consistency. Per Phase 1, agents.id = auth.uid() so the practical lookup is
-- still auth.uid() with no subquery cost.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Audit columns + trigger
-- =============================================================================

ALTER TABLE public.announcements
    ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES public.agents(id);

ALTER TABLE public.announcements
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.announcements.updated_by_user_id IS
    'Phase 19.1. Set to auth.uid() on every UPDATE via upsert_announcement. NULL on rows created before this migration. FK target is public.agents(id) to mirror the same-table posted_by_user_id convention.';

COMMENT ON COLUMN public.announcements.updated_at IS
    'Phase 19.1. Maintained by announcements_set_updated_at trigger; mirrors the leadership_broadcasts_set_updated_at pattern.';

-- Mirrors leadership_broadcasts_set_updated_at exactly. DROP IF EXISTS added
-- for re-runnability (matches the more recent support_tickets migration
-- pattern; Phase 10F omitted it because the table itself was being created).
DROP TRIGGER IF EXISTS announcements_set_updated_at ON public.announcements;
CREATE TRIGGER announcements_set_updated_at
    BEFORE UPDATE ON public.announcements
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- 2. New RPCs (SECURITY INVOKER per D-7)
-- =============================================================================

-- list_active_announcements: stable RLS-aware read surface that PR 19.2's
-- Settings table view and PR 19.3's home-page card will bind to.
-- Functionally equivalent to useAnnouncements.refresh()'s inline query
-- (tenant-scoped, soft-delete filtered, pinned-first ordering).
--
-- TODO(audit-log): record read access in future audit_log table if leadership
-- audit becomes required.
CREATE OR REPLACE FUNCTION public.list_active_announcements()
RETURNS SETOF public.announcements
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT *
      FROM public.announcements
     WHERE tenant_id = public.current_tenant_id()
       AND deleted_at IS NULL
     ORDER BY pinned DESC, created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_active_announcements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_active_announcements() TO authenticated;


-- upsert_announcement: owner-only create/update.
--   p_id IS NULL  => INSERT, posted_by_user_id = auth.uid()
--   p_id NOT NULL => UPDATE, updated_by_user_id = auth.uid()
-- RLS (announcements_insert_owner / _update_owner) enforces is_owner() and
-- tenant_writes_allowed(). No explicit role gate inside the function; INVOKER
-- mode means an unauthorized caller hits a Postgres RLS violation rather than
-- a custom error envelope. Trade-off intentional per D-7: single source of
-- truth for write authorization is RLS.
--
-- TODO(audit-log): emit announcement.created or announcement.updated in
-- future audit_log table.
CREATE OR REPLACE FUNCTION public.upsert_announcement(
    p_id     uuid,
    p_title  text,
    p_body   text,
    p_pinned boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id uuid;
    v_id        uuid;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'no tenant in JWT context' USING ERRCODE = '22023';
    END IF;
    IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
        RAISE EXCEPTION 'title is required' USING ERRCODE = '22023';
    END IF;

    IF p_id IS NULL THEN
        INSERT INTO public.announcements (tenant_id, posted_by_user_id, title, body, pinned)
        VALUES (v_tenant_id, auth.uid(), p_title, p_body, COALESCE(p_pinned, false))
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.announcements
           SET title              = p_title,
               body               = p_body,
               pinned             = COALESCE(p_pinned, pinned),
               updated_by_user_id = auth.uid()
         WHERE id = p_id
           AND tenant_id = v_tenant_id
        RETURNING id INTO v_id;
        IF v_id IS NULL THEN
            RAISE EXCEPTION 'announcement not found in current tenant' USING ERRCODE = 'P0002';
        END IF;
    END IF;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_announcement(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_announcement(uuid, text, text, boolean) TO authenticated;


-- =============================================================================
-- 3. Verification
-- =============================================================================

-- 3.1 Column + trigger presence + FK target
DO $$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*) INTO v_count
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'announcements'
       AND column_name  = 'updated_by_user_id'
       AND is_nullable  = 'YES';
    ASSERT v_count = 1,
        'verify_columns FAILED: updated_by_user_id missing or not nullable';

    SELECT count(*) INTO v_count
      FROM pg_constraint c
      JOIN pg_class      t  ON t.oid  = c.conrelid
      JOIN pg_namespace  n  ON n.oid  = t.relnamespace
      JOIN pg_class      ft ON ft.oid = c.confrelid
      JOIN pg_namespace  fn ON fn.oid = ft.relnamespace
     WHERE n.nspname  = 'public'
       AND t.relname  = 'announcements'
       AND c.contype  = 'f'
       AND fn.nspname = 'public'
       AND ft.relname = 'agents'
       AND pg_get_constraintdef(c.oid) LIKE '%updated_by_user_id%';
    ASSERT v_count = 1,
        'verify_columns FAILED: updated_by_user_id FK to public.agents(id) missing';

    SELECT count(*) INTO v_count
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'announcements'
       AND column_name  = 'updated_at'
       AND is_nullable  = 'NO';
    ASSERT v_count = 1,
        'verify_columns FAILED: updated_at missing or nullable';

    SELECT count(*) INTO v_count
      FROM pg_trigger
     WHERE tgname = 'announcements_set_updated_at'
       AND NOT tgisinternal;
    ASSERT v_count = 1,
        'verify_trigger FAILED: announcements_set_updated_at missing';

    RAISE NOTICE 'Verification 1/4 passed: audit columns + trigger present, FK target = public.agents(id).';
END $$;


-- 3.2 RLS verify-only (D-2). All four policies must still exist, still bind to
-- is_owner() on writes, and still include tenant_writes_allowed() from Phase 17
-- PR 3a. SELECT must still filter deleted_at IS NULL. Any drift here means a
-- prior migration silently regressed RLS and this PR must NOT compound it.
DO $$
DECLARE
    v_select_using text;
    v_insert_check text;
    v_update_using text;
    v_update_check text;
    v_delete_using text;
BEGIN
    SELECT qual INTO v_select_using
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'announcements'
       AND policyname = 'announcements_select';
    ASSERT v_select_using IS NOT NULL,
        'verify_rls FAILED: announcements_select policy missing';
    ASSERT v_select_using LIKE '%deleted_at IS NULL%',
        'verify_rls FAILED: announcements_select must still filter deleted_at IS NULL';

    SELECT with_check INTO v_insert_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'announcements'
       AND policyname = 'announcements_insert_owner';
    ASSERT v_insert_check IS NOT NULL,
        'verify_rls FAILED: announcements_insert_owner policy missing';
    ASSERT v_insert_check LIKE '%is_owner%',
        'verify_rls FAILED: announcements_insert_owner must include is_owner()';
    ASSERT v_insert_check LIKE '%tenant_writes_allowed%',
        'verify_rls FAILED: announcements_insert_owner missing tenant_writes_allowed() (Phase 17 PR 3a regression)';

    SELECT qual, with_check INTO v_update_using, v_update_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'announcements'
       AND policyname = 'announcements_update_owner';
    ASSERT v_update_using IS NOT NULL,
        'verify_rls FAILED: announcements_update_owner policy missing';
    ASSERT v_update_using LIKE '%is_owner%' AND v_update_check LIKE '%is_owner%',
        'verify_rls FAILED: announcements_update_owner USING + WITH CHECK must both include is_owner()';
    ASSERT v_update_using LIKE '%tenant_writes_allowed%' AND v_update_check LIKE '%tenant_writes_allowed%',
        'verify_rls FAILED: announcements_update_owner missing tenant_writes_allowed() on USING or WITH CHECK';

    SELECT qual INTO v_delete_using
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'announcements'
       AND policyname = 'announcements_delete_owner';
    ASSERT v_delete_using IS NOT NULL,
        'verify_rls FAILED: announcements_delete_owner policy missing';
    ASSERT v_delete_using LIKE '%is_owner%',
        'verify_rls FAILED: announcements_delete_owner must include is_owner()';
    ASSERT v_delete_using LIKE '%tenant_writes_allowed%',
        'verify_rls FAILED: announcements_delete_owner missing tenant_writes_allowed()';

    RAISE NOTICE 'Verification 2/4 passed: 4 RLS policies still bound to is_owner() + tenant_writes_allowed(); SELECT still filters deleted_at IS NULL.';
END $$;


-- 3.3 RPC existence + signatures, plus protection that the prior RPCs were not
-- redefined or dropped (D-4, D-5 lock).
DO $$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*) INTO v_count
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'list_active_announcements'
       AND pg_get_function_identity_arguments(p.oid) = '';
    ASSERT v_count = 1,
        'verify_rpcs FAILED: list_active_announcements() missing';

    SELECT count(*) INTO v_count
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'upsert_announcement'
       AND pg_get_function_identity_arguments(p.oid) = 'p_id uuid, p_title text, p_body text, p_pinned boolean';
    ASSERT v_count = 1,
        'verify_rpcs FAILED: upsert_announcement(uuid,text,text,boolean) missing';

    -- post_announcement(text,text,boolean) must still exist (D-4)
    SELECT count(*) INTO v_count
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'post_announcement'
       AND pg_get_function_identity_arguments(p.oid) = 'p_title text, p_body text, p_pinned boolean';
    ASSERT v_count = 1,
        'verify_rpcs FAILED: post_announcement(text,text,boolean) was modified or dropped (D-4 violation)';

    -- delete_announcement(uuid) must still exist with p_announcement_id param (D-5)
    SELECT count(*) INTO v_count
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'delete_announcement'
       AND pg_get_function_identity_arguments(p.oid) = 'p_announcement_id uuid';
    ASSERT v_count = 1,
        'verify_rpcs FAILED: delete_announcement(p_announcement_id uuid) was modified or dropped (D-5 violation)';

    RAISE NOTICE 'Verification 3/4 passed: list_active_announcements + upsert_announcement added; post_announcement + delete_announcement untouched.';
END $$;


-- 3.4 Pinned-first ordering self-test.
--
-- DO-blocks run as the migration role (no JWT) so we cannot call
-- list_active_announcements() directly (current_tenant_id() returns NULL
-- without a JWT). Instead we exercise the equivalent ORDER BY against the
-- table and prove pinned wins over created_at-desc. The RPC body is one SQL
-- statement that re-uses the exact same predicates and order clause.
--
-- We need a real tenant + owner agent to satisfy FK constraints. On a fresh
-- CI database with no tenants the test gracefully skips. The migration's
-- column-presence checks (3.1) and the trivial-correctness of the ORDER BY
-- clause are the real guarantees; the row-level test catches surprises only.
DO $$
DECLARE
    v_tenant_id   uuid;
    v_agent_id    uuid;
    v_pinned_id   uuid;
    v_unpinned_id uuid;
    v_first_id    uuid;
BEGIN
    SELECT id INTO v_tenant_id
      FROM public.tenants
     ORDER BY created_at
     LIMIT 1;
    IF v_tenant_id IS NULL THEN
        RAISE NOTICE 'Verification 4/4 skipped: no tenants in this database (fresh CI context). Column + RPC checks above are authoritative.';
        RETURN;
    END IF;

    SELECT id INTO v_agent_id
      FROM public.agents
     WHERE tenant_id = v_tenant_id
     LIMIT 1;
    IF v_agent_id IS NULL THEN
        RAISE NOTICE 'Verification 4/4 skipped: tenant has no agents.';
        RETURN;
    END IF;

    -- Insert with explicit timestamps so the ordering proof is deterministic:
    -- the pinned row is OLDER, so a naive created_at-desc-only sort would put
    -- it second. Pinned-first ordering must put it first.
    INSERT INTO public.announcements (tenant_id, posted_by_user_id, title, body, pinned, created_at)
    VALUES (v_tenant_id, v_agent_id, '__phase19_test_unpinned', '', false, now())
    RETURNING id INTO v_unpinned_id;

    INSERT INTO public.announcements (tenant_id, posted_by_user_id, title, body, pinned, created_at)
    VALUES (v_tenant_id, v_agent_id, '__phase19_test_pinned', '', true, now() - interval '1 hour')
    RETURNING id INTO v_pinned_id;

    SELECT id INTO v_first_id
      FROM public.announcements
     WHERE tenant_id  = v_tenant_id
       AND deleted_at IS NULL
       AND title IN ('__phase19_test_pinned', '__phase19_test_unpinned')
     ORDER BY pinned DESC, created_at DESC
     LIMIT 1;

    -- Clean up before asserting so a failed assertion does not leave test rows
    -- behind. The DELETE happens first; if the ASSERT then fails the migration
    -- still rolls back via the wrapping transaction.
    DELETE FROM public.announcements WHERE id IN (v_pinned_id, v_unpinned_id);

    ASSERT v_first_id = v_pinned_id,
        format('verify_ordering FAILED: expected pinned row %s to sort first, got %s',
               v_pinned_id, v_first_id);

    RAISE NOTICE 'Verification 4/4 passed: pinned-first ordering confirmed against tenant %.', v_tenant_id;
END $$;


COMMIT;
