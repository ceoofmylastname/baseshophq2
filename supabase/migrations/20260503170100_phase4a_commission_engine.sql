-- =============================================================================
-- Baseshop HQ — Phase 4a: commission engine + triggers
-- Target: Supabase project oarstmxbgdczytwzpyxj
-- Status: DRAFT — do not apply until user green-lights
--
-- Three artifacts:
--   1. recalculate_policy_payouts(p_policy_id) — the engine RPC
--   2. policies_record_status_change()         — trigger fn for status history
--   3. policies_recalc_on_issued()             — trigger fn for engine
--
-- KNOWN LIMITATION — time-stamped upline reassignment:
--
--   The chain walk follows agents.upline_agent_id (current state). It does
--   NOT consult a time-stamped upline history. If an agent's upline gets
--   reassigned (Bobby moves from Andy's leg to Carol's leg), backdated
--   policies will resolve through Bobby's CURRENT chain, not the chain that
--   existed at policy.application_date. Position rates ARE time-stamped via
--   agent_positions; only upline-membership is "current state."
--
--   Acceptable for now: no upline reassignments have happened in this build
--   yet, and the smoke tests verify backdated POSITION resolution (which
--   does work correctly via agent_positions windows).
--
--   Recommended fix path before the first production upline reassignment:
--     Option 1 (preferred): add upline_agent_id to agent_positions so upline
--                           is time-stamped alongside position. Same window
--                           lookup pattern; one history table.
--     Option 2: separate agent_upline_history table with start_date / end_date.
--
--   Track this in the deferred work list. Probably Phase 4b or Phase 5.
--
-- TRIGGER COVERAGE GAP — INSERT-as-'Issue Paid':
--
--   policies_recalc_on_issued only fires when status is INSERTed as 'Issued'
--   or UPDATEd from non-'Issued' → 'Issued'. INSERT-as-'Issue Paid' (e.g.
--   backfilling historical data, or a carrier statement landing as already
--   paid) does NOT trigger the engine. By design — the 95% path is correct
--   and we don't want spurious recalcs.
--
--   For backfill: call recalculate_policy_payouts(policy_id) directly (it's
--   exposed as a service-role RPC). Phase 5 UI can wire a "Recalculate
--   commissions" button on the policy detail page.
--
-- Engine algorithm (mirrors src/lib/commission-spread-calculator.ts):
--
--   Build the upline chain: writing agent at index 0, walk up via
--   agents.upline_agent_id with the standard cycle / depth-100 protection.
--
--   For each link in the chain (bottom up):
--     - Resolve the link's rate at the policy's application_date by joining
--       agent_carrier_rates on (agent_id, product_id) and the time-stamped
--       window. Sum the Lincoln Bonus variant rate when the parent product's
--       has_bonus_column flag is true.
--     - Treat NULL rate as 0% (don't break the chain).
--     - For the writing agent (index 0): payout = annual_premium × rate / 100.
--     - For each upline: payout = annual_premium × max(0, rate − high_water) / 100,
--       where high_water is the maximum rate of any agent BELOW this upline
--       in the chain that we've already computed. This is the "spread" math.
--     - Skip writing the row if the spread is zero or negative.
--
--   Write payouts to policy_commissions via INSERT ... ON CONFLICT DO UPDATE
--   so the engine is idempotent on re-run.
--
-- Triggers:
--   policies_record_status_change — AFTER INSERT/UPDATE on policies. Writes
--   one policy_status_history row when status changes. Source pulled from
--   `app.policy_status_source` session variable; defaults to 'manual'.
--
--   policies_recalc_on_issued — AFTER INSERT/UPDATE OF status. Calls the
--   engine RPC synchronously when status transitions TO 'Issued'. Phase 4a
--   keeps this sync for simplicity; the production async pattern (pg_notify
--   + Edge Function listener) is documented in the function comment and can
--   swap in later for higher throughput without changing the engine itself.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. recalculate_policy_payouts
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_policy_payouts(p_policy_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_policy            RECORD;
    v_bonus_product_id  UUID;
    v_chain             UUID[];
    v_idx               INT;
    v_agent_id          UUID;
    v_position_id       UUID;
    v_rate              NUMERIC;
    v_schedule_code     TEXT;
    v_bonus_rate        NUMERIC;
    v_high_water        NUMERIC := 0;
    v_spread            NUMERIC;
    v_amount            NUMERIC;
    v_is_override       BOOLEAN;
    v_writing_payout    JSONB;
    v_upline_payouts    JSONB := '[]'::jsonb;
    v_total_paid        NUMERIC := 0;
    v_errors            JSONB := '[]'::jsonb;
    v_chain_len         INT;
BEGIN
    -- 1. Read the policy
    SELECT * INTO v_policy FROM public.policies WHERE id = p_policy_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'policy % does not exist', p_policy_id;
    END IF;

    -- 2. Validate required fields. Return structured errors (don't throw).
    IF v_policy.agent_id IS NULL THEN
        RETURN jsonb_build_object(
            'policy_id', p_policy_id,
            'errors', jsonb_build_array(jsonb_build_object('code', 'no_writing_agent'))
        );
    END IF;
    IF v_policy.product_id IS NULL THEN
        RETURN jsonb_build_object(
            'policy_id', p_policy_id,
            'errors', jsonb_build_array(jsonb_build_object('code', 'no_product_id'))
        );
    END IF;
    IF v_policy.application_date IS NULL THEN
        RETURN jsonb_build_object(
            'policy_id', p_policy_id,
            'errors', jsonb_build_array(jsonb_build_object('code', 'no_application_date'))
        );
    END IF;
    IF v_policy.annual_premium IS NULL OR v_policy.annual_premium <= 0 THEN
        RETURN jsonb_build_object(
            'policy_id', p_policy_id,
            'errors', jsonb_build_array(jsonb_build_object('code', 'invalid_annual_premium'))
        );
    END IF;

    -- 3. Resolve the Bonus variant product_id (Lincoln TermAccelerator 20&30
    --    pattern). NULL when the product has no bonus column.
    SELECT
        CASE WHEN prd.has_bonus_column THEN
            (SELECT prd2.id FROM public.comp_grid_products prd2
              WHERE prd2.tenant_id    = prd.tenant_id
                AND prd2.carrier_id   = prd.carrier_id
                AND prd2.product_name = prd.product_name
                AND prd2.product_variant = 'Bonus')
        ELSE NULL END
    INTO v_bonus_product_id
    FROM public.comp_grid_products prd
    WHERE prd.id = v_policy.product_id;

    -- 4. Build the upline chain (writing agent first, then walk upward via
    --    upline_agent_id). Path-array cycle protection + depth cap of 100.
    WITH RECURSIVE chain AS (
        SELECT id, upline_agent_id, 0 AS depth, ARRAY[id] AS path_ids
        FROM public.agents
        WHERE id = v_policy.agent_id
        UNION ALL
        SELECT a.id, a.upline_agent_id, c.depth + 1, c.path_ids || a.id
        FROM public.agents a
        JOIN chain c ON a.id = c.upline_agent_id
        WHERE c.depth < 100 AND NOT a.id = ANY(c.path_ids)
    )
    SELECT array_agg(id ORDER BY depth) INTO v_chain FROM chain;

    v_chain_len := COALESCE(array_length(v_chain, 1), 0);

    -- 5. Wipe prior commission rows for clean re-run. UPSERT in step 6 also
    --    works, but a clean DELETE first ensures stale rows from a chain that
    --    has since shrunk (an upline removed) get cleaned up.
    DELETE FROM public.policy_commissions WHERE policy_id = p_policy_id;

    -- 6. Walk the chain bottom-up. Resolve rate per link, compute spread,
    --    write payout row when spread > 0.
    FOR v_idx IN 1 .. v_chain_len LOOP
        v_agent_id := v_chain[v_idx];

        -- Resolve agent's position at application_date
        SELECT position_id INTO v_position_id
        FROM public.agent_positions
        WHERE agent_id = v_agent_id
          AND start_date <= v_policy.application_date
          AND (end_date IS NULL OR end_date >= v_policy.application_date)
        LIMIT 1;

        -- Resolve parent product rate at application_date
        v_rate := NULL;
        v_schedule_code := NULL;
        SELECT rate, schedule_code INTO v_rate, v_schedule_code
        FROM public.agent_carrier_rates
        WHERE agent_id   = v_agent_id
          AND product_id = v_policy.product_id
          AND start_date <= v_policy.application_date
          AND (end_date IS NULL OR end_date >= v_policy.application_date)
        LIMIT 1;

        -- Lincoln Bonus sum (when applicable)
        IF v_bonus_product_id IS NOT NULL AND v_rate IS NOT NULL THEN
            SELECT rate INTO v_bonus_rate
            FROM public.agent_carrier_rates
            WHERE agent_id   = v_agent_id
              AND product_id = v_bonus_product_id
              AND start_date <= v_policy.application_date
              AND (end_date IS NULL OR end_date >= v_policy.application_date)
            LIMIT 1;
            IF v_bonus_rate IS NOT NULL THEN
                v_rate := v_rate + v_bonus_rate;
            END IF;
        END IF;

        -- Treat null/missing rate as 0% (don't break the chain)
        IF v_rate IS NULL THEN
            v_rate := 0;
        END IF;

        -- Compute payout
        IF v_idx = 1 THEN
            v_spread      := v_rate;
            v_is_override := false;
        ELSE
            v_spread      := v_rate - v_high_water;
            v_is_override := true;
        END IF;

        -- High-water tracks the maximum rate seen so far (going up the chain)
        IF v_rate > v_high_water THEN
            v_high_water := v_rate;
        END IF;

        -- Skip writing row if spread is non-positive
        IF v_spread <= 0 THEN
            CONTINUE;
        END IF;

        v_amount := v_policy.annual_premium * (v_spread / 100);

        INSERT INTO public.policy_commissions (
            tenant_id, policy_id, agent_id, position_id, rate, schedule_code,
            amount, is_override, application_date, recalculated_at
        )
        VALUES (
            v_policy.tenant_id, p_policy_id, v_agent_id, v_position_id, v_rate, v_schedule_code,
            v_amount, v_is_override, v_policy.application_date, now()
        )
        ON CONFLICT (policy_id, agent_id) DO UPDATE
        SET position_id     = EXCLUDED.position_id,
            rate            = EXCLUDED.rate,
            schedule_code   = EXCLUDED.schedule_code,
            amount          = EXCLUDED.amount,
            is_override     = EXCLUDED.is_override,
            recalculated_at = now();

        v_total_paid := v_total_paid + v_amount;

        IF v_idx = 1 THEN
            v_writing_payout := jsonb_build_object(
                'agent_id',      v_agent_id,
                'position_id',   v_position_id,
                'rate',          v_rate,
                'spread',        v_spread,
                'amount',        v_amount,
                'schedule_code', v_schedule_code,
                'is_override',   false
            );
        ELSE
            v_upline_payouts := v_upline_payouts || jsonb_build_object(
                'agent_id',      v_agent_id,
                'position_id',   v_position_id,
                'rate',          v_rate,
                'spread',        v_spread,
                'amount',        v_amount,
                'schedule_code', v_schedule_code,
                'is_override',   true
            );
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'policy_id',           p_policy_id,
        'writing_agent_payout', v_writing_payout,
        'upline_payouts',      v_upline_payouts,
        'total_paid',          v_total_paid,
        'chain_length',        v_chain_len,
        'errors',              v_errors
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recalculate_policy_payouts(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_policy_payouts(UUID)
    TO service_role;


-- -----------------------------------------------------------------------------
-- 2. policies_record_status_change trigger
-- -----------------------------------------------------------------------------
-- Reads `app.policy_status_source` session variable for the source field.
-- Set the variable before each operation type to control source:
--   SET LOCAL app.policy_status_source = 'csv_import';
-- Defaults to 'manual' when unset.
--
-- changed_by behavior:
--   `auth.uid()` returns the JWT-authenticated user id when called from a
--   PostgREST request, and NULL when called from a service-role context
--   (engine recalc fired by another trigger, direct RPC invocation from a
--   service-role client, etc.). NULL changed_by is correct — system events
--   genuinely have no human actor. Phase 5 UI should display "System" for
--   NULL changed_by entries.
CREATE OR REPLACE FUNCTION public.policies_record_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_source TEXT;
    v_should_log BOOLEAN := false;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_should_log := true;
    ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        v_should_log := true;
    END IF;

    IF v_should_log THEN
        v_source := COALESCE(current_setting('app.policy_status_source', true), 'manual');

        INSERT INTO public.policy_status_history (
            tenant_id, policy_id, status, source, changed_by
        )
        VALUES (
            NEW.tenant_id,
            NEW.id,
            NEW.status,
            v_source::public.policy_status_source,
            (SELECT auth.uid())  -- nullable when called outside an authenticated session
        );
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER policies_record_status_change
    AFTER INSERT OR UPDATE ON public.policies
    FOR EACH ROW EXECUTE FUNCTION public.policies_record_status_change();

REVOKE EXECUTE ON FUNCTION public.policies_record_status_change()
    FROM PUBLIC, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 3. policies_recalc_on_issued trigger
-- -----------------------------------------------------------------------------
-- Phase 4a: synchronous. Calls the engine RPC inline on the UPDATE / INSERT
-- thread. Acceptable for low-throughput testing.
--
-- Production scaling option (deferred to Phase 4b or later):
--   Replace `PERFORM public.recalculate_policy_payouts(NEW.id)` with
--   `PERFORM pg_notify('policy_recalc_queue', NEW.id::text);` and have a
--   Supabase Edge Function listen on the channel and call the RPC out of
--   band. The engine itself doesn't change — only the dispatcher.
CREATE OR REPLACE FUNCTION public.policies_recalc_on_issued()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'Issued' THEN
        PERFORM public.recalculate_policy_payouts(NEW.id);
    ELSIF TG_OP = 'UPDATE'
       AND OLD.status IS DISTINCT FROM 'Issued'::public.policy_status
       AND NEW.status = 'Issued'::public.policy_status THEN
        PERFORM public.recalculate_policy_payouts(NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER policies_recalc_on_issued
    AFTER INSERT OR UPDATE OF status ON public.policies
    FOR EACH ROW EXECUTE FUNCTION public.policies_recalc_on_issued();

REVOKE EXECUTE ON FUNCTION public.policies_recalc_on_issued()
    FROM PUBLIC, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 4. Verification
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'recalculate_policy_payouts' AND pronamespace = 'public'::regnamespace
    ), 'recalculate_policy_payouts missing';

    ASSERT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'policies_record_status_change' AND pronamespace = 'public'::regnamespace
    ), 'policies_record_status_change missing';

    ASSERT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'policies_recalc_on_issued' AND pronamespace = 'public'::regnamespace
    ), 'policies_recalc_on_issued missing';

    -- Triggers attached to policies
    ASSERT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'policies_record_status_change'),
        'policies_record_status_change trigger missing';
    ASSERT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'policies_recalc_on_issued'),
        'policies_recalc_on_issued trigger missing';

    -- Service role only
    ASSERT NOT has_function_privilege('anon',
        'public.recalculate_policy_payouts(uuid)', 'EXECUTE');
    ASSERT NOT has_function_privilege('authenticated',
        'public.recalculate_policy_payouts(uuid)', 'EXECUTE');
    ASSERT has_function_privilege('service_role',
        'public.recalculate_policy_payouts(uuid)', 'EXECUTE');

    RAISE NOTICE 'Phase 4a engine + triggers verification passed.';
END $$;

COMMIT;
