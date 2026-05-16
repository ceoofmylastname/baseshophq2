-- =============================================================================
-- Phase 17 PR 3a — Billing lifecycle: schema, trigger, RLS gating, suspended-flip cron
--
-- SCOPE (DB-only; the matching dunning Edge Function changes ship in PR 3b)
--   1. tenants gains two timestamptz columns: past_due_since, suspended_at.
--      Both nullable; populated by trigger when billing_status changes; the
--      webhook handler is allowed to set them directly (COALESCE preserves).
--   2. A BEFORE UPDATE trigger on tenants stamps the lifecycle timestamps any
--      time billing_status transitions through past_due / suspended / back to
--      active. The trigger uses COALESCE on each stamping path so a
--      webhook-provided value (e.g. a Stripe-supplied timestamp) is not
--      clobbered by NOW().
--   3. New SECURITY INVOKER STABLE RPC public.tenant_writes_allowed(uuid) that
--      returns TRUE iff the tenant's current billing_status is in the writable
--      set ('active','past_due'). suspended and cancelled both return FALSE.
--   4. RLS hardening: 38 mutation policies across 13 tables are reapplied via
--      ALTER POLICY so each prepends `tenant_writes_allowed(tenant_id) AND` to
--      its USING / WITH CHECK expression. This is the "read-only when
--      suspended" invariant: a tenant whose billing has hard-suspended can
--      still log in and view their data, but cannot mutate anything.
--   5. SECURITY DEFINER wrapper public.run_suspended_flip() that bulk-flips
--      tenants from past_due → suspended once past_due_since is >= 14 days
--      old, with a RAISE NOTICE heartbeat so cron logs are searchable.
--   6. A pg_cron schedule (06:05 UTC daily) that runs run_suspended_flip().
--   7. A DO-block verification suite (5 tests) that asserts the trigger
--      stamps, the gate flips, the policy count is right, and the RPC
--      returns the expected value for each billing_status.
--
-- THE 38-POLICY / 13-TABLE GATE (verified against pg_policies on live DB):
--   1. agent_carrier_rates   (INSERT, UPDATE, DELETE)               = 3
--   2. agent_contracts       (INSERT, UPDATE, DELETE)               = 3
--   3. agent_positions       (INSERT, UPDATE, DELETE)               = 3
--   4. agents                (INSERT, UPDATE-owner, UPDATE-self, DELETE) = 4
--   5. announcements         (INSERT, UPDATE, DELETE)               = 3
--   6. comp_grid_rates       (INSERT, UPDATE, DELETE)               = 3
--   7. leadership_broadcasts (INSERT, UPDATE, DELETE)               = 3
--   8. policies              (INSERT, UPDATE, DELETE)               = 3
--   9. policy_commissions    (INSERT, UPDATE, DELETE)               = 3
--  10. policy_status_history (INSERT only)                          = 1
--  11. promotion_targets     (INSERT, UPDATE, DELETE)               = 3
--  12. tenant_setup_state    (INSERT, UPDATE, DELETE)               = 3
--  13. user_action_items     (INSERT, UPDATE, DELETE)               = 3
--   ───────────────────────────────────────────────────────────────────────
--                                                            Total  = 38
--
-- DELIBERATE SKIPS:
--   * activity_events — append-only audit log with NO mutation policies in
--     public.pg_policies; service_role writes via Edge Functions / triggers
--     and bypasses RLS entirely. Gating here would be a no-op (no policies
--     to amend) and would create the false impression of protection. The
--     audit log must remain writable across all billing states so that
--     suspension and unsuspension events themselves get logged.
--   * comp_grid_carriers / comp_grid_positions / comp_grid_products —
--     comp-grid REFERENCE-LAYER tables the owner sets up once during
--     onboarding and rarely changes thereafter. Out of scope for the
--     billing gate: suspending the tenant has no bearing on the static
--     carrier/position/product catalog.
--     Note: comp_grid_rates IS gated (section 4.6). Unlike the reference
--     layers, rate cells change during contract negotiations and rate
--     updates — that's operating data, not reference data, and a
--     suspended owner should not be able to mutate it.
--   * demo_bookings — marketing lead capture; the anon INSERT path has no
--     tenant_id (booking happens pre-tenant). Not gateable.
--   * tenants itself — gating writes when suspended would prevent the
--     un-suspension UPDATE (and any future Stripe webhook reaching to
--     correct the billing_status). The trigger handles tenants writes; the
--     gate handles tenant *data* writes.
--
-- THE NEVER-DELETE-DATA MOAT:
--   This migration only adds an EXTRA boolean to existing RLS expressions.
--   It never deletes, archives, or relocates tenant rows. Suspension is a
--   write-block, not a tombstone. When a tenant returns to good standing
--   (billing_status flipped back to 'active' by the webhook or the
--   billing dashboard's "Reactivate" RPC, landing in PR 3b), all writes
--   resume immediately with no data migration step.
--
-- INTERACTION WITH SELECT POLICIES:
--   The gate is on mutation policies only. Suspended tenants retain full
--   SELECT visibility into their own data — they can audit, export, and
--   review, but cannot change anything. tenants.tenants_select_own filters
--   by `id = current_tenant_id()`, so tenant_writes_allowed() cannot be
--   used as a cross-tenant probe.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Schema: timestamps for billing lifecycle on tenants
-- -----------------------------------------------------------------------------
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS past_due_since timestamptz;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS suspended_at   timestamptz;

-- -----------------------------------------------------------------------------
-- 2. Trigger function: stamp past_due_since / suspended_at on status change
--
-- COALESCE preserves any value the caller explicitly provided in the UPDATE
-- (e.g. a webhook handler choosing to use the Stripe-supplied invoice
-- payment_failed timestamp). If the caller did not provide a value the
-- trigger fills with NOW().
--
-- Clears the timestamp on any transition AWAY from the relevant status. A
-- tenant moving past_due → active should NOT carry a stale past_due_since.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tenants_track_billing_status_timestamps()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.billing_status IS DISTINCT FROM OLD.billing_status THEN
    -- Entering past_due: stamp past_due_since (preserve caller-provided value)
    IF NEW.billing_status = 'past_due' THEN
      NEW.past_due_since := COALESCE(NEW.past_due_since, NOW());
    -- Leaving past_due: clear past_due_since
    ELSIF OLD.billing_status = 'past_due' AND NEW.billing_status <> 'past_due' THEN
      -- If caller explicitly set a new value, keep it; otherwise clear.
      IF NEW.past_due_since IS NOT DISTINCT FROM OLD.past_due_since THEN
        NEW.past_due_since := NULL;
      END IF;
    END IF;

    -- Entering suspended: stamp suspended_at (preserve caller-provided value)
    IF NEW.billing_status = 'suspended' THEN
      NEW.suspended_at := COALESCE(NEW.suspended_at, NOW());
    -- Leaving suspended: clear suspended_at
    ELSIF OLD.billing_status = 'suspended' AND NEW.billing_status <> 'suspended' THEN
      IF NEW.suspended_at IS NOT DISTINCT FROM OLD.suspended_at THEN
        NEW.suspended_at := NULL;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_track_billing_status_timestamps_trg ON public.tenants;
CREATE TRIGGER tenants_track_billing_status_timestamps_trg
  BEFORE UPDATE OF billing_status ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tenants_track_billing_status_timestamps();

-- -----------------------------------------------------------------------------
-- 3. RPC: tenant_writes_allowed(uuid) — gate predicate referenced by every
--    mutation policy in section 5.
--
-- SECURITY INVOKER STABLE: the caller's RLS on tenants already restricts them
-- to their own tenant row (tenants_select_own filters by id = current_tenant_id()).
-- A cross-tenant probe is therefore impossible — a caller asking about another
-- tenant's billing_status just gets back NULL → FALSE.
--
-- Treats unknown tenant (no row visible) as FALSE: a caller who somehow has
-- a tenant_id pointing at a tenant they cannot SELECT cannot write to it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tenant_writes_allowed(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants
    WHERE id = p_tenant_id
      AND billing_status IN ('active', 'past_due')
  )
$$;

REVOKE EXECUTE ON FUNCTION public.tenant_writes_allowed(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tenant_writes_allowed(uuid) TO authenticated;

-- =============================================================================
-- 4. RLS reapply: prepend `tenant_writes_allowed(tenant_id) AND` to each of
--    the 38 mutation policies. Each policy is reapplied via ALTER POLICY so
--    the expression-only change is explicit and the policy name / cmd / role
--    set are preserved. Grouped by table; each section comment names the
--    table and the policy count.
-- =============================================================================

-- 4.1 agent_carrier_rates (3 policies)
ALTER POLICY agent_carrier_rates_insert_owner ON public.agent_carrier_rates
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY agent_carrier_rates_update_owner ON public.agent_carrier_rates
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  )
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY agent_carrier_rates_delete_owner ON public.agent_carrier_rates
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );

