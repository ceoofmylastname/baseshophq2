-- Phase 10A: operator Dashboard schema.
--
-- Three new tables (tenant_setup_state, ingest_runs, announcements), one new
-- column (tenants.annual_goal_amount), and four new RPCs:
--   - log_ingest_run             service-role only (called by ingest-commit edge fn)
--   - mark_setup_step_complete   authenticated, owner-only
--   - post_announcement          authenticated, owner-only
--   - delete_announcement        authenticated, owner-only
--   - dashboard_metrics          authenticated, tenant-scoped, view-down filtered
--
-- All new tables added to supabase_realtime publication.
-- All new mutating RPCs follow the Phase 6.5 build rule:
--   is_owner() check + explicit current_tenant_id() = target tenant_id check.

-- ============================================================================
-- Schema additions
-- ============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS annual_goal_amount numeric(14,2) NOT NULL DEFAULT 1000000;

CREATE TABLE IF NOT EXISTS public.tenant_setup_state (
    tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    step_key     text NOT NULL,
    completed_at timestamptz NOT NULL DEFAULT now(),
    completed_by uuid REFERENCES public.agents(id),
    PRIMARY KEY (tenant_id, step_key)
);

CREATE TABLE IF NOT EXISTS public.ingest_runs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    started_at          timestamptz NOT NULL DEFAULT now(),
    completed_at        timestamptz,
    rows_total          int NOT NULL DEFAULT 0,
    rows_assigned       int NOT NULL DEFAULT 0,
    rows_orphan         int NOT NULL DEFAULT 0,
    rows_skipped        int NOT NULL DEFAULT 0,
    started_by_user_id  uuid REFERENCES public.agents(id),
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ingest_runs_tenant_started_idx
  ON public.ingest_runs (tenant_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.announcements (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    posted_by_user_id   uuid NOT NULL REFERENCES public.agents(id),
    title               text NOT NULL,
    body                text NOT NULL,
    pinned              boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    deleted_at          timestamptz
);
CREATE INDEX IF NOT EXISTS announcements_tenant_active_idx
  ON public.announcements (tenant_id, pinned DESC, created_at DESC)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- RLS (rls_auto_enable trigger turns it on for new tables; policies below)
-- ============================================================================

-- tenant_setup_state
CREATE POLICY tenant_setup_state_select ON public.tenant_setup_state
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_setup_state_insert_owner ON public.tenant_setup_state
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());
CREATE POLICY tenant_setup_state_update_owner ON public.tenant_setup_state
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());
CREATE POLICY tenant_setup_state_delete_owner ON public.tenant_setup_state
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner());

-- ingest_runs (read by tenant; insert is service-role only — no policy needed
-- because RLS denies non-policied operations and service_role bypasses RLS)
CREATE POLICY ingest_runs_select ON public.ingest_runs
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- announcements
CREATE POLICY announcements_select ON public.announcements
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND deleted_at IS NULL);
CREATE POLICY announcements_insert_owner ON public.announcements
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());
CREATE POLICY announcements_update_owner ON public.announcements
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());
CREATE POLICY announcements_delete_owner ON public.announcements
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner());

-- ============================================================================
-- Realtime publication
-- ============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_setup_state;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ingest_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;

-- ============================================================================
-- RPCs
-- ============================================================================

