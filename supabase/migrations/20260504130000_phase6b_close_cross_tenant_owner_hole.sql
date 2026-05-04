-- Phase 6b hotfix #3 (CRITICAL): close cross-tenant owner hole.
--
-- can_view_agent (Phase 1) returns true if is_owner() returns true, regardless
-- of which tenant the caller belongs to. SECURITY DEFINER RPCs bypass RLS, so
-- any owner could write to any other tenant's agent rates via the Phase 6b
-- RPCs. Discovered during Phase 6b smoke when Ophelia (owner of phase-5-smoke)
-- successfully wrote an override to a JRM-tenant agent.
--
-- Fix: every Phase 6b RPC and assign_agent_to_position now compares
-- current_tenant_id() to the target agent's tenant_id and rejects mismatches.
-- This is defense-in-depth at the function layer; can_view_agent itself is
-- left alone (broader Phase 1 helper, used elsewhere) and a separate audit is
-- needed to fix that root cause across all callers.

CREATE OR REPLACE FUNCTION public.set_agent_carrier_rate_override(
  p_agent_id      uuid,
  p_product_id    uuid,
  p_rate          numeric,
  p_schedule_code text DEFAULT NULL,
  p_set_by_user   uuid DEFAULT auth.uid(),
  p_effective     date DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_tenant uuid;
  v_target_tenant uuid;
  v_existing_id   uuid;
  v_existing_sd   date;
  v_new_id        uuid;
BEGIN
  IF NOT public.is_owner() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  v_caller_tenant := public.current_tenant_id();
  SELECT tenant_id INTO v_target_tenant FROM public.agents WHERE id = p_agent_id;
  IF v_target_tenant IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'agent_not_found');
  END IF;
  IF v_caller_tenant IS NULL OR v_caller_tenant <> v_target_tenant THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.comp_grid_products
    WHERE id = p_product_id AND tenant_id = v_target_tenant
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'product_not_in_tenant');
  END IF;
  IF p_rate < 0 OR p_rate > 200 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'rate_out_of_range');
  END IF;

  SELECT id, start_date INTO v_existing_id, v_existing_sd
    FROM public.agent_carrier_rates
   WHERE agent_id = p_agent_id AND product_id = p_product_id AND end_date IS NULL
   ORDER BY start_date DESC LIMIT 1;

  IF v_existing_id IS NOT NULL AND v_existing_sd = p_effective THEN
    UPDATE public.agent_carrier_rates
       SET rate = p_rate, source = 'override', schedule_code = p_schedule_code,
           set_by_user_id = p_set_by_user, updated_at = now()
     WHERE id = v_existing_id;
    RETURN jsonb_build_object('success', true, 'rate_id', v_existing_id, 'mode', 'updated_in_place');
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.agent_carrier_rates
       SET end_date = p_effective - INTERVAL '1 day', updated_at = now()
     WHERE id = v_existing_id;
  END IF;

  INSERT INTO public.agent_carrier_rates
    (tenant_id, agent_id, product_id, rate, source, schedule_code,
     start_date, end_date, set_by_user_id)
  VALUES
    (v_target_tenant, p_agent_id, p_product_id, p_rate, 'override', p_schedule_code,
     p_effective, NULL, p_set_by_user)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('success', true, 'rate_id', v_new_id, 'mode', 'closed_and_inserted');
