-- Phase 10A.1: activity_events table + AFTER triggers across 5 source tables
-- + 5 read RPCs (3 leaderboards, commission trend, recent activity feed).
--
-- DRAFT — NOT YET APPLIED. Sent to user for review per phase-gate protocol.
--
-- Architecture:
-- ============================================================================
-- activity_events is the cross-cutting feed that captures everything. AFTER
-- INSERT/UPDATE triggers on source tables write one event row each. Every
-- realtime-subscribing UI surface (Recent Activity feed, future Scoreboard
-- recent column, etc.) reads from this single source of truth.
--
-- Realtime cascade build rule (locked starting in 10A.1):
-- Every aggregate UI surface declares its realtime dependencies in its page
-- header comment so future maintainers know what cascades through. Activity
-- events provides the union "something happened" signal; per-table channels
-- still drive specific page invalidation where high-fidelity matters.

-- ============================================================================
-- activity_events table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.activity_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    event_type      text NOT NULL CHECK (event_type IN (
                      'policy_created', 'policy_status_changed',
                      'agent_invited', 'agent_position_changed',
                      'master_grid_edited'
                    )),
    event_at        timestamptz NOT NULL DEFAULT now(),
    actor_user_id   uuid REFERENCES public.agents(id),
    subject_user_id uuid REFERENCES public.agents(id),
    summary         text NOT NULL,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_events_tenant_at_idx
  ON public.activity_events (tenant_id, event_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_subject_at_idx
  ON public.activity_events (subject_user_id, event_at DESC);

-- RLS: SELECT scoped by tenant_id. No INSERT/UPDATE/DELETE policy =
-- triggers (SECURITY DEFINER) bypass RLS for writes.
CREATE POLICY activity_events_select ON public.activity_events
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_events;

-- ============================================================================
-- Trigger functions — one per event type, all SECURITY DEFINER
-- ============================================================================

-- 1. AFTER INSERT on policies → policy_created
CREATE OR REPLACE FUNCTION public.activity_log_policy_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_agent_name text; v_client text;
BEGIN
  SELECT COALESCE(NULLIF(trim(concat_ws(' ', first_name, last_name)), ''), email)
    INTO v_agent_name FROM public.agents WHERE id = NEW.agent_id;
  v_client := NULLIF(trim(concat_ws(' ', NEW.client_first_name, NEW.client_last_name)), '');
  INSERT INTO public.activity_events (
    tenant_id, event_type, actor_user_id, subject_user_id, summary, metadata
  ) VALUES (
    NEW.tenant_id, 'policy_created', NEW.agent_id, NEW.agent_id,
    format('%s wrote a %s policy%s%s',
      COALESCE(v_agent_name, 'Unassigned'),
      NEW.status,
      CASE WHEN v_client IS NOT NULL THEN ' for ' || v_client ELSE '' END,
      CASE WHEN NEW.annual_premium IS NOT NULL THEN
        format(' ($%s)', to_char(NEW.annual_premium, 'FM999,999,990')) ELSE '' END),
    jsonb_build_object('policy_id', NEW.id, 'policy_number', NEW.policy_number,
                       'status', NEW.status, 'annual_premium', NEW.annual_premium)
  );
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS activity_policy_created_trg ON public.policies;
CREATE TRIGGER activity_policy_created_trg
  AFTER INSERT ON public.policies
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_policy_created();

-- 2. AFTER UPDATE OF status on policies → policy_status_changed
CREATE OR REPLACE FUNCTION public.activity_log_policy_status_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_agent_name text; v_client text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  SELECT COALESCE(NULLIF(trim(concat_ws(' ', first_name, last_name)), ''), email)
    INTO v_agent_name FROM public.agents WHERE id = NEW.agent_id;
  v_client := NULLIF(trim(concat_ws(' ', NEW.client_first_name, NEW.client_last_name)), '');
  INSERT INTO public.activity_events (
    tenant_id, event_type, actor_user_id, subject_user_id, summary, metadata
  ) VALUES (
    NEW.tenant_id, 'policy_status_changed', NEW.agent_id, NEW.agent_id,
    format('%s policy %s -> %s%s',
      COALESCE(v_agent_name, 'Unassigned'),
      OLD.status, NEW.status,
      CASE WHEN v_client IS NOT NULL THEN ' (' || v_client || ')' ELSE '' END),
    jsonb_build_object('policy_id', NEW.id, 'policy_number', NEW.policy_number,
                       'from_status', OLD.status, 'to_status', NEW.status)
  );
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS activity_policy_status_changed_trg ON public.policies;
CREATE TRIGGER activity_policy_status_changed_trg
  AFTER UPDATE OF status ON public.policies
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_policy_status_changed();

-- 3. AFTER INSERT on agents (non-owner) → agent_invited
CREATE OR REPLACE FUNCTION public.activity_log_agent_invited()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_inviter_name text; v_invitee_name text;
BEGIN
  IF NEW.is_owner THEN RETURN NEW; END IF;  -- skip the signup-creates-owner case
  v_invitee_name := COALESCE(NULLIF(trim(concat_ws(' ', NEW.first_name, NEW.last_name)), ''), NEW.email);
  IF NEW.upline_agent_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(trim(concat_ws(' ', first_name, last_name)), ''), email)
      INTO v_inviter_name FROM public.agents WHERE id = NEW.upline_agent_id;
  END IF;
  INSERT INTO public.activity_events (
    tenant_id, event_type, actor_user_id, subject_user_id, summary, metadata
  ) VALUES (
    NEW.tenant_id, 'agent_invited', NEW.upline_agent_id, NEW.id,
    format('%s invited %s', COALESCE(v_inviter_name, 'Owner'), v_invitee_name),
    jsonb_build_object('invitee_id', NEW.id, 'invitee_email', NEW.email,
                       'inviter_id', NEW.upline_agent_id)
  );
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS activity_agent_invited_trg ON public.agents;
CREATE TRIGGER activity_agent_invited_trg
  AFTER INSERT ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_agent_invited();

