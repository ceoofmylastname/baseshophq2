-- =============================================================================
-- Baseshop HQ — Phase 4a: policies + status history + commissions schema
-- Target: Supabase project oarstmxbgdczytwzpyxj
-- Status: DRAFT — do not apply until user green-lights
--
-- Three tables, two enums:
--   policies                — central policy ledger
--   policy_status_history   — append-only status transitions
--   policy_commissions      — computed payouts per policy per recipient
--   policy_status enum      — Draft, Submitted, Pending, Issued, Issue Paid,
--                             Terminated, Potential Lapse
--   policy_status_source    — manual, csv_import, carrier_feed,
--                             orphan_auto_link, engine_recalc
--
-- RLS: owner-only writes everywhere. Reads scoped by tenant + view-down via
-- can_view_agent on agent_id (matches agent_positions and agent_carrier_rates
-- pattern from Phase 1 + 3a).
--
-- Realtime: all three tables published so policy status changes propagate live
-- to the upline chain (per realtime-updates-and-hierarchy-cascade wiki).
--
-- Engine + triggers in the next migration (phase4a_commission_engine.sql).
-- Carrier ingest pipeline is Phase 4b (deferred).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------
CREATE TYPE public.policy_status AS ENUM (
    'Draft', 'Submitted', 'Pending', 'Issued', 'Issue Paid', 'Terminated', 'Potential Lapse'
);

CREATE TYPE public.policy_status_source AS ENUM (
    'manual', 'csv_import', 'carrier_feed', 'orphan_auto_link', 'engine_recalc'
);


-- -----------------------------------------------------------------------------
-- 2. policies
-- -----------------------------------------------------------------------------
-- Central ledger. Every insurance policy in the tenant.
--
-- agent_id is nullable for orphan policies (carrier statement row whose writing
-- number doesn't match any agent_contracts row yet — Phase 4b's auto-link
-- trigger backfills these once the matching contract appears).
--
-- product_id is nullable until canonicalization runs against the Phase 2 alias
-- map. Until then, the raw `product` TEXT field carries the value as-it-came.
-- The `carrier` TEXT field follows the same pattern; FK to comp_grid_carriers
-- is added in a later phase if needed.
--
-- agent_number is the carrier's writing number ON THE CSV ROW (denormalized
-- for the orphan auto-link path — see carrier-ingest-pipeline wiki). Stays
-- populated even after auto-link for forensic audit.
CREATE TABLE public.policies (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    policy_number               TEXT NOT NULL,
    agent_id                    UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    agent_number                TEXT,
    carrier                     TEXT,
    product                     TEXT,
    product_id                  UUID REFERENCES public.comp_grid_products(id) ON DELETE SET NULL,
    client_first_name           TEXT,
    client_last_name            TEXT,
    client_dob                  DATE,
    application_date            DATE,
    effective_date              DATE,
    annual_premium              NUMERIC(12,2),
    status                      public.policy_status NOT NULL DEFAULT 'Draft',
    commission_paid_amount      NUMERIC(12,2),
    commission_owed_amount      NUMERIC(12,2),
    notes                       TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT policies_unique_number_per_tenant UNIQUE (tenant_id, policy_number)
);

COMMENT ON COLUMN public.policies.agent_id IS
    'Writing agent. Nullable for orphan policies (CSV row whose writing number does not match any agent_contracts entry yet). Phase 4b auto-link trigger backfills.';
COMMENT ON COLUMN public.policies.agent_number IS
    'Carrier writing number from the source row. Stays populated after auto-link for forensic audit.';
COMMENT ON COLUMN public.policies.product_id IS
    'Resolved comp_grid_products.id. Nullable until canonicalization (Phase 4b) runs against the alias map.';

CREATE INDEX policies_tenant            ON public.policies (tenant_id);
CREATE INDEX policies_agent             ON public.policies (agent_id);
CREATE INDEX policies_tenant_status     ON public.policies (tenant_id, status);
CREATE INDEX policies_orphan_match      ON public.policies (tenant_id, agent_number, carrier) WHERE agent_id IS NULL;
CREATE INDEX policies_application_date  ON public.policies (tenant_id, application_date);


-- -----------------------------------------------------------------------------
-- 3. policy_status_history
-- -----------------------------------------------------------------------------
-- Append-only log of every status transition.
CREATE TABLE public.policy_status_history (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    policy_id    UUID NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
    status       public.policy_status NOT NULL,
    source       public.policy_status_source NOT NULL DEFAULT 'manual',
    changed_by   UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX policy_status_history_tenant_time ON public.policy_status_history (tenant_id, created_at DESC);
CREATE INDEX policy_status_history_policy_time ON public.policy_status_history (policy_id, created_at DESC);


-- -----------------------------------------------------------------------------
-- 4. policy_commissions
-- -----------------------------------------------------------------------------
-- Computed payouts per policy per recipient (writing agent + each upline).
-- UNIQUE (policy_id, agent_id) so the engine can UPSERT cleanly on re-run.
--
-- All snapshot fields (position_id, rate, schedule_code) are captured at the
-- policy's application_date — engine reads agent_positions + agent_carrier_rates
-- as-of that date.
CREATE TABLE public.policy_commissions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    policy_id           UUID NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
    agent_id            UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    position_id         UUID REFERENCES public.comp_grid_positions(id) ON DELETE SET NULL,
    rate                NUMERIC(6,2) NOT NULL CHECK (rate >= 0 AND rate <= 200),
    schedule_code       TEXT,
    amount              NUMERIC(14,2) NOT NULL,
    is_override         BOOLEAN NOT NULL DEFAULT FALSE,
    application_date    DATE NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    recalculated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT policy_commissions_unique_recipient UNIQUE (policy_id, agent_id)
);

