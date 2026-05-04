-- =============================================================================
-- Baseshop HQ — Phase 4b-1: orphan auto-link trigger
-- Target: Supabase project oarstmxbgdczytwzpyxj
-- Status: DRAFT — do not apply until user green-lights
--
-- AFTER INSERT trigger on agent_contracts. When a new contract row lands,
-- finds all orphan policies in the same tenant where:
--   - agent_id IS NULL
--   - agent_number = NEW.writing_number
--   - carrier matches NEW.carrier_id (resolved to carrier_name)
--
-- For each match:
--   1. UPDATE policies SET agent_id = NEW.agent_id
--   2. INSERT a policy_status_history row (status unchanged, but a meaningful
--      attach event worth recording) with source='orphan_auto_link'. The
--      standard status-change trigger does NOT fire here because status is
--      DISTINCT FROM is false; we write the history row directly.
--   3. PERFORM recalculate_policy_payouts(policy_id) — engine writes
--      payouts for the freshly-attached agent + chain. The recalc-on-issued
--      trigger does NOT fire on the agent_id UPDATE (status unchanged), so
--      we explicitly invoke the engine here regardless of policy status.
--
-- Multi-orphan case: a single contract INSERT can attach multiple orphans
-- (same writing_number across multiple imported policies). The trigger
-- iterates all matches in one INSERT.
--
-- Carrier matching: uses carrier_name string equality. Handles the
-- dual-listed carrier case (e.g. North American Life vs Annuity have
-- separate carrier_id rows) — both contracts can match the same orphan if
-- the writing number happens to overlap, but the first attach wins (second
-- is a no-op on a now-non-orphan policy).
--
-- PRODUCTION SCALE NOTE — async dispatcher:
--   This trigger runs the engine inline once per attached orphan. For Phase
--   4b-1 testing this is fine. At production scale (one contract attaching
--   dozens of orphans on bulk CSV import), the inline recalc loop blocks the
--   contract INSERT for the duration. Same swap-the-dispatcher fix as
--   policies_recalc_on_issued: replace the PERFORM with
--   `PERFORM pg_notify('policy_recalc_queue', v_orphan_id::text)` and have a
--   Supabase Edge Function listen on the channel and call the engine RPC out
--   of band. The engine itself doesn't change.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.agent_contracts_auto_link_orphans()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_carrier_name   TEXT;
    v_attached_count INT := 0;
    v_orphan_id      UUID;
BEGIN
    SELECT carrier_name INTO v_carrier_name
    FROM public.comp_grid_carriers
    WHERE id = NEW.carrier_id;

    IF v_carrier_name IS NULL THEN
        -- Defensive — RESTRICT FK on carrier_id makes this unreachable
        RAISE EXCEPTION 'comp_grid_carriers % does not exist', NEW.carrier_id;
    END IF;

    -- Note: the standard policies_record_status_change trigger does NOT fire
    -- here (we only UPDATE agent_id, not status), so a session-var-based
    -- source tag would be dead code. We INSERT into policy_status_history
    -- directly below with the literal 'orphan_auto_link' source value.

    FOR v_orphan_id IN
        SELECT id FROM public.policies
        WHERE tenant_id    = NEW.tenant_id
          AND agent_id IS NULL
          AND agent_number = NEW.writing_number
          AND carrier      = v_carrier_name
    LOOP
        -- Attach the orphan
        UPDATE public.policies
        SET agent_id = NEW.agent_id
        WHERE id = v_orphan_id;

        -- Log the attach event (status unchanged, so the standard trigger
        -- skipped this; we write directly)
        INSERT INTO public.policy_status_history (
            tenant_id, policy_id, status, source, notes
        )
        SELECT
            tenant_id, id, status, 'orphan_auto_link'::public.policy_status_source,
            format('orphan attached via agent_contracts.id = %s', NEW.id)
        FROM public.policies WHERE id = v_orphan_id;

        -- Engine recompute (status didn't change so recalc-on-issued didn't fire)
        PERFORM public.recalculate_policy_payouts(v_orphan_id);

        v_attached_count := v_attached_count + 1;
    END LOOP;

    -- Telemetry only — RAISE NOTICE goes to server logs
    IF v_attached_count > 0 THEN
        RAISE NOTICE 'agent_contracts_auto_link_orphans: contract % attached % orphan(s)',
            NEW.id, v_attached_count;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER agent_contracts_auto_link_orphans
    AFTER INSERT ON public.agent_contracts
    FOR EACH ROW EXECUTE FUNCTION public.agent_contracts_auto_link_orphans();

REVOKE EXECUTE ON FUNCTION public.agent_contracts_auto_link_orphans()
    FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'agent_contracts_auto_link_orphans' AND pronamespace = 'public'::regnamespace
    ), 'agent_contracts_auto_link_orphans function missing';

    ASSERT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'agent_contracts_auto_link_orphans'
    ), 'agent_contracts_auto_link_orphans trigger missing';

    RAISE NOTICE 'Phase 4b-1 orphan auto-link trigger verification passed.';
END $$;

COMMIT;
