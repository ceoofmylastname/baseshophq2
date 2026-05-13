-- Phase 13.2: Per-agent activity breakdown across all five time windows.
--
-- Returns counts + premium sums per status for one agent across today,
-- this week, this month, this year, and lifetime — all in a single round
-- trip. Powers the slide-in detail panel that opens when an org chart
-- card is clicked.
--
-- Status-by-window matrix:
--   submitted_count / submitted_premium       — status = 'Submitted'
--   pending_count   / pending_premium         — status = 'Pending'
--   issued_count    / issued_premium          — status = 'Issued'
--   issue_paid_count / issue_paid_premium     — status = 'Issue Paid'
--   lapse_count     / lapse_premium           — status = 'Potential Lapse'
--   terminated_count / terminated_premium     — status = 'Terminated'
--   total_count     / total_premium           — all statuses combined
--
-- View-down: enforced via can_view_agent(p_agent_id). Caller must already
-- be in the agent's view-down scope (or be the owner) to read this data.
-- This keeps the slide-in panel honest with the rest of the app's
-- permission model.

BEGIN;

CREATE OR REPLACE FUNCTION public.agent_activity_breakdown(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id   uuid;
    v_today_start date := CURRENT_DATE;
    v_week_start  date;
    v_month_start date := DATE_TRUNC('month', CURRENT_DATE)::date;
    v_year_start  date := DATE_TRUNC('year',  CURRENT_DATE)::date;
    v_result      jsonb;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;

    IF NOT public.can_view_agent(p_agent_id) THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
    END IF;

    -- Week starts Monday. JS Sun=0 Mon=1 ... Sat=6 mirrors PG EXTRACT(DOW).
    v_week_start := CURRENT_DATE - ((EXTRACT(DOW FROM CURRENT_DATE)::int + 6) % 7);

    WITH p AS (
        SELECT
            status,
            COALESCE(annual_premium, 0)::numeric AS premium,
            application_date
          FROM public.policies
         WHERE tenant_id = v_tenant_id
           AND agent_id  = p_agent_id
    ),
    windows AS (
        SELECT
            'today'    AS win, p.* FROM p WHERE application_date = v_today_start
        UNION ALL
        SELECT 'week',     p.* FROM p WHERE application_date >= v_week_start
        UNION ALL
        SELECT 'month',    p.* FROM p WHERE application_date >= v_month_start
        UNION ALL
        SELECT 'year',     p.* FROM p WHERE application_date >= v_year_start
        UNION ALL
        SELECT 'lifetime', p.* FROM p
    ),
    rolled AS (
        SELECT
            win,
            COUNT(*)                                                                  AS total_count,
            COALESCE(SUM(premium), 0)                                                 AS total_premium,
            COUNT(*) FILTER (WHERE status = 'Submitted')                              AS submitted_count,
            COALESCE(SUM(premium) FILTER (WHERE status = 'Submitted'), 0)             AS submitted_premium,
            COUNT(*) FILTER (WHERE status = 'Pending')                                AS pending_count,
            COALESCE(SUM(premium) FILTER (WHERE status = 'Pending'), 0)               AS pending_premium,
            COUNT(*) FILTER (WHERE status = 'Issued')                                 AS issued_count,
            COALESCE(SUM(premium) FILTER (WHERE status = 'Issued'), 0)                AS issued_premium,
            COUNT(*) FILTER (WHERE status = 'Issue Paid')                             AS issue_paid_count,
            COALESCE(SUM(premium) FILTER (WHERE status = 'Issue Paid'), 0)            AS issue_paid_premium,
            COUNT(*) FILTER (WHERE status = 'Potential Lapse')                        AS lapse_count,
            COALESCE(SUM(premium) FILTER (WHERE status = 'Potential Lapse'), 0)       AS lapse_premium,
            COUNT(*) FILTER (WHERE status = 'Terminated')                             AS terminated_count,
            COALESCE(SUM(premium) FILTER (WHERE status = 'Terminated'), 0)            AS terminated_premium
          FROM windows
         GROUP BY win
    )
    SELECT jsonb_object_agg(win, to_jsonb(rolled) - 'win') INTO v_result FROM rolled;

    -- If the agent has no policies at all, the jsonb_object_agg above returns NULL.
    -- Fill in zero-rows so the frontend can render the empty state cleanly.
    IF v_result IS NULL THEN
        v_result := jsonb_build_object(
            'today',    '{}'::jsonb,
            'week',     '{}'::jsonb,
            'month',    '{}'::jsonb,
            'year',     '{}'::jsonb,
            'lifetime', '{}'::jsonb
        );
    END IF;

    RETURN jsonb_build_object(
        'success',   true,
        'agent_id',  p_agent_id,
        'windows',   v_result,
        'meta', jsonb_build_object(
            'today_start', v_today_start,
            'week_start',  v_week_start,
            'month_start', v_month_start,
            'year_start',  v_year_start
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.agent_activity_breakdown(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_activity_breakdown(uuid) TO authenticated;

DO $$
BEGIN
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'agent_activity_breakdown'),
           'agent_activity_breakdown function missing';
    RAISE NOTICE 'Phase 13.2 agent_activity_breakdown RPC verification passed.';
END $$;

COMMIT;
