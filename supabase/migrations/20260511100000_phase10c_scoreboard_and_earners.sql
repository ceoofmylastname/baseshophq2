-- Phase 10C: 5 read RPCs covering team production, agency-wide scoreboard,
-- and the active-agents page.
--
-- APPLIED 2026-05-04 to project oarstmxbgdczytwzpyxj.
--
-- Architecture:
-- ============================================================================
-- The leaderboard_* RPCs from Phase 10A.1 enforce view-down filtering
-- (visible_agent_ids() = self UNION descendants_of(self) for non-owners).
-- The scoreboard_* RPCs in this migration are the explicit carve-out: tenant-
-- scoped, NO view-down filter, every authenticated agent sees the same
-- ranking regardless of upline relationship. Only aggregate fields are
-- exposed (rank, name, position, totals) — never per-policy details.
--
-- Documented in [[scoreboard-page]] in the wiki: this is intentional product
-- design, not a security relaxation. The scoreboard is a public-within-tenant
-- ranking page; the per-agent profile page (per [[agent-profile-pages]])
-- shows a redacted public card for agents outside the caller's downline.
--
-- 1. leaderboard_top_earners — view-down (Phase 10A.1 family); ranks by SUM
--    policy_commissions.amount where the linked policy is Issue Paid in window
-- 2. scoreboard_top_producers / _top_earners / _top_recruiters / _most_improved
--    — same logic as leaderboard_*, NO view-down filter

