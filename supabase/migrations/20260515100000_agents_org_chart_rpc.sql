-- Phase 13.0: Org chart RPC for the /agents page.
--
-- Returns a flat list of every agent visible to the caller (full tenant for
-- the owner; self + descendants for everyone else) with per-agent activity
-- counts in the selected date window. The frontend assembles the tree
-- client-side using upline_agent_id and computes subtree-level rollups
-- (e.g. "any descendant has at-risk business") in a single O(N) pass — much
-- simpler than trying to do recursive aggregation in SQL.
--
-- Activity counts per agent within [p_start_date, p_end_date]:
--   in_window_count           — any status, total policy count in window
--   issue_paid_count          — status = 'Issue Paid' in window
--   submitted_pending_count   — status in ('Submitted','Pending') in window
--   at_risk_count             — status = 'Potential Lapse' in window
--   lifetime_count            — total policies ever (window-independent)
--
-- The "lifetime_count" is what differentiates "never written" (lifetime=0)
-- from "dormant" (lifetime>0 but in_window=0). Both are equally non-active
-- in the selected window but visually they should look different — fresh
-- recruits need an outreach; dormant veterans need a re-engagement nudge.

BEGIN;

CREATE OR REPLACE FUNCTION public.agents_org_chart(
    p_start_date date,
    p_end_date   date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id uuid;
    v_caller    uuid;
    v_is_owner  boolean;
    v_visible_agent_ids uuid[];
    v_result jsonb;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;
    v_caller := auth.uid();
    v_is_owner := public.is_owner();

    -- Build visible set: owner sees full tenant; non-owner sees self + descendants.
    -- NULL signals "no agent-id filter" to match the convention in other RPCs.
    IF NOT v_is_owner THEN
        v_visible_agent_ids := ARRAY[v_caller] ||
            COALESCE((SELECT array_agg(agent_id) FROM public.descendants_of(v_caller)), ARRAY[]::uuid[]);
    END IF;

    SELECT jsonb_agg(row_to_json(t)) INTO v_result FROM (
        SELECT
            a.id,
            a.first_name,
            a.last_name,
            a.email,
            a.upline_agent_id,
            a.is_owner,
            cgp.position_code,
            cgp.position_name,
            COALESCE(act.in_window_count,         0) AS in_window_count,
            COALESCE(act.issue_paid_count,        0) AS issue_paid_count,
            COALESCE(act.submitted_pending_count, 0) AS submitted_pending_count,
            COALESCE(act.at_risk_count,           0) AS at_risk_count,
            COALESCE(act.lifetime_count,          0) AS lifetime_count
          FROM public.agents a
          LEFT JOIN public.agent_positions ap
            ON ap.agent_id = a.id AND ap.end_date IS NULL
          LEFT JOIN public.comp_grid_positions cgp
            ON cgp.id = ap.position_id
          LEFT JOIN LATERAL (
              -- One LATERAL aggregation per agent, scanning only their policies.
              -- agent_id IS NOT NULL is implicit here since the join key is a.id.
              SELECT
                  COUNT(*) FILTER (
                      WHERE p.application_date BETWEEN p_start_date AND p_end_date
                  ) AS in_window_count,
                  COUNT(*) FILTER (
                      WHERE p.application_date BETWEEN p_start_date AND p_end_date
                        AND p.status = 'Issue Paid'
                  ) AS issue_paid_count,
                  COUNT(*) FILTER (
                      WHERE p.application_date BETWEEN p_start_date AND p_end_date
                        AND p.status IN ('Submitted','Pending')
                  ) AS submitted_pending_count,
                  COUNT(*) FILTER (
                      WHERE p.application_date BETWEEN p_start_date AND p_end_date
                        AND p.status = 'Potential Lapse'
                  ) AS at_risk_count,
                  COUNT(*) AS lifetime_count
                FROM public.policies p
               WHERE p.agent_id = a.id
                 AND p.tenant_id = v_tenant_id
          ) act ON TRUE
         WHERE a.tenant_id = v_tenant_id
           AND a.status <> 'archived'
           AND (v_is_owner OR a.id = ANY(v_visible_agent_ids))
         ORDER BY a.is_owner DESC, a.first_name NULLS LAST, a.last_name NULLS LAST
    ) t;

    RETURN jsonb_build_object(
        'success',       true,
        'is_owner_view', v_is_owner,
        'rows',          COALESCE(v_result, '[]'::jsonb),
        'meta', jsonb_build_object(
            'start_date', p_start_date,
            'end_date',   p_end_date
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.agents_org_chart(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agents_org_chart(date, date) TO authenticated;

DO $$
BEGIN
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'agents_org_chart'),
           'agents_org_chart function missing';
    RAISE NOTICE 'Phase 13.0 agents_org_chart RPC verification passed.';
END $$;

COMMIT;
