-- Phase 15.1: Smart setup wizard.
--
-- Replaces the previous flag-based wizard (owner clicks 'Mark complete' to
-- check off each row; nothing was verified) with auto-detection driven by
-- the actual underlying data.
--
-- The new tenant_setup_status() RPC runs live detection queries on each
-- call and returns a step-by-step snapshot. The UI renders auto-detected
-- ticks as read-only; manual 'Mark complete' is exposed only on the two
-- steps that genuinely require explicit acknowledgment (webhook deferral
-- + final mark-complete).
--
-- Step → detection signal:
--   agency_profile      — tenant row exists with name + slug.
--                         (Always true once the wizard renders — kept
--                         for completeness so the UI shows a clean tick
--                         instead of an empty first row.)
--   positions_blueprint — >= 2 active comp_grid_positions exist.
--                         (Signup auto-seeds 4 positions so this is true
--                         on first render; if the owner archives all but
--                         one rung the step reverts to incomplete.)
--   first_carrier       — at least 1 active comp_grid_carriers row.
--   invite_agent        — >= 2 non-archived agents exist (owner + 1+).
--   webhook             — manual flag in tenant_setup_state. Webhook
--                         engine ships in a later phase; this step is
--                         optional, so an explicit 'mark complete' lets
--                         the owner clear it from the checklist now.
--   mark_complete       — manual flag in tenant_setup_state. The final
--                         acknowledgment — owner says 'I'm done with
--                         setup' which hides the banner from the
--                         dashboard from then on.
--
-- The legacy tenant_setup_state table is retained for the two manual
-- rows only. The mark_setup_step_complete RPC stays as their writer.
-- The four auto-detected steps no longer use the table.

BEGIN;

CREATE OR REPLACE FUNCTION public.tenant_setup_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id            uuid;
    v_agency_profile       boolean;
    v_positions            boolean;
    v_carrier              boolean;
    v_invited              boolean;
    v_webhook_manual       boolean;
    v_mark_complete_manual boolean;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;

    -- Step 1: agency_profile — tenant row exists with name + slug.
    v_agency_profile := EXISTS (
        SELECT 1 FROM public.tenants
         WHERE id = v_tenant_id
           AND NULLIF(trim(name), '') IS NOT NULL
           AND NULLIF(trim(slug), '') IS NOT NULL
    );

    -- Step 2: positions_blueprint — at least 2 active rungs configured.
    v_positions := (
        SELECT COUNT(*) >= 2
          FROM public.comp_grid_positions
         WHERE tenant_id = v_tenant_id AND is_active = TRUE
    );

    -- Step 3: first_carrier — at least 1 active carrier.
    v_carrier := EXISTS (
        SELECT 1 FROM public.comp_grid_carriers
         WHERE tenant_id = v_tenant_id AND is_active = TRUE
    );

    -- Step 4: invite_agent — at least 2 non-archived agents (owner + 1+).
    v_invited := (
        SELECT COUNT(*) >= 2
          FROM public.agents
         WHERE tenant_id = v_tenant_id AND status <> 'archived'
    );

    -- Step 5: webhook — manual flag.
    v_webhook_manual := EXISTS (
        SELECT 1 FROM public.tenant_setup_state
         WHERE tenant_id = v_tenant_id AND step_key = 'webhook'
    );

    -- Step 6: mark_complete — manual flag.
    v_mark_complete_manual := EXISTS (
        SELECT 1 FROM public.tenant_setup_state
         WHERE tenant_id = v_tenant_id AND step_key = 'mark_complete'
    );

    RETURN jsonb_build_object(
        'success', true,
        'steps', jsonb_build_array(
            jsonb_build_object('key', 'agency_profile',      'complete', v_agency_profile,       'mode', 'auto'),
            jsonb_build_object('key', 'positions_blueprint', 'complete', v_positions,            'mode', 'auto'),
            jsonb_build_object('key', 'first_carrier',       'complete', v_carrier,              'mode', 'auto'),
            jsonb_build_object('key', 'invite_agent',        'complete', v_invited,              'mode', 'auto'),
            jsonb_build_object('key', 'webhook',             'complete', v_webhook_manual,       'mode', 'manual'),
            jsonb_build_object('key', 'mark_complete',       'complete', v_mark_complete_manual, 'mode', 'manual')
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_setup_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_setup_status() TO authenticated;

DO $$
BEGIN
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tenant_setup_status'),
           'tenant_setup_status function missing';
    RAISE NOTICE 'Phase 15.1 tenant_setup_status RPC verification passed.';
END $$;

COMMIT;