END;
$$;
REVOKE ALL ON FUNCTION public.set_agent_carrier_rate_override(uuid,uuid,numeric,text,uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agent_carrier_rate_override(uuid,uuid,numeric,text,uuid,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.reset_agent_carrier_rate_to_default(
  p_agent_id   uuid,
  p_product_id uuid,
  p_effective  date DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_tenant uuid;
  v_target_tenant uuid;
  v_position_id   uuid;
  v_default_rate  numeric;
  v_default_sched text;
  v_existing_id   uuid;
  v_existing_sd   date;
  v_new_id        uuid;
BEGIN
  IF NOT public.is_owner() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  v_caller_tenant := public.current_tenant_id();
  SELECT tenant_id INTO v_target_tenant FROM public.agents WHERE id = p_agent_id;
  IF v_target_tenant IS NULL OR v_caller_tenant IS NULL OR v_caller_tenant <> v_target_tenant THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  SELECT position_id INTO v_position_id
    FROM public.agent_positions
   WHERE agent_id = p_agent_id AND end_date IS NULL
   ORDER BY start_date DESC LIMIT 1;
  IF v_position_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'agent_unassigned');
  END IF;

  SELECT commission_pct, schedule_code INTO v_default_rate, v_default_sched
    FROM public.comp_grid_rates
   WHERE tenant_id = v_target_tenant AND position_id = v_position_id
     AND product_id = p_product_id AND end_date IS NULL
   ORDER BY effective_date DESC LIMIT 1;
  IF v_default_rate IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'no_master_rate');
  END IF;

  SELECT id, start_date INTO v_existing_id, v_existing_sd
    FROM public.agent_carrier_rates
   WHERE agent_id = p_agent_id AND product_id = p_product_id AND end_date IS NULL
   ORDER BY start_date DESC LIMIT 1;

  IF v_existing_id IS NOT NULL AND v_existing_sd = p_effective THEN
    UPDATE public.agent_carrier_rates
       SET rate = v_default_rate, source = 'position_default', schedule_code = v_default_sched,
           templated_from_position_id = v_position_id, templated_at = now(),
           set_by_user_id = auth.uid(), updated_at = now()
     WHERE id = v_existing_id;
    RETURN jsonb_build_object('success', true, 'rate_id', v_existing_id, 'reset_to', v_default_rate, 'mode', 'updated_in_place');
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.agent_carrier_rates
       SET end_date = p_effective - INTERVAL '1 day', updated_at = now()
     WHERE id = v_existing_id;
  END IF;

  INSERT INTO public.agent_carrier_rates
    (tenant_id, agent_id, product_id, rate, source, schedule_code,
     start_date, end_date, templated_from_position_id, templated_at, set_by_user_id)
  VALUES
    (v_target_tenant, p_agent_id, p_product_id, v_default_rate, 'position_default', v_default_sched,
     p_effective, NULL, v_position_id, now(), auth.uid())
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('success', true, 'rate_id', v_new_id, 'reset_to', v_default_rate, 'mode', 'closed_and_inserted');
END;
$$;
REVOKE ALL ON FUNCTION public.reset_agent_carrier_rate_to_default(uuid,uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_agent_carrier_rate_to_default(uuid,uuid,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.position_template_blast_radius(
  p_agent_id    uuid,
  p_position_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_tenant  uuid;
  v_target_tenant  uuid;
  v_life_count     int;
  v_annuity_count  int;
  v_override_count int;
BEGIN
  v_caller_tenant := public.current_tenant_id();
  SELECT tenant_id INTO v_target_tenant FROM public.agents WHERE id = p_agent_id;
  IF v_target_tenant IS NULL OR v_caller_tenant IS NULL OR v_caller_tenant <> v_target_tenant THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF NOT public.can_view_agent(p_agent_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.comp_grid_positions
    WHERE id = p_position_id AND tenant_id = v_target_tenant
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'position_not_in_tenant');
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE p.product_type = 'life'),
    COUNT(*) FILTER (WHERE p.product_type = 'annuity')
  INTO v_life_count, v_annuity_count
  FROM public.comp_grid_rates r
  JOIN public.comp_grid_products p ON p.id = r.product_id
  WHERE r.tenant_id = v_target_tenant AND r.position_id = p_position_id AND r.end_date IS NULL;

  SELECT COUNT(*) INTO v_override_count
  FROM public.agent_carrier_rates
  WHERE agent_id = p_agent_id AND source = 'override' AND end_date IS NULL;

  RETURN jsonb_build_object(
    'success', true,
    'life_rates_to_template',    v_life_count,
    'annuity_rates_to_template', v_annuity_count,
    'existing_override_count',   v_override_count
  );
END;
$$;
REVOKE ALL ON FUNCTION public.position_template_blast_radius(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.position_template_blast_radius(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_agent_to_position(
  p_agent_id uuid,
  p_position_id uuid,
  p_start_date date,
  p_assigned_by uuid DEFAULT NULL::uuid,
  p_overrides_action text DEFAULT 'keep'::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
    v_caller_tenant      UUID;
    v_tenant_id          UUID;
    v_prior_position_id  UUID;
    v_prior_start_date   DATE;
    v_overrides_cleared  INT := 0;
    v_template_result    JSONB;
    v_override_list      JSONB := '[]'::jsonb;
BEGIN
    IF NOT public.is_owner() THEN
        RAISE EXCEPTION 'forbidden: only the tenant owner can assign positions'
            USING ERRCODE = '42501';
    END IF;

    v_caller_tenant := public.current_tenant_id();
    SELECT tenant_id INTO v_tenant_id FROM public.agents WHERE id = p_agent_id;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'agent % does not exist', p_agent_id;
    END IF;
    IF v_caller_tenant IS NULL OR v_caller_tenant <> v_tenant_id THEN
        RAISE EXCEPTION 'forbidden: cross-tenant assignment' USING ERRCODE = '42501';
    END IF;

    IF p_overrides_action NOT IN ('keep', 'clear', 'review') THEN
        RAISE EXCEPTION 'p_overrides_action must be one of: keep, clear, review (got %)',
            p_overrides_action;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.comp_grid_positions
        WHERE id = p_position_id AND tenant_id = v_tenant_id
    ) THEN
        RAISE EXCEPTION 'position % not in agent tenant', p_position_id;
    END IF;

    SELECT position_id, start_date INTO v_prior_position_id, v_prior_start_date
    FROM public.agent_positions
    WHERE agent_id = p_agent_id AND end_date IS NULL;

    IF v_prior_position_id = p_position_id THEN
        RETURN jsonb_build_object('noop_same_position', true, 'overrides', '[]'::jsonb);
    END IF;

    IF v_prior_start_date IS NOT NULL AND v_prior_start_date >= p_start_date THEN
        RAISE EXCEPTION
            'cannot assign with start_date % when prior assignment started on % (must be later)',
            p_start_date, v_prior_start_date;
    END IF;

    IF p_overrides_action = 'review' THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'agent_carrier_rate_id', acr.id,
            'product_id', acr.product_id,
            'product_name', cgp.product_name,
            'product_variant', cgp.product_variant,
            'current_rate', acr.rate,
            'position_default_rate', cgr.commission_pct
        )), '[]'::jsonb)
        INTO v_override_list
        FROM public.agent_carrier_rates acr
        JOIN public.comp_grid_products cgp ON cgp.id = acr.product_id
        LEFT JOIN public.comp_grid_rates cgr
          ON cgr.position_id = p_position_id
         AND cgr.product_id = acr.product_id AND cgr.end_date IS NULL
        WHERE acr.agent_id = p_agent_id AND acr.tenant_id = v_tenant_id
          AND acr.source = 'override' AND acr.end_date IS NULL;
    END IF;

    IF p_overrides_action = 'clear' THEN
        WITH cleared AS (
            UPDATE public.agent_carrier_rates
               SET end_date = (p_start_date - 1), updated_at = now()
             WHERE agent_id = p_agent_id AND tenant_id = v_tenant_id
               AND source = 'override' AND end_date IS NULL
            RETURNING 1
        )
        SELECT COUNT(*) INTO v_overrides_cleared FROM cleared;
    END IF;

    IF v_prior_position_id IS NOT NULL THEN
        UPDATE public.agent_positions SET end_date = (p_start_date - 1)
         WHERE agent_id = p_agent_id AND end_date IS NULL;
    END IF;

    INSERT INTO public.agent_positions (tenant_id, agent_id, position_id, start_date, assigned_by)
    VALUES (v_tenant_id, p_agent_id, p_position_id, p_start_date, p_assigned_by);

    v_template_result := public.template_agent_from_position(
        p_agent_id, p_position_id, p_assigned_by, p_start_date
    );

    RETURN jsonb_build_object(
        'noop_same_position', false,
        'prior_position_id', v_prior_position_id,
        'new_position_id', p_position_id,
        'start_date', p_start_date,
        'overrides_action', p_overrides_action,
        'overrides_cleared', v_overrides_cleared,
        'template_result', v_template_result,
        'overrides', v_override_list
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.assign_agent_to_position(uuid,uuid,date,uuid,text) TO authenticated;
