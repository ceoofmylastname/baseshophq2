-- Phase 1 follow-up #2: revoke RPC EXECUTE from anon on the user-facing
-- SECURITY DEFINER helpers. Authenticated still needs EXECUTE so RLS policies
-- can invoke these functions during permission evaluation.
--
-- Why: Supabase grants EXECUTE on functions in schema public to anon by default.
-- REVOKE FROM PUBLIC alone does not strip that explicit anon grant. The most
-- exposed of the four was descendants_of(uuid) — without this, an unauthenticated
-- caller could enumerate any agent's downline by hitting /rest/v1/rpc/descendants_of
-- with arbitrary UUIDs.
--
-- These functions remain SECURITY DEFINER (required for RLS to call them without
-- recursing into the policies they implement) and remain in public schema (RLS
-- policies reference them by unqualified name).

REVOKE EXECUTE ON FUNCTION public.current_tenant_id()         FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_owner()                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.descendants_of(UUID)        FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_view_agent(UUID)        FROM anon;

DO $$
DECLARE
    v_anon_executable INTEGER;
    v_auth_executable INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_anon_executable
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('current_tenant_id', 'is_owner', 'descendants_of', 'can_view_agent')
      AND has_function_privilege('anon', p.oid, 'EXECUTE');

    SELECT COUNT(*) INTO v_auth_executable
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('current_tenant_id', 'is_owner', 'descendants_of', 'can_view_agent')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

    ASSERT v_anon_executable = 0, format('expected 0 anon-executable user helpers, found %s', v_anon_executable);
    ASSERT v_auth_executable = 4, format('expected 4 authenticated-executable user helpers, found %s', v_auth_executable);

    RAISE NOTICE 'anon lockdown verified: anon=0, authenticated=4';
END $$;
