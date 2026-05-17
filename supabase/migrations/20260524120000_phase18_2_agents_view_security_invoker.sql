-- Phase 18.2 hotfix: enable security_invoker on agents_with_current_position
-- so the view honors RLS on the underlying agents table.
--
-- Bug: views default to security_invoker = false in Postgres, which makes them
-- execute with the OWNER's privileges (postgres / migration role), bypassing
-- RLS on the underlying tables. The Agents Table view in the frontend queries
-- this view for position metadata; without security_invoker, every authenticated
-- user saw the global agents roster across all tenants.
--
-- Fix verified on production 2026-05-17 via direct SQL Editor apply. This
-- migration is the source-of-truth sync. The companion view
-- agent_rates_with_product already had security_invoker = true; no change there.

ALTER VIEW public.agents_with_current_position SET (security_invoker = true);

DO $$
DECLARE v_security_invoker text;
BEGIN
  SELECT option_value INTO v_security_invoker
  FROM pg_class c, pg_options_to_table(c.reloptions)
  WHERE c.relname = 'agents_with_current_position'
    AND c.relnamespace = 'public'::regnamespace
    AND option_name = 'security_invoker';
  IF v_security_invoker IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'security_invoker not set on agents_with_current_position (got: %)', v_security_invoker;
  END IF;
  RAISE NOTICE 'Verification passed: agents_with_current_position now runs with security_invoker = true (RLS enforced).';
END $$;