-- 4. AFTER INSERT on agent_positions (= position change) → agent_position_changed
CREATE OR REPLACE FUNCTION public.activity_log_agent_position_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_agent_name text; v_new_pos text; v_old_pos text;
BEGIN
  SELECT COALESCE(NULLIF(trim(concat_ws(' ', first_name, last_name)), ''), email)
    INTO v_agent_name FROM public.agents WHERE id = NEW.agent_id;
  SELECT format('%s %s', position_code, position_name) INTO v_new_pos
    FROM public.comp_grid_positions WHERE id = NEW.position_id;
  -- Look up the prior position (the one just closed by assign_agent_to_position)
  SELECT format('%s %s', cgp.position_code, cgp.position_name) INTO v_old_pos
    FROM public.agent_positions ap
    JOIN public.comp_grid_positions cgp ON cgp.id = ap.position_id
   WHERE ap.agent_id = NEW.agent_id
     AND ap.id <> NEW.id
     AND ap.end_date = NEW.start_date - 1
   ORDER BY ap.end_date DESC LIMIT 1;
  INSERT INTO public.activity_events (
    tenant_id, event_type, actor_user_id, subject_user_id, summary, metadata
  ) VALUES (
    NEW.tenant_id, 'agent_position_changed', NEW.assigned_by, NEW.agent_id,
    CASE WHEN v_old_pos IS NULL THEN format('%s placed at %s', v_agent_name, v_new_pos)
         ELSE format('%s moved from %s to %s', v_agent_name, v_old_pos, v_new_pos) END,
    jsonb_build_object('agent_id', NEW.agent_id, 'new_position_id', NEW.position_id,
                       'start_date', NEW.start_date)
  );
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS activity_agent_position_changed_trg ON public.agent_positions;
CREATE TRIGGER activity_agent_position_changed_trg
  AFTER INSERT ON public.agent_positions
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_agent_position_changed();

-- 5. AFTER INSERT on comp_grid_rates → master_grid_edited
CREATE OR REPLACE FUNCTION public.activity_log_master_grid_edited()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_pos text; v_carrier text; v_product text; v_actor uuid;
BEGIN
  SELECT format('%s %s', position_code, position_name) INTO v_pos
    FROM public.comp_grid_positions WHERE id = NEW.position_id;
  SELECT cgc.carrier_name, cgp.product_name INTO v_carrier, v_product
    FROM public.comp_grid_products cgp
    JOIN public.comp_grid_carriers cgc ON cgc.id = cgp.carrier_id
   WHERE cgp.id = NEW.product_id;
  v_actor := NEW.created_by;
  INSERT INTO public.activity_events (
    tenant_id, event_type, actor_user_id, subject_user_id, summary, metadata
  ) VALUES (
    NEW.tenant_id, 'master_grid_edited', v_actor, NULL,
    format('Master grid: %s · %s @ %s set to %s%%',
      COALESCE(v_carrier, '?'), COALESCE(v_product, '?'),
      COALESCE(v_pos, '?'), to_char(NEW.commission_pct, 'FM990.99')),
    jsonb_build_object('position_id', NEW.position_id, 'product_id', NEW.product_id,
                       'rate', NEW.commission_pct, 'effective_date', NEW.effective_date)
  );
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS activity_master_grid_edited_trg ON public.comp_grid_rates;
CREATE TRIGGER activity_master_grid_edited_trg
  AFTER INSERT ON public.comp_grid_rates
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_master_grid_edited();

