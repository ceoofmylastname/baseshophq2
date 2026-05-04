-- =============================================================================
-- Baseshop HQ — Phase 6a: agents directory + add_agent_to_tenant RPC
-- Target: Supabase project oarstmxbgdczytwzpyxj
-- Status: DRAFT — do not apply until user green-lights
--
-- Three artifacts:
--
--   1. agents_with_current_position VIEW
--      LEFT JOIN agents to agent_positions (current open row) and
--      comp_grid_positions. Reads upline_email DIRECTLY from agents.upline_email
--      (Phase 1 canonical field) — no second JOIN to agents to resolve the
--      upline's name. Avoids RLS edge cases and keeps the view minimal.
--      Inherits RLS from the underlying agents table (security_invoker default).
--
--   2. check_email_exists_in_auth(email) RPC (service-role only)
--      Returns TRUE if a user with this email already exists in auth.users
--      (any tenant). Edge function calls this BEFORE inviteUserByEmail to
--      surface a deterministic error_code='email_already_in_use' instead of
--      relying on inviteUserByEmail's error message text.
--
--   3. add_agent_to_tenant(caller, new_user_id, email, first, last, upline_email) RPC
--      Service-role only. Called by the add-agent edge function AFTER
--      auth.users has been invited. Inserts agents row; the Phase 1
--      resolve_upline_agent_id trigger handles the upline_agent_id FK.
--      Returns structured result with error_code branches for all
--      failure modes the edge function needs to map.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. agents_with_current_position view
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.agents_with_current_position
WITH (security_invoker = true)
AS
SELECT
    a.id,
    a.tenant_id,
    a.email,
    a.first_name,
    a.last_name,
    a.phone,
    a.npn,
    a.is_owner,
    a.status,
    a.upline_email,                          -- direct from agents row (Phase 1 canonical field)
    a.created_at,
    a.updated_at,
    a.last_login_at,
    ap.id           AS current_assignment_id,
    ap.position_id  AS current_position_id,
    ap.start_date   AS current_position_start_date,
    cgp.position_code AS current_position_code,
    cgp.position_name AS current_position_name,
    cgp.sort_order    AS current_position_sort_order,
    cgp.is_commissioned AS current_position_is_commissioned
FROM public.agents a
LEFT JOIN public.agent_positions ap
       ON ap.agent_id = a.id AND ap.end_date IS NULL
LEFT JOIN public.comp_grid_positions cgp
       ON cgp.id = ap.position_id;

GRANT SELECT ON public.agents_with_current_position TO authenticated;


-- -----------------------------------------------------------------------------
-- 2. check_email_exists_in_auth
-- -----------------------------------------------------------------------------
-- Used by the add-agent edge function to deterministically detect when an
-- email is already registered in auth.users (any tenant). Avoids parsing
-- inviteUserByEmail error text.
CREATE OR REPLACE FUNCTION public.check_email_exists_in_auth(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = lower(p_email));
$$;

