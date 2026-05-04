-- Phase 10B: Book of Business + Policy Detail.
--
-- 1 new table (policy_deletions_audit) + 1 new RPC (delete_policy_with_audit).
-- Has Risk / Needs Review filters are computed predicates against existing
-- columns, no schema additions. LOA Only filter deferred until policies has
-- a backing column populated by carrier ingest.
--
-- Build rule (Phase 10A.1): every SECURITY DEFINER trigger function REVOKEs
-- EXECUTE from PUBLIC, anon, authenticated. The single new RPC here is not a
-- trigger, but follows the same canonical RPC pattern (REVOKE PUBLIC + anon,
-- GRANT authenticated only).

-- ============================================================================
-- policy_deletions_audit table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.policy_deletions_audit (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    policy_id           uuid NOT NULL,                     -- intentional FK-less; original policies.id
    policy_number       text NOT NULL,                     -- denormalized for audit readability
    agent_id            uuid,                              -- writing agent at time of delete (FK-less to allow agent archival)
    status_at_deletion  public.policy_status NOT NULL,
    annual_premium      numeric,
    full_payload        jsonb NOT NULL,                    -- entire policies row for restore
    deleted_at          timestamptz NOT NULL DEFAULT now(),
    deleted_by_user_id  uuid REFERENCES public.agents(id),
    reason              text                               -- optional owner-supplied reason
);
CREATE INDEX IF NOT EXISTS policy_deletions_audit_tenant_at_idx
  ON public.policy_deletions_audit (tenant_id, deleted_at DESC);

-- RLS: owner-only SELECT (sensitive — even RLS-visible non-owners shouldn't
-- see deletions). No INSERT policy: writes happen via SECURITY DEFINER RPC
-- (delete_policy_with_audit) which bypasses RLS.
CREATE POLICY policy_deletions_audit_select_owner ON public.policy_deletions_audit
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner());

-- Add to supabase_realtime publication so a future audit page can sub
ALTER PUBLICATION supabase_realtime ADD TABLE public.policy_deletions_audit;

-- ============================================================================
-- delete_policy_with_audit RPC
-- ============================================================================
-- Owner-only, tenant-matched per Phase 6.5 build rule. INSERT audit row +
-- DELETE policy in a single transaction. Cascade removes policy_commissions
-- (Phase 4a ON DELETE CASCADE). activity_events rows are preserved (no FK).
CREATE OR REPLACE FUNCTION public.delete_policy_with_audit(
    p_policy_id uuid,
    p_reason    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_tenant uuid;
    v_policy        record;
    v_audit_id      uuid;
BEGIN
    IF NOT public.is_owner() THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
    END IF;
    v_caller_tenant := public.current_tenant_id();

    SELECT * INTO v_policy FROM public.policies WHERE id = p_policy_id;
    IF v_policy.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'not_found');
    END IF;
    IF v_caller_tenant IS NULL OR v_caller_tenant <> v_policy.tenant_id THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
    END IF;

    INSERT INTO public.policy_deletions_audit (
        tenant_id, policy_id, policy_number, agent_id,
        status_at_deletion, annual_premium, full_payload,
        deleted_by_user_id, reason
    ) VALUES (
        v_policy.tenant_id, v_policy.id, v_policy.policy_number, v_policy.agent_id,
        v_policy.status, v_policy.annual_premium, to_jsonb(v_policy),
        auth.uid(), p_reason
    ) RETURNING id INTO v_audit_id;

    DELETE FROM public.policies WHERE id = p_policy_id;

    RETURN jsonb_build_object(
        'success', true,
        'audit_id', v_audit_id,
        'policy_number', v_policy.policy_number
    );
END;
$$;
REVOKE ALL ON FUNCTION public.delete_policy_with_audit(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_policy_with_audit(uuid, text) TO authenticated;
