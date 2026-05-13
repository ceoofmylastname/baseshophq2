-- Phase 13.3: Agent profile fields + avatars storage bucket.
--
-- Adds three optional profile columns to agents:
--   avatar_url — public URL of the agent's profile photo (Supabase Storage)
--   bio        — short free-form blurb shown on the agent detail panel
--   title      — optional title/designation that complements position_name
--                (e.g. position "Senior Field Trainer" + title "MDRT 2025")
--
-- Creates the 'avatars' storage bucket (public-read) and locks write access
-- to the user's own tenant folder. The path layout is:
--
--     avatars/{tenant_id}/{agent_id}/avatar.<ext>
--
-- Write rules:
--   - Any authenticated agent can write to their OWN folder
--     ({tenant_id}/{their agent_id}/...)
--   - A tenant owner can write to ANY folder within their tenant
--     ({their tenant_id}/<anything>/...)
-- Read rules:
--   - Bucket is public-read so <img src> works without signed URLs. The
--     avatar URLs are not sensitive (no PII beyond a face), and serving
--     them from signed URLs would require every list view to round-trip
--     through an edge function to mint URLs per render.
--
-- Once a row is updated with a new avatar_url, the realtime subscription
-- on agents (already in useAgentsOrgChart and elsewhere) will push the new
-- photo to every connected client without an explicit refresh.

BEGIN;

------------------------------------------------------------------
-- 1. Profile columns
------------------------------------------------------------------
ALTER TABLE public.agents
    ADD COLUMN IF NOT EXISTS avatar_url text,
    ADD COLUMN IF NOT EXISTS bio        text,
    ADD COLUMN IF NOT EXISTS title      text;

------------------------------------------------------------------
-- 2. Storage bucket
------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

------------------------------------------------------------------
-- 3. Storage RLS — path layout: {tenant_id}/{agent_id}/<file>
------------------------------------------------------------------

-- Helper: the auth user's tenant_id (matches current_tenant_id() but works
-- inside storage.objects policies without the public-schema search_path).
-- Note: storage policies cannot call public.current_tenant_id() directly
-- in all configurations, so we inline the lookup with a SECURITY DEFINER
-- helper that mirrors current_tenant_id()'s logic.

-- Drop any prior policies so re-running this migration is idempotent.
DROP POLICY IF EXISTS "avatars_select_public"      ON storage.objects;
DROP POLICY IF EXISTS "avatars_insert_own_folder"  ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_own_folder"  ON storage.objects;
DROP POLICY IF EXISTS "avatars_delete_own_folder"  ON storage.objects;

-- Public read: anyone (including anon) can fetch any avatar URL.
CREATE POLICY "avatars_select_public" ON storage.objects
    FOR SELECT
    USING (bucket_id = 'avatars');

-- Insert: caller must own the agent_id in the second path segment OR be
-- the tenant owner. Path segments are extracted via storage.foldername().
CREATE POLICY "avatars_insert_own_folder" ON storage.objects
    FOR INSERT
    WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = (
            SELECT a.tenant_id::text
              FROM public.agents a
             WHERE a.id = auth.uid()
        )
        AND (
            -- Self-write: second path segment matches caller's agent id
            (storage.foldername(name))[2] = auth.uid()::text
            -- Owner override: tenant owner can write to any agent folder in their tenant
            OR EXISTS (
                SELECT 1 FROM public.agents a
                 WHERE a.id = auth.uid() AND a.is_owner = true
            )
        )
    );

-- Update: same rule as insert.
CREATE POLICY "avatars_update_own_folder" ON storage.objects
    FOR UPDATE
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = (
            SELECT a.tenant_id::text
              FROM public.agents a
             WHERE a.id = auth.uid()
        )
        AND (
            (storage.foldername(name))[2] = auth.uid()::text
            OR EXISTS (
                SELECT 1 FROM public.agents a
                 WHERE a.id = auth.uid() AND a.is_owner = true
            )
        )
    );

