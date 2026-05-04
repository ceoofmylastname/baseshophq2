-- Phase 6.5: close cross-tenant owner hole at the helper-function root cause.
--
-- Audit finding (Phase 6b smoke):
-- ---------------------------------------------------------------------------
-- is_owner() returned TRUE for the owner of any tenant regardless of which
-- tenant the caller belonged to (the function only checked agents.is_owner
-- WHERE id = auth.uid(), without scoping to current_tenant_id()).
--
-- can_view_agent(target) short-circuited to TRUE whenever is_owner() was TRUE,
-- so any owner could "see" any agent in any tenant.
--
-- All 36 existing RLS policies pair these helpers with an explicit
-- `tenant_id = current_tenant_id()` clause, so RLS-protected paths were never
-- exploitable. The exposure was through SECURITY DEFINER RPCs that bypass
-- RLS — Phase 6b smoke caught the live exploit when phase-5-smoke owner
-- Ophelia successfully wrote an override to a JRM-tenant agent.
--
-- The Phase 6b RPCs were patched at the call site (hotfix #3); this migration
-- closes the underlying root cause so every future caller inherits the fix.
--
-- Defense-in-depth pattern going forward
-- ---------------------------------------------------------------------------
-- Authenticated SECURITY DEFINER RPCs that touch agent-scoped data should:
--   1. Verify caller authorization (is_owner() or downline rule), AND
--   2. Verify current_tenant_id() = target row's tenant_id explicitly.
-- The Phase 6b RPCs keep their explicit tenant checks even though is_owner()
-- is now scoped — belt-and-suspenders, documents intent at the call site.

-- ---------------------------------------------------------------------------
-- 1. is_owner: scope to caller's tenant
-- ---------------------------------------------------------------------------
-- After the patch, is_owner() returns TRUE only when the caller is BOTH
-- flagged as owner AND that owner row belongs to the tenant returned by
-- current_tenant_id(). For a user with no agents row (auth.uid() set but no
-- tenant yet — theoretical signup race), current_tenant_id() returns NULL
-- and the AND tenant_id = NULL clause yields no rows → COALESCE → FALSE.
CREATE OR REPLACE FUNCTION public.is_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT a.is_owner
      FROM public.agents a
     WHERE a.id = auth.uid()
       AND a.tenant_id = public.current_tenant_id()
     LIMIT 1
  ), FALSE);
$$;

-- ---------------------------------------------------------------------------
-- 2. can_view_agent: target must be in caller's tenant first
-- ---------------------------------------------------------------------------
-- After the patch, can_view_agent(target) returns FALSE when the target is
-- in a different tenant than the caller, regardless of is_owner / downline.
-- The same-tenant gate runs before the visibility branches.
CREATE OR REPLACE FUNCTION public.can_view_agent(target_agent_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agents
     WHERE id = target_agent_id
       AND tenant_id = public.current_tenant_id()
  ) AND (
    target_agent_id = auth.uid()
    OR public.is_owner()  -- now tenant-scoped after patch above
    OR target_agent_id IN (SELECT public.descendants_of(auth.uid()))
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. descendants_of: hardening — refuse cross-tenant root walks
-- ---------------------------------------------------------------------------
-- Pre-patch, an authenticated caller could pass any agent UUID and walk its
-- downline tree, learning competitors' hierarchy depth + sibling counts.
-- The recursive walk already filtered each step by tenant_id matching the
-- root, so the leak was bounded to "the root's tenant" — but the root could
-- be anyone's. After the patch, the seed row is filtered to the caller's
-- own tenant, so cross-tenant walks return zero rows.
CREATE OR REPLACE FUNCTION public.descendants_of(root_agent_id uuid)
RETURNS TABLE(agent_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE tree AS (
    SELECT a.id, a.tenant_id, 1 AS depth, ARRAY[a.id] AS path_ids
      FROM public.agents a
     WHERE a.upline_agent_id = root_agent_id
       AND a.tenant_id = public.current_tenant_id()
    UNION ALL
    SELECT a.id, a.tenant_id, t.depth + 1, t.path_ids || a.id
      FROM public.agents a
      JOIN tree t
        ON a.upline_agent_id = t.id
       AND a.tenant_id = t.tenant_id
     WHERE t.depth < 100
       AND a.id <> ALL(t.path_ids)
  )
  SELECT id FROM tree;
$$;

-- Grants are already in place from prior phases — no GRANT statements needed
-- (CREATE OR REPLACE preserves existing ACLs).
