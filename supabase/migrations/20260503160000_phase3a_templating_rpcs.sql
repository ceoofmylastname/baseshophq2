-- =============================================================================
-- Baseshop HQ — Comp Grid Phase 3a: templating engine RPCs
-- Target: Supabase project oarstmxbgdczytwzpyxj
-- Status: DRAFT — do not apply until user green-lights
--
-- Schema change:
--   ALTER agent_carrier_rates ADD COLUMN schedule_code TEXT — denormalized
--   from comp_grid_rates at templating time so the pure rate resolver and the
--   My Rates page can read schedule code without a JOIN. Templating + propagate
--   RPCs keep it in sync.
--
-- Three new RPCs (SECURITY DEFINER, service-role only):
--
--   1. template_agent_from_position(p_agent_id, p_position_id, p_assigned_by)
--      Reads open comp_grid_rates rows for the position and writes
--      agent_carrier_rates rows tagged source='position_default'.
--      Override preservation: rows with source='override' are skipped.
--      Position-default rows from a DIFFERENT position get closed, then new
--      rows inserted (close-prior + insert-new pattern).
--      Idempotency: re-running for the same position is a no-op (existing
--      position_default rows already templated from this position are
--      unchanged).
--      NON-COMMISSIONED CHECK: if comp_grid_positions.is_commissioned = false
--      (the 80 Associate training position), the RPC returns immediately
--      with skipped_non_commissioned=true and writes ZERO rate rows. The
--      My Rates page reads is_commissioned=false to render the training
--      banner.
--
--   2. assign_agent_to_position(p_agent_id, p_position_id, p_start_date,
--                              p_assigned_by, p_overrides_action)
--      Closes the prior open agent_positions row, inserts the new one, then
--      calls template_agent_from_position.
--      p_overrides_action ∈ {'keep', 'clear', 'review'}:
--        'keep'   → overrides preserved during templating; returns overrides=[]
--        'clear'  → all open override rows closed before templating; overrides=[]
--        'review' → overrides preserved (same execution as 'keep') BUT returns
--                  the override list (id, product_id, product_name, current_rate,
--                  position_default_rate) so the Phase 4 UI can offer per-row
--                  keep/clear toggles afterward via separate RPC calls.
--
--   3. propagate_master_grid_change(p_position_id, p_product_id)
--      Called when the owner edits a master grid cell (which mechanically
--      means: insert a new comp_grid_rates row + close the prior row's
--      end_date, per the Phase 1 immutability trigger). Reads the current
--      OPEN master rate and fans it out to every active agent at the
--      position, skipping agents whose open agent_carrier_rates row for the
--      product is source='override'. Uses the close-prior + insert-new
--      pattern so per-agent rate history is preserved.
--      Returns affected agent count.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Schema change: denormalize schedule_code onto agent_carrier_rates
-- -----------------------------------------------------------------------------
ALTER TABLE public.agent_carrier_rates
    ADD COLUMN IF NOT EXISTS schedule_code TEXT;

COMMENT ON COLUMN public.agent_carrier_rates.schedule_code IS
    'Two purposes. (1) Performance: denormalized from comp_grid_rates.schedule_code at templating time so the resolver and My Rates page do not need a JOIN. Refreshed by template_agent_from_position and propagate_master_grid_change. (2) Per-agent override surface: when an owner sets source=override on a row, they can also change schedule_code independently of the master grid (some carrier statements reconcile by schedule code, and a contract-specific schedule may differ from the position default). Nullable: some products have no schedule code in the master grid.';


