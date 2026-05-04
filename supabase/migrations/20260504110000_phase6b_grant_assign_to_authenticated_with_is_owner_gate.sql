-- Phase 6b hotfix #1: enable browser-side position changes by granting EXECUTE
-- on assign_agent_to_position to authenticated, with an is_owner() gate at
-- the top of the function so non-owners can't bypass the UI hide.
-- Function body otherwise unchanged from Phase 3a.
--
-- (Superseded by hotfix #3, which adds the cross-tenant match check.)

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

    IF p_overrides_action NOT IN ('keep', 'clear', 'review') THEN
        RAISE EXCEPTION 'p_overrides_action must be one of: keep, clear, review (got %)',
            p_overrides_action;
    END IF;

    SELECT tenant_id INTO v_tenant_id FROM public.agents WHERE id = p_agent_id;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'agent % does not exist', p_agent_id;
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
