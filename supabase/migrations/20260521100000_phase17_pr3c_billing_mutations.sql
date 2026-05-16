-- =============================================================================
-- Phase 17 PR 3c — tenants.billing_interval
--
-- SCOPE:
--   1. Adds a NOT NULL text column billing_interval to tenants, default
--      'monthly'. Existing rows get backfilled to 'monthly' (correct value:
--      pre-3c the only supported interval was monthly).
--   2. CHECK constraint restricts the value to ('monthly','annual').
--   3. Composite index on (current_plan_tier, billing_interval) supports the
--      typical "owners on annual Growth" segmentation queries that the
--      operator may run from psql.
--
-- Why NO CHECK for enterprise + annual:
--   Enterprise+annual is structurally impossible at the catalog layer —
--   there is no annual enterprise price ID. Validation lives in:
--     - tier-resolver.ts (errors[] surface)
--     - create-checkout-session/index.ts (400 enterprise_annual_not_supported)
--     - billing-mutate-handler.ts (400 enterprise_annual_not_supported)
--   Adding a DB CHECK would require extending the PR 1 trigger and is
--   redundant; we accept the trade-off (decision §9 in S-1).
--
-- Webhook responsibility:
--   stripe-webhook re-resolves billing_interval on every
--   customer.subscription.created/updated event from the tier-resolver's
--   interval discriminator. No backfill from Stripe needed at apply time
--   because PR 3c is the first PR to introduce annual prices anyway.
-- =============================================================================

BEGIN;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS billing_interval text NOT NULL DEFAULT 'monthly';

-- Idempotent CHECK install. Drop-then-recreate so re-apply on a partially
-- migrated database lands cleanly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'tenants_billing_interval_check'
       AND conrelid = 'public.tenants'::regclass
  ) THEN
    ALTER TABLE public.tenants DROP CONSTRAINT tenants_billing_interval_check;
  END IF;

  ALTER TABLE public.tenants
    ADD CONSTRAINT tenants_billing_interval_check
    CHECK (billing_interval IN ('monthly','annual'));
END $$;

CREATE INDEX IF NOT EXISTS tenants_billing_interval_idx
  ON public.tenants (current_plan_tier, billing_interval);

-- Internal verification — runs at apply time. A failure aborts the migration.
DO $$
DECLARE
  v_data_type    text;
  v_is_nullable  text;
  v_column_default text;
  v_check_present boolean;
BEGIN
  SELECT data_type, is_nullable, column_default
    INTO v_data_type, v_is_nullable, v_column_default
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'tenants'
     AND column_name = 'billing_interval';

  IF v_data_type IS NULL THEN
    RAISE EXCEPTION 'phase17_pr3c verification FAILED: tenants.billing_interval column not present';
  END IF;
  IF v_data_type <> 'text' THEN
    RAISE EXCEPTION 'phase17_pr3c verification FAILED: expected text, got %', v_data_type;
  END IF;
  IF v_is_nullable <> 'NO' THEN
    RAISE EXCEPTION 'phase17_pr3c verification FAILED: column must be NOT NULL, got is_nullable=%', v_is_nullable;
  END IF;
  IF v_column_default IS NULL OR v_column_default NOT LIKE '%monthly%' THEN
    RAISE EXCEPTION 'phase17_pr3c verification FAILED: expected default monthly, got %', v_column_default;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'tenants_billing_interval_check'
       AND conrelid = 'public.tenants'::regclass
  ) INTO v_check_present;

  IF NOT v_check_present THEN
    RAISE EXCEPTION 'phase17_pr3c verification FAILED: tenants_billing_interval_check constraint missing';
  END IF;

  RAISE NOTICE 'Phase 17 PR 3c verification passed: tenants.billing_interval is text NOT NULL default monthly, CHECK enforces (monthly|annual).';
END $$;

COMMIT;
