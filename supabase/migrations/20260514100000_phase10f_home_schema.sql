-- Phase 10F.1: Home Page schema.
--
-- Adds three tables that power the Home page (wiki/home-page-and-announcements.md):
--   1. user_action_items     — per-user banners ("submit your writing number").
--                              Replaces ad-hoc hardcoded banners (tenant_setup_state
--                              stays for the existing setup wizard; this is the
--                              generalized version for all future action items).
--   2. leadership_broadcasts — single hero broadcast slot per tenant. Distinct
--                              from the existing `announcements` table (plural
--                              list, lower-rank items). Broadcasts are flyer-
--                              style with image + CTA + schedule + targeting.
--   3. promotion_targets     — criteria (JSON) for moving from position A to
--                              position B within a tenant. Powers the hero
--                              card's distance-to-next-promotion gauge.
--
-- All three are tenant-scoped, RLS-enforced, and use the same is_owner() gate
-- pattern as announcements.

BEGIN;

-- ============================================================================
-- 1. user_action_items
-- ============================================================================
-- One row per outstanding task per user. UI surfaces these as dismissible
-- banners at the top of /home. Either the user clicks dismiss (sets
-- dismissed_at), or the auto_resolve_condition becomes true and a background
-- job sets resolved_at. Until then it shows up on every login.
CREATE TABLE public.user_action_items (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    action_type             TEXT NOT NULL CHECK (action_type IN (
                                'submit_writing_number',
                                'confirm_contract',
                                'complete_profile',
                                'inactivity_nudge',
                                'custom'
                            )),
    title                   TEXT NOT NULL,
    body                    TEXT,
    cta_text                TEXT,
    cta_url                 TEXT,
    is_dismissible          BOOLEAN NOT NULL DEFAULT TRUE,
    auto_resolve_condition  TEXT,
    dismissed_at            TIMESTAMPTZ,
    resolved_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX user_action_items_open_by_user
    ON public.user_action_items (user_id, created_at DESC)
    WHERE dismissed_at IS NULL AND resolved_at IS NULL;

CREATE INDEX user_action_items_tenant
    ON public.user_action_items (tenant_id, created_at DESC);

COMMENT ON TABLE public.user_action_items IS
    'Phase 10F. Per-user dismissible banners on /home. Distinct from tenant_setup_state which is the one-shot owner-only setup wizard.';
COMMENT ON COLUMN public.user_action_items.auto_resolve_condition IS
    'Free-text marker indicating which background check clears the item (e.g. "agent_contracts.exists"). Not interpreted by the DB; consumed by a future scheduled job.';

ALTER TABLE public.user_action_items ENABLE ROW LEVEL SECURITY;

-- Agent sees their own open items. Owner sees every item in their tenant
-- (needed so owners can write action items for any agent in the tenant).
CREATE POLICY user_action_items_select ON public.user_action_items
    FOR SELECT TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        AND (user_id = auth.uid() OR public.is_owner())
    );

-- Only owner can create. Agents do not author their own action items;
-- the system (via RPC) or an owner does.
CREATE POLICY user_action_items_insert_owner ON public.user_action_items
    FOR INSERT TO authenticated
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND public.is_owner()
    );

-- Agent can update their own row (to dismiss) but only the dismiss columns —
-- enforced at the RPC layer (dismiss_action_item). Owner can update anything.
CREATE POLICY user_action_items_update ON public.user_action_items
    FOR UPDATE TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        AND (user_id = auth.uid() OR public.is_owner())
    )
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND (user_id = auth.uid() OR public.is_owner())
    );

CREATE POLICY user_action_items_delete_owner ON public.user_action_items
    FOR DELETE TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        AND public.is_owner()
    );


-- ============================================================================
-- 2. leadership_broadcasts
-- ============================================================================
-- Single hero broadcast slot per tenant. Owner-controlled. Distinct from the
-- existing `announcements` table:
--   - announcements: plural list, every agent posts/sees, low visual weight.
--   - leadership_broadcasts: single highlighted banner near the top of /home,
--     owner-only writes, optional image + CTA + scheduling.
CREATE TABLE public.leadership_broadcasts (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    created_by_user_id   UUID NOT NULL REFERENCES auth.users(id),
    title                TEXT NOT NULL,
    body                 TEXT,
    image_url            TEXT,
    cta_text             TEXT,
    cta_url              TEXT,
    targeting            JSONB NOT NULL DEFAULT '{"all": true}'::jsonb,
    start_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    end_at               TIMESTAMPTZ,
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX leadership_broadcasts_active
    ON public.leadership_broadcasts (tenant_id, start_at DESC)
    WHERE is_active = TRUE;

COMMENT ON COLUMN public.leadership_broadcasts.targeting IS
    'JSON describing audience. {"all": true} = everyone. {"positions": ["100","115"]} = specific position codes. {"downline_of_user_id": "uuid"} = a subtree. Interpreted by home_page_payload RPC.';

ALTER TABLE public.leadership_broadcasts ENABLE ROW LEVEL SECURITY;

-- Anyone in the tenant can read; the RPC further filters by targeting +
-- start/end window.
CREATE POLICY leadership_broadcasts_select ON public.leadership_broadcasts
    FOR SELECT TO authenticated
    USING (tenant_id = public.current_tenant_id());

CREATE POLICY leadership_broadcasts_insert_owner ON public.leadership_broadcasts
    FOR INSERT TO authenticated
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND public.is_owner()
        AND created_by_user_id = auth.uid()
    );