-- ============================================================================
-- 1. leaderboard_top_earners (view-down family, complements top_producers)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.leaderboard_top_earners(
    p_start_date date,
    p_end_date   date,
    p_carrier_id uuid DEFAULT NULL,
    p_limit      int  DEFAULT 10
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id uuid;
    v_visible   uuid[];
    v_result    jsonb;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;
    v_visible := public.visible_agent_ids();

    WITH scoped AS (
      SELECT pc.agent_id, pc.amount
        FROM public.policy_commissions pc
        JOIN public.policies p ON p.id = pc.policy_id
       WHERE pc.tenant_id   = v_tenant_id
         AND p.status       = 'Issue Paid'
         AND pc.application_date BETWEEN p_start_date AND p_end_date
         AND (v_visible IS NULL OR pc.agent_id = ANY(v_visible))
         AND (p_carrier_id IS NULL OR EXISTS (
              SELECT 1 FROM public.comp_grid_products cgp
               WHERE cgp.id = p.product_id AND cgp.carrier_id = p_carrier_id))
    ), agg AS (
      SELECT s.agent_id, COALESCE(SUM(amount), 0) AS earned
        FROM scoped s GROUP BY s.agent_id
    )
    SELECT jsonb_agg(row_to_json(t)) INTO v_result FROM (
      SELECT
        ROW_NUMBER() OVER (ORDER BY a.earned DESC) AS rank,
        a.agent_id,
        COALESCE(NULLIF(trim(concat_ws(' ', ag.first_name, ag.last_name)), ''), ag.email) AS agent_name,
        cgp.position_code, cgp.position_name, a.earned
      FROM agg a
      JOIN public.agents ag ON ag.id = a.agent_id
      LEFT JOIN public.agent_positions ap ON ap.agent_id = a.agent_id AND ap.end_date IS NULL
      LEFT JOIN public.comp_grid_positions cgp ON cgp.id = ap.position_id
      ORDER BY a.earned DESC LIMIT p_limit
    ) t;

    RETURN jsonb_build_object('success', true, 'is_owner_view', v_visible IS NULL,
                              'rows', COALESCE(v_result, '[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.leaderboard_top_earners(date,date,uuid,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leaderboard_top_earners(date,date,uuid,int) TO authenticated;

-- ============================================================================
-- 2. scoreboard_* family — tenant-scoped, NO view-down filter (carve-out)
-- ============================================================================
-- Every authenticated agent in the tenant sees the same ranking regardless
-- of upline relationship. Only aggregate fields exposed.

-- scoreboard_top_producers
-- Tenant-scoped: enforced via current_tenant_id() in WHERE clause.
-- View-down: explicitly bypassed per [[scoreboard-page]] wiki carve-out.
-- All authenticated agents in the tenant see the same ranking regardless of
-- upline relationship. Aggregate visibility only (rank, name, position,
-- premium total). Do not add WHERE agent_id = ANY(visible_agent_ids()).
CREATE OR REPLACE FUNCTION public.scoreboard_top_producers(
    p_start_date date, p_end_date date, p_carrier_id uuid DEFAULT NULL, p_limit int DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_tenant_id uuid; v_result jsonb;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;
    WITH scoped AS (
      SELECT p.agent_id, p.status, p.annual_premium FROM public.policies p
       WHERE p.tenant_id = v_tenant_id
         AND p.application_date BETWEEN p_start_date AND p_end_date
         AND p.agent_id IS NOT NULL
         AND (p_carrier_id IS NULL OR EXISTS (
              SELECT 1 FROM public.comp_grid_products cgp
               WHERE cgp.id = p.product_id AND cgp.carrier_id = p_carrier_id))
    ), agg AS (
      SELECT s.agent_id,
             COALESCE(SUM(annual_premium) FILTER (WHERE status IN ('Issued','Issue Paid')), 0) AS total
        FROM scoped s GROUP BY s.agent_id
    )
    SELECT jsonb_agg(row_to_json(t)) INTO v_result FROM (
      SELECT ROW_NUMBER() OVER (ORDER BY a.total DESC) AS rank,
        a.agent_id,
        COALESCE(NULLIF(trim(concat_ws(' ', ag.first_name, ag.last_name)), ''), ag.email) AS agent_name,
        cgp.position_code, cgp.position_name, a.total
      FROM agg a JOIN public.agents ag ON ag.id = a.agent_id
      LEFT JOIN public.agent_positions ap ON ap.agent_id = a.agent_id AND ap.end_date IS NULL
      LEFT JOIN public.comp_grid_positions cgp ON cgp.id = ap.position_id
      ORDER BY a.total DESC LIMIT p_limit
    ) t;
    RETURN jsonb_build_object('success', true, 'rows', COALESCE(v_result, '[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.scoreboard_top_producers(date,date,uuid,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scoreboard_top_producers(date,date,uuid,int) TO authenticated;

-- scoreboard_top_earners
-- Tenant-scoped: enforced via current_tenant_id() in WHERE clause.
-- View-down: explicitly bypassed per [[scoreboard-page]] wiki carve-out.
-- All authenticated agents in the tenant see the same ranking regardless of
-- upline relationship. Aggregate visibility only (rank, name, position,
-- realized commission total). Do not add WHERE agent_id = ANY(visible_agent_ids()).
CREATE OR REPLACE FUNCTION public.scoreboard_top_earners(
    p_start_date date, p_end_date date, p_carrier_id uuid DEFAULT NULL, p_limit int DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_tenant_id uuid; v_result jsonb;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;
    WITH scoped AS (
      SELECT pc.agent_id, pc.amount
        FROM public.policy_commissions pc
        JOIN public.policies p ON p.id = pc.policy_id
       WHERE pc.tenant_id = v_tenant_id AND p.status = 'Issue Paid'
         AND pc.application_date BETWEEN p_start_date AND p_end_date
         AND (p_carrier_id IS NULL OR EXISTS (
              SELECT 1 FROM public.comp_grid_products cgp
               WHERE cgp.id = p.product_id AND cgp.carrier_id = p_carrier_id))
    ), agg AS (
      SELECT s.agent_id, COALESCE(SUM(amount), 0) AS earned
        FROM scoped s GROUP BY s.agent_id
    )
    SELECT jsonb_agg(row_to_json(t)) INTO v_result FROM (
      SELECT ROW_NUMBER() OVER (ORDER BY a.earned DESC) AS rank,
        a.agent_id,
        COALESCE(NULLIF(trim(concat_ws(' ', ag.first_name, ag.last_name)), ''), ag.email) AS agent_name,
        cgp.position_code, cgp.position_name, a.earned
      FROM agg a JOIN public.agents ag ON ag.id = a.agent_id
      LEFT JOIN public.agent_positions ap ON ap.agent_id = a.agent_id AND ap.end_date IS NULL
      LEFT JOIN public.comp_grid_positions cgp ON cgp.id = ap.position_id
      ORDER BY a.earned DESC LIMIT p_limit
    ) t;
    RETURN jsonb_build_object('success', true, 'rows', COALESCE(v_result, '[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.scoreboard_top_earners(date,date,uuid,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scoreboard_top_earners(date,date,uuid,int) TO authenticated;

-- scoreboard_top_recruiters
-- Tenant-scoped: enforced via current_tenant_id() in WHERE clause.
-- View-down: explicitly bypassed per [[scoreboard-page]] wiki carve-out.
-- All authenticated agents in the tenant see the same ranking regardless of
-- upline relationship. Aggregate visibility only (rank, name, position,
-- recruit count). Do not add WHERE upline_agent_id = ANY(visible_agent_ids()).
CREATE OR REPLACE FUNCTION public.scoreboard_top_recruiters(
    p_start_date date, p_end_date date, p_limit int DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_tenant_id uuid; v_result jsonb;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;
    WITH scoped AS (
      SELECT a.upline_agent_id AS recruiter_id, COUNT(*) AS recruits
        FROM public.agents a
       WHERE a.tenant_id = v_tenant_id AND a.is_owner = false AND a.upline_agent_id IS NOT NULL
         AND a.created_at::date BETWEEN p_start_date AND p_end_date
       GROUP BY a.upline_agent_id
    )
    SELECT jsonb_agg(row_to_json(t)) INTO v_result FROM (
      SELECT ROW_NUMBER() OVER (ORDER BY s.recruits DESC) AS rank,
        s.recruiter_id AS agent_id,
        COALESCE(NULLIF(trim(concat_ws(' ', ag.first_name, ag.last_name)), ''), ag.email) AS agent_name,
        cgp.position_code, cgp.position_name, s.recruits
      FROM scoped s JOIN public.agents ag ON ag.id = s.recruiter_id
      LEFT JOIN public.agent_positions ap ON ap.agent_id = s.recruiter_id AND ap.end_date IS NULL
      LEFT JOIN public.comp_grid_positions cgp ON cgp.id = ap.position_id
      ORDER BY s.recruits DESC LIMIT p_limit
    ) t;
    RETURN jsonb_build_object('success', true, 'rows', COALESCE(v_result, '[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.scoreboard_top_recruiters(date,date,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scoreboard_top_recruiters(date,date,int) TO authenticated;

-- scoreboard_most_improved
-- Tenant-scoped: enforced via current_tenant_id() in WHERE clause.
-- View-down: explicitly bypassed per [[scoreboard-page]] wiki carve-out.
-- All authenticated agents in the tenant see the same ranking regardless of
-- upline relationship. Aggregate visibility only (rank, name, position,
-- prev/curr booked, pct_growth). Do not add WHERE agent_id = ANY(visible_agent_ids()).
CREATE OR REPLACE FUNCTION public.scoreboard_most_improved(
    p_start_date date, p_end_date date, p_carrier_id uuid DEFAULT NULL, p_limit int DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id uuid; v_result jsonb;
    v_window_days int; v_prior_start date; v_prior_end date;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;
    v_window_days := (p_end_date - p_start_date) + 1;
    v_prior_end := p_start_date - 1;
    v_prior_start := v_prior_end - (v_window_days - 1);
    WITH curr AS (
      SELECT p.agent_id, COALESCE(SUM(annual_premium) FILTER (WHERE status IN ('Issued','Issue Paid')), 0) AS booked
        FROM public.policies p
       WHERE p.tenant_id = v_tenant_id AND p.application_date BETWEEN p_start_date AND p_end_date
         AND p.agent_id IS NOT NULL
         AND (p_carrier_id IS NULL OR EXISTS (
              SELECT 1 FROM public.comp_grid_products cgp WHERE cgp.id = p.product_id AND cgp.carrier_id = p_carrier_id))
       GROUP BY p.agent_id
    ), prev AS (
      SELECT p.agent_id, COALESCE(SUM(annual_premium) FILTER (WHERE status IN ('Issued','Issue Paid')), 0) AS booked
        FROM public.policies p
       WHERE p.tenant_id = v_tenant_id AND p.application_date BETWEEN v_prior_start AND v_prior_end
         AND p.agent_id IS NOT NULL
         AND (p_carrier_id IS NULL OR EXISTS (
              SELECT 1 FROM public.comp_grid_products cgp WHERE cgp.id = p.product_id AND cgp.carrier_id = p_carrier_id))
       GROUP BY p.agent_id
    ), joined AS (
      SELECT c.agent_id, c.booked AS curr_booked, COALESCE(p.booked, 0) AS prev_booked,
             CASE WHEN COALESCE(p.booked, 0) = 0 THEN NULL
                  ELSE ((c.booked - p.booked) / p.booked * 100) END AS pct_growth
        FROM curr c LEFT JOIN prev p ON p.agent_id = c.agent_id
       WHERE c.booked > COALESCE(p.booked, 0)
    )
    SELECT jsonb_agg(row_to_json(t)) INTO v_result FROM (
      SELECT ROW_NUMBER() OVER (ORDER BY pct_growth DESC NULLS LAST, curr_booked DESC) AS rank,
        j.agent_id,
        COALESCE(NULLIF(trim(concat_ws(' ', ag.first_name, ag.last_name)), ''), ag.email) AS agent_name,
        cgp.position_code, cgp.position_name, j.curr_booked, j.prev_booked, j.pct_growth
      FROM joined j JOIN public.agents ag ON ag.id = j.agent_id
      LEFT JOIN public.agent_positions ap ON ap.agent_id = j.agent_id AND ap.end_date IS NULL
      LEFT JOIN public.comp_grid_positions cgp ON cgp.id = ap.position_id
      ORDER BY pct_growth DESC NULLS LAST, curr_booked DESC LIMIT p_limit
    ) t;
    RETURN jsonb_build_object('success', true,
      'prior_window', jsonb_build_object('start', v_prior_start, 'end', v_prior_end),
      'rows', COALESCE(v_result, '[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.scoreboard_most_improved(date,date,uuid,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scoreboard_most_improved(date,date,uuid,int) TO authenticated;
