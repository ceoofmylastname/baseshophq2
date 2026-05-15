-- =============================================================================
-- Phase 13.4: dashboard_bucket_preview — KPI drill-through RPC
--
-- Powers the hover popovers on dashboard KPI tiles (Dashboard, Production,
-- TeamProduction). Returns a small, ordered preview of policies that compose
-- a given bucket (Pipeline / Booked / Realized / At-Risk / Active /
-- Terminated / Submitted / Pending) plus the two commission-mode buckets
-- (Booked Commission / Realized Commission) that already power the
-- dashboard_metrics commission tiles.
--
-- Design notes:
--   * Single RPC with a bucket-key dispatch so the client only has to know
--     one endpoint. Lowercase bucket keys are the canonical contract; the
--     UI maps title-case enum -> key.
--   * Two code paths:
--       1. POLICY-MODE — buckets that aggregate annual_premium. Filter
--          policies by status + date range on application_date + carrier.
--       2. COMMISSION-MODE — booked_commission, realized_commission.
--          Join policy_commissions ON policies and scope by pc.due_date
--          BETWEEN start AND LEAST(end, CURRENT_DATE). Matches the
--          realized-commission semantics introduced in 20260516140000 for
--          scoreboard_top_earners / leaderboard_top_earners. Use of
--          due_date keeps tiles honest about money that has actually
--          come due.
--   * View-down via visible_agent_ids(): owner gets NULL (no filter),
--     others get self+descendants.
--   * Carrier filter resolves via the comp_grid_products.carrier_id link,
--     not policies.product_id directly (a product_id is NOT a carrier_id).
--
-- Bucket key reference:
--   pipeline            -> policies WHERE status IN ('Submitted','Pending')
--   submitted           -> policies WHERE status = 'Submitted'
--   pending             -> policies WHERE status = 'Pending'
--   booked              -> policies WHERE status = 'Issued'
--   realized            -> policies WHERE status = 'Issue Paid'
--   at_risk             -> policies WHERE status = 'Potential Lapse'
--   active              -> policies WHERE status IN ('Issued','Issue Paid')
--   terminated          -> policies WHERE status = 'Terminated'
--   booked_policies     -> same as booked (count tile)
--   booked_commission   -> COMMISSION mode, p.status = 'Issued'
--   realized_commission -> COMMISSION mode, p.status = 'Issue Paid'
--
-- Return shape:
--   {
--     "success": true,
--     "bucket": "<key>",
--     "mode": "policy" | "commission",
--     "total_policies": <int>,
--     "total_premium":  <numeric or null>,
--     "total_commission": <numeric or null>,
--     "preview_rows": [
--       {
--         "id": <uuid>, "policy_number": "...", "client_name": "...",
--         "agent_name": "...", "carrier": "...", "product": "...",
--         "status": "...", "annual_premium": <num>,
--         "commission_amount": <num or null>, "application_date": "..."
--       }, ...
--     ]
--   }
--
-- Errors:
--   {"success": false, "error_code": "no_tenant"}
--   {"success": false, "error_code": "invalid_bucket"}
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.dashboard_bucket_preview(
    p_bucket     text,
    p_carrier_id uuid DEFAULT NULL,
    p_start_date date DEFAULT NULL,
    p_end_date   date DEFAULT NULL,
    p_limit      int  DEFAULT 5
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id  uuid;
    v_visible    uuid[];
    v_bucket     text;
    v_statuses   text[];
    v_mode       text;
    v_start      date;
    v_end        date;
    v_window_end date;
    v_total_policies int := 0;
    v_total_premium  numeric;
    v_total_commission numeric;
    v_rows       jsonb := '[]'::jsonb;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;
    v_visible := public.visible_agent_ids();

    v_bucket := lower(coalesce(p_bucket, ''));

    -- Resolve bucket key -> (statuses, mode).
    CASE v_bucket
        WHEN 'pipeline'            THEN v_statuses := ARRAY['Submitted','Pending'];       v_mode := 'policy';
        WHEN 'submitted'           THEN v_statuses := ARRAY['Submitted'];                 v_mode := 'policy';
        WHEN 'pending'             THEN v_statuses := ARRAY['Pending'];                   v_mode := 'policy';
        WHEN 'booked'              THEN v_statuses := ARRAY['Issued'];                    v_mode := 'policy';
        WHEN 'booked_policies'     THEN v_statuses := ARRAY['Issued'];                    v_mode := 'policy';
        WHEN 'realized'            THEN v_statuses := ARRAY['Issue Paid'];                v_mode := 'policy';
        WHEN 'at_risk'             THEN v_statuses := ARRAY['Potential Lapse'];           v_mode := 'policy';
        WHEN 'active'              THEN v_statuses := ARRAY['Issued','Issue Paid'];       v_mode := 'policy';
        WHEN 'terminated'          THEN v_statuses := ARRAY['Terminated'];                v_mode := 'policy';
        WHEN 'booked_commission'   THEN v_statuses := ARRAY['Issued'];                    v_mode := 'commission';
        WHEN 'realized_commission' THEN v_statuses := ARRAY['Issue Paid'];                v_mode := 'commission';
        ELSE
            RETURN jsonb_build_object('success', false, 'error_code', 'invalid_bucket');
    END CASE;

    -- Reasonable defaults for the date window when caller omits them.
    v_start := COALESCE(p_start_date, DATE '1900-01-01');
    v_end   := COALESCE(p_end_date,   DATE '2999-12-31');

    IF v_mode = 'policy' THEN
        ----------------------------------------------------------------------
        -- POLICY MODE
        ----------------------------------------------------------------------
        WITH scoped AS (
            SELECT p.id, p.policy_number, p.agent_id, p.carrier, p.product,
                   p.client_first_name, p.client_last_name, p.application_date,
                   p.annual_premium, p.status
              FROM public.policies p
             WHERE p.tenant_id = v_tenant_id
               AND p.status::text = ANY (v_statuses)
               AND p.application_date BETWEEN v_start AND v_end
               AND (v_visible IS NULL OR p.agent_id = ANY(v_visible))
               AND (
                   p_carrier_id IS NULL
                   OR EXISTS (
                       SELECT 1 FROM public.comp_grid_products cgp
                        WHERE cgp.id = p.product_id AND cgp.carrier_id = p_carrier_id
                   )
               )
        ),
        agg AS (
            SELECT COUNT(*)::bigint                          AS total_policies,
                   COALESCE(SUM(annual_premium), 0)::numeric AS total_premium
              FROM scoped
        ),
        preview AS (
            SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) AS rows
              FROM (
                SELECT s.id,
                       s.policy_number,
                       COALESCE(NULLIF(trim(concat_ws(' ', s.client_first_name, s.client_last_name)), ''), '—') AS client_name,
                       COALESCE(NULLIF(trim(concat_ws(' ', ag.first_name, ag.last_name)), ''), ag.email, '—')   AS agent_name,
                       s.carrier,
                       s.product,
                       s.status::text AS status,
                       s.annual_premium,
                       NULL::numeric  AS commission_amount,
                       s.application_date
                  FROM scoped s
                  LEFT JOIN public.agents ag ON ag.id = s.agent_id
                 ORDER BY s.annual_premium DESC NULLS LAST,
                          s.application_date DESC NULLS LAST
                 LIMIT GREATEST(p_limit, 0)
              ) t
        )
        SELECT agg.total_policies, agg.total_premium, preview.rows
          INTO v_total_policies, v_total_premium, v_rows
          FROM agg CROSS JOIN preview;

        RETURN jsonb_build_object(
            'success',          true,
            'bucket',           v_bucket,
            'mode',             v_mode,
            'total_policies',   v_total_policies,
            'total_premium',    v_total_premium,
            'total_commission', NULL,
            'preview_rows',     v_rows
        );
    ELSE
        ----------------------------------------------------------------------
        -- COMMISSION MODE — scope by pc.due_date BETWEEN start AND
        -- LEAST(end, CURRENT_DATE). Realized-commission semantics.
        ----------------------------------------------------------------------
        v_window_end := LEAST(v_end, CURRENT_DATE);

        WITH scoped AS (
            SELECT pc.policy_id, pc.agent_id, pc.amount,
                   p.policy_number, p.carrier, p.product,
                   p.client_first_name, p.client_last_name,
                   p.application_date, p.annual_premium, p.status
              FROM public.policy_commissions pc
              JOIN public.policies p ON p.id = pc.policy_id
             WHERE pc.tenant_id = v_tenant_id
               AND p.status::text = ANY (v_statuses)
               AND pc.due_date BETWEEN v_start AND v_window_end
               AND (v_visible IS NULL OR pc.agent_id = ANY(v_visible))
               AND (
                   p_carrier_id IS NULL
                   OR EXISTS (
                       SELECT 1 FROM public.comp_grid_products cgp
                        WHERE cgp.id = p.product_id AND cgp.carrier_id = p_carrier_id
                   )
               )
        ),
        agg AS (
            SELECT COUNT(DISTINCT policy_id)::bigint AS total_policies,
                   COALESCE(SUM(amount), 0)::numeric AS total_commission
              FROM scoped
        ),
        preview AS (
            SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) AS rows
              FROM (
                SELECT s.policy_id AS id,
                       s.policy_number,
                       COALESCE(NULLIF(trim(concat_ws(' ', s.client_first_name, s.client_last_name)), ''), '—') AS client_name,
                       COALESCE(NULLIF(trim(concat_ws(' ', ag.first_name, ag.last_name)), ''), ag.email, '—')   AS agent_name,
                       s.carrier,
                       s.product,
                       s.status::text AS status,
                       s.annual_premium,
                       s.amount       AS commission_amount,
                       s.application_date
                  FROM scoped s
                  LEFT JOIN public.agents ag ON ag.id = s.agent_id
                 ORDER BY s.amount DESC NULLS LAST,
                          s.application_date DESC NULLS LAST
                 LIMIT GREATEST(p_limit, 0)
              ) t
        )
        SELECT agg.total_policies, agg.total_commission, preview.rows
          INTO v_total_policies, v_total_commission, v_rows
          FROM agg CROSS JOIN preview;

        RETURN jsonb_build_object(
            'success',          true,
            'bucket',           v_bucket,
            'mode',             v_mode,
            'total_policies',   v_total_policies,
            'total_premium',    NULL,
            'total_commission', v_total_commission,
            'preview_rows',     v_rows
        );
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_bucket_preview(text, uuid, date, date, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_bucket_preview(text, uuid, date, date, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_smoke jsonb;
    v_has_authenticated boolean;
    v_has_public boolean;
    v_has_anon boolean;
BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
         WHERE n.nspname = 'public' AND p.proname = 'dashboard_bucket_preview'
    ), 'dashboard_bucket_preview function missing';

    SELECT
        bool_or(grantee = 'authenticated' AND privilege_type = 'EXECUTE'),
        bool_or(grantee = 'PUBLIC' AND privilege_type = 'EXECUTE'),
        bool_or(grantee = 'anon' AND privilege_type = 'EXECUTE')
      INTO v_has_authenticated, v_has_public, v_has_anon
      FROM information_schema.role_routine_grants
     WHERE specific_schema = 'public'
       AND routine_name = 'dashboard_bucket_preview';

    ASSERT COALESCE(v_has_authenticated, false), 'authenticated missing EXECUTE on dashboard_bucket_preview';
    ASSERT NOT COALESCE(v_has_public, false),    'PUBLIC must not have EXECUTE on dashboard_bucket_preview';
    ASSERT NOT COALESCE(v_has_anon, false),      'anon must not have EXECUTE on dashboard_bucket_preview';

    -- Smoke: function runs without raising. Returns success=false / no_tenant
    -- because the migration session has no JWT, that's expected and OK.
    v_smoke := public.dashboard_bucket_preview('pipeline');
    ASSERT v_smoke ? 'success', 'smoke return missing success key';

    -- Invalid bucket path returns shaped error.
    v_smoke := public.dashboard_bucket_preview('not_a_bucket');
    ASSERT (v_smoke ->> 'success')::boolean = false
       AND (v_smoke ->> 'error_code') IN ('no_tenant','invalid_bucket'),
        'invalid bucket smoke returned unexpected shape';

    RAISE NOTICE 'dashboard_bucket_preview RPC verification passed.';
END $$;

COMMIT;
