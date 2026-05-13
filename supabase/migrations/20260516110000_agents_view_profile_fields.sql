-- Phase 13.3 follow-up: surface avatar_url, title, bio on the
-- agents_with_current_position view.
-- Postgres CREATE OR REPLACE VIEW preserves column ordering, so the
-- new columns are appended at the end of the SELECT list.
BEGIN;

CREATE OR REPLACE VIEW public.agents_with_current_position AS
SELECT
    a.id,
    a.tenant_id,
    a.email,
    a.first_name,
    a.last_name,
    a.phone,
    a.npn,
    a.is_owner,
    a.status,
    a.upline_email,
    a.created_at,
    a.updated_at,
    a.last_login_at,
    ap.id          AS current_assignment_id,
    ap.position_id AS current_position_id,
    ap.start_date  AS current_position_start_date,
    cgp.position_code     AS current_position_code,
    cgp.position_name     AS current_position_name,
    cgp.sort_order        AS current_position_sort_order,
    cgp.is_commissioned   AS current_position_is_commissioned,
    a.avatar_url,
    a.title,
    a.bio
  FROM public.agents a
  LEFT JOIN public.agent_positions ap
    ON ap.agent_id = a.id AND ap.end_date IS NULL
  LEFT JOIN public.comp_grid_positions cgp
    ON cgp.id = ap.position_id;

COMMIT;