CREATE POLICY leadership_broadcasts_update_owner ON public.leadership_broadcasts
    FOR UPDATE TO authenticated
    USING (tenant_id = public.current_tenant_id() AND public.is_owner())
    WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY leadership_broadcasts_delete_owner ON public.leadership_broadcasts
    FOR DELETE TO authenticated
    USING (tenant_id = public.current_tenant_id() AND public.is_owner());


-- ============================================================================
-- 3. promotion_targets
-- ============================================================================
-- Defines what it takes to move from one position to the next. Powers the
-- hero card's distance-to-next-promotion gauge.
--
-- criteria JSON shape (interpreted by promotion_progress RPC):
--   {
--     "min_premium_last_3_months": 50000,
--     "min_active_downline_count": 3,
--     "min_personal_policies": 12
--   }
-- All keys optional. Each present key is a separate gate; agent must clear
-- all of them to be promoted. Extensible: add new keys without schema change.
CREATE TABLE public.promotion_targets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    from_position_id    UUID NOT NULL REFERENCES public.comp_grid_positions(id) ON DELETE CASCADE,
    to_position_id      UUID NOT NULL REFERENCES public.comp_grid_positions(id) ON DELETE CASCADE,
    criteria            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT promotion_targets_unique_from_per_tenant
        UNIQUE (tenant_id, from_position_id),
    CONSTRAINT promotion_targets_no_self_promo
        CHECK (from_position_id <> to_position_id)
);

CREATE INDEX promotion_targets_tenant
    ON public.promotion_targets (tenant_id);

COMMENT ON COLUMN public.promotion_targets.criteria IS
    'JSON criteria, all keys optional, all present keys must be cleared. Keys: min_premium_last_3_months (numeric), min_active_downline_count (int), min_personal_policies (int). Extensible.';

ALTER TABLE public.promotion_targets ENABLE ROW LEVEL SECURITY;

-- Everyone in the tenant can read (agents need to see "what does my next
-- promotion require"). Only owner writes.
CREATE POLICY promotion_targets_select ON public.promotion_targets
    FOR SELECT TO authenticated
    USING (tenant_id = public.current_tenant_id());

CREATE POLICY promotion_targets_insert_owner ON public.promotion_targets
    FOR INSERT TO authenticated
    WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY promotion_targets_update_owner ON public.promotion_targets
    FOR UPDATE TO authenticated
    USING (tenant_id = public.current_tenant_id() AND public.is_owner())
    WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY promotion_targets_delete_owner ON public.promotion_targets
    FOR DELETE TO authenticated
    USING (tenant_id = public.current_tenant_id() AND public.is_owner());


-- ============================================================================
-- 4. updated_at triggers
-- ============================================================================
-- Reuses the existing set_updated_at() helper from phase1.
CREATE TRIGGER leadership_broadcasts_set_updated_at
    BEFORE UPDATE ON public.leadership_broadcasts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER promotion_targets_set_updated_at
    BEFORE UPDATE ON public.promotion_targets
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ============================================================================
-- 5. Realtime publication
-- ============================================================================
-- Home page subscribes to these for live banner dismiss / broadcast updates.
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_action_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.leadership_broadcasts;
-- promotion_targets changes rarely; no realtime subscription needed.


-- ============================================================================
-- Verification
-- ============================================================================
DO $$
DECLARE
    v_rls_count INT;
BEGIN
    -- All three tables exist
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                    WHERE table_schema='public' AND table_name='user_action_items'),
           'user_action_items table missing';
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                    WHERE table_schema='public' AND table_name='leadership_broadcasts'),
           'leadership_broadcasts table missing';
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                    WHERE table_schema='public' AND table_name='promotion_targets'),
           'promotion_targets table missing';

    -- RLS enabled on all three
    SELECT COUNT(*) INTO v_rls_count
      FROM pg_tables
     WHERE schemaname='public'
       AND tablename IN ('user_action_items','leadership_broadcasts','promotion_targets')
       AND rowsecurity = TRUE;
    ASSERT v_rls_count = 3,
           format('RLS not enabled on all 3 Phase 10F tables (found %s)', v_rls_count);

    -- Indexes
    ASSERT EXISTS (SELECT 1 FROM pg_indexes
                    WHERE schemaname='public' AND indexname='user_action_items_open_by_user'),
           'user_action_items_open_by_user index missing';
    ASSERT EXISTS (SELECT 1 FROM pg_indexes
                    WHERE schemaname='public' AND indexname='leadership_broadcasts_active'),
           'leadership_broadcasts_active index missing';

    -- Triggers
    ASSERT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgname='leadership_broadcasts_set_updated_at'),
           'leadership_broadcasts updated_at trigger missing';
    ASSERT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgname='promotion_targets_set_updated_at'),
           'promotion_targets updated_at trigger missing';

    RAISE NOTICE 'Phase 10F.1 schema verification passed.';
END $$;

COMMIT;
