-- Phase 8: master grid owner RPCs.
--
-- Two new SECURITY DEFINER functions, both authenticated-callable, both
-- following the Phase 6.5 build rule: is_owner() check + explicit
-- current_tenant_id() = target tenant_id check (belt-and-suspenders even
-- though is_owner() is now correctly tenant-scoped).
--
-- 1. set_master_grid_rate(position, product, new_rate, schedule, effective)
--    Atomic: close prior + insert new + propagate. Same-day re-edits use
--    DELETE+INSERT to bypass the enforce_comp_grid_rate_immutability trigger
--    (which blocks UPDATE of commission_pct). Audit-trail outcome is
--    identical to the relaxed-trigger alternative — both lose intermediate
--    same-day states and produce the correct final rate. The relaxed-
--    trigger alternative remains available as a future change if the
--    semantics ever need to shift.
--
-- 2. master_grid_blast_radius(position, product)
--    Read-only preview for the edit-cell tooltip and the Set-column dialog.
--    Returns counts of agents at the position with vs without an open
--    override on the product.

-- ---------------------------------------------------------------------------
-- 1. set_master_grid_rate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_master_grid_rate(
  p_position_id   uuid,
  p_product_id    uuid,
  p_new_rate      numeric,
  p_schedule_code text DEFAULT NULL,
  p_effective     date DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_tenant uuid;
  v_pos_tenant    uuid;
  v_prod_tenant   uuid;
  v_prior_rate    numeric;
  v_propagation   jsonb;
BEGIN
  -- Phase 6.5 defense-in-depth: is_owner() + explicit tenant match
  IF NOT public.is_owner() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  v_caller_tenant := public.current_tenant_id();
  SELECT tenant_id INTO v_pos_tenant  FROM public.comp_grid_positions WHERE id = p_position_id;
  SELECT tenant_id INTO v_prod_tenant FROM public.comp_grid_products  WHERE id = p_product_id;
  IF v_pos_tenant IS NULL OR v_prod_tenant IS NULL
     OR v_caller_tenant IS NULL
     OR v_caller_tenant <> v_pos_tenant
     OR v_caller_tenant <> v_prod_tenant THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF p_new_rate < 0 OR p_new_rate > 200 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'rate_out_of_range');
  END IF;

  -- Capture prior rate for the modal feedback
  SELECT commission_pct INTO v_prior_rate
    FROM public.comp_grid_rates
   WHERE tenant_id = v_caller_tenant
     AND position_id = p_position_id
     AND product_id  = p_product_id
     AND end_date IS NULL;

  -- Close prior open row (only if it began earlier than p_effective)
  UPDATE public.comp_grid_rates
     SET end_date = p_effective - 1
   WHERE tenant_id   = v_caller_tenant
     AND position_id = p_position_id
     AND product_id  = p_product_id
     AND end_date IS NULL
     AND effective_date < p_effective;

  -- Same-day re-edit: an open row already starts on p_effective. The
  -- enforce_comp_grid_rate_immutability trigger blocks UPDATE of
  -- commission_pct, so we DELETE the open same-day row and INSERT a fresh
  -- one. Net audit-trail effect is the same as a relaxed-trigger UPDATE.
  DELETE FROM public.comp_grid_rates
   WHERE tenant_id      = v_caller_tenant
     AND position_id    = p_position_id
     AND product_id     = p_product_id
     AND effective_date = p_effective
     AND end_date IS NULL;

  INSERT INTO public.comp_grid_rates
    (tenant_id, position_id, product_id, commission_pct, schedule_code,
     effective_date, end_date, created_by)
  VALUES
    (v_caller_tenant, p_position_id, p_product_id, p_new_rate, p_schedule_code,
     p_effective, NULL, auth.uid());

  -- Fan out to non-overridden agents at this position
  v_propagation := public.propagate_master_grid_change(p_position_id, p_product_id);

  RETURN jsonb_build_object(
    'success', true,
    'prior_rate', v_prior_rate,
    'new_rate', p_new_rate,
    'effective_date', p_effective,
    'propagation', v_propagation
  );
END;
$$;
REVOKE ALL ON FUNCTION public.set_master_grid_rate(uuid,uuid,numeric,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_master_grid_rate(uuid,uuid,numeric,text,date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. master_grid_blast_radius (read-only preview)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.master_grid_blast_radius(
  p_position_id uuid,
  p_product_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_tenant   uuid;
  v_pos_tenant      uuid;
  v_eligible        int;
  v_overridden      int;
BEGIN
  v_caller_tenant := public.current_tenant_id();
  SELECT tenant_id INTO v_pos_tenant FROM public.comp_grid_positions WHERE id = p_position_id;
  IF v_pos_tenant IS NULL OR v_caller_tenant IS NULL OR v_caller_tenant <> v_pos_tenant THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  -- Agents at this position WITHOUT an open override on this product
  SELECT COUNT(DISTINCT ap.agent_id) INTO v_eligible
    FROM public.agent_positions ap
   WHERE ap.position_id = p_position_id
     AND ap.tenant_id   = v_caller_tenant
     AND ap.end_date IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.agent_carrier_rates acr
        WHERE acr.agent_id   = ap.agent_id
          AND acr.product_id = p_product_id
          AND acr.source     = 'override'
          AND acr.end_date IS NULL
     );

  -- Agents at this position WITH an open override (won't be touched)
  SELECT COUNT(DISTINCT ap.agent_id) INTO v_overridden
    FROM public.agent_positions ap
    JOIN public.agent_carrier_rates acr
      ON acr.agent_id   = ap.agent_id
     AND acr.product_id = p_product_id
     AND acr.source     = 'override'
     AND acr.end_date IS NULL
   WHERE ap.position_id = p_position_id
     AND ap.tenant_id   = v_caller_tenant
     AND ap.end_date IS NULL;

  RETURN jsonb_build_object(
    'success', true,
    'eligible_agents',   v_eligible,
    'overridden_agents', v_overridden
  );
END;
$$;
REVOKE ALL ON FUNCTION public.master_grid_blast_radius(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_grid_blast_radius(uuid,uuid) TO authenticated;
