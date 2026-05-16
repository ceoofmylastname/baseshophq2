-- =============================================================================
-- Phase 18 PR 3 — stripe_webhook_events.error column + auth_user_id_by_email RPC
--
-- SCOPE:
--   1. Add a nullable text column `error` to public.stripe_webhook_events. The
--      stripe-webhook handler writes a structured failure summary to this
--      column when new_signup provisioning rolls back, so operators can read
--      the full chain-of-failures (original error + any cleanup failures)
--      without grepping Edge Function logs.
--   2. Add SECURITY DEFINER RPC public.auth_user_id_by_email(text) returning
--      the auth.users.id for a given lowercase email, or NULL. Service-role
--      only. Used by new-signup-provisioning.ts step (c.i) to resolve an
--      existing auth user when admin.auth.admin.createUser reports the
--      address as already registered.
--
-- WHY NULLABLE on the error column:
--   Successful runs leave this NULL. Only error / rollback paths populate it.
--   The webhook still stamps `processed_at` to short-circuit Stripe retries on
--   our own validation bugs (see new-signup-provisioning.ts step b).
--
-- VERIFICATIONS (3 DO-blocks per locked plan):
--   (a) error column exists
--   (b) error column is nullable
--   (c) insert a test row with error='test' and verify it lands (then clean
--       up the test row in the same DO-block).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Add the column
-- -----------------------------------------------------------------------------
ALTER TABLE public.stripe_webhook_events
    ADD COLUMN IF NOT EXISTS error text;

COMMENT ON COLUMN public.stripe_webhook_events.error IS
    'Phase 18 PR 3. Structured failure summary written by new-signup-provisioning.ts when rollback runs. NULL on success. Format: "original: <step>: <msg>" plus an optional second line "rollback: <step>=ok|failed: ..." when any cleanup step failed.';


-- -----------------------------------------------------------------------------
-- 2. public.auth_user_id_by_email(text) — SECURITY DEFINER, service_role only
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER required because: cross-schema read of auth.users which service_role owns; the public schema needs the auth.users.id for a known email to resolve idempotency after admin.auth.admin.createUser reports a duplicate.
CREATE OR REPLACE FUNCTION public.auth_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp, pg_catalog
AS $$
    SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.auth_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.auth_user_id_by_email(text) TO service_role;

COMMENT ON FUNCTION public.auth_user_id_by_email(text) IS
    'Phase 18 PR 3. Returns auth.users.id for a given email (case-insensitive) or NULL. Service-role only. Used by stripe-webhook new_signup provisioning to resolve an existing auth user when admin.createUser reports a duplicate.';


-- -----------------------------------------------------------------------------
-- 3. Verification — 3 DO-blocks (per locked plan)
-- -----------------------------------------------------------------------------

-- (a) error_column_exists — column is present
DO $$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*) INTO v_count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'stripe_webhook_events'
      AND column_name  = 'error';
    ASSERT v_count = 1,
        format('error_column_exists FAILED: expected 1 column named error, found %s', v_count);
    RAISE NOTICE 'Verification 1/3 passed: error_column_exists.';
END $$;

-- (b) error_column_nullable — column is nullable
DO $$
DECLARE
    v_nullable text;
    v_data_type text;
BEGIN
    SELECT is_nullable, data_type INTO v_nullable, v_data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'stripe_webhook_events'
      AND column_name  = 'error';
    ASSERT v_nullable = 'YES',
        format('error_column_nullable FAILED: expected nullable, got is_nullable=%s', COALESCE(v_nullable, '<missing>'));
    ASSERT v_data_type = 'text',
        format('error_column_nullable FAILED: expected text, got data_type=%s', COALESCE(v_data_type, '<missing>'));
    RAISE NOTICE 'Verification 2/3 passed: error_column_nullable.';
END $$;

-- (c) error_insert_roundtrip — insert a test row with error='test', verify it
-- lands, then clean up. Uses a synthetic event_id with a 'phase18_pr3_verify_'
-- prefix so a parallel run cannot collide with a real event.
DO $$
DECLARE
    v_test_event_id text := 'phase18_pr3_verify_' || replace(gen_random_uuid()::text, '-', '');
    v_read_error    text;
BEGIN
    INSERT INTO public.stripe_webhook_events (event_id, event_type, raw, error)
    VALUES (v_test_event_id, 'phase18_pr3_verify', '{}'::jsonb, 'test');

    SELECT error INTO v_read_error
    FROM public.stripe_webhook_events
    WHERE event_id = v_test_event_id;

    ASSERT v_read_error = 'test',
        format('error_insert_roundtrip FAILED: expected error=test, got %s', COALESCE(v_read_error, '<null>'));

    -- Clean up the test row (do this in the same DO-block so a future
    -- re-application of this migration finds a clean table).
    DELETE FROM public.stripe_webhook_events WHERE event_id = v_test_event_id;

    RAISE NOTICE 'Verification 3/3 passed: error_insert_roundtrip.';
END $$;

COMMIT;