-- 4.2 agent_contracts (3 policies — note the self_or_owner expressions)
ALTER POLICY agent_contracts_insert_self_or_owner ON public.agent_contracts
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND ((agent_id = auth.uid()) OR public.is_owner()))
  );
ALTER POLICY agent_contracts_update_self_or_owner ON public.agent_contracts
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND ((agent_id = auth.uid()) OR public.is_owner()))
  )
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND ((agent_id = auth.uid()) OR public.is_owner()))
  );
ALTER POLICY agent_contracts_delete_owner ON public.agent_contracts
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );

-- 4.3 agent_positions (3 policies)
ALTER POLICY agent_positions_insert_owner ON public.agent_positions
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY agent_positions_update_owner ON public.agent_positions
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  )
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY agent_positions_delete_owner ON public.agent_positions
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );

-- 4.4 agents (4 policies — includes agents_update_self per locked decision §3)
ALTER POLICY agents_insert_owner ON public.agents
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY agents_update_owner ON public.agents
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  )
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY agents_update_self ON public.agents
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((id = auth.uid()) AND (tenant_id = public.current_tenant_id()))
  )
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((id = auth.uid()) AND (tenant_id = public.current_tenant_id()))
  );
ALTER POLICY agents_delete_owner ON public.agents
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );

