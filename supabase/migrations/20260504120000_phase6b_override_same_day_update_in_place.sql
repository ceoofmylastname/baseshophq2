-- Phase 6b hotfix #2: when an open agent_carrier_rates row already has
-- start_date = p_effective, UPDATE it in place instead of close+insert.
-- Closing today's open row to today-1 violates the
-- agent_carrier_rates_date_order CHECK (end_date >= start_date).
--
-- (Superseded by hotfix #3, which adds the cross-tenant match check.)

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
  v_tenant_id    uuid;
  v_existing_id  uuid;
  v_existing_sd  date;
  v_new_id       uuid;
BEGIN
  IF NOT public.is_owner() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  SELECT tenant_id INTO v_tenant_id FROM public.agents WHERE id = p_agent_id;
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'agent_not_found');
  END IF;
  IF NOT public.can_view_agent(p_agent_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.comp_grid_products
    WHERE id = p_product_id AND tenant_id = v_tenant_id
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
    (v_tenant_id, p_agent_id, p_product_id, p_rate, 'override', p_schedule_code,
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
  v_tenant_id     uuid;
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

  SELECT tenant_id INTO v_tenant_id FROM public.agents WHERE id = p_agent_id;
  IF v_tenant_id IS NULL OR NOT public.can_view_agent(p_agent_id) THEN
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
   WHERE tenant_id = v_tenant_id AND position_id = v_position_id
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
    (v_tenant_id, p_agent_id, p_product_id, v_default_rate, 'position_default', v_default_sched,
     p_effective, NULL, v_position_id, now(), auth.uid())
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('success', true, 'rate_id', v_new_id, 'reset_to', v_default_rate, 'mode', 'closed_and_inserted');
END;
$$;
REVOKE ALL ON FUNCTION public.reset_agent_carrier_rate_to_default(uuid,uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_agent_carrier_rate_to_default(uuid,uuid,date) TO authenticated;
