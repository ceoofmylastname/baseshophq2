-- =============================================================================
-- JRM Insurance Group — tenant-specific commission engine test data
--
-- THIS FILE IS NOT RUN BY `supabase db reset`.
--   `supabase db reset` runs `supabase/seed.sql` only. Apply this file manually
--   when you need to restore the JRM tenant's specific test data:
--
--     psql "$DATABASE_URL" -f supabase/seed-jrm-test-data.sql
--
--   Or against a local stack:
--     docker exec -i supabase_db_<project> psql -U postgres -d postgres \
--       < supabase/seed-jrm-test-data.sql
--
-- WHAT THIS FILE CAPTURES (live state pulled 2026-05-14):
--   1. Four new comp_grid_products rows on the JRM tenant for AIG and Foresters.
--      These products were added to support commission tests for John Melvin
--      and Bryson Melvin.
--   2. Five new agent_carrier_rates rows at 90% with start_date 2025-01-01.
--      Four of them reference the four new products; the fifth is the Loso
--      Melvin / PlanRight override that landed in the same batch.
--   3. A back-date update that pins every agent_carrier_rates row in the JRM
--      tenant to start_date '2025-01-01' so the commission engine resolves
--      rates for every policy in the historical window. This was a one-time
--      manual reset on live; the UPDATE is included so a fresh JRM
--      reconstruction reaches the same state.
--
-- DEPENDENCIES:
--   * Migration 20260516140000_commission_engine_schema_sync.sql must be
--     applied first (it adds the columns the engine uses).
--   * The JRM tenant row and its 5 referenced agents must already exist.
--   * The two carriers (AIG, Foresters) must exist with the IDs referenced
--     below.
--
-- IDEMPOTENCE:
--   * All INSERTs use ON CONFLICT (id) DO NOTHING — safe to re-run.
--   * The back-date UPDATE is a no-op on a row that already has
--     start_date = '2025-01-01'.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Four new comp_grid_products under JRM tenant
-- -----------------------------------------------------------------------------
INSERT INTO public.comp_grid_products (
    id, tenant_id, carrier_id, product_name, product_variant, product_type,
    has_bonus_column, product_subtype, is_active
)
VALUES
    ('044a59b8-549e-4025-a891-574207c84e9a',
     'f4b44753-fe5f-4dc5-8353-a86dc2b03c40',
     '1a545a4b-6485-4f49-89e0-a374edf74df7',  -- AIG
     'Quality of Life Index UL', NULL, 'life',
     false, NULL, true),
    ('7034d074-3666-4272-8673-3912586bdbfb',
     'f4b44753-fe5f-4dc5-8353-a86dc2b03c40',
     '1a545a4b-6485-4f49-89e0-a374edf74df7',  -- AIG
     'Select-a-Term 20yr', NULL, 'life',
     false, NULL, true),
    ('514a4ac7-d250-473e-8a59-dd7bc25e2cb4',
     'f4b44753-fe5f-4dc5-8353-a86dc2b03c40',
     '9e1d33a7-ca4a-4b7f-8b5e-3902a51bfc24',  -- Foresters
     'Advantage Plus II', NULL, 'life',
     false, NULL, true),
    ('9efb69f5-acb5-4e9c-a370-726625ae5526',
     'f4b44753-fe5f-4dc5-8353-a86dc2b03c40',
     '9e1d33a7-ca4a-4b7f-8b5e-3902a51bfc24',  -- Foresters
     'Your Term 25yr', NULL, 'life',
     false, NULL, true)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Five new agent_carrier_rates rows — 90% overrides, start_date 2025-01-01
--
--    Bryson Melvin and John Melvin get 90% overrides on the four new products
--    (Bryson on Advantage Plus II + Your Term 25yr; John on Quality of Life
--    Index UL + Select-a-Term 20yr). Loso Melvin gets the PlanRight override
--    that landed in the same batch.
-- -----------------------------------------------------------------------------
INSERT INTO public.agent_carrier_rates (
    id, tenant_id, agent_id, product_id, rate, source, start_date, end_date,
    templated_from_position_id, templated_at
)
VALUES
    -- Bryson Melvin / Foresters Advantage Plus II
    ('ffc0b857-1783-4fe9-9584-bde38c451e5a',
     'f4b44753-fe5f-4dc5-8353-a86dc2b03c40',
     'f7163778-4d24-4062-82b6-5af9ca27f9fc',
     '514a4ac7-d250-473e-8a59-dd7bc25e2cb4',
     90.00, 'override', '2025-01-01', NULL, NULL, NULL),
    -- Loso Melvin / PlanRight
    ('a0b57ef2-cfbf-4e6c-8458-5ec77bf1cecf',
     'f4b44753-fe5f-4dc5-8353-a86dc2b03c40',
     '704fb098-f1a4-4de7-bdb5-7221e5f7fd56',
     'ed5c420a-bb12-4d19-9404-fc0ade3b99c0',
     90.00, 'override', '2025-01-01', NULL, NULL, NULL),
    -- John Melvin / AIG Quality of Life Index UL
    ('a530d68b-b9cc-4f01-8763-1b1686dd008e',
     'f4b44753-fe5f-4dc5-8353-a86dc2b03c40',
     '2d0fd9ce-b392-4f72-bef6-0f6b95c2827a',
     '044a59b8-549e-4025-a891-574207c84e9a',
     90.00, 'override', '2025-01-01', NULL, NULL, NULL),
    -- John Melvin / AIG Select-a-Term 20yr
    ('6437e217-1af5-4433-baa6-e74f4d218f2b',
     'f4b44753-fe5f-4dc5-8353-a86dc2b03c40',
     '2d0fd9ce-b392-4f72-bef6-0f6b95c2827a',
     '7034d074-3666-4272-8673-3912586bdbfb',
     90.00, 'override', '2025-01-01', NULL, NULL, NULL),
    -- Bryson Melvin / Foresters Your Term 25yr
    ('56762636-0215-43a9-b4f6-898182ab539f',
     'f4b44753-fe5f-4dc5-8353-a86dc2b03c40',
     'f7163778-4d24-4062-82b6-5af9ca27f9fc',
     '9efb69f5-acb5-4e9c-a370-726625ae5526',
     90.00, 'override', '2025-01-01', NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. Back-date all agent_carrier_rates in the JRM tenant to 2025-01-01.
--
--    The templating engine writes new rate rows with start_date = CURRENT_DATE.
--    The JRM tenant's policies span dates older than 2026-05, so without a
--    back-date the engine can't resolve rates for any historical policy and
--    silently produces $0 commissions. This UPDATE flattens every rate's
--    start_date to 2025-01-01 so the time window covers everything.
--
--    Idempotent: rows already at 2025-01-01 are unaffected.
-- -----------------------------------------------------------------------------
UPDATE public.agent_carrier_rates
   SET start_date = '2025-01-01'
 WHERE tenant_id = 'f4b44753-fe5f-4dc5-8353-a86dc2b03c40'
   AND start_date > '2025-01-01';

COMMIT;
