-- Phase 10E: Contracts page (10E.1 schema + RPCs, 10E.2 UI in src/).
--
-- APPLIED 2026-05-04 to project oarstmxbgdczytwzpyxj.
--
-- Adds 3 columns to agent_contracts (referral_code, loa_upline_agent_id, status)
-- and 2 SECURITY INVOKER RPCs for upsert + delete. RLS enforcement is handled
-- by the existing Phase 4b1 policies — agents can only INSERT/UPDATE rows
-- where agent_id = auth.uid() (WITH CHECK gates both sides), owners can do
-- anything in their tenant. DELETE remains owner-only by design.
--
-- The upsert RPC also enforces a server-side self-reference guard:
-- loa_upline_agent_id MAY NOT equal agent_id. The client-side picker walks
-- the transitive LOA chain to surface the same error early; this server
-- guard is the backstop.
--
-- Refs: wiki/contracts-page.md, schema-spec.md, carrier-ingest-pipeline.md.

BEGIN;

-- ============================================================================
-- 1. Schema additions
-- ============================================================================
-- DEFAULT 'Active' on the new status column means the 4 existing rows
-- (verified pre-apply via execute_sql) all become 'Active' — the only
-- sensible interpretation since all 4 already have effective_date set and
-- no end_date. The CHECK applies to future writes.
ALTER TABLE public.agent_contracts
    ADD COLUMN referral_code        TEXT,
    ADD COLUMN loa_upline_agent_id  UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    ADD COLUMN status               TEXT NOT NULL DEFAULT 'Active'
               CHECK (status IN ('Active','Pending','Terminated'));

CREATE INDEX agent_contracts_loa_upline ON public.agent_contracts (loa_upline_agent_id)
    WHERE loa_upline_agent_id IS NOT NULL;

COMMENT ON COLUMN public.agent_contracts.referral_code IS
    'Optional per-contract referral code (wiki gap analysis #13).';
COMMENT ON COLUMN public.agent_contracts.loa_upline_agent_id IS
    'For LOA contracts, the upline whose direct contract this agent writes under. NULL = direct pay. Cycles prevented client-side (picker) and server-side (upsert RPC).';
COMMENT ON COLUMN public.agent_contracts.status IS
    'Active | Pending | Terminated. Independent of effective_date/end_date so "Pending appointment" can exist before effective_date is known.';