-- -----------------------------------------------------------------------------
-- 2. template_agent_from_position
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.template_agent_from_position(
    p_agent_id    UUID,
    p_position_id UUID,
    p_assigned_by UUID DEFAULT NULL
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
    v_today               DATE := CURRENT_DATE;
BEGIN
    -- Position must exist; capture tenant + commissioned flag
    SELECT tenant_id, is_commissioned
      INTO v_tenant_id, v_is_commissioned
    FROM public.comp_grid_positions
    WHERE id = p_position_id;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'comp_grid_positions row % does not exist', p_position_id;
    END IF;

    -- Agent must exist in same tenant
    IF NOT EXISTS (
        SELECT 1 FROM public.agents
        WHERE id = p_agent_id AND tenant_id = v_tenant_id
    ) THEN
        RAISE EXCEPTION 'agent % not in tenant of position %', p_agent_id, p_position_id;
    END IF;

    -- Non-commissioned position (80 Associate): zero rate templating, return early
    IF NOT v_is_commissioned THEN
        RETURN jsonb_build_object(
            'rates_inserted',          0,
            'rates_closed',            0,
            'overrides_preserved',     0,
            'skipped_non_commissioned', true,
            'position_id',             p_position_id
        );
    END IF;

    -- Count overrides we're preserving (informational; not modified)
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

    -- Close existing position_default rows that aren't already templated from
    -- this position (avoid no-op churn on re-runs of the same position).
    WITH closed AS (
        UPDATE public.agent_carrier_rates
           SET end_date = v_today, updated_at = now()
         WHERE agent_id  = p_agent_id
           AND tenant_id = v_tenant_id
           AND source    = 'position_default'
           AND end_date IS NULL
           AND templated_from_position_id IS DISTINCT FROM p_position_id
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_rates_closed FROM closed;

    -- Insert new rows for products with no remaining open row (after close above).
    -- Skips: products with an open override (preservation), products already
    -- templated from this position (idempotency).
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
            v_today,
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
        'position_id',             p_position_id
    );
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. assign_agent_to_position
-- -----------------------------------------------------------------------------
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

    -- Capture current open assignment (if any)
    SELECT position_id, start_date
      INTO v_prior_position_id, v_prior_start_date
    FROM public.agent_positions
    WHERE agent_id = p_agent_id AND end_date IS NULL;

    -- Same-position re-assignment is a no-op
    IF v_prior_position_id = p_position_id THEN
        RETURN jsonb_build_object(
            'noop_same_position', true,
            'overrides',          '[]'::jsonb
        );
    END IF;

    -- Prior assignment cannot start on or after the new start_date
    IF v_prior_start_date IS NOT NULL AND v_prior_start_date >= p_start_date THEN
        RAISE EXCEPTION
            'cannot assign with start_date % when prior assignment started on % (must be later)',
            p_start_date, v_prior_start_date;
    END IF;

    -- For 'review', capture the override list before any mutation
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

    -- For 'clear', close every open override row before templating
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

    -- Close prior agent_position
    IF v_prior_position_id IS NOT NULL THEN
        UPDATE public.agent_positions
           SET end_date = (p_start_date - 1)
         WHERE agent_id = p_agent_id AND end_date IS NULL;
    END IF;

    -- Insert new agent_position
    INSERT INTO public.agent_positions (
        tenant_id, agent_id, position_id, start_date, assigned_by
    )
    VALUES (v_tenant_id, p_agent_id, p_position_id, p_start_date, p_assigned_by);

    -- Run templating
    v_template_result := public.template_agent_from_position(
        p_agent_id, p_position_id, p_assigned_by
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


-- -----------------------------------------------------------------------------
-- 4. propagate_master_grid_change
-- -----------------------------------------------------------------------------
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
    v_target_agent_ids     UUID[];
    v_agents_updated       INT := 0;
    v_today                DATE := CURRENT_DATE;
BEGIN
    -- Read the current OPEN master grid rate for (position_id, product_id)
    SELECT tenant_id, commission_pct, schedule_code
      INTO v_tenant_id, v_master_rate, v_master_schedule
    FROM public.comp_grid_rates
    WHERE position_id = p_position_id
      AND product_id  = p_product_id
      AND end_date IS NULL;

    IF v_master_rate IS NULL THEN
        RAISE EXCEPTION
            'no open master grid rate for position % product % — propagation aborted',
            p_position_id, p_product_id;
    END IF;

    -- Find target agents: at this position, with no open OVERRIDE on this product
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
            'agents_updated',  0,
            'master_rate',     v_master_rate,
            'master_schedule', v_master_schedule
        );
    END IF;

    -- Close existing open position_default rows for these agents on this product
    UPDATE public.agent_carrier_rates
       SET end_date = v_today, updated_at = now()
     WHERE agent_id   = ANY(v_target_agent_ids)
       AND product_id = p_product_id
       AND source     = 'position_default'
       AND end_date IS NULL;

    -- Insert new rows with the new master rate (only for agents now having no open row)
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
            v_today
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
        'agents_updated',  v_agents_updated,
        'master_rate',     v_master_rate,
        'master_schedule', v_master_schedule
    );
