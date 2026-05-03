-- =============================================================================
-- Baseshop HQ — Phase 1: Auth + Tenants + Agents foundation
-- Target: Supabase project oarstmxbgdczytwzpyxj
-- Status: DRAFT — do not apply until user green-lights
--
-- Scope (per user kickoff brief 2026-05-03 + wiki):
--   - tenants (one row per agency / sub-account)
--   - agents (one row per person, FK to auth.users)
--   - upline_email canonical pointer + auto-resolved upline_agent_id
--   - is_owner() helper, current_tenant_id(), descendants_of(), can_view_agent()
--   - RLS: tenant isolation + view-down (self + descendants), owner-only writes
--   - feature_flags JSONB on tenants (per Phase 8 of comp-grid-build-spec)
--
-- Out of scope here (handled in later phases):
--   - comp grid tables (Phase 2 of build = comp-grid-build-spec Phase 1)
--   - agent_positions time-stamped position history (Phase 2 of build)
--   - white-label `agency_id` layer (defer until single-agency build is solid)
--   - signup edge function (separate concern from schema migration)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()


-- -----------------------------------------------------------------------------
-- 2. tenants
-- -----------------------------------------------------------------------------
CREATE TABLE public.tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    owner_agent_id  UUID,  -- FK added after agents table; nullable during signup bootstrap
    status          TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'paused', 'cancelled')),
    feature_flags   JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.tenants.owner_agent_id IS
    'The owner agent for this tenant. Nullable for signup bootstrap; set in same txn as the owner agent insert.';
COMMENT ON COLUMN public.tenants.feature_flags IS
    'Per-tenant feature flags. e.g. {"comp_grid_v1": true}. Read by useFeatureFlag() in app code.';


-- -----------------------------------------------------------------------------
-- 3. agents
-- -----------------------------------------------------------------------------
CREATE TYPE public.agent_status AS ENUM ('active', 'inactive', 'archived');

CREATE TABLE public.agents (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    first_name      TEXT,
    last_name       TEXT,
    phone           TEXT,
    npn             TEXT,                  -- National Producer Number
    upline_email    TEXT,                  -- canonical pointer; resolved to upline_agent_id by trigger
    upline_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    is_owner        BOOLEAN NOT NULL DEFAULT FALSE,
    status          public.agent_status NOT NULL DEFAULT 'active',
    archived_at     TIMESTAMPTZ,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, email)
);

COMMENT ON COLUMN public.agents.upline_email IS
    'Email of upline agent. Source of truth (per wiki: email is universal identifier within a tenant). upline_agent_id is the resolved FK and stays in sync via trigger; lets the owner provision a downline by email before the upline has signed up.';
COMMENT ON COLUMN public.agents.is_owner IS
    'Tenant owner flag. Exactly one TRUE per tenant (enforced by partial unique index).';

-- Wire tenants.owner_agent_id FK now that agents exists
ALTER TABLE public.tenants
    ADD CONSTRAINT tenants_owner_agent_id_fkey
    FOREIGN KEY (owner_agent_id)
    REFERENCES public.agents(id)
    ON DELETE SET NULL;

-- Exactly one owner per tenant
CREATE UNIQUE INDEX agents_one_owner_per_tenant
    ON public.agents (tenant_id) WHERE is_owner = TRUE;

CREATE INDEX agents_tenant_upline_email     ON public.agents (tenant_id, upline_email);
CREATE INDEX agents_tenant_upline_agent_id  ON public.agents (tenant_id, upline_agent_id);
CREATE INDEX agents_tenant_status           ON public.agents (tenant_id, status);


-- -----------------------------------------------------------------------------
-- 4. upline_email → upline_agent_id resolution + orphan backfill
-- -----------------------------------------------------------------------------
-- upline_email is canonical (per wiki). upline_agent_id is the computed FK
-- used for recursive joins and view-down RLS. Two triggers:
--   (a) BEFORE INS/UPD on agents: resolve upline_agent_id from upline_email.
--   (b) AFTER INSERT on agents: backfill any orphan upline pointers in the
--       same tenant that referenced this agent's email.

CREATE OR REPLACE FUNCTION public.resolve_upline_agent_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.upline_email IS NOT NULL THEN
        SELECT id INTO NEW.upline_agent_id
        FROM public.agents
        WHERE tenant_id = NEW.tenant_id
          AND lower(email) = lower(NEW.upline_email)
        LIMIT 1;
    ELSE
        NEW.upline_agent_id := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER agents_resolve_upline_before_ins
    BEFORE INSERT ON public.agents
    FOR EACH ROW EXECUTE FUNCTION public.resolve_upline_agent_id();

CREATE TRIGGER agents_resolve_upline_before_upd
    BEFORE UPDATE OF upline_email, tenant_id ON public.agents
    FOR EACH ROW EXECUTE FUNCTION public.resolve_upline_agent_id();

CREATE OR REPLACE FUNCTION public.backfill_orphan_upline_pointers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.agents
    SET upline_agent_id = NEW.id
    WHERE tenant_id = NEW.tenant_id
      AND upline_agent_id IS NULL
      AND lower(upline_email) = lower(NEW.email);
    RETURN NEW;
