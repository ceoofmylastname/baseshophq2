-- Revoke noise grants on rls_auto_enable event trigger function.
-- Event trigger functions cannot be invoked directly, so PUBLIC/anon/authenticated EXECUTE
-- was always functional noise — but it triggered an advisor warning.
-- Only postgres + service_role retain EXECUTE.

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
