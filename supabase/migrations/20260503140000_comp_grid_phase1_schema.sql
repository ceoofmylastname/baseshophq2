-- =============================================================================
-- Baseshop HQ — Comp Grid Phase 1 (build step 2): schema
-- Target: Supabase project oarstmxbgdczytwzpyxj
-- Status: DRAFT — do not apply until user green-lights
--
-- Scope (per user spec 2026-05-03 + comp-grid-engine.md + comp-grid-build-spec.md):
--   Six tables created from scratch (this is a fresh build; agent_carrier_rates
--   is NOT an ALTER on an existing table — it's CREATEd with the new shape):
--     1. comp_grid_positions   — Agora levels (130 ... 80)
--     2. comp_grid_carriers    — carrier × product_type
--     3. comp_grid_products    — products under each carrier (with age band variants)
--     4. comp_grid_rates       — master grid cells (position × product → commission_pct)
--     5. agent_positions       — time-stamped position assignments per agent
--     6. agent_carrier_rates   — per-agent rates, source = 'position_default' | 'override'
--
-- Two new enum types:
--   - product_type ('life', 'annuity')
--   - rate_source  ('position_default', 'override')
--
-- Owner controls 100%. Agents read-only. RLS owner-only on every write across
-- every comp grid table. The is_owner_or_manager() pattern from the prior
-- environment is explicitly gone — manager-write is a security gap.
--
-- Engine reads only agent_carrier_rates. Master grid is the template, never
-- the fallback. Free-form decimal rates throughout (NUMERIC(6,2), 0.00 to
-- 200.00 percent, two-decimal precision; the prior 5%-step lock is removed).
--
-- AGENCY-ID-READY POSTURE
--   This migration follows the same pattern as Phase 1: single-agency by design,
--   constraint names chosen so the white-label migration is mechanical (drop
--   tenant-scoped uniques, replace with agency-scoped uniques).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------
CREATE TYPE public.product_type AS ENUM ('life', 'annuity');
CREATE TYPE public.rate_source  AS ENUM ('position_default', 'override');


-- -----------------------------------------------------------------------------
-- 2. comp_grid_positions
-- -----------------------------------------------------------------------------
-- The Agora ladder (130 Division Executive ... 80 Associate). Owner-editable.
-- position_code is the stable identifier and never changes. position_name and
-- sort_order are editable. is_commissioned = false skips rate templating
-- (used for 80 Associate per acceptance criterion #11).
CREATE TABLE public.comp_grid_positions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    position_code   TEXT NOT NULL,
    position_name   TEXT NOT NULL,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    is_commissioned BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT comp_grid_positions_unique_code_per_tenant UNIQUE (tenant_id, position_code)
);

COMMENT ON COLUMN public.comp_grid_positions.position_code IS
    'Stable identifier (e.g. "100", "115"). Never changes after creation.';
COMMENT ON COLUMN public.comp_grid_positions.is_commissioned IS
    'False for non-commissioned training positions (e.g. 80 Associate). Templating engine skips agents at non-commissioned positions.';


-- -----------------------------------------------------------------------------
-- 3. comp_grid_carriers
-- -----------------------------------------------------------------------------
-- Carrier × product_type. North American appears in both Life and Annuity as
-- two separate rows; the unique constraint allows it. F&G also dual-listed.
CREATE TABLE public.comp_grid_carriers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    carrier_name    TEXT NOT NULL,
    product_type    public.product_type NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT comp_grid_carriers_unique_per_tenant UNIQUE (tenant_id, carrier_name, product_type)
);


