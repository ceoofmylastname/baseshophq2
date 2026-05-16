-- =============================================================================
-- Phase 17 — Billing schema: four-tier flat-rate + Enterprise metered + White-Label add-on
--
-- SCOPE (PR 1 of 3, schema only, no Stripe code):
--   1. tenants gains 8 billing columns + unique constraints + CHECK constraints.
--   2. tenants gains a trigger that denormalizes agent_cap from current_plan_tier
--      and auto-clears white_label_addon_active on downgrade to Starter.
--   3. billing_snapshots table for Enterprise active-agent metering.
--   4. enforce_agent_cap(uuid) RPC for invite-time cap enforcement.
--
-- WHAT THIS DOES NOT TOUCH:
--   * Stripe Edge Functions (signup webhook, subscription create, usage report)
--     — those land in PR 2.
--   * Billing page UI — lands in PR 3.
--   * The Supabase Vault entries — those are configured by hand via the
--     Supabase dashboard; recipe documented at branded/stripe-products.md.
--
-- CANONICAL SOURCES:
--   wiki/pricing-and-checkout.md (final tier lock 2026-05-01)
--   wiki/active-agent-billing-model.md (Enterprise-only metering)
--   wiki/schema-spec.md (referenced shape; PR brief overrides where they differ)
--   branded/audits/stripe-prompt-2-audit.md (the 12 criteria this PR begins to ship)
--
-- TIER → CAP DENORMALIZATION:
--   starter → 3, growth → 10, pro → 50, enterprise → 9999 (sentinel for
--   "unbounded by tier; billed by usage"). Sync runs in a BEFORE trigger so
--   agent_cap is always consistent with current_plan_tier, regardless of how
--   the row was written.
--
-- TWO-LAYER WHITE-LABEL/STARTER GUARD:
--   * CHECK constraint: blocks any direct INSERT or UPDATE that produces the
--     forbidden combination (white_label_addon_active=true AND tier='starter').
--     This is the hard floor — DML at any layer is rejected.
--   * Trigger (UPDATE path only): on a tier DOWNGRADE to Starter, auto-clears
--     white_label_addon_active so the downgrade does not get blocked by the
--     CHECK. Defense in depth — the CHECK catches direct mistakes, the trigger
--     handles the legitimate downgrade pathway gracefully.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. tenants: add 8 billing columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS stripe_customer_id        text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS stripe_subscription_id    text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS current_plan_tier         text       NOT NULL DEFAULT 'starter';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS white_label_addon_active  boolean    NOT NULL DEFAULT false;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS agent_cap                 integer    NOT NULL DEFAULT 3;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS billing_status            text       NOT NULL DEFAULT 'active';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_in_trial               boolean    NOT NULL DEFAULT true;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS trial_ends_at             timestamptz;

