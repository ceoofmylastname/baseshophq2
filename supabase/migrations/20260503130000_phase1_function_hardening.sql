-- Phase 1 follow-up: harden function grants and search_path.
-- Triggered by Supabase advisor warnings post-apply of phase1_auth_tenants_agents.
--
-- 1. set_updated_at was missing SET search_path. Add it (matches every other
--    helper function in the prior migration).
-- 2. Trigger-only functions (resolve_upline_agent_id, backfill_orphan_upline_pointers,
--    set_updated_at) should not be invocable as REST RPCs. Revoke from anon and
--    authenticated explicitly — REVOKE FROM PUBLIC alone is not enough on Supabase
--    because anon/authenticated may carry default grants from role membership.
--    Triggers fire as the table owner regardless of EXECUTE grants on the function.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_upline_agent_id()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.backfill_orphan_upline_pointers() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at()                  FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
    v_anon_can_execute INTEGER;
    v_auth_can_execute INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_anon_can_execute
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('resolve_upline_agent_id', 'backfill_orphan_upline_pointers', 'set_updated_at')
      AND has_function_privilege('anon', p.oid, 'EXECUTE');

    SELECT COUNT(*) INTO v_auth_can_execute
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('resolve_upline_agent_id', 'backfill_orphan_upline_pointers', 'set_updated_at')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

    ASSERT v_anon_can_execute = 0, format('expected 0 anon-executable trigger functions, found %s', v_anon_can_execute);
    ASSERT v_auth_can_execute = 0, format('expected 0 authenticated-executable trigger functions, found %s', v_auth_can_execute);

    RAISE NOTICE 'Phase 1 hardening verification passed.';
END $$;
