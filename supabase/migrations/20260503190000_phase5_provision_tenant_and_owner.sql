-- =============================================================================
-- Baseshop HQ — Phase 5: provision_tenant_and_owner RPC + agents self-select RLS
-- Target: Supabase project oarstmxbgdczytwzpyxj
-- Status: DRAFT — do not apply until user green-lights
--
-- Two artifacts:
--
--   1. agents_select_self RLS policy
--      Lets an authenticated user always SELECT their own agents row by
--      id = auth.uid(), independent of tenant context. Resolves the
--      chicken-and-egg in the AuthContext bootstrap query: when a user
--      logs in, the AuthContext queries `agents` for the user's row, but
--      the existing agents_select_visible policy depends on
--      current_tenant_id() which itself reads from agents. SECURITY DEFINER
--      bypass means the existing policy DOES work in the happy path, but a
--      defensive self-select policy unblocks the broken intermediate state
--      (e.g. signup edge function failed midway leaving an orphan
--      auth.users row).
--
--      Multiple SELECT policies are OR'd in Postgres RLS, so this policy
--      is purely additive — does not weaken agents_select_visible.
--
--   2. provision_tenant_and_owner(uuid, text, text, text, text, text, jsonb)
--      Atomic transactional RPC called by the signup edge function AFTER
--      auth.users has been created. Inserts tenants + owner agent + wires
--      tenants.owner_agent_id + bootstraps the Agora master grid via
--      bootstrap_agora_grid_for_tenant.
--
--      Returns structured result:
--        { success: bool,
--          tenant_id: uuid | null,
--          tenant_slug: text | null,
--          agent_id: uuid | null,
--          bootstrap: jsonb | null,
--          error_code: text | null,
--          error_message: text | null }
--
--      error_code values (caller-actionable):
--        - validation_failed     (slug regex, empty fields, etc.)
--        - auth_user_not_found   (no auth.users row for p_owner_user_id)
--        - user_already_has_tenant
--        - slug_collision        (tenants.slug UNIQUE violated)
--
--      ROLLBACK PATH (edge function responsibility):
--        The auth.users row is created BEFORE this RPC by the signup edge
--        function. If this RPC returns success=false, OR raises an exception
--        (e.g. bootstrap failure), the edge function MUST call
--        supabase.auth.admin.deleteUser(p_owner_user_id) to roll back the
--        auth.users row. Documented in supabase/functions/signup/index.ts.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Convention: agents.email is stored lowercased
-- -----------------------------------------------------------------------------
-- Document the lowercase-on-insert convention. The Phase 1 UNIQUE constraint
-- on (tenant_id, email) is case-sensitive at the DB level, so application code
-- (this RPC, Phase 4b-1's match_agent_by_email which lowercases on lookup,
-- the eventual signup paths and bulk-import flows) must lowercase before
-- INSERT. Otherwise "JOHN@example.com" and "john@example.com" would land as
-- distinct rows but match the same lookup, creating a real reconciliation bug.
COMMENT ON COLUMN public.agents.email IS
    'Stored lowercase (LOWER(TRIM(email))). Application code must lowercase before INSERT/UPDATE. The Phase 1 UNIQUE (tenant_id, email) constraint is case-sensitive; lowercase-on-write keeps the match_agent_by_email lookup from drifting against the insert path.';

-- -----------------------------------------------------------------------------
-- 1. agents_select_self policy (flag C)
-- -----------------------------------------------------------------------------
CREATE POLICY agents_select_self
    ON public.agents FOR SELECT
    TO authenticated
    USING (id = auth.uid());