END;
$$;

CREATE TRIGGER agents_backfill_orphans_after_ins
    AFTER INSERT ON public.agents
    FOR EACH ROW EXECUTE FUNCTION public.backfill_orphan_upline_pointers();


-- -----------------------------------------------------------------------------
-- 5. updated_at triggers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER agents_updated_at BEFORE UPDATE ON public.agents
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 6. Permission helper functions
-- -----------------------------------------------------------------------------

-- Returns the calling user's tenant_id. NULL if no agent row exists yet.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT tenant_id FROM public.agents WHERE id = auth.uid() LIMIT 1;
$$;

-- Returns true if the calling user is the owner of their tenant.
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(
        (SELECT is_owner FROM public.agents WHERE id = auth.uid() LIMIT 1),
        FALSE
    );
$$;

-- Returns the recursive descendant set of root_agent_id (excluding self).
-- Walks via upline_agent_id within the same tenant.
CREATE OR REPLACE FUNCTION public.descendants_of(root_agent_id UUID)
RETURNS TABLE (agent_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH RECURSIVE tree AS (
        SELECT a.id, a.tenant_id
        FROM public.agents a
        WHERE a.upline_agent_id = root_agent_id
        UNION ALL
        SELECT a.id, a.tenant_id
        FROM public.agents a
        JOIN tree t ON a.upline_agent_id = t.id AND a.tenant_id = t.tenant_id
    )
    SELECT id FROM tree;
$$;

-- Returns true if target_agent_id is visible to the calling user under the
-- view-down rule. Owner sees all in tenant; everyone else sees self + descendants.
CREATE OR REPLACE FUNCTION public.can_view_agent(target_agent_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        target_agent_id = auth.uid()
        OR public.is_owner()
        OR target_agent_id IN (SELECT public.descendants_of(auth.uid()));
$$;

-- Lock execute privileges
REVOKE EXECUTE ON FUNCTION public.current_tenant_id            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_owner                      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.descendants_of(UUID)          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_view_agent(UUID)          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_upline_agent_id       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backfill_orphan_upline_pointers FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_updated_at                FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_tenant_id     TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner               TO authenticated;
GRANT EXECUTE ON FUNCTION public.descendants_of(UUID)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_agent(UUID)   TO authenticated;


-- -----------------------------------------------------------------------------
-- 7. RLS policies
-- -----------------------------------------------------------------------------

-- TENANTS
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- Any authenticated agent can read their own tenant row (for branding, etc.)
CREATE POLICY tenants_select_own
    ON public.tenants FOR SELECT
    TO authenticated
    USING (id = public.current_tenant_id());

-- Only the owner can update their tenant (rename, feature flags, etc.)
CREATE POLICY tenants_update_owner
    ON public.tenants FOR UPDATE
    TO authenticated
    USING      (id = public.current_tenant_id() AND public.is_owner())
    WITH CHECK (id = public.current_tenant_id() AND public.is_owner());

-- INSERT and DELETE on tenants are intentionally unpoliced for the
-- `authenticated` role. Service role bypasses RLS and handles signup/closure
-- via an edge function (out of scope for this migration).


-- AGENTS
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY agents_select_visible
    ON public.agents FOR SELECT
    TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        AND public.can_view_agent(id)
    );

CREATE POLICY agents_insert_owner
    ON public.agents FOR INSERT
    TO authenticated
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND public.is_owner()
    );

CREATE POLICY agents_update_owner
    ON public.agents FOR UPDATE
    TO authenticated
    USING      (tenant_id = public.current_tenant_id() AND public.is_owner())
    WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY agents_delete_owner
    ON public.agents FOR DELETE
    TO authenticated
    USING (tenant_id = public.current_tenant_id() AND public.is_owner());


-- -----------------------------------------------------------------------------
-- 8. Realtime publication
-- -----------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.tenants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agents;


-- -----------------------------------------------------------------------------
-- 9. Verification
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Tables present
    ASSERT to_regclass('public.tenants') IS NOT NULL, 'tenants table missing';
    ASSERT to_regclass('public.agents')  IS NOT NULL, 'agents table missing';

    -- Helper functions present
    SELECT COUNT(*) INTO v_count
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN (
        'is_owner', 'current_tenant_id', 'descendants_of', 'can_view_agent',
        'resolve_upline_agent_id', 'backfill_orphan_upline_pointers', 'set_updated_at'
      );
    ASSERT v_count = 7, format('expected 7 helper functions, found %s', v_count);

    -- RLS enabled on both tables
    SELECT COUNT(*) INTO v_count
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('tenants', 'agents')
      AND rowsecurity = TRUE;
    ASSERT v_count = 2, 'RLS not enabled on all tables';

    -- Owner uniqueness index present
    ASSERT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'agents_one_owner_per_tenant'
    ), 'agents_one_owner_per_tenant index missing';

    RAISE NOTICE 'Phase 1 verification passed.';
END $$;

COMMIT;