-- -----------------------------------------------------------------------------
-- 4. comp_grid_products
-- -----------------------------------------------------------------------------
-- Products under each carrier. Age band variants ("Age 0-60", "Age 76-80") and
-- the Lincoln TermAccelerator 20&30 Bonus row (variant = 'Bonus') are stored
-- as separate rows.
--
-- Unique uses NULLS NOT DISTINCT (PG 15+) so two rows with NULL variants and
-- the same product_name collide as duplicates — without this, NULL is treated
-- as distinct and the constraint would let through dupes.
--
-- has_bonus_column flags products that have a separate Bonus variant row to
-- look up and sum (only Lincoln TermAccelerator 20&30; the Bonus variant
-- itself has has_bonus_column = false).
--
-- product_type mirrors the parent carrier's product_type for query convenience
-- (avoids a JOIN on read-heavy paths). A trigger keeps it in sync.
--
-- product_subtype handles edge cases (e.g. 'ah' for Mutual of Omaha Disability
-- Income, which is Accident & Health, not Life — stored on the Life grid for
-- convenience but tagged so downstream systems can filter).
CREATE TABLE public.comp_grid_products (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    carrier_id         UUID NOT NULL REFERENCES public.comp_grid_carriers(id) ON DELETE RESTRICT,
    product_name       TEXT NOT NULL,
    product_variant    TEXT,                                          -- nullable
    product_type       public.product_type NOT NULL,                  -- mirrored from carrier
    has_bonus_column   BOOLEAN NOT NULL DEFAULT FALSE,
    product_subtype    TEXT,                                          -- e.g. 'ah'
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT comp_grid_products_unique_per_carrier
        UNIQUE NULLS NOT DISTINCT (tenant_id, carrier_id, product_name, product_variant)
);

COMMENT ON COLUMN public.comp_grid_products.product_variant IS
    'Nullable. Used for age bands ("Age 0-60", "Age 76-80") and Lincoln Bonus variant ("Bonus"). NULL means "the canonical product, no variant breakdown."';
COMMENT ON COLUMN public.comp_grid_products.has_bonus_column IS
    'True only on parent products that have a separate Bonus variant row to sum (currently only Lincoln TermAccelerator 20&30). The Bonus variant itself has this set to FALSE.';
COMMENT ON COLUMN public.comp_grid_products.product_subtype IS
    'Optional cross-cutting tag. e.g. "ah" for Accident & Health products stored on the Life grid (Mutual of Omaha Disability Income).';


-- -----------------------------------------------------------------------------
-- 5. comp_grid_rates  — the master grid cells
-- -----------------------------------------------------------------------------
-- Time-stamped: rate updates write a new row with a new effective_date and
-- close the prior row by setting end_date. Direct UPDATE of commission_pct is
-- blocked by a trigger (see immutability enforcement below). Other column
-- updates (end_date, schedule_code) are allowed.
--
-- commission_pct is NUMERIC(6,2) in PERCENTAGE units. e.g. 100.00 means 100%,
-- 7.50 means 7.5%, 87.50 means 87.5%. Bounds: 0.00 to 200.00. The math layer
-- divides by 100 to get the multiplier.
CREATE TABLE public.comp_grid_rates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    position_id     UUID NOT NULL REFERENCES public.comp_grid_positions(id) ON DELETE RESTRICT,
    product_id      UUID NOT NULL REFERENCES public.comp_grid_products(id)  ON DELETE RESTRICT,
    commission_pct  NUMERIC(6,2) NOT NULL CHECK (commission_pct >= 0 AND commission_pct <= 200),
    schedule_code   TEXT,
    effective_date  DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date        DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    CONSTRAINT comp_grid_rates_unique_open_cell
        UNIQUE (tenant_id, position_id, product_id, effective_date),
    CONSTRAINT comp_grid_rates_date_order
        CHECK (end_date IS NULL OR end_date >= effective_date)
);


-- -----------------------------------------------------------------------------
-- 6. agent_positions  — time-stamped assignments
-- -----------------------------------------------------------------------------
-- Exactly one row per agent with end_date IS NULL at any time (partial unique
-- index below). Promotions close the open row and insert a new one.
CREATE TABLE public.agent_positions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    agent_id        UUID NOT NULL REFERENCES public.agents(id)  ON DELETE CASCADE,
    position_id     UUID NOT NULL REFERENCES public.comp_grid_positions(id) ON DELETE RESTRICT,
    start_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date        DATE,
    assigned_by     UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT agent_positions_date_order
        CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE UNIQUE INDEX agent_positions_one_active_per_agent
    ON public.agent_positions (agent_id) WHERE end_date IS NULL;