-- -----------------------------------------------------------------------------
-- 2. provision_tenant_and_owner RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_tenant_and_owner(
    p_owner_user_id     UUID,
    p_owner_email       TEXT,
    p_owner_first_name  TEXT,
    p_owner_last_name   TEXT,
    p_tenant_name       TEXT,
    p_tenant_slug       TEXT,
    p_agora_payload     JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id  UUID;
    v_agent_id   UUID;
    v_bootstrap  JSONB;
BEGIN
    -- Validation: required fields
    IF p_owner_user_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false, 'error_code', 'validation_failed',
            'error_message', 'p_owner_user_id is required'
        );
    END IF;

    IF p_owner_email IS NULL OR trim(p_owner_email) = '' THEN
        RETURN jsonb_build_object(
            'success', false, 'error_code', 'validation_failed',
            'error_message', 'owner email is required'
        );
    END IF;

    IF p_owner_first_name IS NULL OR trim(p_owner_first_name) = '' THEN
        RETURN jsonb_build_object(
            'success', false, 'error_code', 'validation_failed',
            'error_message', 'owner first name is required'
        );
    END IF;

    IF p_owner_last_name IS NULL OR trim(p_owner_last_name) = '' THEN
        RETURN jsonb_build_object(
            'success', false, 'error_code', 'validation_failed',
            'error_message', 'owner last name is required'
        );
    END IF;

    IF p_tenant_name IS NULL OR trim(p_tenant_name) = '' THEN
        RETURN jsonb_build_object(
            'success', false, 'error_code', 'validation_failed',
            'error_message', 'tenant name is required'
        );
    END IF;

    IF p_tenant_slug IS NULL OR p_tenant_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
        RETURN jsonb_build_object(
            'success', false, 'error_code', 'validation_failed',
            'error_message', 'tenant slug must match ^[a-z0-9]+(-[a-z0-9]+)*$'
        );
    END IF;

    IF p_agora_payload IS NULL THEN
        RETURN jsonb_build_object(
            'success', false, 'error_code', 'validation_failed',
            'error_message', 'agora payload is required'
        );
    END IF;

    -- auth.users row must exist (edge function created it)
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_owner_user_id) THEN
        RETURN jsonb_build_object(
            'success', false, 'error_code', 'auth_user_not_found',
            'error_message', 'no auth.users row for the given user_id'
        );
    END IF;

    -- Idempotency: this user must not already be linked to a tenant
    IF EXISTS (SELECT 1 FROM public.agents WHERE id = p_owner_user_id) THEN
        RETURN jsonb_build_object(
            'success', false, 'error_code', 'user_already_has_tenant',
            'error_message', 'this user is already linked to a tenant'
        );
    END IF;

    -- Insert tenant. Catch slug collision; let other constraint failures surface.
    BEGIN
        INSERT INTO public.tenants (name, slug)
        VALUES (trim(p_tenant_name), p_tenant_slug)
        RETURNING id INTO v_tenant_id;
    EXCEPTION
        WHEN unique_violation THEN
            RETURN jsonb_build_object(
                'success', false, 'error_code', 'slug_collision',
                'error_message', format('tenant slug %s is already taken', p_tenant_slug)
            );
        WHEN check_violation THEN
            RETURN jsonb_build_object(
                'success', false, 'error_code', 'validation_failed',
                'error_message', 'tenant slug failed regex check'
            );
    END;

    -- Insert owner agent
    INSERT INTO public.agents (
        id, tenant_id, email, first_name, last_name, is_owner, status
    )
    VALUES (
        p_owner_user_id, v_tenant_id, lower(trim(p_owner_email)),
        trim(p_owner_first_name), trim(p_owner_last_name), TRUE, 'active'
    )
    RETURNING id INTO v_agent_id;

    -- Wire owner_agent_id
    UPDATE public.tenants SET owner_agent_id = v_agent_id WHERE id = v_tenant_id;

    -- Bootstrap Agora master grid. Exceptions propagate — caller (edge fn)
    -- catches and rolls back auth.users via supabase.auth.admin.deleteUser.
    v_bootstrap := public.bootstrap_agora_grid_for_tenant(v_tenant_id, p_agora_payload);

    RETURN jsonb_build_object(
        'success',     true,
        'tenant_id',   v_tenant_id,
        'tenant_slug', p_tenant_slug,
        'agent_id',    v_agent_id,
        'bootstrap',   v_bootstrap,
        'error_code',  NULL,
        'error_message', NULL
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.provision_tenant_and_owner(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_tenant_and_owner(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
    TO service_role;


-- -----------------------------------------------------------------------------
-- 3. Verification
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    -- Self-select policy present
    ASSERT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'agents' AND policyname = 'agents_select_self'
    ), 'agents_select_self policy missing';

    -- RPC present + service-role only
    ASSERT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'provision_tenant_and_owner' AND pronamespace = 'public'::regnamespace
    ), 'provision_tenant_and_owner missing';

    ASSERT NOT has_function_privilege('anon',
        'public.provision_tenant_and_owner(uuid, text, text, text, text, text, jsonb)', 'EXECUTE');
    ASSERT NOT has_function_privilege('authenticated',
        'public.provision_tenant_and_owner(uuid, text, text, text, text, text, jsonb)', 'EXECUTE');
    ASSERT has_function_privilege('service_role',
        'public.provision_tenant_and_owner(uuid, text, text, text, text, text, jsonb)', 'EXECUTE');

    RAISE NOTICE 'Phase 5 provision RPC + agents self-select RLS verification passed.';
END $$;

COMMIT;
