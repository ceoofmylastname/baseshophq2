-- =============================================================================
-- Baseshop HQ — Comp Grid Phase 2 (build step 3): bootstrap RPC
-- Target: Supabase project oarstmxbgdczytwzpyxj
-- Status: DRAFT — do not apply until user green-lights
--
-- Defines the SQL function `bootstrap_agora_grid_for_tenant(uuid, jsonb)`
-- called by `src/lib/comp-grid-bootstrap.ts` to seed the master grid for one
-- tenant. The TypeScript orchestrator parses the bundled Agora CSVs in the
-- Node process and ships the normalized payload to this RPC for transactional
-- insertion under service-role privileges.
--
-- Idempotency contract:
--   - Positions, carriers, products: standard ON CONFLICT DO NOTHING on the
--     tenant-scoped unique constraints. Re-runs are no-ops.
--   - Rates: skipped if an open row (end_date IS NULL) already exists for the
--     (tenant_id, position_id, product_id) cell. Prevents the rate insert
--     from violating the partial unique index `comp_grid_rates_one_active_per_cell`
--     on second runs and avoids creating duplicate open windows.
--
-- Returns JSONB with insert counts and a `was_noop` flag for the orchestrator
-- to surface in logs / signup-flow telemetry.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.bootstrap_agora_grid_for_tenant(
    p_tenant_id UUID,
    p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_positions_inserted INT := 0;
    v_carriers_inserted  INT := 0;
    v_products_inserted  INT := 0;
    v_rates_inserted     INT := 0;
BEGIN
    -- Sanity check: tenant must exist
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
        RAISE EXCEPTION 'tenant % does not exist', p_tenant_id;
    END IF;

    -- 1. Positions  (10 rows: 9 commissioned + 80 Associate)
    WITH ins AS (
        INSERT INTO public.comp_grid_positions
            (tenant_id, position_code, position_name, sort_order, is_commissioned)
        SELECT p_tenant_id, position_code, position_name, sort_order, is_commissioned
        FROM jsonb_to_recordset(p_payload -> 'positions') AS t(
            position_code   TEXT,
            position_name   TEXT,
            sort_order      INT,
            is_commissioned BOOLEAN
        )
        ON CONFLICT (tenant_id, position_code) DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_positions_inserted FROM ins;

    -- 2. Carriers  (19 rows: 11 Life + 8 Annuity, North American dual-listed)
    WITH ins AS (
        INSERT INTO public.comp_grid_carriers
            (tenant_id, carrier_name, product_type)
        SELECT p_tenant_id, carrier_name, product_type::public.product_type
        FROM jsonb_to_recordset(p_payload -> 'carriers') AS t(
            carrier_name TEXT,
            product_type TEXT
        )
        ON CONFLICT (tenant_id, carrier_name, product_type) DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_carriers_inserted FROM ins;

    -- 3. Products  (54 rows: 39 Life + 15 Annuity, including age-band variants
    --              and Lincoln Bonus variant). product_type column is set by
    --              the sync_comp_grid_product_type BEFORE INSERT trigger from
    --              the joined carrier row.
    WITH ins AS (
        INSERT INTO public.comp_grid_products
            (tenant_id, carrier_id, product_name, product_variant, has_bonus_column)
        SELECT
            p_tenant_id,
            c.id,
            p.product_name,
            p.product_variant,
            p.has_bonus_column
        FROM jsonb_to_recordset(p_payload -> 'products') AS p(
            carrier_name     TEXT,
            product_name     TEXT,
            product_variant  TEXT,
            product_type     TEXT,
            has_bonus_column BOOLEAN
        )
        JOIN public.comp_grid_carriers c
            ON c.tenant_id    = p_tenant_id
           AND c.carrier_name = p.carrier_name
           AND c.product_type = p.product_type::public.product_type
        ON CONFLICT (tenant_id, carrier_id, product_name, product_variant) DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_products_inserted FROM ins;

    -- 4. Rates  (479 rows: 344 Life + 135 Annuity, with effective_date = today.
    --           Skipped entirely on re-runs that find an existing open row for
    --           the (position_id, product_id) cell. Prevents the partial
    --           unique index `comp_grid_rates_one_active_per_cell` from being
    --           violated.)
    WITH ins AS (
        INSERT INTO public.comp_grid_rates
            (tenant_id, position_id, product_id, commission_pct, schedule_code, effective_date)
        SELECT
            p_tenant_id,
            pos.id,
            prod.id,
            r.commission_pct,
            NULLIF(r.schedule_code, ''),
            CURRENT_DATE
        FROM jsonb_to_recordset(p_payload -> 'rates') AS r(
            position_code   TEXT,
            carrier_name    TEXT,
            product_name    TEXT,
            product_variant TEXT,
            commission_pct  NUMERIC,
            schedule_code   TEXT,
            product_type    TEXT
        )
        JOIN public.comp_grid_positions pos
            ON pos.tenant_id     = p_tenant_id
           AND pos.position_code = r.position_code
        JOIN public.comp_grid_carriers car
            ON car.tenant_id    = p_tenant_id
           AND car.carrier_name = r.carrier_name
           AND car.product_type = r.product_type::public.product_type
        JOIN public.comp_grid_products prod
            ON prod.tenant_id       = p_tenant_id
           AND prod.carrier_id      = car.id
           AND prod.product_name    = r.product_name
           AND prod.product_variant IS NOT DISTINCT FROM r.product_variant
        WHERE NOT EXISTS (
            -- Idempotency: skip if an open rate window already exists for this cell
            SELECT 1
            FROM public.comp_grid_rates existing
            WHERE existing.tenant_id   = p_tenant_id
              AND existing.position_id = pos.id
              AND existing.product_id  = prod.id
              AND existing.end_date IS NULL
        )
        ON CONFLICT (tenant_id, position_id, product_id, effective_date) DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_rates_inserted FROM ins;

    RETURN jsonb_build_object(
        'positions_inserted', v_positions_inserted,
        'carriers_inserted',  v_carriers_inserted,
        'products_inserted',  v_products_inserted,
        'rates_inserted',     v_rates_inserted,
        'was_noop',
            (v_positions_inserted + v_carriers_inserted + v_products_inserted + v_rates_inserted) = 0
    );
END;
$$;

-- Service-role only — orchestrator uses the admin client. anon/authenticated
-- have no business invoking the bootstrap RPC.
REVOKE EXECUTE ON FUNCTION public.bootstrap_agora_grid_for_tenant(UUID, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_agora_grid_for_tenant(UUID, JSONB)
    TO service_role;

COMMENT ON FUNCTION public.bootstrap_agora_grid_for_tenant(UUID, JSONB) IS
    'Phase 2 bootstrap. Called by src/lib/comp-grid-bootstrap.ts with the parsed payload from public/seed/agora-life.csv + agora-annuity.csv. Idempotent. Returns insert counts.';
