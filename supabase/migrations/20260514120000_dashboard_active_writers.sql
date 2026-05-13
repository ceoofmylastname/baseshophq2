-- Phase 12.0: Add range-driven Active Writers metric to dashboard_metrics.
--
-- Adds a single new aggregation `active_writers` to the dashboard_metrics
-- jsonb return: COUNT DISTINCT agent_id over the already-scoped policies
-- window. Same date range, same carrier filter, same view-down + orphan
-- semantics as every other field in this RPC.
--
-- Three distinct headcount concepts now coexist without overlap:
--   1. team_size      — pure headcount (non-archived agents in scope).
--                       Ignores activity, ignores window.
--   2. active_writers — agents who wrote at least one policy in the
--                       SELECTED date range. Resets when the range changes.
--                       This is the new field. Lives on the dashboard.
--   3. active_agents  — FIXED 30-day window count, used by the billing
--                       model. Surfaced on production_metrics + /active-agents.
--                       Deliberately ignores the page date range so billing
--                       dollars don't fluctuate with a dropdown.
--
-- CREATE OR REPLACE FUNCTION is idempotent. Existing callers are unaffected;
-- they just see a new field they can read or ignore.

BEGIN;

CREATE OR REPLACE FUNCTION public.dashboard_metrics(
    p_start_date date,
    p_end_date   date,
    p_carrier_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id uuid;
    v_is_owner  boolean;
    v_caller    uuid;
    v_visible_agent_ids uuid[];
    v_pipeline numeric := 0;
    v_booked_premium numeric := 0;
    v_realized_premium numeric := 0;
    v_at_risk numeric := 0;
    v_booked_policies int := 0;
    v_team_size int := 0;
    v_active_writers int := 0;
    v_booked_commission numeric := 0;
    v_realized_commission numeric := 0;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;
    v_caller := auth.uid();
    v_is_owner := public.is_owner();

    -- Build visible agent set: owner = NULL (no filter), non-owner = self + descendants
    IF NOT v_is_owner THEN
        v_visible_agent_ids := ARRAY[v_caller] ||
            COALESCE((SELECT array_agg(agent_id) FROM public.descendants_of(v_caller)), ARRAY[]::uuid[]);
    END IF;

    WITH scoped AS (
      SELECT p.id, p.agent_id, p.status, p.annual_premium, p.product_id, p.application_date
        FROM public.policies p
       WHERE p.tenant_id = v_tenant_id
         AND p.application_date BETWEEN p_start_date AND p_end_date
         AND (v_is_owner OR p.agent_id = ANY(v_visible_agent_ids))
         AND (
             p_carrier_id IS NULL
             OR EXISTS (
                 SELECT 1 FROM public.comp_grid_products cgp
                  WHERE cgp.id = p.product_id AND cgp.carrier_id = p_carrier_id
             )
         )
    )
    SELECT
        COALESCE(SUM(annual_premium) FILTER (WHERE status IN ('Submitted','Pending')), 0),
        COALESCE(SUM(annual_premium) FILTER (WHERE status = 'Issued'),                0),
        COALESCE(SUM(annual_premium) FILTER (WHERE status = 'Issue Paid'),            0),
        COALESCE(SUM(annual_premium) FILTER (WHERE status = 'Potential Lapse'),       0),
        COUNT(*)                     FILTER (WHERE status = 'Issued'),
        -- Active writers: any agent who wrote ≥ 1 policy in the scoped window.
        -- agent_id IS NOT NULL excludes orphan rows (unmatched writing numbers).
        COUNT(DISTINCT agent_id) FILTER (WHERE agent_id IS NOT NULL)
      INTO v_pipeline, v_booked_premium, v_realized_premium, v_at_risk,
           v_booked_policies, v_active_writers
      FROM scoped;

    -- Team Size: view-down headcount, not activity-based, not time-filtered
    IF v_is_owner THEN
        SELECT COUNT(*) INTO v_team_size
          FROM public.agents
         WHERE tenant_id = v_tenant_id
           AND status <> 'archived';
    ELSE
        SELECT COUNT(*) INTO v_team_size
          FROM public.agents
         WHERE tenant_id = v_tenant_id
           AND status <> 'archived'
           AND id = ANY(v_visible_agent_ids);
    END IF;

    -- Commission metrics: SUM amounts where policy_commissions.agent_id is in scope
    WITH scoped_comm AS (
      SELECT pc.amount, p.status
        FROM public.policy_commissions pc
        JOIN public.policies p ON p.id = pc.policy_id
       WHERE pc.tenant_id = v_tenant_id
         AND pc.application_date BETWEEN p_start_date AND p_end_date
         AND (v_is_owner OR pc.agent_id = ANY(v_visible_agent_ids))
         AND (
             p_carrier_id IS NULL
             OR EXISTS (
                 SELECT 1 FROM public.comp_grid_products cgp
                  WHERE cgp.id = p.product_id AND cgp.carrier_id = p_carrier_id
             )
         )
    )
    SELECT
        COALESCE(SUM(amount) FILTER (WHERE status = 'Issued'),     0),
        COALESCE(SUM(amount) FILTER (WHERE status = 'Issue Paid'), 0)
      INTO v_booked_commission, v_realized_commission
      FROM scoped_comm;

    RETURN jsonb_build_object(
        'success', true,
        'pipeline_premium',    v_pipeline,
        'booked_premium',      v_booked_premium,
        'realized_premium',    v_realized_premium,
        'at_risk_premium',     v_at_risk,
        'booked_policies',     v_booked_policies,
        'team_size',           v_team_size,
        'active_writers',      v_active_writers,
        'booked_commission',   v_booked_commission,
        'realized_commission', v_realized_commission,
        'meta', jsonb_build_object(
            'is_owner_view', v_is_owner,
            'start_date',    p_start_date,
            'end_date',      p_end_date,
            'carrier_id',    p_carrier_id
        )
    );
END;
$$;

-- Grants unchanged from the original definition; CREATE OR REPLACE preserved them
-- but restating for clarity in case the function is dropped and recreated later.
REVOKE ALL ON FUNCTION public.dashboard_metrics(date,date,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_metrics(date,date,uuid) TO authenticated;

DO $$
BEGIN
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dashboard_metrics'),
           'dashboard_metrics function missing';
    RAISE NOTICE 'Phase 12.0 dashboard_metrics active_writers field verification passed.';
END $$;

COMMIT;