-- -----------------------------------------------------------------------------
-- 7. agent_carrier_rates  — per-agent rates (engine reads only this)
-- -----------------------------------------------------------------------------
-- Per-agent rate per product. source = 'position_default' for templated rows,
-- 'override' for owner-edited cells. templated_from_position_id and
-- templated_at record the provenance of position_default rows.
--
-- product_id FK to comp_grid_products. carrier is derivable via JOIN through
-- comp_grid_products → comp_grid_carriers (no denormalized carrier_id).
--
-- rate is NUMERIC(6,2) in PERCENTAGE units (matches comp_grid_rates).
-- Free-form decimal, no 5%-step lock. Bounds 0.00 to 200.00.
--
-- Time-stamped: rate change writes a new row with a new start_date and closes
-- the prior row's end_date.
CREATE TABLE public.agent_carrier_rates (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    agent_id                    UUID NOT NULL REFERENCES public.agents(id)  ON DELETE CASCADE,
    product_id                  UUID NOT NULL REFERENCES public.comp_grid_products(id) ON DELETE RESTRICT,
    rate                        NUMERIC(6,2) NOT NULL CHECK (rate >= 0 AND rate <= 200),
    source                      public.rate_source NOT NULL DEFAULT 'position_default',
    templated_from_position_id  UUID REFERENCES public.comp_grid_positions(id) ON DELETE SET NULL,
    templated_at                TIMESTAMPTZ,
    start_date                  DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date                    DATE,
    set_by_user_id              UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT agent_carrier_rates_unique_open_row
        UNIQUE (tenant_id, agent_id, product_id, start_date),
    CONSTRAINT agent_carrier_rates_date_order
        CHECK (end_date IS NULL OR end_date >= start_date)
);


-- -----------------------------------------------------------------------------
-- 8. Indexes (FK coverage + engine read paths)
-- -----------------------------------------------------------------------------

-- comp_grid_positions
CREATE INDEX comp_grid_positions_tenant       ON public.comp_grid_positions (tenant_id);
CREATE INDEX comp_grid_positions_sort         ON public.comp_grid_positions (tenant_id, sort_order DESC) WHERE is_active = TRUE;

-- comp_grid_carriers
CREATE INDEX comp_grid_carriers_tenant_type   ON public.comp_grid_carriers (tenant_id, product_type) WHERE is_active = TRUE;

-- comp_grid_products
CREATE INDEX comp_grid_products_tenant        ON public.comp_grid_products (tenant_id);
CREATE INDEX comp_grid_products_carrier       ON public.comp_grid_products (carrier_id);
CREATE INDEX comp_grid_products_tenant_type   ON public.comp_grid_products (tenant_id, product_type) WHERE is_active = TRUE;

-- comp_grid_rates  — engine read path
CREATE INDEX comp_grid_rates_tenant           ON public.comp_grid_rates (tenant_id);
CREATE INDEX comp_grid_rates_position         ON public.comp_grid_rates (position_id);
CREATE INDEX comp_grid_rates_product          ON public.comp_grid_rates (product_id);
CREATE INDEX comp_grid_rates_engine_lookup    ON public.comp_grid_rates (tenant_id, position_id, product_id, effective_date DESC);
CREATE INDEX comp_grid_rates_created_by       ON public.comp_grid_rates (created_by);

-- agent_positions  — time-stamped position lookups (engine: "what was the agent's position at policy_date?")
CREATE INDEX agent_positions_tenant           ON public.agent_positions (tenant_id);
CREATE INDEX agent_positions_position         ON public.agent_positions (position_id);
CREATE INDEX agent_positions_agent_dates      ON public.agent_positions (agent_id, start_date, end_date);
CREATE INDEX agent_positions_assigned_by      ON public.agent_positions (assigned_by);

-- agent_carrier_rates  — engine hot path (the only table the engine reads)
CREATE INDEX agent_carrier_rates_tenant       ON public.agent_carrier_rates (tenant_id);
CREATE INDEX agent_carrier_rates_product      ON public.agent_carrier_rates (product_id);
CREATE INDEX agent_carrier_rates_templated_from ON public.agent_carrier_rates (templated_from_position_id);
CREATE INDEX agent_carrier_rates_set_by       ON public.agent_carrier_rates (set_by_user_id);
CREATE INDEX agent_carrier_rates_engine_lookup
    ON public.agent_carrier_rates (tenant_id, agent_id, product_id, start_date DESC);