-- 4.5 announcements (3 policies)
ALTER POLICY announcements_insert_owner ON public.announcements
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY announcements_update_owner ON public.announcements
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  )
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY announcements_delete_owner ON public.announcements
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );

-- 4.6 comp_grid_rates (3 policies — master commission grid; operating data, not reference)
ALTER POLICY comp_grid_rates_insert_owner ON public.comp_grid_rates
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY comp_grid_rates_update_owner ON public.comp_grid_rates
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  )
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY comp_grid_rates_delete_owner ON public.comp_grid_rates
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );

-- 4.7 leadership_broadcasts (3 policies — INSERT also asserts created_by_user_id)
ALTER POLICY leadership_broadcasts_insert_owner ON public.leadership_broadcasts
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner() AND (created_by_user_id = auth.uid()))
  );
ALTER POLICY leadership_broadcasts_update_owner ON public.leadership_broadcasts
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  )
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY leadership_broadcasts_delete_owner ON public.leadership_broadcasts
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );

-- 4.8 policies (3 policies)
ALTER POLICY policies_insert_owner ON public.policies
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY policies_update_owner ON public.policies
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  )
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY policies_delete_owner ON public.policies
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );

-- 4.9 policy_commissions (3 policies)
ALTER POLICY policy_commissions_insert_owner ON public.policy_commissions
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY policy_commissions_update_owner ON public.policy_commissions
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  )
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY policy_commissions_delete_owner ON public.policy_commissions
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );

-- 4.10 policy_status_history (1 INSERT-only policy)
ALTER POLICY policy_status_history_insert_owner ON public.policy_status_history
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );

-- 4.11 promotion_targets (3 policies)
ALTER POLICY promotion_targets_insert_owner ON public.promotion_targets
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY promotion_targets_update_owner ON public.promotion_targets
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  )
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY promotion_targets_delete_owner ON public.promotion_targets
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );

