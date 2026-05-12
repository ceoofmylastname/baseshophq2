-- =============================================================================
-- Fix: commission trigger fires on every status change, engine owns the gate.
--
-- BUG SURFACED:
--   Checkpoint C seed verification (2026-05-12) showed 26 Issue Paid policies
--   produced 0 commission rows. The trigger policies_recalc_on_issued only
--   fired on INSERT-as-Issued or UPDATE-to-Issued. Direct INSERT with
--   status='Issue Paid' (carrier CSV importing an already-paid policy) silently
--   bypassed the engine. The Phase 4a migration even documented this as
--   "by design" — but it's wrong in production. Carrier statements routinely
--   land policies in Issue Paid state because the policy was processed before
--   the report ran. Lost commission.
--
-- THE FIX (invert the responsibility):
--   1. Trigger fires on every INSERT and every UPDATE OF status, no condition.
--   2. Engine (recalculate_policy_payouts) early-returns with a no-op when the
--      policy's current status is not commissionable. Existing commission rows
--      are DELETEd on the no-op path so a transition out of a commissionable
--      status (Issued → Terminated) correctly clears the policy's payouts.
--
-- COMMISSIONABLE STATUSES: Issued, Issue Paid, Potential Lapse.
--   Issued / Issue Paid — Booked + Realized buckets. Engine writes rows.
--   Potential Lapse     — At-Risk bucket. Rows preserved so agent commission
--                         numbers do not drop on transient at-risk warnings.
--                         Per wiki, chargeback reversal happens at Terminated
--                         (handled by separate flow), not at Potential Lapse.
--
-- NON-COMMISSIONABLE: Draft, Submitted, Pending, Terminated.
--   Engine no-ops AND deletes any prior commission rows so a policy moving
--   Issued → Terminated has its rows cleared cleanly.
--
-- RENAMES:
--   Function policies_recalc_on_issued → policies_recalc_on_status_change.
--   Trigger  policies_recalc_on_issued → policies_recalc_on_status_change.
--   ALTER ... RENAME TO preserves OID, so existing EXECUTE grants survive.
--   recalculate_policy_payouts keeps its name (callable RPC; seed and any
--   direct callers stay valid).
--
-- WORKED EXAMPLE — INSERT a policy already in Issue Paid state:
--   Old behavior: trigger condition fails (status is not Issued), engine
--                 never called, zero commission rows. Lost money.
--   New behavior: trigger fires unconditionally on INSERT, calls engine,
--                 engine passes status gate (Issue Paid is commissionable),
--                 walks the upline chain, writes commission rows. Money paid.
--
-- VERIFIED LOCALLY: removing the workaround recalc loop in supabase/seed.sql
-- (added at Checkpoint C as a stopgap) and running supabase db reset --local
-- still produces ~122 commission rows across the seeded Issued + Issue Paid
-- policies. The trigger does the job; the seed no longer needs the stopgap.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Rename trigger + function in place. RENAME preserves OID and grants.
-- -----------------------------------------------------------------------------
ALTER TRIGGER policies_recalc_on_issued ON public.policies
    RENAME TO policies_recalc_on_status_change;

ALTER FUNCTION public.policies_recalc_on_issued()
    RENAME TO policies_recalc_on_status_change;


-- -----------------------------------------------------------------------------
-- 2. Replace the trigger function body: fire engine unconditionally on every
--    INSERT and every UPDATE OF status. Engine owns the commissionable gate.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.policies_recalc_on_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.recalculate_policy_payouts(NEW.id);
    RETURN NEW;
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. Replace recalculate_policy_payouts to add the status gate. Body is the
--    Phase 4a engine plus one new section (Step 2.5) below the existing
--    validation gates.
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

    -- 2.5. Status gate. If not commissionable, clear any prior commission rows
    --      (handles transitions OUT of a commissionable status) and exit clean.
    --      Commissionable set: Issued, Issue Paid, Potential Lapse.
    --      Per the migration header, Potential Lapse is intentionally included
    --      so the At-Risk bucket retains real commission numbers; chargeback
    --      reversal happens at Terminated via a separate path.
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
-- 4. Verification
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'policies_recalc_on_status_change'
          AND pronamespace = 'public'::regnamespace
    ), 'policies_recalc_on_status_change function missing';

    ASSERT NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'policies_recalc_on_issued'
          AND pronamespace = 'public'::regnamespace
    ), 'old policies_recalc_on_issued function still present';

    ASSERT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'policies_recalc_on_status_change'
    ), 'policies_recalc_on_status_change trigger missing';

    ASSERT NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'policies_recalc_on_issued'
    ), 'old policies_recalc_on_issued trigger still present';

    -- Grants survive RENAME (OID-anchored).
    ASSERT NOT has_function_privilege('anon',
        'public.recalculate_policy_payouts(uuid)', 'EXECUTE'),
        'recalculate_policy_payouts grant leaked to anon';
    ASSERT NOT has_function_privilege('authenticated',
        'public.recalculate_policy_payouts(uuid)', 'EXECUTE'),
        'recalculate_policy_payouts grant leaked to authenticated';
    ASSERT has_function_privilege('service_role',
        'public.recalculate_policy_payouts(uuid)', 'EXECUTE'),
        'recalculate_policy_payouts grant lost from service_role';

    RAISE NOTICE 'Commission trigger fix verification passed.';
END $$;

COMMIT;
