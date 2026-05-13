-- Phase 13.3 hotfix: the original avatars storage policies queried
-- public.agents inline, which means storage RLS evaluation went through
-- the agents table's RLS — and the auth context inside a storage policy
-- doesn't always satisfy agents_select_self cleanly, so the subquery
-- returned NULL and the policy quietly rejected every insert.
--
-- Replace the inline subqueries with the existing SECURITY DEFINER
-- helpers `current_tenant_id()` and `is_owner()`, which bypass RLS
-- and return the same value the rest of the app uses. Also scope each
-- policy to the `authenticated` role explicitly (the inline-subquery
-- version was implicitly public, which doesn't matter for INSERT/UPDATE/
-- DELETE on storage.objects but tightens the surface).

BEGIN;

DROP POLICY IF EXISTS "avatars_insert_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "avatars_delete_own_folder" ON storage.objects;

CREATE POLICY "avatars_insert_own_folder" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = public.current_tenant_id()::text
        AND (
            (storage.foldername(name))[2] = auth.uid()::text
            OR public.is_owner()
        )
    );

CREATE POLICY "avatars_update_own_folder" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = public.current_tenant_id()::text
        AND (
            (storage.foldername(name))[2] = auth.uid()::text
            OR public.is_owner()
        )
    );

CREATE POLICY "avatars_delete_own_folder" ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = public.current_tenant_id()::text
        AND (
            (storage.foldername(name))[2] = auth.uid()::text
            OR public.is_owner()
        )
    );

COMMIT;