-- Trigger functions don't need PostgREST exposure. Triggers fire via the
-- trigger mechanism regardless of EXECUTE grants; the advisor flags them
-- otherwise as anon-callable SECURITY DEFINER endpoints.
REVOKE ALL ON FUNCTION public.activity_log_policy_created() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activity_log_policy_status_changed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activity_log_agent_invited() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activity_log_agent_position_changed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activity_log_master_grid_edited() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- Read RPCs (5)
-- ============================================================================
-- All authenticated, all view-down filtered, all return jsonb arrays.
-- Phase 6.5 build rule: read RPCs verify tenant_id = current_tenant_id() at the
-- top, no is_owner check (read-only paths are allowed for non-owners' subtree).

-- Helper: build the visible_agent_ids array for the caller.
-- Returns NULL for owners (signaling "no filter") to keep RPCs branch-light.
CREATE OR REPLACE FUNCTION public.visible_agent_ids() RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_caller uuid; v_is_owner boolean;
BEGIN
  v_caller := auth.uid();
  v_is_owner := public.is_owner();
  IF v_is_owner THEN RETURN NULL; END IF;
  RETURN ARRAY[v_caller] || COALESCE(
    (SELECT array_agg(agent_id) FROM public.descendants_of(v_caller)),
    ARRAY[]::uuid[]
  );
END; $$;
REVOKE ALL ON FUNCTION public.visible_agent_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visible_agent_ids() TO authenticated;

-- 1. leaderboard_top_producers
CREATE OR REPLACE FUNCTION public.leaderboard_top_producers(
  p_start_date date, p_end_date date, p_carrier_id uuid DEFAULT NULL, p_limit int DEFAULT 10
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid; v_visible uuid[]; v_result jsonb;
BEGIN
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant'); END IF;
  v_visible := public.visible_agent_ids();
  WITH scoped AS (
    SELECT p.agent_id, p.status, p.annual_premium
      FROM public.policies p
     WHERE p.tenant_id = v_tenant_id
       AND p.application_date BETWEEN p_start_date AND p_end_date
       AND p.agent_id IS NOT NULL
       AND (v_visible IS NULL OR p.agent_id = ANY(v_visible))
       AND (p_carrier_id IS NULL OR EXISTS (
            SELECT 1 FROM public.comp_grid_products cgp
             WHERE cgp.id = p.product_id AND cgp.carrier_id = p_carrier_id))
  ), agg AS (
    SELECT s.agent_id,
           COALESCE(SUM(annual_premium) FILTER (WHERE status = 'Issued'), 0) AS booked,
           COALESCE(SUM(annual_premium) FILTER (WHERE status = 'Issue Paid'), 0) AS realized,
           COALESCE(SUM(annual_premium) FILTER (WHERE status IN ('Issued','Issue Paid')), 0) AS total
      FROM scoped s GROUP BY s.agent_id
  )
  SELECT jsonb_agg(row_to_json(t)) INTO v_result FROM (
    SELECT
      ROW_NUMBER() OVER (ORDER BY a.total DESC) AS rank,
      a.agent_id,
      COALESCE(NULLIF(trim(concat_ws(' ', ag.first_name, ag.last_name)), ''), ag.email) AS agent_name,
      cgp.position_code, cgp.position_name,
      a.booked, a.realized, a.total
    FROM agg a
    JOIN public.agents ag ON ag.id = a.agent_id
    LEFT JOIN public.agent_positions ap ON ap.agent_id = a.agent_id AND ap.end_date IS NULL
    LEFT JOIN public.comp_grid_positions cgp ON cgp.id = ap.position_id
    ORDER BY a.total DESC
    LIMIT p_limit
  ) t;
  RETURN jsonb_build_object('success', true, 'is_owner_view', v_visible IS NULL,
                            'rows', COALESCE(v_result, '[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.leaderboard_top_producers(date,date,uuid,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leaderboard_top_producers(date,date,uuid,int) TO authenticated;

-- 2. leaderboard_top_recruiters
-- Counts new direct downlines (agents.upline_agent_id = recruiter) with
-- agents.created_at in window. Owner sees full tenant; non-owner sees only
-- agents whose upline (the recruiter) is in their visible set.
CREATE OR REPLACE FUNCTION public.leaderboard_top_recruiters(
  p_start_date date, p_end_date date, p_limit int DEFAULT 10
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid; v_visible uuid[]; v_result jsonb;
BEGIN
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant'); END IF;
  v_visible := public.visible_agent_ids();
  WITH scoped AS (
    SELECT a.upline_agent_id AS recruiter_id, COUNT(*) AS recruits
      FROM public.agents a
     WHERE a.tenant_id = v_tenant_id
       AND a.is_owner = false
       AND a.upline_agent_id IS NOT NULL
       AND a.created_at::date BETWEEN p_start_date AND p_end_date
       AND (v_visible IS NULL OR a.upline_agent_id = ANY(v_visible))
     GROUP BY a.upline_agent_id
  )
  SELECT jsonb_agg(row_to_json(t)) INTO v_result FROM (
    SELECT
      ROW_NUMBER() OVER (ORDER BY s.recruits DESC) AS rank,
      s.recruiter_id AS agent_id,
      COALESCE(NULLIF(trim(concat_ws(' ', ag.first_name, ag.last_name)), ''), ag.email) AS agent_name,
      cgp.position_code, cgp.position_name, s.recruits
    FROM scoped s
    JOIN public.agents ag ON ag.id = s.recruiter_id
    LEFT JOIN public.agent_positions ap ON ap.agent_id = s.recruiter_id AND ap.end_date IS NULL
    LEFT JOIN public.comp_grid_positions cgp ON cgp.id = ap.position_id
    ORDER BY s.recruits DESC LIMIT p_limit
  ) t;
  RETURN jsonb_build_object('success', true, 'is_owner_view', v_visible IS NULL,
                            'rows', COALESCE(v_result, '[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.leaderboard_top_recruiters(date,date,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leaderboard_top_recruiters(date,date,int) TO authenticated;

-- 3. leaderboard_most_improved
-- Compares booked premium in [p_start_date, p_end_date] vs the equivalent
-- prior period of the same length. Negative growth excluded. View-down filtered.
CREATE OR REPLACE FUNCTION public.leaderboard_most_improved(
  p_start_date date, p_end_date date, p_carrier_id uuid DEFAULT NULL, p_limit int DEFAULT 10
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid; v_visible uuid[]; v_result jsonb;
  v_window_days int; v_prior_start date; v_prior_end date;
BEGIN
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant'); END IF;
  v_visible := public.visible_agent_ids();
  v_window_days := (p_end_date - p_start_date) + 1;
  v_prior_end   := p_start_date - 1;
  v_prior_start := v_prior_end - (v_window_days - 1);
  WITH curr AS (
    SELECT p.agent_id, COALESCE(SUM(annual_premium) FILTER (WHERE status IN ('Issued','Issue Paid')), 0) AS booked
      FROM public.policies p
     WHERE p.tenant_id = v_tenant_id
       AND p.application_date BETWEEN p_start_date AND p_end_date
       AND p.agent_id IS NOT NULL
       AND (v_visible IS NULL OR p.agent_id = ANY(v_visible))
       AND (p_carrier_id IS NULL OR EXISTS (
            SELECT 1 FROM public.comp_grid_products cgp WHERE cgp.id = p.product_id AND cgp.carrier_id = p_carrier_id))
     GROUP BY p.agent_id
  ), prev AS (
    SELECT p.agent_id, COALESCE(SUM(annual_premium) FILTER (WHERE status IN ('Issued','Issue Paid')), 0) AS booked
      FROM public.policies p
     WHERE p.tenant_id = v_tenant_id
       AND p.application_date BETWEEN v_prior_start AND v_prior_end
       AND p.agent_id IS NOT NULL
       AND (v_visible IS NULL OR p.agent_id = ANY(v_visible))
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
    SELECT
      ROW_NUMBER() OVER (ORDER BY pct_growth DESC NULLS LAST, curr_booked DESC) AS rank,
      j.agent_id,
      COALESCE(NULLIF(trim(concat_ws(' ', ag.first_name, ag.last_name)), ''), ag.email) AS agent_name,
      cgp.position_code, cgp.position_name,
      j.curr_booked, j.prev_booked, j.pct_growth
    FROM joined j
    JOIN public.agents ag ON ag.id = j.agent_id
    LEFT JOIN public.agent_positions ap ON ap.agent_id = j.agent_id AND ap.end_date IS NULL
    LEFT JOIN public.comp_grid_positions cgp ON cgp.id = ap.position_id
    ORDER BY pct_growth DESC NULLS LAST, curr_booked DESC LIMIT p_limit
  ) t;
  RETURN jsonb_build_object('success', true, 'is_owner_view', v_visible IS NULL,
                            'prior_window', jsonb_build_object('start', v_prior_start, 'end', v_prior_end),
                            'rows', COALESCE(v_result, '[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.leaderboard_most_improved(date,date,uuid,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leaderboard_most_improved(date,date,uuid,int) TO authenticated;

-- 4. commission_trend_series — monthly buckets
CREATE OR REPLACE FUNCTION public.commission_trend_series(
  p_start_date date, p_end_date date, p_carrier_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid; v_visible uuid[]; v_result jsonb;
BEGIN
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant'); END IF;
  v_visible := public.visible_agent_ids();
  WITH months AS (
    SELECT generate_series(date_trunc('month', p_start_date), date_trunc('month', p_end_date), '1 month'::interval)::date AS month_start
  ), buckets AS (
    SELECT m.month_start,
           COALESCE(SUM(pc.amount) FILTER (WHERE p.status = 'Issued'), 0) AS booked,
           COALESCE(SUM(pc.amount) FILTER (WHERE p.status = 'Issue Paid'), 0) AS realized
      FROM months m
      LEFT JOIN public.policy_commissions pc
        ON pc.tenant_id = v_tenant_id
       AND date_trunc('month', pc.application_date) = m.month_start
       AND (v_visible IS NULL OR pc.agent_id = ANY(v_visible))
      LEFT JOIN public.policies p ON p.id = pc.policy_id
       AND (p_carrier_id IS NULL OR EXISTS (
            SELECT 1 FROM public.comp_grid_products cgp WHERE cgp.id = p.product_id AND cgp.carrier_id = p_carrier_id))
     GROUP BY m.month_start
     ORDER BY m.month_start
  )
  SELECT jsonb_agg(jsonb_build_object('month', to_char(month_start, 'YYYY-MM'),
                                      'booked', booked, 'realized', realized))
    INTO v_result FROM buckets;
  RETURN jsonb_build_object('success', true, 'is_owner_view', v_visible IS NULL,
                            'series', COALESCE(v_result, '[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.commission_trend_series(date,date,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commission_trend_series(date,date,uuid) TO authenticated;

-- 5. recent_activity_feed
-- Reads activity_events filtered to tenant + view-down. Master grid edits
-- have NULL subject_user_id; non-owners never see them via the view-down
-- filter (subject_user_id NULL excluded from = ANY check).
--
-- Pagination cursor: (event_at, id) tuple, NOT single-column id. Multiple
-- triggers can fire in the same transaction with identical event_at; tuple
-- comparison `(event_at, id) < (cursor_event_at, cursor_id)` is the only way
-- to deterministically advance past same-timestamp rows.
CREATE OR REPLACE FUNCTION public.recent_activity_feed(
  p_limit int DEFAULT 20, p_after_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid; v_visible uuid[]; v_result jsonb;
  v_after_at timestamptz; v_after_id uuid;
BEGIN
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant'); END IF;
  v_visible := public.visible_agent_ids();
  IF p_after_id IS NOT NULL THEN
    SELECT event_at, id INTO v_after_at, v_after_id
      FROM public.activity_events WHERE id = p_after_id;
  END IF;
  SELECT jsonb_agg(row_to_json(t)) INTO v_result FROM (
    SELECT id, event_type, event_at, actor_user_id, subject_user_id, summary, metadata
      FROM public.activity_events
     WHERE tenant_id = v_tenant_id
       AND (v_visible IS NULL OR subject_user_id = ANY(v_visible))
       AND (v_after_at IS NULL OR (event_at, id) < (v_after_at, v_after_id))
     ORDER BY event_at DESC, id DESC
     LIMIT p_limit
  ) t;
  RETURN jsonb_build_object('success', true, 'is_owner_view', v_visible IS NULL,
                            'rows', COALESCE(v_result, '[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.recent_activity_feed(int,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recent_activity_feed(int,uuid) TO authenticated;
