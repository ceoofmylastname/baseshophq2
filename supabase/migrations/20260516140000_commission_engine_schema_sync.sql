-- =============================================================================
-- Commission Engine Schema Sync — capture live-prod schema changes.
--
-- WHY THIS EXISTS:
--   Schema work performed directly against the live remote Supabase project
--   (oarstmxbgdczytwzpyxj) between Phase 10e and now landed without
--   accompanying migration files. The bare list:
--
--     * new enum types: payment_mode_enum, payout_type_enum
--     * policies.payment_mode column (default 'Monthly')
--     * policy_commissions gained: payout_type, payout_month, due_date,
--       paid, paid_date
--     * unique constraint swap on policy_commissions:
--         dropped: policy_commissions_unique_recipient (policy_id, agent_id)
--         added:   policy_commissions_unique_payout_slot
--                    (policy_id, agent_id, payout_type, payout_month)
--     * new index idx_policy_commissions_tenant_agent_due
--     * recalculate_policy_payouts rewritten to split commission into a
--       payment-mode-aware advance row plus a 12-month trail. Override rows
--       are preserved across recalcs (DELETE filtered by is_override = false).
--     * scoreboard_top_earners and leaderboard_top_earners now scope by
--       pc.due_date BETWEEN start AND LEAST(end, CURRENT_DATE).
--
--   Without this migration, a fresh `supabase db reset` produces a stack that
--   does not match production. Existing migrations 20260512130000 and
--   20260512140000 already wrote earlier versions of recalculate_policy_payouts
--   — this file CREATE OR REPLACEs over the top with the current production
--   body. That's intentional and safe; both prior versions are honored by
--   migration history, and the latest body is what the codebase depends on.
--
-- CAPTURED VERBATIM:
--   Function bodies pulled via pg_get_functiondef on 2026-05-14.
--   Enum labels pulled via pg_enum.
--   Column defaults pulled via information_schema.columns.
--
-- IDEMPOTENCE:
--   * CREATE TYPE wrapped in DO blocks (Postgres has no "CREATE TYPE IF NOT
--     EXISTS"; the DO/EXCEPTION pattern is the canonical workaround).
--   * Columns use ADD COLUMN IF NOT EXISTS.
--   * Constraints use DROP IF EXISTS / ADD with NOT EXISTS guard.
--   * Indexes use CREATE INDEX IF NOT EXISTS.
--   * Functions use CREATE OR REPLACE.
--
-- BACK-DATE NOTE:
--   This file's timestamp (20260516140000) sorts AFTER the latest existing
--   migration so it applies last on a fresh stack. On the remote, Supabase
--   tracks applied migrations by filename; this is the next-newer file and
--   will apply as an idempotent no-op (remote already has every object this
--   file defines).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Enum types
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    CREATE TYPE public.payment_mode_enum AS ENUM (
        'Monthly', 'Annual', 'Quarterly', 'Semi-Annual', 'Single Pay'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE public.payout_type_enum AS ENUM (
        'advance', 'trail', 'chargeback', 'override'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 2. policies.payment_mode column
-- -----------------------------------------------------------------------------
ALTER TABLE public.policies
    ADD COLUMN IF NOT EXISTS payment_mode public.payment_mode_enum
        NOT NULL DEFAULT 'Monthly'::public.payment_mode_enum;

-- -----------------------------------------------------------------------------
-- 3. policy_commissions: new columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.policy_commissions
    ADD COLUMN IF NOT EXISTS payout_type public.payout_type_enum
        NOT NULL DEFAULT 'advance'::public.payout_type_enum;

ALTER TABLE public.policy_commissions
    ADD COLUMN IF NOT EXISTS payout_month integer NOT NULL DEFAULT 0;

ALTER TABLE public.policy_commissions
    ADD COLUMN IF NOT EXISTS due_date date NULL;

ALTER TABLE public.policy_commissions
    ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT false;

ALTER TABLE public.policy_commissions
    ADD COLUMN IF NOT EXISTS paid_date date NULL;

-- -----------------------------------------------------------------------------
-- 4. policy_commissions: unique constraint swap
--    The old single-row-per-(policy, agent) constraint is incompatible with
--    the new advance + 12-month-trail commission model. Replace with a wider
--    key that includes payout_type + payout_month so each scheduled payout
--    gets its own row.
-- -----------------------------------------------------------------------------
ALTER TABLE public.policy_commissions
    DROP CONSTRAINT IF EXISTS policy_commissions_unique_recipient;

ALTER TABLE public.policy_commissions
    DROP CONSTRAINT IF EXISTS policy_commissions_unique_payout_slot;

ALTER TABLE public.policy_commissions
    ADD CONSTRAINT policy_commissions_unique_payout_slot
    UNIQUE (policy_id, agent_id, payout_type, payout_month);

-- -----------------------------------------------------------------------------
-- 5. policy_commissions: due-date index (powers the earners RPCs)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_policy_commissions_tenant_agent_due
    ON public.policy_commissions (tenant_id, agent_id, due_date);

-- -----------------------------------------------------------------------------
-- 6. recalculate_policy_payouts — full rewrite
--
--    Splits the expected commission per chain link into:
--      * One 'advance' row at month 0 (75% of expected for Monthly,
--        100% for all other payment_modes).
--      * Twelve 'trail' rows at months 1..12 (remaining expected / 12,
--        each due_date = base_date + N months) when there's a remainder.
--
--    base_date = COALESCE(policy.effective_date, policy.application_date).
--
--    DELETE on recalc filters by is_override = false so manually-flagged
--    override rows survive a re-run. Validation gates each clear non-override
--    rows for clean state (same pattern as 20260512140000).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_policy_payouts(p_policy_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    v_expected          NUMERIC;
    v_advance_pct       NUMERIC;
    v_advance_amount    NUMERIC;
    v_trail_total       NUMERIC;
    v_trail_per_month   NUMERIC;
    v_base_date         DATE;
    v_is_override       BOOLEAN;
    v_writing_payout    JSONB;
    v_upline_payouts    JSONB := '[]'::jsonb;
    v_total_paid        NUMERIC := 0;
    v_errors            JSONB := '[]'::jsonb;
    v_chain_len         INT;
    m                   INT;
BEGIN
    -- 1. Read the policy
    SELECT * INTO v_policy FROM public.policies WHERE id = p_policy_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'policy % does not exist', p_policy_id;
    END IF;

    -- 2. Validate required fields. Each gate clears prior rows for clean state.
    IF v_policy.agent_id IS NULL THEN
        DELETE FROM public.policy_commissions WHERE policy_id = p_policy_id AND COALESCE(is_override, false) = false;
        RETURN jsonb_build_object('policy_id', p_policy_id, 'errors',
            jsonb_build_array(jsonb_build_object('code', 'no_writing_agent')));
    END IF;
    IF v_policy.product_id IS NULL THEN
        DELETE FROM public.policy_commissions WHERE policy_id = p_policy_id AND COALESCE(is_override, false) = false;
        RETURN jsonb_build_object('policy_id', p_policy_id, 'errors',
            jsonb_build_array(jsonb_build_object('code', 'no_product_id')));
    END IF;
    IF v_policy.application_date IS NULL THEN
        DELETE FROM public.policy_commissions WHERE policy_id = p_policy_id AND COALESCE(is_override, false) = false;
        RETURN jsonb_build_object('policy_id', p_policy_id, 'errors',
            jsonb_build_array(jsonb_build_object('code', 'no_application_date')));
    END IF;
    IF v_policy.annual_premium IS NULL OR v_policy.annual_premium <= 0 THEN
        DELETE FROM public.policy_commissions WHERE policy_id = p_policy_id AND COALESCE(is_override, false) = false;
        RETURN jsonb_build_object('policy_id', p_policy_id, 'errors',
            jsonb_build_array(jsonb_build_object('code', 'invalid_annual_premium')));
    END IF;

    -- 2.5. Status gate
    IF v_policy.status NOT IN (
        'Issued'::public.policy_status,
        'Issue Paid'::public.policy_status,
        'Potential Lapse'::public.policy_status
    ) THEN
        DELETE FROM public.policy_commissions WHERE policy_id = p_policy_id AND COALESCE(is_override, false) = false;
        RETURN jsonb_build_object('policy_id', p_policy_id, 'skipped', true,
            'reason', 'non_commissionable_status', 'status', v_policy.status);
    END IF;

    -- 3. Bonus variant resolution (Lincoln TermAccelerator pattern)
    SELECT
        CASE WHEN prd.has_bonus_column THEN
            (SELECT prd2.id FROM public.comp_grid_products prd2
              WHERE prd2.tenant_id     = prd.tenant_id
                AND prd2.carrier_id    = prd.carrier_id
                AND prd2.product_name  = prd.product_name
                AND prd2.product_variant = 'Bonus')
        ELSE NULL END
    INTO v_bonus_product_id
    FROM public.comp_grid_products prd
    WHERE prd.id = v_policy.product_id;

    -- 4. Build upline chain
    WITH RECURSIVE chain AS (
        SELECT id, upline_agent_id, 0 AS depth, ARRAY[id] AS path_ids
        FROM public.agents WHERE id = v_policy.agent_id
        UNION ALL
        SELECT a.id, a.upline_agent_id, c.depth + 1, c.path_ids || a.id
        FROM public.agents a
        JOIN chain c ON a.id = c.upline_agent_id
        WHERE c.depth < 100 AND NOT a.id = ANY(c.path_ids)
    )
    SELECT array_agg(id ORDER BY depth) INTO v_chain FROM chain;

    v_chain_len := COALESCE(array_length(v_chain, 1), 0);

    -- 5. Wipe ALL prior non-override rows for clean re-run
    DELETE FROM public.policy_commissions WHERE policy_id = p_policy_id AND COALESCE(is_override, false) = false;

    -- 6. Resolve advance percentage from payment_mode
    v_advance_pct := CASE v_policy.payment_mode
        WHEN 'Monthly' THEN 0.75
        WHEN 'Annual' THEN 1.00
        WHEN 'Single Pay' THEN 1.00
        WHEN 'Quarterly' THEN 1.00
        WHEN 'Semi-Annual' THEN 1.00
        ELSE 0.75
    END;

    v_base_date := COALESCE(v_policy.effective_date, v_policy.application_date);

    -- 7. Walk the chain. For each link, compute spread then split into advance + trail.
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

        v_expected       := ROUND(v_policy.annual_premium * (v_spread / 100), 2);
        v_advance_amount := ROUND(v_expected * v_advance_pct, 2);
        v_trail_total    := ROUND(v_expected - v_advance_amount, 2);
        v_trail_per_month := CASE WHEN v_trail_total > 0 THEN ROUND(v_trail_total / 12.0, 2) ELSE 0 END;

        INSERT INTO public.policy_commissions (
            tenant_id, policy_id, agent_id, position_id, rate, schedule_code,
            amount, is_override, application_date, recalculated_at,
            payout_type, payout_month, due_date, paid
        )
        VALUES (
            v_policy.tenant_id, p_policy_id, v_agent_id, v_position_id, v_rate, v_schedule_code,
            v_advance_amount, v_is_override, v_policy.application_date, now(),
            'advance', 0, v_base_date, false
        )
        ON CONFLICT (policy_id, agent_id, payout_type, payout_month) DO UPDATE
        SET position_id     = EXCLUDED.position_id,
            rate            = EXCLUDED.rate,
            schedule_code   = EXCLUDED.schedule_code,
            amount          = EXCLUDED.amount,
            is_override     = EXCLUDED.is_override,
            due_date        = EXCLUDED.due_date,
            recalculated_at = now();

        v_total_paid := v_total_paid + v_advance_amount;

        IF v_trail_total > 0 THEN
            FOR m IN 1..12 LOOP
                INSERT INTO public.policy_commissions (
                    tenant_id, policy_id, agent_id, position_id, rate, schedule_code,
                    amount, is_override, application_date, recalculated_at,
                    payout_type, payout_month, due_date, paid
                )
                VALUES (
                    v_policy.tenant_id, p_policy_id, v_agent_id, v_position_id, v_rate, v_schedule_code,
                    v_trail_per_month, v_is_override, v_policy.application_date, now(),
                    'trail', m, v_base_date + (m || ' months')::interval, false
                )
                ON CONFLICT (policy_id, agent_id, payout_type, payout_month) DO UPDATE
                SET position_id     = EXCLUDED.position_id,
                    rate            = EXCLUDED.rate,
                    schedule_code   = EXCLUDED.schedule_code,
                    amount          = EXCLUDED.amount,
                    is_override     = EXCLUDED.is_override,
                    due_date        = EXCLUDED.due_date,
                    recalculated_at = now();
                v_total_paid := v_total_paid + v_trail_per_month;
            END LOOP;
        END IF;

        IF v_idx = 1 THEN
            v_writing_payout := jsonb_build_object(
                'agent_id',         v_agent_id,
                'position_id',      v_position_id,
                'rate',             v_rate,
                'spread',           v_spread,
                'expected',         v_expected,
                'advance_amount',   v_advance_amount,
                'trail_per_month',  v_trail_per_month,
                'schedule_code',    v_schedule_code,
                'is_override',      false
            );
        ELSE
            v_upline_payouts := v_upline_payouts || jsonb_build_object(
                'agent_id',         v_agent_id,
                'position_id',      v_position_id,
                'rate',             v_rate,
                'spread',           v_spread,
                'expected',         v_expected,
                'advance_amount',   v_advance_amount,
                'trail_per_month',  v_trail_per_month,
                'schedule_code',    v_schedule_code,
                'is_override',      true
            );
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'policy_id',           p_policy_id,
        'payment_mode',        v_policy.payment_mode,
        'advance_pct',         v_advance_pct,
        'writing_agent_payout', v_writing_payout,
        'upline_payouts',      v_upline_payouts,
        'total_paid',          v_total_paid,
        'chain_length',        v_chain_len,
        'errors',              v_errors
    );
END;
$function$;

-- -----------------------------------------------------------------------------
-- 7. scoreboard_top_earners — now scopes by pc.due_date BETWEEN start AND
--    LEAST(end, CURRENT_DATE). Realized-commission semantics.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scoreboard_top_earners(
    p_start_date date,
    p_end_date   date,
    p_carrier_id uuid DEFAULT NULL::uuid,
    p_limit      integer DEFAULT 25
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_result    jsonb;
  v_window_end date;
BEGIN
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
  END IF;

  v_window_end := LEAST(p_end_date, CURRENT_DATE);

  WITH scoped AS (
    SELECT pc.agent_id, pc.amount
      FROM public.policy_commissions pc
      JOIN public.policies p ON p.id = pc.policy_id
     WHERE pc.tenant_id = v_tenant_id
       AND p.status = 'Issue Paid'
       AND pc.due_date BETWEEN p_start_date AND v_window_end
       AND (p_carrier_id IS NULL OR EXISTS (
            SELECT 1 FROM public.comp_grid_products cgp
             WHERE cgp.id = p.product_id AND cgp.carrier_id = p_carrier_id))
  ), agg AS (
    SELECT s.agent_id, COALESCE(SUM(amount), 0) AS earned
      FROM scoped s GROUP BY s.agent_id
  )
  SELECT jsonb_agg(row_to_json(t)) INTO v_result FROM (
    SELECT ROW_NUMBER() OVER (ORDER BY a.earned DESC) AS rank,
      a.agent_id,
      COALESCE(NULLIF(trim(concat_ws(' ', ag.first_name, ag.last_name)), ''), ag.email) AS agent_name,
      cgp.position_code, cgp.position_name, a.earned
    FROM agg a JOIN public.agents ag ON ag.id = a.agent_id
    LEFT JOIN public.agent_positions ap ON ap.agent_id = a.agent_id AND ap.end_date IS NULL
    LEFT JOIN public.comp_grid_positions cgp ON cgp.id = ap.position_id
    ORDER BY a.earned DESC LIMIT p_limit
  ) t;

  RETURN jsonb_build_object('success', true, 'rows', COALESCE(v_result, '[]'::jsonb));
END; $function$;

-- -----------------------------------------------------------------------------
-- 8. leaderboard_top_earners — same due_date scope; preserves view-down via
--    visible_agent_ids().
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leaderboard_top_earners(
    p_start_date date,
    p_end_date   date,
    p_carrier_id uuid DEFAULT NULL::uuid,
    p_limit      integer DEFAULT 10
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_visible   uuid[];
  v_result    jsonb;
  v_window_end date;
BEGIN
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
  END IF;
  v_visible := public.visible_agent_ids();

  v_window_end := LEAST(p_end_date, CURRENT_DATE);

  WITH scoped AS (
    SELECT pc.agent_id, pc.amount
      FROM public.policy_commissions pc
      JOIN public.policies p ON p.id = pc.policy_id
     WHERE pc.tenant_id = v_tenant_id
       AND p.status = 'Issue Paid'
       AND pc.due_date BETWEEN p_start_date AND v_window_end
       AND (v_visible IS NULL OR pc.agent_id = ANY(v_visible))
       AND (p_carrier_id IS NULL OR EXISTS (
            SELECT 1 FROM public.comp_grid_products cgp
             WHERE cgp.id = p.product_id AND cgp.carrier_id = p_carrier_id))
  ), agg AS (
    SELECT s.agent_id, COALESCE(SUM(amount), 0) AS earned
      FROM scoped s GROUP BY s.agent_id
  )
  SELECT jsonb_agg(row_to_json(t)) INTO v_result FROM (
    SELECT ROW_NUMBER() OVER (ORDER BY a.earned DESC) AS rank,
      a.agent_id,
      COALESCE(NULLIF(trim(concat_ws(' ', ag.first_name, ag.last_name)), ''), ag.email) AS agent_name,
      cgp.position_code, cgp.position_name, a.earned
    FROM agg a JOIN public.agents ag ON ag.id = a.agent_id
    LEFT JOIN public.agent_positions ap ON ap.agent_id = a.agent_id AND ap.end_date IS NULL
    LEFT JOIN public.comp_grid_positions cgp ON cgp.id = ap.position_id
    ORDER BY a.earned DESC LIMIT p_limit
  ) t;

  RETURN jsonb_build_object('success', true, 'is_owner_view', v_visible IS NULL,
                            'rows', COALESCE(v_result, '[]'::jsonb));
END; $function$;

-- -----------------------------------------------------------------------------
-- 9. Verification
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    -- Enums
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                   WHERE n.nspname = 'public' AND t.typname = 'payment_mode_enum'),
        'payment_mode_enum missing';
    ASSERT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                   WHERE n.nspname = 'public' AND t.typname = 'payout_type_enum'),
        'payout_type_enum missing';

    -- Columns
    ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'policies'
                     AND column_name = 'payment_mode'),
        'policies.payment_mode missing';
    ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'policy_commissions'
                     AND column_name = 'payout_type'),
        'policy_commissions.payout_type missing';
    ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'policy_commissions'
                     AND column_name = 'due_date'),
        'policy_commissions.due_date missing';

    -- Constraint swap
    ASSERT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'policy_commissions_unique_payout_slot'),
        'policy_commissions_unique_payout_slot missing';
    ASSERT NOT EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conname = 'policy_commissions_unique_recipient'),
        'old policy_commissions_unique_recipient still present';

    -- Index
    ASSERT EXISTS (SELECT 1 FROM pg_indexes
                   WHERE schemaname = 'public'
                     AND indexname = 'idx_policy_commissions_tenant_agent_due'),
        'idx_policy_commissions_tenant_agent_due missing';

    -- Functions
    ASSERT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
                   WHERE n.nspname = 'public' AND p.proname = 'recalculate_policy_payouts'),
        'recalculate_policy_payouts missing';
    ASSERT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
                   WHERE n.nspname = 'public' AND p.proname = 'scoreboard_top_earners'),
        'scoreboard_top_earners missing';
    ASSERT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
                   WHERE n.nspname = 'public' AND p.proname = 'leaderboard_top_earners'),
        'leaderboard_top_earners missing';

    RAISE NOTICE 'Commission engine schema sync verification passed.';
END $$;

COMMIT;