-- Delete: same rule as insert.
CREATE POLICY "avatars_delete_own_folder" ON storage.objects
    FOR DELETE
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = (
            SELECT a.tenant_id::text
              FROM public.agents a
             WHERE a.id = auth.uid()
        )
        AND (
            (storage.foldername(name))[2] = auth.uid()::text
            OR EXISTS (
                SELECT 1 FROM public.agents a
                 WHERE a.id = auth.uid() AND a.is_owner = true
            )
        )
    );

------------------------------------------------------------------
-- 4. Extend agents_org_chart RPC to include avatar_url + title
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agents_org_chart(
    p_start_date date,
    p_end_date   date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id uuid;
    v_caller    uuid;
    v_is_owner  boolean;
    v_visible_agent_ids uuid[];
    v_result jsonb;
BEGIN
    v_tenant_id := public.current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'no_tenant');
    END IF;
    v_caller := auth.uid();
    v_is_owner := public.is_owner();

    IF NOT v_is_owner THEN
        v_visible_agent_ids := ARRAY[v_caller] ||
            COALESCE((SELECT array_agg(agent_id) FROM public.descendants_of(v_caller)), ARRAY[]::uuid[]);
    END IF;

    SELECT jsonb_agg(row_to_json(t)) INTO v_result FROM (
        SELECT
            a.id,
            a.first_name,
            a.last_name,
            a.email,
            a.avatar_url,
            a.title,
            a.upline_agent_id,
            a.is_owner,
            cgp.position_code,
            cgp.position_name,
            COALESCE(act.in_window_count,         0) AS in_window_count,
            COALESCE(act.issue_paid_count,        0) AS issue_paid_count,
            COALESCE(act.submitted_pending_count, 0) AS submitted_pending_count,
            COALESCE(act.at_risk_count,           0) AS at_risk_count,
            COALESCE(act.lifetime_count,          0) AS lifetime_count
          FROM public.agents a
          LEFT JOIN public.agent_positions ap
            ON ap.agent_id = a.id AND ap.end_date IS NULL
          LEFT JOIN public.comp_grid_positions cgp
            ON cgp.id = ap.position_id
          LEFT JOIN LATERAL (
              SELECT
                  COUNT(*) FILTER (
                      WHERE p.application_date BETWEEN p_start_date AND p_end_date
                  ) AS in_window_count,
                  COUNT(*) FILTER (
                      WHERE p.application_date BETWEEN p_start_date AND p_end_date
                        AND p.status = 'Issue Paid'
                  ) AS issue_paid_count,
                  COUNT(*) FILTER (
                      WHERE p.application_date BETWEEN p_start_date AND p_end_date
                        AND p.status IN ('Submitted','Pending')
                  ) AS submitted_pending_count,
                  COUNT(*) FILTER (
                      WHERE p.application_date BETWEEN p_start_date AND p_end_date
                        AND p.status = 'Potential Lapse'
                  ) AS at_risk_count,
                  COUNT(*) AS lifetime_count
                FROM public.policies p
               WHERE p.agent_id = a.id
                 AND p.tenant_id = v_tenant_id
          ) act ON TRUE
         WHERE a.tenant_id = v_tenant_id
           AND a.status <> 'archived'
           AND (v_is_owner OR a.id = ANY(v_visible_agent_ids))
         ORDER BY a.is_owner DESC, a.first_name NULLS LAST, a.last_name NULLS LAST
    ) t;

    RETURN jsonb_build_object(
        'success',       true,
        'is_owner_view', v_is_owner,
        'rows',          COALESCE(v_result, '[]'::jsonb),
        'meta', jsonb_build_object(
            'start_date', p_start_date,
            'end_date',   p_end_date
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.agents_org_chart(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agents_org_chart(date, date) TO authenticated;

DO $$
BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'agents'
           AND column_name = 'avatar_url'
    ), 'agents.avatar_url column missing';
    ASSERT EXISTS (
        SELECT 1 FROM storage.buckets WHERE id = 'avatars'
    ), 'avatars storage bucket missing';
    RAISE NOTICE 'Phase 13.3 agent profile + avatars storage verified.';
END $$;

COMMIT;
