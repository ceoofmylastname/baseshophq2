-- Phase 3a follow-up #2: same effective-date fix for propagate_master_grid_change.
--
-- Bug surfaced during Phase 3a smoke step 8 (master grid update + propagation):
-- propagate_master_grid_change used CURRENT_DATE for the close-prior + insert-new
-- pair, which collides on the agent_carrier_rates_unique_open_row constraint
-- when the agent's existing rate has start_date = today.
--
-- Fix: pull effective_date from the OPEN master rate row and use it for the
-- propagation. Close prior agent rates at effective_date - 1, insert new
-- agent rates at effective_date. Matches the canonical "master grid edits go
-- through close-prior + insert-new" semantics — the effective_date is set on
-- the master rate INSERT and propagation honors it.

CREATE OR REPLACE FUNCTION public.propagate_master_grid_change(
    p_position_id UUID,
    p_product_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id            UUID;
    v_master_rate          NUMERIC;
    v_master_schedule      TEXT;
    v_master_effective     DATE;
    v_target_agent_ids     UUID[];
    v_agents_updated       INT := 0;
    v_close_date           DATE;
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

    UPDATE public.agent_carrier_rates
       SET end_date = v_close_date, updated_at = now()
     WHERE agent_id   = ANY(v_target_agent_ids)
       AND product_id = p_product_id
       AND source     = 'position_default'
       AND end_date IS NULL;

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
    SELECT COUNT(*) INTO v_agents_updated FROM inserted;

    RETURN jsonb_build_object(
        'agents_updated',         v_agents_updated,
        'master_rate',            v_master_rate,
        'master_schedule',        v_master_schedule,
        'master_effective_date',  v_master_effective
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.propagate_master_grid_change(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.propagate_master_grid_change(UUID, UUID)
    TO service_role;