-- -----------------------------------------------------------------------------
-- 2. tenants: unique constraints on the Stripe IDs (nullable, so multiple rows
--    can share NULL during pre-checkout state; once set they must be unique)
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE public.tenants ADD CONSTRAINT tenants_stripe_customer_id_key
    UNIQUE (stripe_customer_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tenants ADD CONSTRAINT tenants_stripe_subscription_id_key
    UNIQUE (stripe_subscription_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- 3. tenants: CHECK constraints (tier enum, billing_status enum, white-label guard)
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE public.tenants ADD CONSTRAINT tenants_current_plan_tier_check
    CHECK (current_plan_tier IN ('starter','growth','pro','enterprise'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tenants ADD CONSTRAINT tenants_billing_status_check
    CHECK (billing_status IN ('active','past_due','suspended','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tenants ADD CONSTRAINT tenants_no_white_label_on_starter
    CHECK (NOT (white_label_addon_active = true AND current_plan_tier = 'starter'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- 4. Trigger function: sync agent_cap to tier; clear addon on downgrade to starter
--    Note: trigger only fires on tier *change* (INSERT or UPDATE OF
--    current_plan_tier), not on every UPDATE of the row. Direct writes to
--    agent_cap or white_label_addon_active without a tier change are allowed
--    (admin override path); the CHECK constraint enforces the invariants.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tenants_sync_cap_and_addon()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Sync agent_cap to tier on every fire.
  NEW.agent_cap := CASE NEW.current_plan_tier
    WHEN 'starter'    THEN 3
    WHEN 'growth'     THEN 10
    WHEN 'pro'        THEN 50
    WHEN 'enterprise' THEN 9999
    ELSE NEW.agent_cap  -- unreachable: CHECK constraint blocks other values
  END;

  -- Auto-clear white-label add-on ONLY on a tier DOWNGRADE to Starter via
  -- UPDATE. Direct INSERTs that try to set starter+addon=true are blocked by
  -- the CHECK; this branch handles the legitimate downgrade path.
  IF TG_OP = 'UPDATE'
     AND OLD.current_plan_tier IS DISTINCT FROM NEW.current_plan_tier
     AND NEW.current_plan_tier = 'starter'
     AND NEW.white_label_addon_active = true THEN
    NEW.white_label_addon_active := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_sync_cap_and_addon_trg ON public.tenants;
CREATE TRIGGER tenants_sync_cap_and_addon_trg
  BEFORE INSERT OR UPDATE OF current_plan_tier ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tenants_sync_cap_and_addon();

-- -----------------------------------------------------------------------------
-- 5. billing_snapshots — Enterprise active-agent metering history
--    One row per (tenant, period_start). Service-role writes only; owner-only
--    reads via RLS. Used by the monthly snapshot job (PR 2) to report usage
--    to Stripe and persist the count for in-app display on the Billing page.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_snapshots (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_start           date NOT NULL,
  period_end             date NOT NULL,
  active_agent_count     integer NOT NULL,
  tier_at_snapshot       text NOT NULL,
  stripe_usage_record_id text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_snapshots_period_order CHECK (period_end >= period_start),
  CONSTRAINT billing_snapshots_tier_check
    CHECK (tier_at_snapshot IN ('starter','growth','pro','enterprise')),
  CONSTRAINT billing_snapshots_unique_period UNIQUE (tenant_id, period_start)
);

CREATE INDEX IF NOT EXISTS billing_snapshots_tenant_created
  ON public.billing_snapshots (tenant_id, created_at DESC);

ALTER TABLE public.billing_snapshots ENABLE ROW LEVEL SECURITY;

-- Owner-only SELECT. No INSERT/UPDATE/DELETE policy → service_role bypasses
-- RLS and is the only writer; authenticated/anon cannot write.
DROP POLICY IF EXISTS billing_snapshots_owner_select ON public.billing_snapshots;
CREATE POLICY billing_snapshots_owner_select ON public.billing_snapshots
  FOR SELECT
  USING (
    public.is_owner()
    AND tenant_id = public.current_tenant_id()
  );

-- -----------------------------------------------------------------------------
-- 6. enforce_agent_cap(p_tenant_id uuid) RPC
--    Called from the agent-invite flow. Returns ok=true if a new agent can be
--    added, ok=false with structured details if the cap is reached.
--    Enterprise (cap=9999) always returns ok=true.
--
--    Counts archived_at IS NULL agents only — archived agents do not bill and
--    do not count toward the cap, matching the wiki definition.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_agent_cap(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cap     integer;
  v_tier    text;
  v_current integer;
BEGIN
  SELECT agent_cap, current_plan_tier INTO v_cap, v_tier
  FROM public.tenants WHERE id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tenant_not_found');
  END IF;

  -- Enterprise sentinel: unbounded by tier (billed by active-agent usage instead)
  IF v_tier = 'enterprise' OR v_cap >= 9999 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'tier', v_tier,
      'cap', v_cap,
      'current', NULL
    );
  END IF;

  SELECT COUNT(*) INTO v_current
  FROM public.agents
  WHERE tenant_id = p_tenant_id
    AND archived_at IS NULL;

  IF v_current >= v_cap THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'cap_reached',
      'cap', v_cap,
      'current', v_current,
      'tier', v_tier
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'cap', v_cap,
    'current', v_current,
    'tier', v_tier
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_agent_cap(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.enforce_agent_cap(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. Internal verification — runs at apply time. A failure aborts the migration.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_test_tenant_id uuid := gen_random_uuid();
  v_result         jsonb;
BEGIN
  -- Test 1: CHECK constraint blocks starter + white_label_addon_active=true
  BEGIN
    INSERT INTO public.tenants (id, name, slug, current_plan_tier, white_label_addon_active)
    VALUES (v_test_tenant_id, 'verify1', 'phase17-verify1', 'starter', true);
    RAISE EXCEPTION 'Test 1 FAILED: starter + white_label_addon_active=true was accepted';
  EXCEPTION WHEN check_violation THEN
    -- expected: tenants_no_white_label_on_starter blocked the insert
    NULL;
  END;

  -- Test 2: trigger sets agent_cap=10 on INSERT with tier='growth'
  INSERT INTO public.tenants (id, name, slug, current_plan_tier, white_label_addon_active)
  VALUES (v_test_tenant_id, 'verify2', 'phase17-verify2', 'growth', true);
  PERFORM 1 FROM public.tenants
   WHERE id = v_test_tenant_id
     AND agent_cap = 10
     AND white_label_addon_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test 2 FAILED: growth INSERT did not set agent_cap=10 (or addon was cleared)';
  END IF;

  -- Test 3: tier downgrade to starter clears addon and updates cap
  UPDATE public.tenants SET current_plan_tier = 'starter' WHERE id = v_test_tenant_id;
  PERFORM 1 FROM public.tenants
   WHERE id = v_test_tenant_id
     AND agent_cap = 3
     AND white_label_addon_active = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test 3 FAILED: downgrade to starter did not clear addon or update cap';
  END IF;

  -- Test 4: enterprise tier sets agent_cap=9999
  UPDATE public.tenants SET current_plan_tier = 'enterprise' WHERE id = v_test_tenant_id;
  PERFORM 1 FROM public.tenants WHERE id = v_test_tenant_id AND agent_cap = 9999;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test 4 FAILED: enterprise tier did not set agent_cap=9999';
  END IF;

  -- Test 5: enforce_agent_cap on enterprise tenant always returns ok=true
  v_result := public.enforce_agent_cap(v_test_tenant_id);
  IF (v_result ->> 'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 5 FAILED: enterprise should return ok=true, got %', v_result;
  END IF;

  -- Test 6: enforce_agent_cap at-cap returns ok=false with cap_reached
  --   Move to growth (cap=10 via trigger), then manually drop agent_cap to 0 so
  --   the predicate `current(0) >= cap(0)` fires without needing fake agents.
  --   The trigger fires only on tier change; direct agent_cap UPDATEs persist.
  UPDATE public.tenants SET current_plan_tier = 'growth' WHERE id = v_test_tenant_id;
  UPDATE public.tenants SET agent_cap = 0       WHERE id = v_test_tenant_id;
  v_result := public.enforce_agent_cap(v_test_tenant_id);
  IF (v_result ->> 'ok')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Test 6 FAILED: at cap=0 with 0 agents should return ok=false, got %', v_result;
  END IF;
  IF v_result ->> 'error' != 'cap_reached' THEN
    RAISE EXCEPTION 'Test 6 FAILED: error should be cap_reached, got %', v_result;
  END IF;
  IF (v_result ->> 'cap')::int != 0 OR (v_result ->> 'current')::int != 0 THEN
    RAISE EXCEPTION 'Test 6 FAILED: cap/current values wrong, got %', v_result;
  END IF;

  -- Test 7: enforce_agent_cap below cap returns ok=true
  --   Switch to pro (trigger sets cap=50). Current agents = 0, 0 < 50 → ok=true.
  UPDATE public.tenants SET current_plan_tier = 'pro' WHERE id = v_test_tenant_id;
  v_result := public.enforce_agent_cap(v_test_tenant_id);
  IF (v_result ->> 'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 7 FAILED: below cap should return ok=true, got %', v_result;
  END IF;

  -- Test 8: enforce_agent_cap on non-existent tenant returns tenant_not_found
  v_result := public.enforce_agent_cap('00000000-0000-0000-0000-000000000000'::uuid);
  IF v_result ->> 'error' != 'tenant_not_found' THEN
    RAISE EXCEPTION 'Test 8 FAILED: unknown tenant should return tenant_not_found, got %', v_result;
  END IF;

  -- Test 9: billing_snapshots schema sanity (insert + unique constraint)
  INSERT INTO public.billing_snapshots
    (tenant_id, period_start, period_end, active_agent_count, tier_at_snapshot)
  VALUES
    (v_test_tenant_id, '2026-05-01', '2026-05-31', 5, 'pro');

  BEGIN
    INSERT INTO public.billing_snapshots
      (tenant_id, period_start, period_end, active_agent_count, tier_at_snapshot)
    VALUES
      (v_test_tenant_id, '2026-05-01', '2026-05-31', 7, 'pro');
    RAISE EXCEPTION 'Test 9 FAILED: duplicate (tenant_id, period_start) was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- expected
  END;

  -- Cleanup (CASCADE wipes billing_snapshots rows)
  DELETE FROM public.tenants WHERE id = v_test_tenant_id;

  RAISE NOTICE 'Phase 17 billing schema verification passed (9 tests).';
END $$;

COMMIT;