-- Partial unique indexes: enforce "exactly one open window per key."
-- The base unique constraints prevent duplicate rows on the same start/effective
-- date, but without these, two rows with end_date IS NULL could exist for the
-- same cell. Same pattern as agent_positions_one_active_per_agent.
--
-- (position_id, product_id) and (agent_id, product_id) implicitly tenant-scope
-- via FK chain — a position_id belongs to one tenant, an agent_id belongs to
-- one tenant — so tenant_id is omitted for a tighter index.
CREATE UNIQUE INDEX comp_grid_rates_one_active_per_cell
    ON public.comp_grid_rates (position_id, product_id) WHERE end_date IS NULL;

CREATE UNIQUE INDEX agent_carrier_rates_one_active_per_product
    ON public.agent_carrier_rates (agent_id, product_id) WHERE end_date IS NULL;


-- -----------------------------------------------------------------------------
-- 9. Triggers
-- -----------------------------------------------------------------------------

-- updated_at on every table that has it (set_updated_at exists from Phase 1)
CREATE TRIGGER comp_grid_positions_updated_at BEFORE UPDATE ON public.comp_grid_positions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER comp_grid_carriers_updated_at BEFORE UPDATE ON public.comp_grid_carriers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER comp_grid_products_updated_at BEFORE UPDATE ON public.comp_grid_products
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER agent_carrier_rates_updated_at BEFORE UPDATE ON public.agent_carrier_rates
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- comp_grid_rates has no updated_at (it's append-only by design — see immutability trigger below)


-- Sync comp_grid_products.product_type from parent carrier.
-- Prevents drift when an owner reassigns a product to a different carrier.
CREATE OR REPLACE FUNCTION public.sync_comp_grid_product_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_parent_type public.product_type;
BEGIN
    SELECT product_type INTO v_parent_type
    FROM public.comp_grid_carriers
    WHERE id = NEW.carrier_id;

    IF v_parent_type IS NULL THEN
        RAISE EXCEPTION 'comp_grid_products.carrier_id % does not exist', NEW.carrier_id;
    END IF;

    NEW.product_type := v_parent_type;
    RETURN NEW;
END;
$$;

CREATE TRIGGER comp_grid_products_sync_type_ins
    BEFORE INSERT ON public.comp_grid_products
    FOR EACH ROW EXECUTE FUNCTION public.sync_comp_grid_product_type();

CREATE TRIGGER comp_grid_products_sync_type_upd
    BEFORE UPDATE OF carrier_id ON public.comp_grid_products
    FOR EACH ROW EXECUTE FUNCTION public.sync_comp_grid_product_type();


-- Block direct UPDATE of commission_pct on comp_grid_rates.
-- Rate updates must INSERT a new row with a new effective_date and close the
-- prior row's end_date. Updates to schedule_code, end_date, etc. remain allowed.
--
-- NOTE: the user spec said "warns" — implementing as a hard block (RAISE
-- EXCEPTION) because a non-blocking warning would silently allow drift. If you
-- prefer a soft warn instead, swap RAISE EXCEPTION → RAISE WARNING and remove
-- the RETURN OLD line; the trigger still runs, the user gets a server message,
-- but the UPDATE proceeds.
CREATE OR REPLACE FUNCTION public.enforce_comp_grid_rate_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.commission_pct IS DISTINCT FROM OLD.commission_pct THEN
        RAISE EXCEPTION
            'Direct UPDATE of comp_grid_rates.commission_pct is not allowed. '
            'Insert a new row with a later effective_date and close the prior '
            'row by setting end_date.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER comp_grid_rates_block_pct_update
    BEFORE UPDATE OF commission_pct ON public.comp_grid_rates
    FOR EACH ROW EXECUTE FUNCTION public.enforce_comp_grid_rate_immutability();


-- Lock new function grants (anon/authenticated cannot call internal triggers via RPC)
REVOKE EXECUTE ON FUNCTION public.sync_comp_grid_product_type()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_comp_grid_rate_immutability() FROM PUBLIC, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 10. RLS policies
-- -----------------------------------------------------------------------------
-- Two patterns:
--   (A) Master grid tables (comp_grid_*): tenant-scoped read for all authenticated
--       agents in the tenant; owner-only writes.
--   (B) Per-agent tables (agent_positions, agent_carrier_rates): tenant + view-down
--       reads via can_view_agent(); owner-only writes.

-- --- comp_grid_positions ---
ALTER TABLE public.comp_grid_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY comp_grid_positions_select_tenant ON public.comp_grid_positions FOR SELECT
    TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE POLICY comp_grid_positions_insert_owner ON public.comp_grid_positions FOR INSERT
    TO authenticated WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY comp_grid_positions_update_owner ON public.comp_grid_positions FOR UPDATE
    TO authenticated
    USING      (tenant_id = public.current_tenant_id() AND public.is_owner())
    WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY comp_grid_positions_delete_owner ON public.comp_grid_positions FOR DELETE
    TO authenticated USING (tenant_id = public.current_tenant_id() AND public.is_owner());

-- --- comp_grid_carriers ---
ALTER TABLE public.comp_grid_carriers ENABLE ROW LEVEL SECURITY;

CREATE POLICY comp_grid_carriers_select_tenant ON public.comp_grid_carriers FOR SELECT
    TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE POLICY comp_grid_carriers_insert_owner ON public.comp_grid_carriers FOR INSERT
    TO authenticated WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY comp_grid_carriers_update_owner ON public.comp_grid_carriers FOR UPDATE
    TO authenticated
    USING      (tenant_id = public.current_tenant_id() AND public.is_owner())
    WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY comp_grid_carriers_delete_owner ON public.comp_grid_carriers FOR DELETE
    TO authenticated USING (tenant_id = public.current_tenant_id() AND public.is_owner());

-- --- comp_grid_products ---
ALTER TABLE public.comp_grid_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY comp_grid_products_select_tenant ON public.comp_grid_products FOR SELECT
    TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE POLICY comp_grid_products_insert_owner ON public.comp_grid_products FOR INSERT
    TO authenticated WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY comp_grid_products_update_owner ON public.comp_grid_products FOR UPDATE
    TO authenticated
    USING      (tenant_id = public.current_tenant_id() AND public.is_owner())
    WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY comp_grid_products_delete_owner ON public.comp_grid_products FOR DELETE
    TO authenticated USING (tenant_id = public.current_tenant_id() AND public.is_owner());

-- --- comp_grid_rates ---
ALTER TABLE public.comp_grid_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY comp_grid_rates_select_tenant ON public.comp_grid_rates FOR SELECT
    TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE POLICY comp_grid_rates_insert_owner ON public.comp_grid_rates FOR INSERT
    TO authenticated WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY comp_grid_rates_update_owner ON public.comp_grid_rates FOR UPDATE
    TO authenticated
    USING      (tenant_id = public.current_tenant_id() AND public.is_owner())
    WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY comp_grid_rates_delete_owner ON public.comp_grid_rates FOR DELETE
    TO authenticated USING (tenant_id = public.current_tenant_id() AND public.is_owner());

-- --- agent_positions  (per-agent, view-down reads) ---
ALTER TABLE public.agent_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_positions_select_visible ON public.agent_positions FOR SELECT
    TO authenticated
    USING (tenant_id = public.current_tenant_id() AND public.can_view_agent(agent_id));

CREATE POLICY agent_positions_insert_owner ON public.agent_positions FOR INSERT
    TO authenticated WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY agent_positions_update_owner ON public.agent_positions FOR UPDATE
    TO authenticated
    USING      (tenant_id = public.current_tenant_id() AND public.is_owner())
    WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY agent_positions_delete_owner ON public.agent_positions FOR DELETE
    TO authenticated USING (tenant_id = public.current_tenant_id() AND public.is_owner());

-- --- agent_carrier_rates  (per-agent, view-down reads) ---
ALTER TABLE public.agent_carrier_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_carrier_rates_select_visible ON public.agent_carrier_rates FOR SELECT
    TO authenticated
    USING (tenant_id = public.current_tenant_id() AND public.can_view_agent(agent_id));

CREATE POLICY agent_carrier_rates_insert_owner ON public.agent_carrier_rates FOR INSERT
    TO authenticated WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY agent_carrier_rates_update_owner ON public.agent_carrier_rates FOR UPDATE
    TO authenticated
    USING      (tenant_id = public.current_tenant_id() AND public.is_owner())
    WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY agent_carrier_rates_delete_owner ON public.agent_carrier_rates FOR DELETE
    TO authenticated USING (tenant_id = public.current_tenant_id() AND public.is_owner());


-- -----------------------------------------------------------------------------
-- 11. Realtime publication
-- -----------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.comp_grid_positions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.comp_grid_carriers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.comp_grid_products;
ALTER PUBLICATION supabase_realtime ADD TABLE public.comp_grid_rates;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_positions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_carrier_rates;


-- -----------------------------------------------------------------------------
-- 12. Verification
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_count INTEGER;
    v_table TEXT;
    v_row_count INTEGER;
BEGIN
    -- (a) Six tables exist
    FOREACH v_table IN ARRAY ARRAY[
        'comp_grid_positions', 'comp_grid_carriers', 'comp_grid_products',
        'comp_grid_rates', 'agent_positions', 'agent_carrier_rates'
    ]
    LOOP
        ASSERT to_regclass('public.' || v_table) IS NOT NULL,
            format('table public.%s missing', v_table);
    END LOOP;

    -- (b) Both enums exist
    ASSERT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_type' AND typnamespace = 'public'::regnamespace),
        'product_type enum missing';
    ASSERT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rate_source' AND typnamespace = 'public'::regnamespace),
        'rate_source enum missing';

    -- (c) RLS enabled on all 6 tables
    SELECT COUNT(*) INTO v_count
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('comp_grid_positions', 'comp_grid_carriers', 'comp_grid_products',
                        'comp_grid_rates', 'agent_positions', 'agent_carrier_rates')
      AND rowsecurity = TRUE;
    ASSERT v_count = 6, format('expected RLS on 6 tables, got %s', v_count);

    -- (d) 24 RLS policies (4 per table × 6 tables)
    SELECT COUNT(*) INTO v_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('comp_grid_positions', 'comp_grid_carriers', 'comp_grid_products',
                        'comp_grid_rates', 'agent_positions', 'agent_carrier_rates');
    ASSERT v_count = 24, format('expected 24 RLS policies, got %s', v_count);

    -- (e) Three partial unique indexes (one-open-window-per-key enforcement)
    SELECT COUNT(*) INTO v_count
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'agent_positions_one_active_per_agent',
        'comp_grid_rates_one_active_per_cell',
        'agent_carrier_rates_one_active_per_product'
      );
    ASSERT v_count = 3, format('expected 3 partial unique indexes, got %s', v_count);

    -- (f) Engine-path composite indexes
    ASSERT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'comp_grid_rates_engine_lookup'
    ), 'comp_grid_rates_engine_lookup index missing';
    ASSERT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'agent_carrier_rates_engine_lookup'
    ), 'agent_carrier_rates_engine_lookup index missing';

    -- (g) Triggers in place
    SELECT COUNT(*) INTO v_count
    FROM pg_trigger
    WHERE tgrelid IN (
        'public.comp_grid_positions'::regclass,
        'public.comp_grid_carriers'::regclass,
        'public.comp_grid_products'::regclass,
        'public.comp_grid_rates'::regclass,
        'public.agent_positions'::regclass,
        'public.agent_carrier_rates'::regclass
    ) AND NOT tgisinternal;
    -- Expected: 4 updated_at + 2 product_type sync + 1 rate immutability = 7
    ASSERT v_count = 7, format('expected 7 user triggers across comp grid tables, got %s', v_count);

    -- (h) Row counts: 0 in every table (clean state, ready for Phase 2 bootstrap)
    FOREACH v_table IN ARRAY ARRAY[
        'comp_grid_positions', 'comp_grid_carriers', 'comp_grid_products',
        'comp_grid_rates', 'agent_positions', 'agent_carrier_rates'
    ]
    LOOP
        EXECUTE format('SELECT COUNT(*) FROM public.%I', v_table) INTO v_row_count;
        ASSERT v_row_count = 0, format('table public.%s should be empty, has %s rows', v_table, v_row_count);
    END LOOP;

    RAISE NOTICE 'Comp Grid Phase 1 verification passed.';
    RAISE NOTICE '  6 tables, 2 enums, 6 RLS-enabled, 24 policies, 7 triggers, 3 partial unique indexes, 0 rows everywhere';
END $$;

COMMIT;