CREATE INDEX policy_commissions_tenant       ON public.policy_commissions (tenant_id);
CREATE INDEX policy_commissions_policy       ON public.policy_commissions (policy_id);
CREATE INDEX policy_commissions_agent_app    ON public.policy_commissions (tenant_id, agent_id, application_date DESC);


-- -----------------------------------------------------------------------------
-- 5. updated_at trigger on policies
-- -----------------------------------------------------------------------------
CREATE TRIGGER policies_updated_at
    BEFORE UPDATE ON public.policies
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 6. RLS policies
-- -----------------------------------------------------------------------------

-- POLICIES (per-agent, view-down reads)
ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY policies_select_visible ON public.policies FOR SELECT
    TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        AND (agent_id IS NULL AND public.is_owner()  -- orphans visible to owner only
             OR agent_id IS NOT NULL AND public.can_view_agent(agent_id))
    );

CREATE POLICY policies_insert_owner ON public.policies FOR INSERT
    TO authenticated
    WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY policies_update_owner ON public.policies FOR UPDATE
    TO authenticated
    USING      (tenant_id = public.current_tenant_id() AND public.is_owner())
    WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY policies_delete_owner ON public.policies FOR DELETE
    TO authenticated
    USING (tenant_id = public.current_tenant_id() AND public.is_owner());


-- POLICY_STATUS_HISTORY (per-policy, view-down reads via JOIN to policies)
ALTER TABLE public.policy_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY policy_status_history_select_visible ON public.policy_status_history FOR SELECT
    TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        AND EXISTS (
            SELECT 1 FROM public.policies p
            WHERE p.id = policy_status_history.policy_id
              AND (p.agent_id IS NULL AND public.is_owner()
                   OR p.agent_id IS NOT NULL AND public.can_view_agent(p.agent_id))
        )
    );

CREATE POLICY policy_status_history_insert_owner ON public.policy_status_history FOR INSERT
    TO authenticated
    WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

-- No UPDATE / DELETE policies for status history — it's append-only.


-- POLICY_COMMISSIONS (per-recipient, view-down reads on agent_id)
ALTER TABLE public.policy_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY policy_commissions_select_visible ON public.policy_commissions FOR SELECT
    TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        AND public.can_view_agent(agent_id)
    );

CREATE POLICY policy_commissions_insert_owner ON public.policy_commissions FOR INSERT
    TO authenticated
    WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY policy_commissions_update_owner ON public.policy_commissions FOR UPDATE
    TO authenticated
    USING      (tenant_id = public.current_tenant_id() AND public.is_owner())
    WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY policy_commissions_delete_owner ON public.policy_commissions FOR DELETE
    TO authenticated
    USING (tenant_id = public.current_tenant_id() AND public.is_owner());


-- -----------------------------------------------------------------------------
-- 7. Realtime publication
-- -----------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.policies;
ALTER PUBLICATION supabase_realtime ADD TABLE public.policy_status_history;
ALTER PUBLICATION supabase_realtime ADD TABLE public.policy_commissions;


-- -----------------------------------------------------------------------------
-- 8. Verification
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Tables
    ASSERT to_regclass('public.policies')               IS NOT NULL, 'policies missing';
    ASSERT to_regclass('public.policy_status_history')  IS NOT NULL, 'policy_status_history missing';
    ASSERT to_regclass('public.policy_commissions')     IS NOT NULL, 'policy_commissions missing';

    -- Enums
    ASSERT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'policy_status' AND typnamespace = 'public'::regnamespace),
        'policy_status enum missing';
    ASSERT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'policy_status_source' AND typnamespace = 'public'::regnamespace),
        'policy_status_source enum missing';

    -- RLS enabled
    SELECT COUNT(*) INTO v_count
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('policies', 'policy_status_history', 'policy_commissions')
      AND rowsecurity = TRUE;
    ASSERT v_count = 3, format('expected RLS on 3 tables, got %s', v_count);

    -- Realtime
    SELECT COUNT(*) INTO v_count
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename IN ('policies', 'policy_status_history', 'policy_commissions');
    ASSERT v_count = 3, format('expected 3 tables in supabase_realtime, got %s', v_count);

    RAISE NOTICE 'Phase 4a schema verification passed.';
END $$;

COMMIT;
