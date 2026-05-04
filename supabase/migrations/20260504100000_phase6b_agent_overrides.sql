-- Phase 6b: agent profile + override editing
--
-- Three RPCs and one helper view layered on top of the existing Phase 3a
-- templating (template_agent_from_position, assign_agent_to_position).
--
--   set_agent_carrier_rate_override     write  (owner-only)  close-prior + insert override
--   reset_agent_carrier_rate_to_default write  (owner-only)  close current + re-template one cell
--   position_template_blast_radius      read   (any view)   "if I move agent X to position Y, this is what templates"
--   agent_rates_with_product            view             agent rates joined to product/carrier metadata
--
-- assign_agent_to_position (Phase 3a) is still the function called for the
-- actual position change — UI gates it by isOwner. Adding a server-side
-- wrapper is a follow-up if defense-in-depth on position changes is wanted.

-- ---------------------------------------------------------------
-- 1. set_agent_carrier_rate_override
-- ---------------------------------------------------------------
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
  v_tenant_id uuid;
  v_new_id    uuid;
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

  UPDATE public.agent_carrier_rates
     SET end_date = p_effective - INTERVAL '1 day', updated_at = now()
   WHERE agent_id = p_agent_id
     AND product_id = p_product_id
     AND end_date IS NULL
     AND start_date <= p_effective;

  INSERT INTO public.agent_carrier_rates
    (tenant_id, agent_id, product_id, rate, source, schedule_code,
     start_date, end_date, set_by_user_id)
  VALUES
    (v_tenant_id, p_agent_id, p_product_id, p_rate, 'override', p_schedule_code,
     p_effective, NULL, p_set_by_user)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('success', true, 'rate_id', v_new_id);
END;
$$;
REVOKE ALL ON FUNCTION public.set_agent_carrier_rate_override(uuid,uuid,numeric,text,uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agent_carrier_rate_override(uuid,uuid,numeric,text,uuid,date) TO authenticated;

-- ---------------------------------------------------------------
-- 2. reset_agent_carrier_rate_to_default
-- ---------------------------------------------------------------
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

  SELECT commission_pct, schedule_code
    INTO v_default_rate, v_default_sched
    FROM public.comp_grid_rates
   WHERE tenant_id   = v_tenant_id
     AND position_id = v_position_id
     AND product_id  = p_product_id
     AND end_date IS NULL
   ORDER BY effective_date DESC LIMIT 1;
  IF v_default_rate IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'no_master_rate');
  END IF;

  UPDATE public.agent_carrier_rates
     SET end_date = p_effective - INTERVAL '1 day', updated_at = now()
   WHERE agent_id = p_agent_id AND product_id = p_product_id AND end_date IS NULL;

  INSERT INTO public.agent_carrier_rates
    (tenant_id, agent_id, product_id, rate, source, schedule_code,
     start_date, end_date, templated_from_position_id, templated_at, set_by_user_id)
  VALUES
    (v_tenant_id, p_agent_id, p_product_id, v_default_rate, 'position_default', v_default_sched,
     p_effective, NULL, v_position_id, now(), auth.uid())
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('success', true, 'rate_id', v_new_id, 'reset_to', v_default_rate);
END;
$$;
REVOKE ALL ON FUNCTION public.reset_agent_carrier_rate_to_default(uuid,uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_agent_carrier_rate_to_default(uuid,uuid,date) TO authenticated;

-- ---------------------------------------------------------------
-- 3. position_template_blast_radius (read-only preview)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.position_template_blast_radius(
  p_agent_id    uuid,
  p_position_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id      uuid;
  v_life_count     int;
  v_annuity_count  int;
  v_override_count int;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.agents WHERE id = p_agent_id;
  IF v_tenant_id IS NULL OR NOT public.can_view_agent(p_agent_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.comp_grid_positions
    WHERE id = p_position_id AND tenant_id = v_tenant_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'position_not_in_tenant');
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE p.product_type = 'life'),
    COUNT(*) FILTER (WHERE p.product_type = 'annuity')
  INTO v_life_count, v_annuity_count
  FROM public.comp_grid_rates r
  JOIN public.comp_grid_products p ON p.id = r.product_id
  WHERE r.tenant_id   = v_tenant_id
    AND r.position_id = p_position_id
    AND r.end_date IS NULL;

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

-- ---------------------------------------------------------------
-- 4. agent_rates_with_product helper view (RLS-inheriting)
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW public.agent_rates_with_product
WITH (security_invoker = true)
AS
SELECT
  r.id, r.tenant_id, r.agent_id, r.product_id,
  r.rate, r.source, r.schedule_code, r.start_date, r.end_date,
  r.templated_from_position_id, r.templated_at,
  p.product_name, p.product_variant, p.product_type, p.has_bonus_column,
  c.id          AS carrier_id,
  c.carrier_name,
  (SELECT cr.commission_pct
     FROM public.comp_grid_rates cr
     JOIN public.agent_positions ap
       ON ap.agent_id = r.agent_id AND ap.end_date IS NULL
    WHERE cr.tenant_id   = r.tenant_id
      AND cr.product_id  = r.product_id
      AND cr.position_id = ap.position_id
      AND cr.end_date IS NULL
    ORDER BY cr.effective_date DESC LIMIT 1) AS current_default_rate
FROM public.agent_carrier_rates r
JOIN public.comp_grid_products p ON p.id = r.product_id
JOIN public.comp_grid_carriers c ON c.id = p.carrier_id
WHERE r.end_date IS NULL;
GRANT SELECT ON public.agent_rates_with_product TO authenticated;