-- ============================================================================
-- 2. upsert_agent_contract — SECURITY INVOKER (RLS does the work)
-- ============================================================================
-- Returns jsonb envelope. INSERT or UPDATE based on p_id.
--
-- Why SECURITY INVOKER: the existing Phase 4b1 RLS policies are correct and
-- gate both sides of UPDATE (USING + WITH CHECK), so an agent cannot rewrite
-- a row's agent_id to point to someone else. Re-implementing those checks
-- inside a SECURITY DEFINER body would create a second source of truth
-- that could drift. Trust the RLS, verify with smoke.
--
-- Server-side self-reference guard: loa_upline_agent_id <> agent_id. The
-- client picker also enforces this (and full transitive cycles); this is
-- defense in depth.
--
-- Tenant boundary: tenant_id is INSERTed from current_tenant_id() — never
-- accepted as a parameter. RLS double-checks via WITH CHECK.
CREATE OR REPLACE FUNCTION public.upsert_agent_contract(
    p_id                  uuid,    -- NULL = insert, non-NULL = update
    p_agent_id            uuid,
    p_carrier_id          uuid,
    p_writing_number      text,
    p_status              text     DEFAULT 'Active',
    p_effective_date      date     DEFAULT NULL,
    p_end_date            date     DEFAULT NULL,
    p_loa_upline_agent_id uuid     DEFAULT NULL,
    p_referral_code       text     DEFAULT NULL,
    p_notes               text     DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id uuid;
    v_id        uuid;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;

    -- Normalize whitespace; reject empty writing number outright
    p_writing_number := NULLIF(trim(p_writing_number), '');
    IF p_writing_number IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'writing_number_required');
    END IF;

    IF p_status NOT IN ('Active','Pending','Terminated') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'bad_status');
    END IF;

    IF p_loa_upline_agent_id IS NOT NULL AND p_loa_upline_agent_id = p_agent_id THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'loa_self_reference');
    END IF;

    IF p_id IS NULL THEN
        -- INSERT path. RLS will reject if agent_id ≠ auth.uid() AND not owner.
        BEGIN
            INSERT INTO public.agent_contracts (
                tenant_id, agent_id, carrier_id, writing_number, status,
                effective_date, end_date, loa_upline_agent_id, referral_code, notes
            ) VALUES (
                v_tenant_id, p_agent_id, p_carrier_id, p_writing_number, p_status,
                p_effective_date, p_end_date, p_loa_upline_agent_id, p_referral_code, p_notes
            )
            RETURNING id INTO v_id;
        EXCEPTION
            WHEN unique_violation THEN
                RETURN jsonb_build_object('success', false, 'error_code', 'writing_number_taken');
            WHEN insufficient_privilege THEN
                RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
            WHEN check_violation THEN
                RETURN jsonb_build_object('success', false, 'error_code', 'check_violation');
        END;
    ELSE
        -- UPDATE path. RLS USING gates the existing row; WITH CHECK gates the
        -- new values. Both must pass.
        BEGIN
            UPDATE public.agent_contracts
               SET agent_id            = p_agent_id,
                   carrier_id          = p_carrier_id,
                   writing_number      = p_writing_number,
                   status              = p_status,
                   effective_date      = p_effective_date,
                   end_date            = p_end_date,
                   loa_upline_agent_id = p_loa_upline_agent_id,
                   referral_code       = p_referral_code,
                   notes               = p_notes,
                   updated_at          = now()
             WHERE id = p_id
               AND tenant_id = v_tenant_id
            RETURNING id INTO v_id;
        EXCEPTION
            WHEN unique_violation THEN
                RETURN jsonb_build_object('success', false, 'error_code', 'writing_number_taken');
            WHEN insufficient_privilege THEN
                RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
            WHEN check_violation THEN
                RETURN jsonb_build_object('success', false, 'error_code', 'check_violation');
        END;

        IF v_id IS NULL THEN
            -- Either row doesn't exist OR RLS USING blocked it
            RETURN jsonb_build_object('success', false, 'error_code', 'not_found_or_forbidden');
        END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'contract_id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_agent_contract(
    uuid, uuid, uuid, text, text, date, date, uuid, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_agent_contract(
    uuid, uuid, uuid, text, text, date, date, uuid, text, text
) TO authenticated;


-- ============================================================================
-- 3. delete_agent_contract — SECURITY INVOKER
-- ============================================================================
-- RLS DELETE policy is owner-only (Phase 4b1 design choice). Agents calling
-- this on their own row will get not_found_or_forbidden, same as touching
-- someone else's row.
CREATE OR REPLACE FUNCTION public.delete_agent_contract(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id uuid;
    v_deleted   uuid;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;

    BEGIN
        DELETE FROM public.agent_contracts
         WHERE id = p_id
           AND tenant_id = v_tenant_id
        RETURNING id INTO v_deleted;
    EXCEPTION
        WHEN insufficient_privilege THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
    END;

    IF v_deleted IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'not_found_or_forbidden');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_agent_contract(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_agent_contract(uuid) TO authenticated;


-- ============================================================================
-- Verification
-- ============================================================================
DO $$
BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='agent_contracts' AND column_name='status'
    ), 'status column missing';

    ASSERT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='agent_contracts' AND column_name='referral_code'
    ), 'referral_code column missing';

    ASSERT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='agent_contracts' AND column_name='loa_upline_agent_id'
    ), 'loa_upline_agent_id column missing';

    ASSERT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'upsert_agent_contract'
    ), 'upsert_agent_contract missing';

    ASSERT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'delete_agent_contract'
    ), 'delete_agent_contract missing';

    RAISE NOTICE 'Phase 10E schema + RPC verification passed.';
END $$;

COMMIT;
