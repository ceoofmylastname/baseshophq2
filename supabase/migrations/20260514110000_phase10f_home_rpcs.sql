-- Phase 10F.2: Home Page RPCs.
--
-- All RPCs are SECURITY INVOKER and return jsonb envelopes matching the
-- existing codebase convention ({success: bool, error_code?: text, ...}).
-- RLS does the auth gate; the RPC body adds normalization, targeting
-- interpretation, and computed aggregates that don't belong in client code.
--
-- RPCs in this migration:
--   1. dismiss_action_item              — agent dismisses own banner
--   2. current_leadership_broadcast     — fetch the one active broadcast for caller
--   3. upsert_leadership_broadcast      — owner creates/updates the hero broadcast
--   4. delete_leadership_broadcast      — owner removes
--   5. upsert_promotion_target          — owner sets criteria for a position rung
--   6. promotion_progress               — compute distance-to-next-promotion for caller

BEGIN;

-- ============================================================================
-- 1. dismiss_action_item
-- ============================================================================
-- Lets an agent dismiss their own banner without being able to touch any
-- other column. RLS already gates this (USING user_id = auth.uid() OR is_owner)
-- but the column-scoped UPDATE here is the explicit guarantee.
CREATE OR REPLACE FUNCTION public.dismiss_action_item(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_dismissed uuid;
BEGIN
    UPDATE public.user_action_items
       SET dismissed_at = now()
     WHERE id = p_id
       AND is_dismissible = TRUE
       AND dismissed_at IS NULL
       AND resolved_at IS NULL
     RETURNING id INTO v_dismissed;

    IF v_dismissed IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'not_found_or_already_closed');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.dismiss_action_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_action_item(uuid) TO authenticated;


-- ============================================================================
-- 2. current_leadership_broadcast
-- ============================================================================
-- Returns the single most-recent active broadcast that targets the caller, or
-- {success: true, broadcast: null} if none. Targeting interpreted server-side:
--   {"all": true}                 → matches everyone in the tenant
--   {"positions": ["100","115"]}  → caller's active position code must be in list
-- Other targeting keys (downline_of_user_id, etc) are v2; ignored for now and
-- the row is treated as non-matching to be safe.
CREATE OR REPLACE FUNCTION public.current_leadership_broadcast()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id     uuid;
    v_position_code text;
    v_row           public.leadership_broadcasts%ROWTYPE;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;

    -- Caller's active position code, if any
    SELECT cgp.position_code INTO v_position_code
      FROM public.agent_positions ap
      JOIN public.comp_grid_positions cgp ON cgp.id = ap.position_id
     WHERE ap.agent_id = auth.uid()
       AND ap.end_date IS NULL
     LIMIT 1;

    SELECT b.* INTO v_row
      FROM public.leadership_broadcasts b
     WHERE b.tenant_id = v_tenant_id
       AND b.is_active = TRUE
       AND b.start_at <= now()
       AND (b.end_at IS NULL OR b.end_at > now())
       AND (
            (b.targeting ->> 'all')::boolean IS TRUE
         OR (
               b.targeting ? 'positions'
           AND v_position_code IS NOT NULL
           AND b.targeting -> 'positions' ? v_position_code
            )
       )
     ORDER BY b.start_at DESC
     LIMIT 1;

    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('success', true, 'broadcast', null);
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'broadcast', jsonb_build_object(
            'id',         v_row.id,
            'title',      v_row.title,
            'body',       v_row.body,
            'image_url',  v_row.image_url,
            'cta_text',   v_row.cta_text,
            'cta_url',    v_row.cta_url,
            'start_at',   v_row.start_at,
            'end_at',     v_row.end_at,
            'created_at', v_row.created_at
        )
    );
END;
$$;
REVOKE ALL ON FUNCTION public.current_leadership_broadcast() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_leadership_broadcast() TO authenticated;