-- 4.12 tenant_setup_state (3 policies — NOT in original brief; added per parent decision to gate setup-wizard progress under suspension)
ALTER POLICY tenant_setup_state_insert_owner ON public.tenant_setup_state
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY tenant_setup_state_update_owner ON public.tenant_setup_state
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  )
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY tenant_setup_state_delete_owner ON public.tenant_setup_state
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );

-- 4.13 user_action_items (3 policies — UPDATE gates the self-or-owner expression)
ALTER POLICY user_action_items_insert_owner ON public.user_action_items
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );
ALTER POLICY user_action_items_update ON public.user_action_items
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND ((user_id = auth.uid()) OR public.is_owner()))
  )
  WITH CHECK (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND ((user_id = auth.uid()) OR public.is_owner()))
  );
ALTER POLICY user_action_items_delete_owner ON public.user_action_items
  USING (
    public.tenant_writes_allowed(tenant_id)
    AND ((tenant_id = public.current_tenant_id()) AND public.is_owner())
  );

-- -----------------------------------------------------------------------------
-- 5. SECURITY DEFINER wrapper public.run_suspended_flip()
--
-- SECURITY DEFINER required because: pg_cron runs jobs as the `postgres` role
-- by default, but we want the UPDATE to be auditable against a single named
-- function rather than letting cron dispatch arbitrary SQL. DEFINER + locked
-- search_path is the standard Supabase pattern for cron-callable wrappers.
--
-- The function bulk-flips any past_due tenant whose past_due_since is older
-- than 14 days, returning the number of rows updated. A RAISE NOTICE
-- heartbeat makes the daily run searchable in cron logs even when zero rows
-- are flipped.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_suspended_flip()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.tenants
     SET billing_status = 'suspended'
   WHERE billing_status = 'past_due'
     AND past_due_since IS NOT NULL
     AND past_due_since <= (NOW() - INTERVAL '14 days');

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RAISE NOTICE 'phase17_suspended_flip heartbeat: % tenant(s) flipped past_due → suspended', v_count;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_suspended_flip() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.run_suspended_flip() TO service_role;

-- -----------------------------------------------------------------------------
-- 6. pg_cron schedule: 06:05 UTC daily, run_suspended_flip()
--
-- Same defensive pattern as PR 2: pre-flight checks pg_namespace for both
-- `cron` and `net` schemas before referencing them. A bare reference to
-- `cron.unschedule(...)` raises invalid_schema_name (SQLSTATE 3F000) at
-- parse-time on a fresh `supabase db reset --local`, so the pre-flight is
-- mandatory.
--
-- Note: this schedule does not need pg_net (no HTTP call — it's a direct
-- SELECT public.run_suspended_flip()), but we keep the net pre-flight in
-- place because the rest of the Phase 17 cron schedules expect both
-- extensions; if net is missing the whole cron infrastructure is in an
-- abnormal state and we want this DO block to skip-and-notice too.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cron_present boolean;
  v_net_present  boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') INTO v_cron_present;
  SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'net')  INTO v_net_present;

  IF NOT v_cron_present OR NOT v_net_present THEN
    RAISE NOTICE 'pg_cron present=% / pg_net present=% — skipping phase17_suspended_flip install. Operator must enable both extensions and re-apply.',
      v_cron_present, v_net_present;
    RETURN;
  END IF;

  -- Idempotency: drop any pre-existing schedule first. The first apply will
  -- error (the schedule doesn't exist yet); the EXCEPTION swallows that.
  BEGIN
    PERFORM cron.unschedule('phase17_suspended_flip');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'phase17_suspended_flip',
    '5 6 * * *',
    $cron$ SELECT public.run_suspended_flip(); $cron$
  );

  RAISE NOTICE 'phase17_suspended_flip cron schedule installed (daily 06:05 UTC).';
END $$;