REVOKE EXECUTE ON FUNCTION public.check_email_exists_in_auth(TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_email_exists_in_auth(TEXT)
    TO service_role;


-- -----------------------------------------------------------------------------
-- 3. add_agent_to_tenant
-- -----------------------------------------------------------------------------
-- Called AFTER inviteUserByEmail by the edge function. Validates the caller
-- is the owner of their tenant, then inserts the agents row.
--
-- Returns structured { success, agent_id, tenant_id, error_code, error_message }.
-- error_code values:
--   - validation_failed         (empty fields, bad email format, etc.)
--   - caller_not_owner          (caller is authenticated but not is_owner)
--   - caller_no_agent_record    (auth user has no agents row — orphan auth)
--   - new_user_not_found        (p_new_user_id missing from auth.users — should not
--                                happen since edge function created it)
--   - email_already_in_tenant   (UNIQUE (tenant_id, email) violated — race condition
--                                if two adds raced; impossible in single-owner UX)
--
-- Email-already-in-AUTH is detected by the edge function via check_email_exists_in_auth
-- BEFORE this RPC is called.
CREATE OR REPLACE FUNCTION public.add_agent_to_tenant(
    p_caller_user_id  UUID,
    p_new_user_id     UUID,
    p_email           TEXT,
    p_first_name      TEXT,
    p_last_name       TEXT,
    p_upline_email    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_is_owner   BOOLEAN;
    v_tenant_id         UUID;
    v_new_agent_id      UUID;
BEGIN
    -- Validation
    IF p_caller_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'validation_failed',
            'error_message', 'p_caller_user_id is required');
    END IF;
    IF p_new_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'validation_failed',
            'error_message', 'p_new_user_id is required');
    END IF;
    IF p_email IS NULL OR trim(p_email) = '' OR p_email NOT LIKE '%@%' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'validation_failed',
            'error_message', 'valid email is required');
    END IF;
    IF p_first_name IS NULL OR trim(p_first_name) = '' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'validation_failed',
            'error_message', 'first name is required');
    END IF;
    IF p_last_name IS NULL OR trim(p_last_name) = '' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'validation_failed',
            'error_message', 'last name is required');
    END IF;

    -- Resolve caller's tenant + owner status
    SELECT tenant_id, is_owner INTO v_tenant_id, v_caller_is_owner
    FROM public.agents WHERE id = p_caller_user_id;

    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'caller_no_agent_record',
            'error_message', 'caller has no agents row');
    END IF;
    IF NOT v_caller_is_owner THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'caller_not_owner',
            'error_message', 'only the tenant owner can add agents');
    END IF;

    -- Verify new auth user exists (edge function created it)
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_new_user_id) THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'new_user_not_found',
            'error_message', 'p_new_user_id does not exist in auth.users');
    END IF;

    -- Insert agent. Phase 1 resolve_upline_agent_id trigger handles upline FK.
    BEGIN
        INSERT INTO public.agents (
            id, tenant_id, email, first_name, last_name,
            is_owner, status, upline_email
        )
        VALUES (
            p_new_user_id, v_tenant_id, lower(trim(p_email)),
            trim(p_first_name), trim(p_last_name),
            FALSE, 'active',
            CASE WHEN p_upline_email IS NULL OR trim(p_upline_email) = '' THEN NULL
                 ELSE lower(trim(p_upline_email))
            END
        )
        RETURNING id INTO v_new_agent_id;
    EXCEPTION
        WHEN unique_violation THEN
            RETURN jsonb_build_object('success', false, 'error_code', 'email_already_in_tenant',
                'error_message', 'an agent with this email already exists in the tenant');
    END;

    RETURN jsonb_build_object(
        'success', true,
        'agent_id', v_new_agent_id,
        'tenant_id', v_tenant_id,
        'error_code', NULL,
        'error_message', NULL
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_agent_to_tenant(UUID, UUID, TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_agent_to_tenant(UUID, UUID, TEXT, TEXT, TEXT, TEXT)
    TO service_role;


-- -----------------------------------------------------------------------------
-- 4. Verification
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'agents_with_current_position'
    ), 'agents_with_current_position view missing';

    ASSERT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'check_email_exists_in_auth' AND pronamespace = 'public'::regnamespace
    ), 'check_email_exists_in_auth missing';

    ASSERT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'add_agent_to_tenant' AND pronamespace = 'public'::regnamespace
    ), 'add_agent_to_tenant missing';

    -- Service role only on both RPCs
    ASSERT NOT has_function_privilege('anon', 'public.check_email_exists_in_auth(text)', 'EXECUTE');
    ASSERT NOT has_function_privilege('authenticated', 'public.check_email_exists_in_auth(text)', 'EXECUTE');
    ASSERT has_function_privilege('service_role', 'public.check_email_exists_in_auth(text)', 'EXECUTE');

    ASSERT NOT has_function_privilege('anon', 'public.add_agent_to_tenant(uuid, uuid, text, text, text, text)', 'EXECUTE');
    ASSERT NOT has_function_privilege('authenticated', 'public.add_agent_to_tenant(uuid, uuid, text, text, text, text)', 'EXECUTE');
    ASSERT has_function_privilege('service_role', 'public.add_agent_to_tenant(uuid, uuid, text, text, text, text)', 'EXECUTE');

    -- View grant: authenticated SELECT
    ASSERT has_table_privilege('authenticated', 'public.agents_with_current_position', 'SELECT'),
        'authenticated should SELECT agents_with_current_position';

    RAISE NOTICE 'Phase 6a verification passed.';
END $$;

COMMIT;
