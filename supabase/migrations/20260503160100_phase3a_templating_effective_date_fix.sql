-- Phase 3a follow-up #1: thread p_effective_date through templating.
--
-- Bug surfaced during Phase 3a smoke step 6 (promotion):
-- template_agent_from_position used CURRENT_DATE for both closing prior rows
-- (end_date) and inserting new rows (start_date). When called from
-- assign_agent_to_position with a future p_start_date, this caused a
-- duplicate-key violation on agent_carrier_rates_unique_open_row because the
-- new row's start_date collided with the just-closed prior row's start_date
-- (both = today).
--
-- Fix: thread an explicit p_effective_date through the templating function.
-- - Close prior rows with end_date = p_effective_date - 1.
-- - Insert new rows with start_date = p_effective_date.
-- - assign_agent_to_position passes its p_start_date.
-- - Default p_effective_date = CURRENT_DATE keeps direct callers unchanged.

DROP FUNCTION IF EXISTS public.template_agent_from_position(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION public.template_agent_from_position(
    p_agent_id        UUID,
    p_position_id     UUID,
    p_assigned_by     UUID DEFAULT NULL,
    p_effective_date  DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id           UUID;
    v_is_commissioned     BOOLEAN;
    v_rates_inserted      INT := 0;
    v_rates_closed        INT := 0;
    v_overrides_preserved INT := 0;
    v_close_date          DATE := p_effective_date - 1;
BEGIN
    SELECT tenant_id, is_commissioned
      INTO v_tenant_id, v_is_commissioned
    FROM public.comp_grid_positions
    WHERE id = p_position_id;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'comp_grid_positions row % does not exist', p_position_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.agents
        WHERE id = p_agent_id AND tenant_id = v_tenant_id
    ) THEN
        RAISE EXCEPTION 'agent % not in tenant of position %', p_agent_id, p_position_id;
    END IF;

    IF NOT v_is_commissioned THEN
        RETURN jsonb_build_object(
            'rates_inserted',          0,
            'rates_closed',            0,
            'overrides_preserved',     0,
            'skipped_non_commissioned', true,
            'position_id',             p_position_id,
            'effective_date',          p_effective_date
        );
    END IF;

    SELECT COUNT(*) INTO v_overrides_preserved
    FROM public.agent_carrier_rates acr
    JOIN public.comp_grid_rates cgr
      ON cgr.product_id  = acr.product_id
     AND cgr.position_id = p_position_id
     AND cgr.tenant_id   = v_tenant_id
     AND cgr.end_date IS NULL
    WHERE acr.agent_id = p_agent_id
      AND acr.tenant_id = v_tenant_id
      AND acr.source = 'override'
      AND acr.end_date IS NULL;

    WITH closed AS (
        UPDATE public.agent_carrier_rates
           SET end_date = v_close_date, updated_at = now()
         WHERE agent_id  = p_agent_id
           AND tenant_id = v_tenant_id
           AND source    = 'position_default'
           AND end_date IS NULL
           AND templated_from_position_id IS DISTINCT FROM p_position_id
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_rates_closed FROM closed;

    WITH inserted AS (
        INSERT INTO public.agent_carrier_rates (
            tenant_id, agent_id, product_id, rate, source, schedule_code,
            templated_from_position_id, templated_at, start_date, end_date,
            set_by_user_id
        )
        SELECT
            v_tenant_id,
            p_agent_id,
            cgr.product_id,
            cgr.commission_pct,
            'position_default'::public.rate_source,
            cgr.schedule_code,
            p_position_id,
            now(),
            p_effective_date,
            NULL,
            p_assigned_by
        FROM public.comp_grid_rates cgr
        WHERE cgr.position_id = p_position_id
          AND cgr.tenant_id   = v_tenant_id
          AND cgr.end_date IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.agent_carrier_rates acr
              WHERE acr.agent_id   = p_agent_id
                AND acr.tenant_id  = v_tenant_id
                AND acr.product_id = cgr.product_id
                AND acr.end_date IS NULL
          )
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_rates_inserted FROM inserted;

    RETURN jsonb_build_object(
        'rates_inserted',          v_rates_inserted,
        'rates_closed',            v_rates_closed,
        'overrides_preserved',     v_overrides_preserved,
        'skipped_non_commissioned', false,
        'position_id',             p_position_id,
        'effective_date',          p_effective_date
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.template_agent_from_position(UUID, UUID, UUID, DATE)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.template_agent_from_position(UUID, UUID, UUID, DATE)
    TO service_role;

-- assign_agent_to_position passes its p_start_date as the templating
-- effective_date so the close-prior + insert-new pair use consistent dates.
CREATE OR REPLACE FUNCTION public.assign_agent_to_position(
    p_agent_id          UUID,
    p_position_id       UUID,
    p_start_date        DATE,
    p_assigned_by       UUID DEFAULT NULL,
    p_overrides_action  TEXT DEFAULT 'keep'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id          UUID;
    v_prior_position_id  UUID;
    v_prior_start_date   DATE;
    v_overrides_cleared  INT := 0;
    v_template_result    JSONB;
    v_override_list      JSONB := '[]'::jsonb;
BEGIN
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

    SELECT position_id, start_date
      INTO v_prior_position_id, v_prior_start_date
    FROM public.agent_positions
    WHERE agent_id = p_agent_id AND end_date IS NULL;

    IF v_prior_position_id = p_position_id THEN
        RETURN jsonb_build_object(
            'noop_same_position', true,
            'overrides',          '[]'::jsonb
        );
    END IF;

    IF v_prior_start_date IS NOT NULL AND v_prior_start_date >= p_start_date THEN
        RAISE EXCEPTION
            'cannot assign with start_date % when prior assignment started on % (must be later)',
            p_start_date, v_prior_start_date;
    END IF;

    IF p_overrides_action = 'review' THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'agent_carrier_rate_id', acr.id,
            'product_id',            acr.product_id,
            'product_name',          cgp.product_name,
            'product_variant',       cgp.product_variant,
            'current_rate',          acr.rate,
            'position_default_rate', cgr.commission_pct
        )), '[]'::jsonb)
        INTO v_override_list
        FROM public.agent_carrier_rates acr
        JOIN public.comp_grid_products cgp ON cgp.id = acr.product_id
        LEFT JOIN public.comp_grid_rates cgr
          ON cgr.position_id = p_position_id
         AND cgr.product_id  = acr.product_id
         AND cgr.end_date IS NULL
        WHERE acr.agent_id  = p_agent_id
          AND acr.tenant_id = v_tenant_id
          AND acr.source    = 'override'
          AND acr.end_date IS NULL;
    END IF;

    IF p_overrides_action = 'clear' THEN
        WITH cleared AS (
            UPDATE public.agent_carrier_rates
               SET end_date = (p_start_date - 1), updated_at = now()
             WHERE agent_id  = p_agent_id
               AND tenant_id = v_tenant_id
               AND source    = 'override'
               AND end_date IS NULL
            RETURNING 1
        )
        SELECT COUNT(*) INTO v_overrides_cleared FROM cleared;
    END IF;

    IF v_prior_position_id IS NOT NULL THEN
        UPDATE public.agent_positions
           SET end_date = (p_start_date - 1)
         WHERE agent_id = p_agent_id AND end_date IS NULL;
    END IF;

    INSERT INTO public.agent_positions (
        tenant_id, agent_id, position_id, start_date, assigned_by
    )
    VALUES (v_tenant_id, p_agent_id, p_position_id, p_start_date, p_assigned_by);

    -- Pass p_start_date as the templating's effective_date so prior rates
    -- close at p_start_date - 1 and new rates begin at p_start_date.
    v_template_result := public.template_agent_from_position(
        p_agent_id, p_position_id, p_assigned_by, p_start_date
    );

    RETURN jsonb_build_object(
        'noop_same_position',  false,
        'prior_position_id',   v_prior_position_id,
        'new_position_id',     p_position_id,
        'start_date',          p_start_date,
        'overrides_action',    p_overrides_action,
        'overrides_cleared',   v_overrides_cleared,
        'template_result',     v_template_result,
        'overrides',           v_override_list
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_agent_to_position(UUID, UUID, DATE, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_agent_to_position(UUID, UUID, DATE, UUID, TEXT)
    TO service_role;
