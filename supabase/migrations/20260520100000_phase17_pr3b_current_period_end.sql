-- =============================================================================
-- Phase 17 PR 3b — tenants.current_period_end
--
-- SCOPE:
--   1. Adds a nullable timestamptz column current_period_end to tenants.
--   2. The stripe-webhook Edge Function (patched in this PR) extracts
--      obj.current_period_end from customer.subscription.created/updated
--      events and converts Unix seconds → ISO timestamptz, writing here.
--   3. useBillingState reads this directly to render the "Renews on / Cancels
--      on" line in the tier card and to drive the past_due deadline math.
--
-- Why a new column rather than expanding state-mapping.ts:
--   The renewal cutoff is per-tenant runtime state that lives on the tenant
--   row, not a derivation of static config. Putting it in a column keeps
--   the page hook trivial (one row read) and keeps the webhook's pure
--   state-mapper free of side-effects.
-- =============================================================================

BEGIN;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz;

-- Internal verification — runs at apply time. A failure aborts the migration.
DO $$
DECLARE
  v_data_type   text;
  v_is_nullable text;
BEGIN
  SELECT data_type, is_nullable
    INTO v_data_type, v_is_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'tenants'
     AND column_name = 'current_period_end';

  IF v_data_type IS NULL THEN
    RAISE EXCEPTION 'phase17_pr3b verification FAILED: tenants.current_period_end column not present';
  END IF;
  IF v_data_type <> 'timestamp with time zone' THEN
    RAISE EXCEPTION 'phase17_pr3b verification FAILED: expected timestamp with time zone, got %', v_data_type;
  END IF;
  IF v_is_nullable <> 'YES' THEN
    RAISE EXCEPTION 'phase17_pr3b verification FAILED: column must be nullable, got is_nullable=%', v_is_nullable;
  END IF;

  RAISE NOTICE 'Phase 17 PR 3b verification passed: tenants.current_period_end is timestamptz, nullable.';
END $$;

COMMIT;
