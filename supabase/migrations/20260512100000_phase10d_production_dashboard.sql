-- Phase 10D: Production Dashboard at /production.
--
-- APPLIED 2026-05-04 to project oarstmxbgdczytwzpyxj.
--
-- Scope (per wiki/production-dashboard-page.md + Kevin's call):
--   - Status-split scorecards: Total / Submitted / Pending / Active / Potential
--     Lapse / Terminated, plus Active Agents (30d definition) and Booked Policies.
--   - Submitted Business vs Issue Paid Business basis toggle (Kevin's must-have).
--   - Production line graph with 4 modes: total / submitted / active / per_agent.
--   - Agent Totals table: every visible agent's Individual / Team / Total AP.
--   - View-down via existing visible_agent_ids() (NULL = owner = no filter).
--
-- Three new RPCs, ZERO new tables (refs deferred to Phase 10F per user decision):
--   1. production_metrics(start, end, carrier_id, basis)
--      → status splits + booked_policies + active_agents + total/submitted/etc.
--   2. production_premium_trend(start, end, carrier_id, basis, mode, bucket)
--      → time series buckets for the line chart
--   3. production_agent_totals(start, end, carrier_id, basis, limit, offset)
--      → paginated agent table with Individual / Team / Total AP
--
-- Basis semantics (NEW vocabulary — locked here, used everywhere downstream):
--   - 'submitted'  → metric counts policies whose application_date is in window,
--                    regardless of current status (drives raw activity contests).
--   - 'issue_paid' → metric counts policies that REACHED Issue Paid status with
--                    that transition's policy_status_history.created_at in window
--                    (drives cash-flow contests). Per wiki: this is the cash-flow
--                    pulse Kevin asked about explicitly.
--
-- Active Agents semantics (per wiki/active-agent-billing-model.md):
--   COUNT(DISTINCT p.agent_id) WHERE policies.application_date >= NOW() - 30d
--   AND agent.status <> 'archived'. The 30d window is a CONSTANT — does not
--   reflect the page's date range. Kevin's billing definition is "wrote in last
--   30d, period". A separate widget can show "active in window" later if asked.

BEGIN;

-- ============================================================================
-- 1. production_metrics
-- ============================================================================
-- Single round trip for the scorecard row.
--
-- Returns BOTH bases pre-computed when called (basis param picks which goes
-- into the visible cards) — but the RPC accepts the basis param to keep its
-- contract symmetric with the trend / agent-totals RPCs and to allow future
-- short-circuit when only one basis is needed by a caller.
--
-- Active Agents is computed with the 30d billing window regardless of the
-- caller's date range — see header comment.
--
-- Carrier filter: policies.product_id → comp_grid_products.carrier_id. Orphan
-- product policies (product_id NULL) only count when p_carrier_id IS NULL.
CREATE OR REPLACE FUNCTION public.production_metrics(
    p_start_date date,
    p_end_date   date,
    p_carrier_id uuid    DEFAULT NULL,
    p_basis      text    DEFAULT 'submitted'   -- 'submitted' | 'issue_paid'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id    uuid;
    v_visible      uuid[];
    v_total        numeric := 0;
    v_submitted    numeric := 0;
    v_pending      numeric := 0;
    v_active       numeric := 0;
    v_lapse        numeric := 0;
    v_terminated   numeric := 0;
    v_booked_pol   int     := 0;
    v_active_agts  int     := 0;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;

    IF p_basis NOT IN ('submitted', 'issue_paid') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'bad_basis');
    END IF;

    v_visible := public.visible_agent_ids();   -- NULL for owner

    -- Status-split aggregation
    --
    -- 'submitted' basis: filter by p.application_date in window. Each policy
    -- counts in the bucket of its CURRENT status. Total = sum across all.
    --
    -- 'issue_paid' basis: filter by EXISTS history row where status='Issue Paid'
    -- AND created_at in window. Status splits then bucket by current status,
    -- but in practice most rows will be 'Issue Paid' or downstream of it.
    -- This intentionally surfaces "what hit cash this month" — the raw
    -- contest definition Kevin asked about. Pending/Submitted buckets will
    -- usually be 0 here; that's correct.
    WITH scoped AS (
      SELECT p.id, p.agent_id, p.status, p.annual_premium
        FROM public.policies p
       WHERE p.tenant_id = v_tenant_id
         AND p.agent_id IS NOT NULL
         AND (v_visible IS NULL OR p.agent_id = ANY(v_visible))
         AND (
              p_carrier_id IS NULL
              OR EXISTS (
                  SELECT 1 FROM public.comp_grid_products cgp
                   WHERE cgp.id = p.product_id AND cgp.carrier_id = p_carrier_id
              )
         )
         AND CASE
              WHEN p_basis = 'submitted' THEN
                  p.application_date BETWEEN p_start_date AND p_end_date
              ELSE
                  EXISTS (
                      SELECT 1 FROM public.policy_status_history h
                       WHERE h.policy_id = p.id
                         AND h.status = 'Issue Paid'
                         AND h.created_at::date BETWEEN p_start_date AND p_end_date
                  )
             END
    )
    SELECT
        COALESCE(SUM(annual_premium),                                                 0),
        COALESCE(SUM(annual_premium) FILTER (WHERE status = 'Submitted'),             0),
        COALESCE(SUM(annual_premium) FILTER (WHERE status = 'Pending'),               0),
        COALESCE(SUM(annual_premium) FILTER (WHERE status IN ('Issued','Issue Paid')),0),
        COALESCE(SUM(annual_premium) FILTER (WHERE status = 'Potential Lapse'),       0),
        COALESCE(SUM(annual_premium) FILTER (WHERE status = 'Terminated'),            0),
        COUNT(*)                     FILTER (WHERE status IN ('Issued','Issue Paid'))
      INTO v_total, v_submitted, v_pending, v_active, v_lapse, v_terminated, v_booked_pol
      FROM scoped;

    -- Active Agents — fixed 30d billing window; ignores the page date range.
    -- View-down still applies. Archived agents excluded.
    SELECT COUNT(DISTINCT p.agent_id) INTO v_active_agts
      FROM public.policies p
      JOIN public.agents   a ON a.id = p.agent_id
     WHERE p.tenant_id = v_tenant_id
       AND p.application_date >= (CURRENT_DATE - INTERVAL '30 days')
       AND p.agent_id IS NOT NULL
       AND a.status <> 'archived'
       AND (v_visible IS NULL OR p.agent_id = ANY(v_visible));

    RETURN jsonb_build_object(
        'success',          true,
        'total_premium',    v_total,
        'submitted_premium',v_submitted,
        'pending_premium',  v_pending,
        'active_premium',   v_active,
        'lapse_premium',    v_lapse,
        'terminated_premium', v_terminated,
        'booked_policies',  v_booked_pol,
        'active_agents',    v_active_agts,
        'meta', jsonb_build_object(
            'is_owner_view', v_visible IS NULL,
            'basis',         p_basis,
            'start_date',    p_start_date,
            'end_date',      p_end_date,
            'carrier_id',    p_carrier_id
        )
    );
END;
$$;
REVOKE ALL ON FUNCTION public.production_metrics(date,date,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.production_metrics(date,date,uuid,text) TO authenticated;


-- ============================================================================
-- 2. production_premium_trend
-- ============================================================================
-- Time series for the production line chart. Caller picks bucket size + mode.
--
-- Modes:
--   'total'     → one series: SUM(annual_premium) for ALL statuses in window.
--   'submitted' → one series: only status='Submitted' rows.
--   'active'    → one series: only status IN ('Issued','Issue Paid') rows.
--   'per_agent' → top-5-by-total-premium series, one line per agent.
--
-- Bucket size: 'day' | 'week' | 'month'. Default 'day' for ranges <= 60 days,
-- 'week' for <= 365 days, 'month' otherwise — but we let the caller decide;
-- the default param is 'day' and the UI chooses based on range width.
--
-- Basis semantics: same as production_metrics — 'submitted' filters by
-- application_date; 'issue_paid' filters by Issue Paid transition date.
CREATE OR REPLACE FUNCTION public.production_premium_trend(
    p_start_date date,
    p_end_date   date,
    p_carrier_id uuid DEFAULT NULL,
    p_basis      text DEFAULT 'submitted',
    p_mode       text DEFAULT 'total',          -- total|submitted|active|per_agent
    p_bucket     text DEFAULT 'day'             -- day|week|month
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
    IF p_basis  NOT IN ('submitted', 'issue_paid')      THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'bad_basis'); END IF;
    IF p_mode   NOT IN ('total','submitted','active','per_agent') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'bad_mode'); END IF;
    IF p_bucket NOT IN ('day','week','month')           THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'bad_bucket'); END IF;

    v_visible := public.visible_agent_ids();

    -- Build the scoped policy set with the basis-aware "event date" we'll
    -- bucket against. event_date = application_date for 'submitted',
    -- = the Issue Paid transition timestamp date for 'issue_paid'.
    WITH scoped AS (
      SELECT
          p.id,
          p.agent_id,
          p.status,
          p.annual_premium,
          CASE
            WHEN p_basis = 'submitted' THEN p.application_date
            ELSE (
              SELECT MAX(h.created_at::date)
                FROM public.policy_status_history h
               WHERE h.policy_id = p.id AND h.status = 'Issue Paid'
            )
          END AS event_date
        FROM public.policies p
       WHERE p.tenant_id = v_tenant_id
         AND p.agent_id IS NOT NULL
         AND (v_visible IS NULL OR p.agent_id = ANY(v_visible))
         AND (
              p_carrier_id IS NULL
              OR EXISTS (
                  SELECT 1 FROM public.comp_grid_products cgp
                   WHERE cgp.id = p.product_id AND cgp.carrier_id = p_carrier_id
              )
         )
    ), filtered AS (
      SELECT * FROM scoped
       WHERE event_date IS NOT NULL
         AND event_date BETWEEN p_start_date AND p_end_date
         AND CASE p_mode
              WHEN 'submitted' THEN status = 'Submitted'
              WHEN 'active'    THEN status IN ('Issued','Issue Paid')
              ELSE TRUE
             END
    ), bucketed AS (
      SELECT
          date_trunc(p_bucket, event_date)::date AS bucket_date,
          agent_id,
          annual_premium
        FROM filtered
    )
    SELECT CASE
        WHEN p_mode = 'per_agent' THEN
          -- Pick top 5 agents by total premium across the window, then build
          -- one bucketed series per agent.
          (WITH top5 AS (
              SELECT agent_id, SUM(annual_premium) AS total
                FROM bucketed
               GROUP BY agent_id
               ORDER BY total DESC NULLS LAST
               LIMIT 5
           ), per_agent AS (
              SELECT b.bucket_date,
                     b.agent_id,
                     COALESCE(NULLIF(trim(concat_ws(' ', ag.first_name, ag.last_name)), ''), ag.email) AS agent_name,
                     SUM(b.annual_premium) AS amount
                FROM bucketed b
                JOIN top5      t ON t.agent_id = b.agent_id
                JOIN public.agents ag ON ag.id = b.agent_id
               GROUP BY b.bucket_date, b.agent_id, ag.first_name, ag.last_name, ag.email
               ORDER BY bucket_date, agent_name
           )
           SELECT jsonb_build_object(
               'mode',   'per_agent',
               'series', COALESCE(jsonb_agg(row_to_json(per_agent)), '[]'::jsonb)
           ) FROM per_agent)
        ELSE
          (WITH single AS (
              SELECT bucket_date, SUM(annual_premium) AS amount
                FROM bucketed
               GROUP BY bucket_date
               ORDER BY bucket_date
           )
           SELECT jsonb_build_object(
               'mode',   p_mode,
               'series', COALESCE(jsonb_agg(row_to_json(single)), '[]'::jsonb)
           ) FROM single)
      END INTO v_result;

    RETURN jsonb_build_object(
        'success', true,
        'bucket',  p_bucket,
        'basis',   p_basis,
        'data',    COALESCE(v_result, jsonb_build_object('mode', p_mode, 'series', '[]'::jsonb))
    );
END;
$$;
REVOKE ALL ON FUNCTION public.production_premium_trend(date,date,uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.production_premium_trend(date,date,uuid,text,text,text) TO authenticated;


-- ============================================================================
-- 3. production_agent_totals
-- ============================================================================
-- Per-agent table: Individual AP / Team AP / Total AP.
--
-- Individual = SUM(annual_premium) where p.agent_id = agent
-- Team       = SUM(annual_premium) for all DESCENDANTS of agent (recursive)
-- Total      = Individual + Team
--
-- Compute: walk the visible agent set once, build per-agent individual SUMs,
-- then walk the upline chain so each ancestor accumulates descendants' totals.
-- The recursive CTE traverses the agents tree top-down using upline_agent_id.
--
-- Pagination: ORDER BY total DESC, then agent_name. Limit/offset standard.
--
-- View-down: identical to other RPCs in this file. Owner sees full tenant.
CREATE OR REPLACE FUNCTION public.production_agent_totals(
    p_start_date date,
    p_end_date   date,
    p_carrier_id uuid DEFAULT NULL,
    p_basis      text DEFAULT 'submitted',
    p_limit      int  DEFAULT 50,
    p_offset     int  DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id uuid;
    v_visible   uuid[];
    v_total     int;
    v_rows      jsonb;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;
    IF p_basis NOT IN ('submitted','issue_paid') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'bad_basis'); END IF;
    IF p_limit  IS NULL OR p_limit  <= 0 OR p_limit  > 500 THEN p_limit  := 50; END IF;
    IF p_offset IS NULL OR p_offset <  0                   THEN p_offset := 0;  END IF;

    v_visible := public.visible_agent_ids();

    WITH RECURSIVE
    -- 1. Agents in caller's scope (active + archived both visible; UI can filter).
    visible_agents AS (
      SELECT a.id, a.upline_agent_id, a.first_name, a.last_name, a.email, a.status
        FROM public.agents a
       WHERE a.tenant_id = v_tenant_id
         AND (v_visible IS NULL OR a.id = ANY(v_visible))
    ),
    -- 2. Per-policy basis filter & event scoping (same logic as the trend RPC).
    scoped_policies AS (
      SELECT p.agent_id, p.annual_premium
        FROM public.policies p
       WHERE p.tenant_id = v_tenant_id
         AND p.agent_id IS NOT NULL
         AND (v_visible IS NULL OR p.agent_id = ANY(v_visible))
         AND (
              p_carrier_id IS NULL
              OR EXISTS (
                  SELECT 1 FROM public.comp_grid_products cgp
                   WHERE cgp.id = p.product_id AND cgp.carrier_id = p_carrier_id
              )
         )
         AND CASE
              WHEN p_basis = 'submitted' THEN
                  p.application_date BETWEEN p_start_date AND p_end_date
              ELSE
                  EXISTS (
                      SELECT 1 FROM public.policy_status_history h
                       WHERE h.policy_id = p.id
                         AND h.status = 'Issue Paid'
                         AND h.created_at::date BETWEEN p_start_date AND p_end_date
                  )
             END
    ),
    -- 3. Individual rollup per visible agent.
    individual AS (
      SELECT v.id AS agent_id, COALESCE(SUM(sp.annual_premium), 0) AS individual_ap
        FROM visible_agents v
        LEFT JOIN scoped_policies sp ON sp.agent_id = v.id
       GROUP BY v.id
    ),
    -- 4. Walk the tree once: for each visible agent A, compute Team AP =
    --    SUM(individual_ap) over agents whose ancestry chain includes A.
    --    Done by recursive CTE: each row walks up its upline chain inside the
    --    tenant, emitting (ancestor_id, contributing_individual_ap).
    chain AS (
      SELECT a.id AS leaf_id, a.id AS ancestor_id, COALESCE(i.individual_ap, 0) AS contrib
        FROM visible_agents a
        LEFT JOIN individual i ON i.agent_id = a.id
      UNION ALL
      SELECT c.leaf_id, p.upline_agent_id AS ancestor_id, c.contrib
        FROM chain c
        JOIN public.agents p ON p.id = c.ancestor_id
       WHERE p.upline_agent_id IS NOT NULL
         AND p.tenant_id = v_tenant_id
    ),
    team AS (
      -- Team AP for agent X = SUM(contrib) of all chain rows where ancestor_id = X
      -- but EXCLUDING the agent's own individual contribution (chain leaf row
      -- where leaf_id = ancestor_id). Hence the WHERE filter.
      SELECT ancestor_id AS agent_id, COALESCE(SUM(contrib), 0) AS team_ap
        FROM chain
       WHERE leaf_id <> ancestor_id
       GROUP BY ancestor_id
    ),
    rolled AS (
      SELECT
          v.id                                                                          AS agent_id,
          COALESCE(NULLIF(trim(concat_ws(' ', v.first_name, v.last_name)), ''), v.email) AS agent_name,
          v.email,
          v.status,
          cgp.position_code,
          cgp.position_name,
          COALESCE(i.individual_ap, 0)                                                  AS individual_ap,
          COALESCE(t.team_ap,       0)                                                  AS team_ap,
          COALESCE(i.individual_ap, 0) + COALESCE(t.team_ap, 0)                         AS total_ap
        FROM visible_agents  v
        LEFT JOIN individual i  ON i.agent_id  = v.id
        LEFT JOIN team       t  ON t.agent_id  = v.id
        LEFT JOIN public.agent_positions ap   ON ap.agent_id = v.id AND ap.end_date IS NULL
        LEFT JOIN public.comp_grid_positions cgp ON cgp.id   = ap.position_id
       WHERE v.status <> 'archived'
    ),
    ranked AS (
      SELECT r.*,
             ROW_NUMBER() OVER (ORDER BY r.total_ap DESC NULLS LAST, r.agent_name) AS rn
        FROM rolled r
    )
    SELECT COUNT(*),
           COALESCE(jsonb_agg(row_to_json(ranked) ORDER BY ranked.rn)
                    FILTER (WHERE ranked.rn BETWEEN p_offset + 1 AND p_offset + p_limit),
                    '[]'::jsonb)
      INTO v_total, v_rows
      FROM ranked;

    RETURN jsonb_build_object(
        'success',  true,
        'total',    v_total,
        'limit',    p_limit,
        'offset',   p_offset,
        'rows',     COALESCE(v_rows, '[]'::jsonb),
        'meta',     jsonb_build_object(
            'is_owner_view', v_visible IS NULL,
            'basis',         p_basis,
            'start_date',    p_start_date,
            'end_date',      p_end_date,
            'carrier_id',    p_carrier_id
        )
    );
END;
$$;
REVOKE ALL ON FUNCTION public.production_agent_totals(date,date,uuid,text,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.production_agent_totals(date,date,uuid,text,int,int) TO authenticated;


-- ============================================================================
-- Verification
-- ============================================================================
DO $$
BEGIN
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'production_metrics'),
        'production_metrics missing';
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'production_premium_trend'),
        'production_premium_trend missing';
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'production_agent_totals'),
        'production_agent_totals missing';
    RAISE NOTICE 'Phase 10D function verification passed.';
END $$;

COMMIT;