-- log_ingest_run: service-role only, called by ingest-commit edge fn
CREATE OR REPLACE FUNCTION public.log_ingest_run(
    p_tenant_id          uuid,
    p_started_at         timestamptz,
    p_completed_at       timestamptz,
    p_rows_total         int,
    p_rows_assigned      int,
    p_rows_orphan        int,
    p_rows_skipped       int,
    p_started_by_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
    INSERT INTO public.ingest_runs (
        tenant_id, started_at, completed_at, rows_total,
        rows_assigned, rows_orphan, rows_skipped, started_by_user_id
    ) VALUES (
        p_tenant_id, p_started_at, p_completed_at, p_rows_total,
        p_rows_assigned, p_rows_orphan, p_rows_skipped, p_started_by_user_id
    ) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.log_ingest_run(uuid,timestamptz,timestamptz,int,int,int,int,uuid)
  FROM PUBLIC, anon, authenticated;
-- service_role retains EXECUTE by default

-- mark_setup_step_complete: owner-only
CREATE OR REPLACE FUNCTION public.mark_setup_step_complete(p_step_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_tenant_id uuid;
BEGIN
    IF NOT public.is_owner() THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
    END IF;
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;
    INSERT INTO public.tenant_setup_state (tenant_id, step_key, completed_by)
    VALUES (v_tenant_id, p_step_key, auth.uid())
    ON CONFLICT (tenant_id, step_key)
    DO UPDATE SET completed_at = now(), completed_by = auth.uid();
    RETURN jsonb_build_object('success', true, 'step_key', p_step_key);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_setup_step_complete(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_setup_step_complete(text) TO authenticated;

-- post_announcement: owner-only
CREATE OR REPLACE FUNCTION public.post_announcement(
    p_title text, p_body text, p_pinned boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_tenant_id uuid; v_id uuid;
BEGIN
    IF NOT public.is_owner() THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
    END IF;
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;
    IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'title_required');
    END IF;
    INSERT INTO public.announcements (tenant_id, posted_by_user_id, title, body, pinned)
    VALUES (v_tenant_id, auth.uid(), p_title, p_body, COALESCE(p_pinned, false))
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('success', true, 'announcement_id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.post_announcement(text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_announcement(text,text,boolean) TO authenticated;

-- delete_announcement: owner-only, soft-delete
CREATE OR REPLACE FUNCTION public.delete_announcement(p_announcement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_caller_tenant uuid; v_target_tenant uuid;
BEGIN
    IF NOT public.is_owner() THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
    END IF;
    v_caller_tenant := public.current_tenant_id();
    SELECT tenant_id INTO v_target_tenant FROM public.announcements WHERE id = p_announcement_id;
    IF v_target_tenant IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'not_found');
    END IF;
    IF v_caller_tenant IS NULL OR v_caller_tenant <> v_target_tenant THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
    END IF;
    UPDATE public.announcements SET deleted_at = now() WHERE id = p_announcement_id;
    RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_announcement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_announcement(uuid) TO authenticated;

-- dashboard_metrics: tenant-scoped, view-down filtered, single round trip.
--
-- View-down rule: caller sees policies where agent_id IN (self UNION
-- descendants_of(self)). Owner short-circuits to no agent_id filter at all
-- (sees full tenant). The same set of visible_agent_ids gates the policy +
-- policy_commission aggregations and (separately) the team_size headcount.
--
-- Time-window semantics: filtered via policies.application_date and
-- policy_commissions.application_date. Documenting application_date as the
-- canonical "deal date" for ALL Phase 10A metrics.
--   Known limitation: a policy with application_date=2026-04-15 that becomes
--   Issue Paid in May still shows in April's Realized bucket, not May's. If
--   real-use surfaces "the dashboard says $0 realized this month but I got
--   paid $30k this month", a Phase 10A.1 patch can add policies.paid_at and
--   split Realized to use it. Premature now — keeping the canonical-date
--   semantic consistent.
--
-- Carrier filter: policies → comp_grid_products.carrier_id. Orphan-product
-- policies (product_id NULL) only count when p_carrier_id IS NULL.
--
-- team_size semantics: view-down HEADCOUNT — count of agents in scope
-- regardless of activity or time range. Owner sees total non-archived tenant
-- headcount; non-owner sees self + descendants. Static metric that only
-- changes when agents are invited / archived / promoted. The "active writers
-- in last N days" metric is a separate widget per [[active-agent-billing-model]].
--
-- Cascade safety: policy_commissions.policy_id has ON DELETE CASCADE (Phase 4a).
-- Deleting a policy automatically removes its commission rows from these
-- aggregations. Smoke verifies this end-to-end.
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
        COUNT(*)                     FILTER (WHERE status = 'Issued')
      INTO v_pipeline, v_booked_premium, v_realized_premium, v_at_risk,
           v_booked_policies
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
    -- AND the linked policy is in the right status. Carrier filter applies via the
    -- linked policy's product_id.
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
REVOKE ALL ON FUNCTION public.dashboard_metrics(date,date,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_metrics(date,date,uuid) TO authenticated;
