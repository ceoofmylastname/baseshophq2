-- =============================================================================
-- Baseshop HQ — Phase 4b-1: agent_contracts schema
-- Target: Supabase project oarstmxbgdczytwzpyxj
-- Status: DRAFT — do not apply until user green-lights
--
-- Holds the writing-number-to-agent mapping per carrier. This is the table
-- the carrier ingest pipeline matches against (writing-number-first per the
-- carrier-ingest-pipeline wiki rule).
--
-- Uniqueness:
--   UNIQUE (tenant_id, carrier_id, writing_number) — no two agents claim the
--   same writing number on the same carrier (enforced).
--   NOT unique on (agent_id, carrier_id) — one agent can hold multiple
--   writing numbers on the same carrier (multiple contract levels across
--   products is real-world).
--
-- RLS (per the 2026-05-09 wiki entry):
--   SELECT — tenant + view-down via can_view_agent (agent sees their own
--            contracts plus downline; owner sees all)
--   INSERT — agent_id matches calling auth.uid() OR is_owner()
--   UPDATE — same as INSERT
--   DELETE — is_owner() only (no agent self-delete; prevents silent
--            contract loss + downstream orphans)
--
-- Trigger that auto-links orphan policies on contract insert lives in the
-- next migration (phase4b1_orphan_auto_link.sql).
-- =============================================================================

BEGIN;

CREATE TABLE public.agent_contracts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    agent_id        UUID NOT NULL REFERENCES public.agents(id)  ON DELETE CASCADE,
    carrier_id      UUID NOT NULL REFERENCES public.comp_grid_carriers(id) ON DELETE RESTRICT,
    writing_number  TEXT NOT NULL,
    effective_date  DATE,
    end_date        DATE,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT agent_contracts_unique_writing_per_carrier
        UNIQUE (tenant_id, carrier_id, writing_number),
    CONSTRAINT agent_contracts_date_order
        CHECK (end_date IS NULL OR end_date >= effective_date)
);

COMMENT ON COLUMN public.agent_contracts.writing_number IS
    'The carrier-issued writing number for this agent on this carrier. The orphan auto-link trigger matches on this value vs policies.agent_number.';

CREATE INDEX agent_contracts_tenant_carrier_writing
    ON public.agent_contracts (tenant_id, carrier_id, writing_number);
CREATE INDEX agent_contracts_agent
    ON public.agent_contracts (agent_id);
CREATE INDEX agent_contracts_tenant_agent
    ON public.agent_contracts (tenant_id, agent_id);

CREATE TRIGGER agent_contracts_updated_at
    BEFORE UPDATE ON public.agent_contracts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_contracts_select_visible ON public.agent_contracts FOR SELECT
    TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        AND public.can_view_agent(agent_id)
    );

-- Agents can create / update their OWN writing numbers; owner can do all
CREATE POLICY agent_contracts_insert_self_or_owner ON public.agent_contracts FOR INSERT
    TO authenticated
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND (agent_id = auth.uid() OR public.is_owner())
    );

CREATE POLICY agent_contracts_update_self_or_owner ON public.agent_contracts FOR UPDATE
    TO authenticated
    USING      (tenant_id = public.current_tenant_id() AND (agent_id = auth.uid() OR public.is_owner()))
    WITH CHECK (tenant_id = public.current_tenant_id() AND (agent_id = auth.uid() OR public.is_owner()));

-- Owner only delete (no agent self-delete; prevents silent contract loss)
CREATE POLICY agent_contracts_delete_owner ON public.agent_contracts FOR DELETE
    TO authenticated
    USING (tenant_id = public.current_tenant_id() AND public.is_owner());

ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_contracts;

DO $$
DECLARE
    v_count INTEGER;
BEGIN
    ASSERT to_regclass('public.agent_contracts') IS NOT NULL, 'agent_contracts missing';

    SELECT COUNT(*) INTO v_count FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'agent_contracts' AND rowsecurity = TRUE;
    ASSERT v_count = 1, 'RLS not enabled on agent_contracts';

    SELECT COUNT(*) INTO v_count FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'agent_contracts';
    ASSERT v_count = 4, format('expected 4 RLS policies on agent_contracts, got %s', v_count);

    ASSERT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'agent_contracts'
    ), 'agent_contracts not in supabase_realtime';

    RAISE NOTICE 'Phase 4b-1 agent_contracts schema verification passed.';
END $$;

COMMIT;
