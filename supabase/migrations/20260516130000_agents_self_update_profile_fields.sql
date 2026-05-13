-- Phase 13.3 hotfix 2: every agent needs to edit their own profile
-- (name, phone, avatar, title, bio) without needing owner privileges.
--
-- Before this migration the only UPDATE policy on agents was
-- agents_update_owner, which requires is_owner(). Non-owner agents could
-- still call .update() without an error (PostgREST returns success with
-- zero rows touched), which is exactly what hid the failure during the
-- avatar upload — the file landed in storage, but the URL never made
-- it onto the agents row.
--
-- This adds:
--   1. agents_update_self — row policy: agent can update their own row.
--   2. agents_self_update_guard — BEFORE UPDATE trigger: when the caller
--      is NOT the owner, hard-fail if they try to change any of the
--      security-critical columns (tenant_id, is_owner, upline_*,
--      email, status, archived_at, npn, id, created_at, last_login_at).
--      The agent can update only: first_name, last_name, phone,
--      avatar_url, title, bio, updated_at.
--
-- This pattern (row policy + trigger guard) is the standard way to do
-- column-level mutation control in Postgres without going through a
-- SECURITY DEFINER RPC for every field.

BEGIN;

DROP POLICY IF EXISTS "agents_update_self" ON public.agents;
CREATE POLICY "agents_update_self" ON public.agents
    FOR UPDATE TO authenticated
    USING (
        id = auth.uid()
        AND tenant_id = public.current_tenant_id()
    )
    WITH CHECK (
        id = auth.uid()
        AND tenant_id = public.current_tenant_id()
    );

CREATE OR REPLACE FUNCTION public.agents_self_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_owner boolean;
BEGIN
    v_is_owner := public.is_owner();
    IF v_is_owner THEN
        RETURN NEW;
    END IF;

    IF NEW.id              IS DISTINCT FROM OLD.id              THEN RAISE EXCEPTION 'cannot change agent id'                       USING ERRCODE = '42501'; END IF;
    IF NEW.tenant_id       IS DISTINCT FROM OLD.tenant_id       THEN RAISE EXCEPTION 'cannot change tenant_id'                      USING ERRCODE = '42501'; END IF;
    IF NEW.is_owner        IS DISTINCT FROM OLD.is_owner        THEN RAISE EXCEPTION 'cannot change is_owner'                       USING ERRCODE = '42501'; END IF;
    IF NEW.upline_agent_id IS DISTINCT FROM OLD.upline_agent_id THEN RAISE EXCEPTION 'cannot change upline_agent_id'                USING ERRCODE = '42501'; END IF;
    IF NEW.upline_email    IS DISTINCT FROM OLD.upline_email    THEN RAISE EXCEPTION 'cannot change upline_email'                   USING ERRCODE = '42501'; END IF;
    IF NEW.email           IS DISTINCT FROM OLD.email           THEN RAISE EXCEPTION 'cannot change email (use Account section)'    USING ERRCODE = '42501'; END IF;
    IF NEW.status          IS DISTINCT FROM OLD.status          THEN RAISE EXCEPTION 'cannot change status'                         USING ERRCODE = '42501'; END IF;
    IF NEW.archived_at     IS DISTINCT FROM OLD.archived_at     THEN RAISE EXCEPTION 'cannot change archived_at'                    USING ERRCODE = '42501'; END IF;
    IF NEW.npn             IS DISTINCT FROM OLD.npn             THEN RAISE EXCEPTION 'cannot change npn (owner-managed)'            USING ERRCODE = '42501'; END IF;
    IF NEW.created_at      IS DISTINCT FROM OLD.created_at      THEN RAISE EXCEPTION 'cannot change created_at'                     USING ERRCODE = '42501'; END IF;
    IF NEW.last_login_at   IS DISTINCT FROM OLD.last_login_at   THEN RAISE EXCEPTION 'cannot change last_login_at'                  USING ERRCODE = '42501'; END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agents_self_update_guard ON public.agents;
CREATE TRIGGER agents_self_update_guard
    BEFORE UPDATE ON public.agents
    FOR EACH ROW
    EXECUTE FUNCTION public.agents_self_update_guard();

COMMIT;