-- ============================================================================
-- 3. upsert_leadership_broadcast
-- ============================================================================
-- Owner-only. p_id NULL = insert, non-NULL = update. RLS is the auth gate;
-- this wrapper provides the jsonb envelope and normalizes inputs.
CREATE OR REPLACE FUNCTION public.upsert_leadership_broadcast(
    p_id          uuid,
    p_title       text,
    p_body        text         DEFAULT NULL,
    p_image_url   text         DEFAULT NULL,
    p_cta_text    text         DEFAULT NULL,
    p_cta_url     text         DEFAULT NULL,
    p_targeting   jsonb        DEFAULT '{"all": true}'::jsonb,
    p_start_at    timestamptz  DEFAULT NULL,
    p_end_at      timestamptz  DEFAULT NULL,
    p_is_active   boolean      DEFAULT TRUE
) RETURNS jsonb
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
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;

    p_title := NULLIF(trim(p_title), '');
    IF p_title IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'title_required');
    END IF;

    -- Default start_at to now() if not provided
    IF p_start_at IS NULL THEN
        p_start_at := now();
    END IF;

    IF p_end_at IS NOT NULL AND p_end_at <= p_start_at THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'end_before_start');
    END IF;

    IF p_id IS NULL THEN
        BEGIN
            INSERT INTO public.leadership_broadcasts (
                tenant_id, created_by_user_id, title, body, image_url,
                cta_text, cta_url, targeting, start_at, end_at, is_active
            ) VALUES (
                v_tenant_id, auth.uid(), p_title, p_body, p_image_url,
                p_cta_text, p_cta_url, p_targeting, p_start_at, p_end_at, p_is_active
            )
            RETURNING id INTO v_id;
        EXCEPTION
            WHEN insufficient_privilege THEN
                RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
        END;
    ELSE
        BEGIN
            UPDATE public.leadership_broadcasts
               SET title       = p_title,
                   body        = p_body,
                   image_url   = p_image_url,
                   cta_text    = p_cta_text,
                   cta_url     = p_cta_url,
                   targeting   = p_targeting,
                   start_at    = p_start_at,
                   end_at      = p_end_at,
                   is_active   = p_is_active
             WHERE id = p_id
               AND tenant_id = v_tenant_id
            RETURNING id INTO v_id;
        EXCEPTION
            WHEN insufficient_privilege THEN
                RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
        END;

        IF v_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'not_found_or_forbidden');
        END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'broadcast_id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_leadership_broadcast(
    uuid, text, text, text, text, text, jsonb, timestamptz, timestamptz, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_leadership_broadcast(
    uuid, text, text, text, text, text, jsonb, timestamptz, timestamptz, boolean
) TO authenticated;


