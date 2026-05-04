-- Phase 8 hotfix: propagate_master_grid_change (Phase 3a) had a latent bug
-- that surfaced during Phase 8 smoke. When an agent's open position_default
-- agent_carrier_rates row already had start_date = the master rate's
-- effective_date, closing it to (effective - 1) violated the
-- agent_carrier_rates_date_order CHECK (end_date >= start_date).
--
-- Same-day update-in-place fix Phase 6b hotfix #2 applied to
-- set_agent_carrier_rate_override: if existing row has start_date = effective,
-- UPDATE in place; otherwise close + insert. New return field
-- agents_in_place / agents_close_insert breaks down which path each agent
-- took (sum = agents_updated, preserving the existing field).

CREATE OR REPLACE FUNCTION public.propagate_master_grid_change(p_position_id uuid, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
    v_tenant_id            UUID;
    v_master_rate          NUMERIC;
    v_master_schedule      TEXT;
    v_master_effective     DATE;
    v_target_agent_ids     UUID[];
    v_close_date           DATE;
    v_in_place_count       INT := 0;
    v_close_insert_count   INT := 0;
BEGIN
    SELECT tenant_id, commission_pct, schedule_code, effective_date
      INTO v_tenant_id, v_master_rate, v_master_schedule, v_master_effective
    FROM public.comp_grid_rates
    WHERE position_id = p_position_id
      AND product_id  = p_product_id
      AND end_date IS NULL;

    IF v_master_rate IS NULL THEN
        RAISE EXCEPTION
            'no open master grid rate for position % product % - propagation aborted',
            p_position_id, p_product_id;
    END IF;

    v_close_date := v_master_effective - 1;

    -- Eligible agents: at this position, no open override on this product
    SELECT array_agg(DISTINCT ap.agent_id)
      INTO v_target_agent_ids
    FROM public.agent_positions ap
    WHERE ap.position_id = p_position_id
      AND ap.tenant_id   = v_tenant_id
      AND ap.end_date IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.agent_carrier_rates acr
          WHERE acr.agent_id   = ap.agent_id
            AND acr.product_id = p_product_id
            AND acr.source     = 'override'
            AND acr.end_date IS NULL
      );

    IF v_target_agent_ids IS NULL OR array_length(v_target_agent_ids, 1) IS NULL THEN
        RETURN jsonb_build_object(
            'agents_updated',         0,
            'master_rate',            v_master_rate,
            'master_schedule',        v_master_schedule,
            'master_effective_date',  v_master_effective
        );
    END IF;

    -- Branch A: same-day in-place update (any open row whose start_date = effective)
    WITH updated AS (
        UPDATE public.agent_carrier_rates
           SET rate                       = v_master_rate,
               schedule_code              = v_master_schedule,
               templated_from_position_id = p_position_id,
               templated_at               = now(),
               updated_at                 = now()
         WHERE agent_id   = ANY(v_target_agent_ids)
           AND product_id = p_product_id
           AND source     = 'position_default'
           AND end_date IS NULL
           AND start_date = v_master_effective
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_in_place_count FROM updated;

    -- Branch B: close-prior for older open rows (start_date < effective)
    UPDATE public.agent_carrier_rates
       SET end_date = v_close_date, updated_at = now()
     WHERE agent_id   = ANY(v_target_agent_ids)
       AND product_id = p_product_id
       AND source     = 'position_default'
       AND end_date IS NULL
       AND start_date < v_master_effective;

    -- Branch B (cont.): insert fresh rows for agents who now have no open row
    -- (covers both agents whose prior row was just closed + agents who never
    -- had a row for this product — the first-time-set path)
    WITH inserted AS (
        INSERT INTO public.agent_carrier_rates (
            tenant_id, agent_id, product_id, rate, source, schedule_code,
            templated_from_position_id, templated_at, start_date
        )
        SELECT
            v_tenant_id,
            ta_id,
            p_product_id,
            v_master_rate,
            'position_default'::public.rate_source,
            v_master_schedule,
            p_position_id,
            now(),
            v_master_effective
        FROM unnest(v_target_agent_ids) AS ta_id
        WHERE NOT EXISTS (
            SELECT 1 FROM public.agent_carrier_rates
            WHERE agent_id   = ta_id
              AND product_id = p_product_id
              AND end_date IS NULL
        )
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_close_insert_count FROM inserted;

    RETURN jsonb_build_object(
        'agents_updated',         v_in_place_count + v_close_insert_count,
        'agents_in_place',        v_in_place_count,
        'agents_close_insert',    v_close_insert_count,
        'master_rate',            v_master_rate,
        'master_schedule',        v_master_schedule,
        'master_effective_date',  v_master_effective
    );
END;
$function$;
