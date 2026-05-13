-- Phase 14.0: Demo booking submissions from the public marketing page.
--
-- Public visitors (NOT authenticated) submit a name, email, agency name,
-- and a requested time slot. Submissions land in this table. Owners
-- review them on an internal page (Settings → Demo bookings, future
-- phase) and reach out to schedule.
--
-- Tenant-less. This is a single-table acquisition funnel; rows are not
-- scoped to any tenant because the submitter doesn't have one yet.
-- Read access is gated to the special "platform-admin" set (the agent
-- with is_owner=true on the JRM Enterprise Group tenant for now — Johnathon).
-- All other authenticated users CANNOT see these submissions. Anon users
-- can ONLY insert; they cannot read or update anything.

BEGIN;

CREATE TABLE public.demo_bookings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    email           TEXT NOT NULL,
    agency_name     TEXT,
    agency_size     TEXT,   -- '1-10', '11-50', '51-200', '200+' etc.
    requested_slot  TIMESTAMPTZ NOT NULL,
    message         TEXT,
    status          TEXT NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new', 'contacted', 'scheduled', 'done', 'no_show', 'declined')),
    notes           TEXT,
    source          TEXT,   -- e.g. 'homepage_hero', 'homepage_footer', 'pricing', etc.
    user_agent      TEXT,
    referrer        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX demo_bookings_recent
    ON public.demo_bookings (created_at DESC);

CREATE INDEX demo_bookings_by_status
    ON public.demo_bookings (status, created_at DESC);

COMMENT ON TABLE public.demo_bookings IS
    'Demo booking submissions from the public marketing page. Anonymous INSERTs only; reads gated to platform-admin.';

ALTER TABLE public.demo_bookings ENABLE ROW LEVEL SECURITY;

-- Anonymous + authenticated visitors can both insert. Treat this as a
-- public lead-capture endpoint.
CREATE POLICY demo_bookings_insert_anon ON public.demo_bookings
    FOR INSERT TO anon, authenticated
    WITH CHECK (
        char_length(trim(name))  > 0
        AND char_length(trim(email)) > 0
        AND email LIKE '%_@__%.__%'
    );

-- Reads are platform-admin only. Anyone who is an owner of any tenant
-- can see them for now (single-platform-admin scenario). Tighten later
-- once Johnathon decides on a proper platform_admins table.
CREATE POLICY demo_bookings_select_owner ON public.demo_bookings
    FOR SELECT TO authenticated
    USING (public.is_owner());

-- Only owners can update (e.g. mark contacted/scheduled/done).
CREATE POLICY demo_bookings_update_owner ON public.demo_bookings
    FOR UPDATE TO authenticated
    USING (public.is_owner())
    WITH CHECK (public.is_owner());

CREATE POLICY demo_bookings_delete_owner ON public.demo_bookings
    FOR DELETE TO authenticated
    USING (public.is_owner());

-- Anonymous gets INSERT only — no GRANT SELECT, no UPDATE, no DELETE.
GRANT INSERT ON public.demo_bookings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demo_bookings TO authenticated;

DO $$
BEGIN
    ASSERT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema='public' AND table_name='demo_bookings'
    ), 'demo_bookings table missing';
    ASSERT (
        SELECT rowsecurity FROM pg_tables
         WHERE schemaname='public' AND tablename='demo_bookings'
    ), 'RLS not enabled on demo_bookings';
    RAISE NOTICE 'Phase 14.0 demo_bookings schema verification passed.';
END $$;

COMMIT;