END;
$$;


-- -----------------------------------------------------------------------------
-- 5. Lock down execute privileges (service_role only)
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.template_agent_from_position(UUID, UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.template_agent_from_position(UUID, UUID, UUID)
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.assign_agent_to_position(UUID, UUID, DATE, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_agent_to_position(UUID, UUID, DATE, UUID, TEXT)
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.propagate_master_grid_change(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.propagate_master_grid_change(UUID, UUID)
    TO service_role;


-- -----------------------------------------------------------------------------
-- 6. Verification
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_fn TEXT;
BEGIN
    -- schedule_code column exists on agent_carrier_rates
    ASSERT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'agent_carrier_rates'
          AND column_name = 'schedule_code'
    ), 'agent_carrier_rates.schedule_code column missing';

    -- All three RPCs exist
    FOREACH v_fn IN ARRAY ARRAY[
        'template_agent_from_position',
        'assign_agent_to_position',
        'propagate_master_grid_change'
    ]
    LOOP
        ASSERT EXISTS (
            SELECT 1 FROM pg_proc
            WHERE proname = v_fn AND pronamespace = 'public'::regnamespace
        ), format('function public.%s missing', v_fn);
    END LOOP;

    -- Grants: anon and authenticated have NO execute, service_role has execute
    ASSERT NOT has_function_privilege('anon',
        'public.template_agent_from_position(uuid, uuid, uuid)', 'EXECUTE'),
        'anon should NOT execute template_agent_from_position';
    ASSERT NOT has_function_privilege('authenticated',
        'public.template_agent_from_position(uuid, uuid, uuid)', 'EXECUTE'),
        'authenticated should NOT execute template_agent_from_position';
    ASSERT has_function_privilege('service_role',
        'public.template_agent_from_position(uuid, uuid, uuid)', 'EXECUTE'),
        'service_role should execute template_agent_from_position';

    ASSERT NOT has_function_privilege('anon',
        'public.assign_agent_to_position(uuid, uuid, date, uuid, text)', 'EXECUTE'),
        'anon should NOT execute assign_agent_to_position';
    ASSERT NOT has_function_privilege('authenticated',
        'public.assign_agent_to_position(uuid, uuid, date, uuid, text)', 'EXECUTE'),
        'authenticated should NOT execute assign_agent_to_position';
    ASSERT has_function_privilege('service_role',
        'public.assign_agent_to_position(uuid, uuid, date, uuid, text)', 'EXECUTE'),
        'service_role should execute assign_agent_to_position';

    ASSERT NOT has_function_privilege('anon',
        'public.propagate_master_grid_change(uuid, uuid)', 'EXECUTE'),
        'anon should NOT execute propagate_master_grid_change';
    ASSERT NOT has_function_privilege('authenticated',
        'public.propagate_master_grid_change(uuid, uuid)', 'EXECUTE'),
        'authenticated should NOT execute propagate_master_grid_change';
    ASSERT has_function_privilege('service_role',
        'public.propagate_master_grid_change(uuid, uuid)', 'EXECUTE'),
        'service_role should execute propagate_master_grid_change';

    RAISE NOTICE 'Phase 3a verification passed.';
    RAISE NOTICE '  schedule_code column added; 3 RPCs deployed; service-role only.';
END $$;
