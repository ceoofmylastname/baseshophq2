-- Baseline: rls_auto_enable() function + ensure_rls event trigger.
--
-- Captured from live DB during security hygiene pass 2026-05-11.
-- Originally a Supabase-managed default created at project setup,
-- not previously in migration history. This file makes the schema
-- reproducible from a fresh `supabase db reset` — the REVOKE migration
-- at 20260511120000 depends on this function existing.
--
-- Date-stamped 2026-01-01 so it sorts before every Phase 1 migration.
-- Supabase tracks applied migrations by name; back-dating does NOT
-- cause this to replay on the remote project (remote already has the
-- function). The file exists purely so fresh local stacks and CI runs
-- match production behavior.
--
-- Function body captured verbatim via pg_get_functiondef on 2026-05-12.
-- Event trigger metadata captured via pg_event_trigger on 2026-05-12.

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

DROP EVENT TRIGGER IF EXISTS ensure_rls CASCADE;

CREATE EVENT TRIGGER ensure_rls
ON ddl_command_end
WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
EXECUTE FUNCTION public.rls_auto_enable();
