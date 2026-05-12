-- =============================================================================
-- Fix: four engine validation gates now clear stale commission rows.
--
-- FOLLOW-UP TO:
--   20260512130000_fix_commission_trigger_to_fire_on_all_status_changes.sql
--
-- WHAT'S WRONG TODAY:
--   The status gate added in 20260512130000 DELETEs prior commission rows when
--   the policy is in a non-commissionable status. The four pre-existing
--   validation gates do not:
--     - no_writing_agent       (agent_id IS NULL)
--     - no_product_id          (product_id IS NULL)
--     - no_application_date    (application_date IS NULL)
--     - invalid_annual_premium (annual_premium IS NULL OR <= 0)
--
--   A policy that was valid when first commissioned and later becomes invalid
--   (admin NULLs agent_id, product reference removed, application_date wiped,
--   annual_premium zeroed) leaves stale rows in policy_commissions.
--
-- THE FIX:
--   Each of the four gates now DELETEs prior rows for the policy before
--   returning the structured error, matching the status gate's pattern.
--   Function body only — no trigger change, no rename, no signature change.
--
-- INVARIANT EACH GATE PRESERVES:
--   After recalculate_policy_payouts() returns, the policy's commission rows
--   exactly reflect its current state. Either the engine wrote them, or the
--   policy was rejected and any prior rows were cleared.
-- =============================================================================

BEGIN;

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

    -- 2. Validate required fields. Each gate DELETEs any prior commission
    --    rows so a policy transitioning valid → invalid does not leave stale
    --    payouts behind, then returns structured errors (no throw).
    IF v_policy.agent_id IS NULL THEN
        DELETE FROM public.policy_commissions WHERE policy_id = p_policy_id;
        RETURN jsonb_build_object(
            'policy_id', p_policy_id,
            'errors', jsonb_build_array(jsonb_build_object('code', 'no_writing_agent'))
        );
    END IF;
    IF v_policy.product_id IS NULL THEN
        DELETE FROM public.policy_commissions WHERE policy_id = p_policy_id;
        RETURN jsonb_build_object(
            'policy_id', p_policy_id,
            'errors', jsonb_build_array(jsonb_build_object('code', 'no_product_id'))
        );
    END IF;
    IF v_policy.application_date IS NULL THEN
        DELETE FROM public.policy_commissions WHERE policy_id = p_policy_id;
        RETURN jsonb_build_object(
            'policy_id', p_policy_id,
            'errors', jsonb_build_array(jsonb_build_object('code', 'no_application_date'))
        );
    END IF;
    IF v_policy.annual_premium IS NULL OR v_policy.annual_premium <= 0 THEN
        DELETE FROM public.policy_commissions WHERE policy_id = p_policy_id;
        RETURN jsonb_build_object(
            'policy_id', p_policy_id,
            'errors', jsonb_build_array(jsonb_build_object('code', 'invalid_annual_premium'))
        );
    END IF;

    -- 2.5. Status gate. If not commissionable, clear any prior commission rows
    --      (handles transitions OUT of a commissionable status) and exit clean.
    --      Commissionable set: Issued, Issue Paid, Potential Lapse.
    --      Per migration 20260512130000, Potential Lapse is intentionally
    --      included so the At-Risk bucket retains real commission numbers;
    --      chargeback reversal happens at Terminated via a separate path.
    IF v_policy.status NOT IN (
        'Issued'::public.policy_status,
        'Issue Paid'::public.policy_status,
        'Potential Lapse'::public.policy_status
    ) THEN
        DELETE FROM public.policy_commissions WHERE policy_id = p_policy_id;
        RETURN jsonb_build_object(
            'policy_id', p_policy_id,
            'skipped',   true,
            'reason',    'non_commissionable_status',
            'status',    v_policy.status
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

    -- 5. Wipe prior commission rows for clean re-run.
    DELETE FROM public.policy_commissions WHERE policy_id = p_policy_id;

    -- 6. Walk the chain bottom-up. Resolve rate per link, compute spread,
    --    write payout row when spread > 0.
    FOR v_idx IN 1 .. v_chain_len LOOP
        v_agent_id := v_chain[v_idx];

        SELECT position_id INTO v_position_id
        FROM public.agent_positions
        WHERE agent_id = v_agent_id
          AND start_date <= v_policy.application_date
          AND (end_date IS NULL OR end_date >= v_policy.application_date)
        LIMIT 1;

        v_rate := NULL;
        v_schedule_code := NULL;
        SELECT rate, schedule_code INTO v_rate, v_schedule_code
        FROM public.agent_carrier_rates
        WHERE agent_id   = v_agent_id
          AND product_id = v_policy.product_id
          AND start_date <= v_policy.application_date
          AND (end_date IS NULL OR end_date >= v_policy.application_date)
        LIMIT 1;

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

        IF v_rate IS NULL THEN
            v_rate := 0;
        END IF;

        IF v_idx = 1 THEN
            v_spread      := v_rate;
            v_is_override := false;
        ELSE
            v_spread      := v_rate - v_high_water;
            v_is_override := true;
        END IF;

        IF v_rate > v_high_water THEN
            v_high_water := v_rate;
        END IF;

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


-- -----------------------------------------------------------------------------
-- Verification
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'recalculate_policy_payouts'
          AND pronamespace = 'public'::regnamespace
    ), 'recalculate_policy_payouts function missing';

    -- Grants survive CREATE OR REPLACE (OID-anchored on the matching signature).
    ASSERT NOT has_function_privilege('anon',
        'public.recalculate_policy_payouts(uuid)', 'EXECUTE'),
        'recalculate_policy_payouts grant leaked to anon';
    ASSERT NOT has_function_privilege('authenticated',
        'public.recalculate_policy_payouts(uuid)', 'EXECUTE'),
        'recalculate_policy_payouts grant leaked to authenticated';
    ASSERT has_function_privilege('service_role',
        'public.recalculate_policy_payouts(uuid)', 'EXECUTE'),
        'recalculate_policy_payouts grant lost from service_role';

    RAISE NOTICE 'Engine validation gates clear-stale-rows verification passed.';
END $$;

COMMIT;