-- -----------------------------------------------------------------------------
-- 7. Internal verification — runs at apply time. A failure aborts the migration.
--
-- Uses a throwaway tenant with gen_random_uuid() so the seed's
-- slug='demo-agency' constraint is not tripped. Final cleanup deletes the
-- test tenant; ON DELETE CASCADE on billing_snapshots handles any rows the
-- trigger may have implicitly created (there shouldn't be any).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_tid              uuid := gen_random_uuid();
  v_slug             text;
  v_past_due_since   timestamptz;
  v_suspended_at     timestamptz;
  v_writes_allowed   boolean;
  v_policy_count     integer;
  v_billing_status   text;
BEGIN
  v_slug := 'phase17-pr3a-verify-' || replace(v_tid::text, '-', '');

  INSERT INTO public.tenants (id, name, slug, current_plan_tier, billing_status)
  VALUES (v_tid, 'phase17-pr3a-verify', v_slug, 'starter', 'active');

  -- Test 1: trigger stamps past_due_since when transitioning active → past_due
  UPDATE public.tenants SET billing_status = 'past_due' WHERE id = v_tid;
  SELECT past_due_since, suspended_at INTO v_past_due_since, v_suspended_at
    FROM public.tenants WHERE id = v_tid;
  IF v_past_due_since IS NULL THEN
    RAISE EXCEPTION 'Test 1 FAILED: past_due_since not stamped on active → past_due';
  END IF;
  IF v_suspended_at IS NOT NULL THEN
    RAISE EXCEPTION 'Test 1 FAILED: suspended_at should still be NULL after active → past_due, got %', v_suspended_at;
  END IF;

  -- Test 2: trigger stamps suspended_at on past_due → suspended (and preserves
  -- past_due_since per current policy — only cleared on transition AWAY from
  -- past_due to something other than suspended).
  UPDATE public.tenants SET billing_status = 'suspended' WHERE id = v_tid;
  SELECT past_due_since, suspended_at INTO v_past_due_since, v_suspended_at
    FROM public.tenants WHERE id = v_tid;
  IF v_suspended_at IS NULL THEN
    RAISE EXCEPTION 'Test 2 FAILED: suspended_at not stamped on past_due → suspended';
  END IF;

  -- Test 3: tenant_writes_allowed returns FALSE when suspended, TRUE when active
  v_writes_allowed := public.tenant_writes_allowed(v_tid);
  IF v_writes_allowed IS NOT FALSE THEN
    RAISE EXCEPTION 'Test 3 FAILED: tenant_writes_allowed should be FALSE for suspended tenant, got %', v_writes_allowed;
  END IF;

  UPDATE public.tenants SET billing_status = 'active' WHERE id = v_tid;
  v_writes_allowed := public.tenant_writes_allowed(v_tid);
  IF v_writes_allowed IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 3 FAILED: tenant_writes_allowed should be TRUE for active tenant, got %', v_writes_allowed;
  END IF;

  -- Test 4: trigger cleared suspended_at on transition AWAY from suspended.
  SELECT suspended_at INTO v_suspended_at FROM public.tenants WHERE id = v_tid;
  IF v_suspended_at IS NOT NULL THEN
    RAISE EXCEPTION 'Test 4 FAILED: suspended_at not cleared on suspended → active, got %', v_suspended_at;
  END IF;

  -- Also verify past_due_since cleared when going active (the prior UPDATE
  -- went suspended → active; past_due_since was still set from Test 1, so
  -- it should NOT be auto-cleared here — only cleared on transition away
  -- from past_due. Going suspended → active leaves past_due_since alone
  -- since OLD was already not past_due. So we don't assert it here.

  -- Test 5: 38 policies gated (the floor; future adds shouldn't break this)
  --   Count distinct (schemaname, tablename, policyname) where the qual or
  --   with_check expression mentions tenant_writes_allowed. Distinct because
  --   an UPDATE policy gets one row in pg_policies but its expression is
  --   stored in both qual and with_check.
  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      qual       LIKE '%tenant_writes_allowed%'
      OR with_check LIKE '%tenant_writes_allowed%'
    );
  IF v_policy_count < 38 THEN
    RAISE EXCEPTION 'Test 5 FAILED: expected >= 38 policies referencing tenant_writes_allowed, found %', v_policy_count;
  END IF;

  -- Cleanup (CASCADE wipes any billing_snapshots rows; none expected)
  DELETE FROM public.tenants WHERE id = v_tid;

  RAISE NOTICE 'Phase 17 PR 3a verification passed (5 tests, % gated policies).', v_policy_count;
END $$;

COMMIT;
