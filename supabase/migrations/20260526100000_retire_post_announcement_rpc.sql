-- =============================================================================
-- Phase 19.3 -- retire post_announcement RPC
--
-- Phase 19.2 swapped useAnnouncements.post() from post_announcement(...) to
-- upsert_announcement(p_id, ...). Phase 19.3 deleted PostAnnouncementDialog
-- and made the Dashboard Announcements card read-only. Nothing references
-- post_announcement anymore (grep -r post_announcement src/ returns only
-- comment-only mentions documenting this retirement).
--
-- This migration drops the function and asserts the other three announcements
-- RPCs are still present.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.post_announcement(text, text, boolean);

-- =============================================================================
-- Verification: 4 assertions
--   1. post_announcement(text,text,boolean) is gone.
--   2. list_active_announcements() still exists (Phase 19.1).
--   3. upsert_announcement(uuid,text,text,boolean) still exists (Phase 19.1).
--   4. delete_announcement(uuid) still exists (Phase 10A, preserved per D-5).
-- =============================================================================
DO $$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*) INTO v_count
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'post_announcement'
       AND pg_get_function_identity_arguments(p.oid) = 'p_title text, p_body text, p_pinned boolean';
    ASSERT v_count = 0,
        'verify_drop FAILED: post_announcement(text,text,boolean) still present';

    SELECT count(*) INTO v_count
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'list_active_announcements'
       AND pg_get_function_identity_arguments(p.oid) = '';
    ASSERT v_count = 1,
        'verify_survive FAILED: list_active_announcements() missing';

    SELECT count(*) INTO v_count
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'upsert_announcement'
       AND pg_get_function_identity_arguments(p.oid) = 'p_id uuid, p_title text, p_body text, p_pinned boolean';
    ASSERT v_count = 1,
        'verify_survive FAILED: upsert_announcement(uuid,text,text,boolean) missing';

    SELECT count(*) INTO v_count
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'delete_announcement'
       AND pg_get_function_identity_arguments(p.oid) = 'p_announcement_id uuid';
    ASSERT v_count = 1,
        'verify_survive FAILED: delete_announcement(p_announcement_id uuid) missing';

    RAISE NOTICE 'Phase 19.3 verify: post_announcement dropped; list_active_announcements + upsert_announcement + delete_announcement intact.';
END $$;

COMMIT;
