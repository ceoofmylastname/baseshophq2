-- =============================================================================
-- Phase 18.1 — public.auth_user_has_password(uuid) RETURNS boolean
--
-- Returns TRUE iff the auth.users row identified by p_user_id has a non-null,
-- non-empty encrypted_password. Used by the dashboard's "Set Password" banner
-- and by the AccountSection password form to decide whether to render
-- "Set Your Password" (no current-password verification) or "Change Password"
-- (the existing manual re-auth check from Phase 16.0 still gates it).
--
-- Body returns boolean ONLY — no PII leaks. No email, no token, no hash.
--
-- LOCKED guardrails:
--   * SECURITY DEFINER with exact justification comment (parent locked)
--   * LANGUAGE sql STABLE
--   * SET search_path = public, pg_temp, pg_catalog
--   * REVOKE EXECUTE FROM PUBLIC, anon
--   * GRANT EXECUTE TO authenticated
--   * 2 internal DO-block verifications:
--       (a) rpc_signature_and_grants — exists with SECURITY DEFINER + STABLE +
--           locked search_path + correct EXECUTE matrix
--       (b) returns_expected_boolean — synthesizes a transient auth.users row,
--           confirms the RPC reports its expected boolean, cleans up
-- =============================================================================

BEGIN;

-- SECURITY DEFINER required because: reads auth.users.encrypted_password column which is in the auth schema that only postgres / supabase_auth_admin own. The function returns boolean only (no PII leak — no email, no token, no actual hash).
CREATE OR REPLACE FUNCTION public.auth_user_has_password(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp, pg_catalog
AS $$
    SELECT (encrypted_password IS NOT NULL AND encrypted_password != '')
    FROM auth.users
    WHERE id = p_user_id
$$;

REVOKE EXECUTE ON FUNCTION public.auth_user_has_password(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.auth_user_has_password(uuid) TO authenticated;

COMMENT ON FUNCTION public.auth_user_has_password(uuid) IS
    'Phase 18.1. Returns true iff auth.users.encrypted_password is set for the given user. Returns boolean only — no PII leak. Used by the dashboard PasswordSetupBanner + AccountSection password form.';


-- -----------------------------------------------------------------------------
-- Verification 1/2: rpc_signature_and_grants
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_prosecdef  boolean;
    v_provolatile char;
    v_search     text;
    v_anon_can   boolean;
    v_authd_can  boolean;
    v_public_can boolean;
BEGIN
    SELECT p.prosecdef, p.provolatile, array_to_string(p.proconfig, ',')
    INTO   v_prosecdef, v_provolatile, v_search
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'auth_user_has_password'
      AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid';

    ASSERT v_prosecdef IS TRUE,
        'rpc_signature_and_grants FAILED: auth_user_has_password is not SECURITY DEFINER (or missing)';
    ASSERT v_provolatile = 's',
        format('rpc_signature_and_grants FAILED: expected STABLE volatility (s), got %s', v_provolatile);
    ASSERT v_search LIKE '%search_path=public, pg_temp, pg_catalog%',
        format('rpc_signature_and_grants FAILED: locked search_path not set, got %s', COALESCE(v_search, '<null>'));

    v_public_can := has_function_privilege('public',        'public.auth_user_has_password(uuid)', 'EXECUTE');
    v_anon_can   := has_function_privilege('anon',          'public.auth_user_has_password(uuid)', 'EXECUTE');
    v_authd_can  := has_function_privilege('authenticated', 'public.auth_user_has_password(uuid)', 'EXECUTE');

    ASSERT v_public_can = FALSE,
        'rpc_signature_and_grants FAILED: PUBLIC should NOT have EXECUTE on auth_user_has_password';
    ASSERT v_anon_can   = FALSE,
        'rpc_signature_and_grants FAILED: anon should NOT have EXECUTE on auth_user_has_password';
    ASSERT v_authd_can  = TRUE,
        'rpc_signature_and_grants FAILED: authenticated SHOULD have EXECUTE on auth_user_has_password';

    RAISE NOTICE 'Verification 1/2 passed: rpc_signature_and_grants.';
END $$;


-- -----------------------------------------------------------------------------
-- Verification 2/2: returns_expected_boolean
--
-- Synthesize two transient auth.users rows (one with a password, one without),
-- assert the RPC returns the expected boolean for each, then clean up.
-- This runs inside the migration transaction; on COMMIT the test rows are
-- already deleted, so the auth.users table is left untouched.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_user_with_pw    uuid := gen_random_uuid();
    v_user_without_pw uuid := gen_random_uuid();
    v_with    boolean;
    v_without boolean;
    v_missing boolean;
BEGIN
    -- Insert two synthetic users. instance_id + the auth schema columns mirror
    -- what GoTrue writes; we only set the columns the RPC reads. NULL email
    -- is fine for this test — the RPC only inspects encrypted_password.
    INSERT INTO auth.users (id, instance_id, encrypted_password, aud, role)
    VALUES (v_user_with_pw,    '00000000-0000-0000-0000-000000000000', 'fake-hash-not-real', 'authenticated', 'authenticated');

    INSERT INTO auth.users (id, instance_id, encrypted_password, aud, role)
    VALUES (v_user_without_pw, '00000000-0000-0000-0000-000000000000', NULL,                 'authenticated', 'authenticated');

    SELECT public.auth_user_has_password(v_user_with_pw)    INTO v_with;
    SELECT public.auth_user_has_password(v_user_without_pw) INTO v_without;
    SELECT public.auth_user_has_password(gen_random_uuid()) INTO v_missing;

    ASSERT v_with = TRUE,
        'returns_expected_boolean FAILED: user with password should return true';
    ASSERT v_without = FALSE,
        'returns_expected_boolean FAILED: user with NULL password should return false';
    ASSERT v_missing IS NULL,
        format('returns_expected_boolean FAILED: missing user should return NULL, got %s', COALESCE(v_missing::text, '<null>'));

    -- Cleanup
    DELETE FROM auth.users WHERE id IN (v_user_with_pw, v_user_without_pw);

    RAISE NOTICE 'Verification 2/2 passed: returns_expected_boolean.';
END $$;

COMMIT;