-- ============================================================================
-- 4. delete_leadership_broadcast
-- ============================================================================
CREATE OR REPLACE FUNCTION public.delete_leadership_broadcast(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id uuid;
    v_deleted   uuid;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;

    BEGIN
        DELETE FROM public.leadership_broadcasts
         WHERE id = p_id
           AND tenant_id = v_tenant_id
        RETURNING id INTO v_deleted;
    EXCEPTION
        WHEN insufficient_privilege THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
    END;

    IF v_deleted IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'not_found_or_forbidden');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_leadership_broadcast(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_leadership_broadcast(uuid) TO authenticated;


-- ============================================================================
-- 5. upsert_promotion_target
-- ============================================================================
-- Owner-only. One target per (tenant, from_position_id) — uniqueness handles
-- the upsert via ON CONFLICT.
CREATE OR REPLACE FUNCTION public.upsert_promotion_target(
    p_from_position_id uuid,
    p_to_position_id   uuid,
    p_criteria         jsonb
) RETURNS jsonb
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
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;

    IF p_from_position_id = p_to_position_id THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'self_promo_invalid');
    END IF;

    -- Both positions must belong to this tenant
    IF NOT EXISTS (
        SELECT 1 FROM public.comp_grid_positions
         WHERE id = p_from_position_id AND tenant_id = v_tenant_id
    ) OR NOT EXISTS (
        SELECT 1 FROM public.comp_grid_positions
         WHERE id = p_to_position_id AND tenant_id = v_tenant_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'position_not_in_tenant');
    END IF;

    BEGIN
        INSERT INTO public.promotion_targets (tenant_id, from_position_id, to_position_id, criteria)
        VALUES (v_tenant_id, p_from_position_id, p_to_position_id, p_criteria)
        ON CONFLICT (tenant_id, from_position_id)
        DO UPDATE SET
            to_position_id = EXCLUDED.to_position_id,
            criteria       = EXCLUDED.criteria,
            updated_at     = now()
        RETURNING id INTO v_id;
    EXCEPTION
        WHEN insufficient_privilege THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
    END;

    RETURN jsonb_build_object('success', true, 'target_id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_promotion_target(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_promotion_target(uuid, uuid, jsonb) TO authenticated;


-- ============================================================================
-- 6. promotion_progress
-- ============================================================================
-- Computes distance-to-next-promotion for the calling agent. Returns:
--   {
--     success: true,
--     current_position:    { id, code, name } | null,
--     next_position:       { id, code, name } | null,
--     criteria_progress:   [ { key, target, current, pct, met }, ... ],
--     all_met:             bool
--   }
--
-- Window: trailing 3 months from CURRENT_DATE for premium + personal_policies.
-- Active downline = direct or transitive descendant who wrote at least one
-- policy with application_date in the last 30 days (matches the
-- "active agent = wrote business in last 30 days" rule from CLAUDE.md).
--
-- Criteria keys interpreted (all optional, all gated):
--   min_premium_last_3_months   — sum(annual_premium) for self + downline
--   min_active_downline_count   — count of active descendants
--   min_personal_policies       — count of policies written by self in window
--
-- Unknown criteria keys are surfaced as { key, target, current: 0, pct: 0,
-- met: false } so the owner sees them in the UI but they always block
-- promotion. Loud failure beats silent wrong answer.
CREATE OR REPLACE FUNCTION public.promotion_progress()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id          uuid;
    v_user_id            uuid := auth.uid();
    v_current_position   record;
    v_next_position      record;
    v_target             public.promotion_targets%ROWTYPE;
    v_criteria_progress  jsonb := '[]'::jsonb;
    v_all_met            boolean := TRUE;
    v_window_start       date := CURRENT_DATE - INTERVAL '3 months';
    v_active_window      date := CURRENT_DATE - INTERVAL '30 days';
    v_target_val         numeric;
    v_current_val        numeric;
    v_pct                numeric;
    v_met                boolean;
    v_key                text;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;

    -- Caller's current position
    SELECT cgp.id, cgp.position_code, cgp.position_name
      INTO v_current_position
      FROM public.agent_positions ap
      JOIN public.comp_grid_positions cgp ON cgp.id = ap.position_id
     WHERE ap.agent_id = v_user_id
       AND ap.end_date IS NULL
     LIMIT 1;

    IF v_current_position.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'current_position', null,
            'next_position', null,
            'criteria_progress', '[]'::jsonb,
            'all_met', false
        );
    END IF;

    -- Promotion target row for caller's current position
    SELECT * INTO v_target
      FROM public.promotion_targets
     WHERE tenant_id = v_tenant_id
       AND from_position_id = v_current_position.id;

    IF v_target.id IS NULL THEN
        -- No target configured; we know the current position but can't compute progress.
        RETURN jsonb_build_object(
            'success', true,
            'current_position', jsonb_build_object(
                'id', v_current_position.id,
                'code', v_current_position.position_code,
                'name', v_current_position.position_name
            ),
            'next_position', null,
            'criteria_progress', '[]'::jsonb,
            'all_met', false
        );
    END IF;

    -- Next position details
    SELECT cgp.id, cgp.position_code, cgp.position_name
      INTO v_next_position
      FROM public.comp_grid_positions cgp
     WHERE cgp.id = v_target.to_position_id;

    -- Iterate criteria keys
    FOR v_key IN SELECT jsonb_object_keys(v_target.criteria) LOOP
        v_target_val := (v_target.criteria ->> v_key)::numeric;
        v_current_val := 0;

        IF v_key = 'min_premium_last_3_months' THEN
            SELECT COALESCE(SUM(p.annual_premium), 0) INTO v_current_val
              FROM public.policies p
             WHERE p.tenant_id = v_tenant_id
               AND p.application_date >= v_window_start
               AND (
                   p.agent_id = v_user_id
                   OR p.agent_id IN (SELECT agent_id FROM public.descendants_of(v_user_id))
               );

        ELSIF v_key = 'min_active_downline_count' THEN
            SELECT COUNT(DISTINCT d.agent_id) INTO v_current_val
              FROM public.descendants_of(v_user_id) d
             WHERE EXISTS (
                 SELECT 1 FROM public.policies p
                  WHERE p.agent_id = d.agent_id
                    AND p.application_date >= v_active_window
             );

        ELSIF v_key = 'min_personal_policies' THEN
            SELECT COUNT(*) INTO v_current_val
              FROM public.policies p
             WHERE p.tenant_id = v_tenant_id
               AND p.agent_id = v_user_id
               AND p.application_date >= v_window_start;

        ELSE
            -- Unknown criteria key: surface it but treat as unmet
            v_current_val := 0;
        END IF;

        IF v_target_val <= 0 THEN
            v_pct := 1.0;
            v_met := TRUE;
        ELSE
            v_pct := LEAST(1.0, v_current_val / v_target_val);
            v_met := v_current_val >= v_target_val;
        END IF;

        IF NOT v_met THEN
            v_all_met := FALSE;
        END IF;

        v_criteria_progress := v_criteria_progress || jsonb_build_array(
            jsonb_build_object(
                'key',     v_key,
                'target',  v_target_val,
                'current', v_current_val,
                'pct',     v_pct,
                'met',     v_met
            )
        );
    END LOOP;

    -- If criteria object is empty, no gates → all_met is trivially true but
    -- there's nothing meaningful to display. Keep all_met=false in that case
    -- so the UI doesn't render a misleading "Promoted!" state.
    IF jsonb_array_length(v_criteria_progress) = 0 THEN
        v_all_met := FALSE;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'current_position', jsonb_build_object(
            'id', v_current_position.id,
            'code', v_current_position.position_code,
            'name', v_current_position.position_name
        ),
        'next_position', CASE WHEN v_next_position.id IS NULL THEN NULL
                              ELSE jsonb_build_object(
                                'id', v_next_position.id,
                                'code', v_next_position.position_code,
                                'name', v_next_position.position_name)
                         END,
        'criteria_progress', v_criteria_progress,
        'all_met', v_all_met
    );
END;
$$;
REVOKE ALL ON FUNCTION public.promotion_progress() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promotion_progress() TO authenticated;


-- ============================================================================
-- Verification
-- ============================================================================
DO $$
BEGIN
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dismiss_action_item'),
           'dismiss_action_item missing';
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_leadership_broadcast'),
           'current_leadership_broadcast missing';
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'upsert_leadership_broadcast'),
           'upsert_leadership_broadcast missing';
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'delete_leadership_broadcast'),
           'delete_leadership_broadcast missing';
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'upsert_promotion_target'),
           'upsert_promotion_target missing';
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'promotion_progress'),
           'promotion_progress missing';

    RAISE NOTICE 'Phase 10F.2 RPC verification passed.';
END $$;

COMMIT;
