-- =============================================================================
-- Baseshop HQ — Demo seed (Checkpoint C of CI+seed rollout)
-- =============================================================================
-- One demo tenant ("Demo Agency"), 17 agents (1 owner + 4 directors + 12 third-
-- level), 4 positions, 3 carriers × 2-3 products each, full master comp grid,
-- per-(agent×carrier) contracts, 120 policies (recent-weighted), 5 orphans,
-- 10 activity events, 4 announcements.
--
-- Idempotent: wrapped in BEGIN/COMMIT, every INSERT uses ON CONFLICT DO NOTHING
-- (or composite-key equivalents). Safe to re-run.
--
-- All UUIDs are hardcoded literals (no gen_random_uuid()).
--
-- Deterministic randomness: setseed(0.42) before any random() call so reruns
-- produce identical policy distributions.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Hold session-level config quiet during seed (no app.policy_status_source
--    set means triggers default to 'manual' — exactly what we want).
-- ---------------------------------------------------------------------------
SET LOCAL client_min_messages = WARNING;

-- ---------------------------------------------------------------------------
-- 1. auth.users — 17 rows
--    GoTrue null-token recipe: every text token column is '' (empty string).
--    NULL on these silently breaks sign-in. Also requires a matching
--    auth.identities row with provider='email'.
-- ---------------------------------------------------------------------------

-- Owner: real bcrypt password 'BaseShop!2026'
INSERT INTO auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new,
    email_change, email_change_token_current, reauthentication_token,
    phone_change, phone_change_token
)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    '22222222-0000-0000-0000-000000000001',
    'authenticated', 'authenticated',
    'demo@baseshophq.test',
    crypt('BaseShop!2026', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Demo","last_name":"Owner"}'::jsonb,
    FALSE, now(), now(),
    '', '', '', '', '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
    user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
)
VALUES (
    '22222222-0000-0000-0000-000000000001',
    jsonb_build_object(
        'sub',           '22222222-0000-0000-0000-000000000001',
        'email',         'demo@baseshophq.test',
        'email_verified', true,
        'provider',      'email'
    ),
    'email',
    'demo@baseshophq.test',
    now(), now(), now()
)
ON CONFLICT (provider_id, provider) DO NOTHING;

-- 16 placeholder agents (directors + third-level). Junk password — they only
-- exist to satisfy the agents.id → auth.users(id) FK.
DO $seed_users$
DECLARE
    v_users JSONB := jsonb_build_array(
        -- 4 directors
        jsonb_build_object('id','22222222-0000-0000-0000-000000000002','email','director1@baseshophq.test','first','Alice','last','Anderson','identity','99999999-0000-0000-0000-000000000002'),
        jsonb_build_object('id','22222222-0000-0000-0000-000000000003','email','director2@baseshophq.test','first','Bob','last','Brown','identity','99999999-0000-0000-0000-000000000003'),
        jsonb_build_object('id','22222222-0000-0000-0000-000000000004','email','director3@baseshophq.test','first','Carol','last','Clark','identity','99999999-0000-0000-0000-000000000004'),
        jsonb_build_object('id','22222222-0000-0000-0000-000000000005','email','director4@baseshophq.test','first','David','last','Davis','identity','99999999-0000-0000-0000-000000000005'),
        -- 12 third-level (3 per director)
        jsonb_build_object('id','22222222-0000-0000-0000-000000000006','email','agent01@baseshophq.test','first','Emma','last','Evans','identity','99999999-0000-0000-0000-000000000006'),
        jsonb_build_object('id','22222222-0000-0000-0000-000000000007','email','agent02@baseshophq.test','first','Frank','last','Foster','identity','99999999-0000-0000-0000-000000000007'),
        jsonb_build_object('id','22222222-0000-0000-0000-000000000008','email','agent03@baseshophq.test','first','Grace','last','Garcia','identity','99999999-0000-0000-0000-000000000008'),
        jsonb_build_object('id','22222222-0000-0000-0000-000000000009','email','agent04@baseshophq.test','first','Henry','last','Hill','identity','99999999-0000-0000-0000-000000000009'),
        jsonb_build_object('id','22222222-0000-0000-0000-000000000010','email','agent05@baseshophq.test','first','Ivy','last','Irwin','identity','99999999-0000-0000-0000-000000000010'),
        jsonb_build_object('id','22222222-0000-0000-0000-000000000011','email','agent06@baseshophq.test','first','Jack','last','Jones','identity','99999999-0000-0000-0000-000000000011'),
        jsonb_build_object('id','22222222-0000-0000-0000-000000000012','email','agent07@baseshophq.test','first','Kate','last','Kim','identity','99999999-0000-0000-0000-000000000012'),
        jsonb_build_object('id','22222222-0000-0000-0000-000000000013','email','agent08@baseshophq.test','first','Liam','last','Lee','identity','99999999-0000-0000-0000-000000000013'),
        jsonb_build_object('id','22222222-0000-0000-0000-000000000014','email','agent09@baseshophq.test','first','Mia','last','Martin','identity','99999999-0000-0000-0000-000000000014'),
        jsonb_build_object('id','22222222-0000-0000-0000-000000000015','email','agent10@baseshophq.test','first','Noah','last','Nelson','identity','99999999-0000-0000-0000-000000000015'),
        jsonb_build_object('id','22222222-0000-0000-0000-000000000016','email','agent11@baseshophq.test','first','Olivia','last','Owens','identity','99999999-0000-0000-0000-000000000016'),
        jsonb_build_object('id','22222222-0000-0000-0000-000000000017','email','agent12@baseshophq.test','first','Peter','last','Parker','identity','99999999-0000-0000-0000-000000000017')
    );
    v_row JSONB;
BEGIN
    FOR v_row IN SELECT * FROM jsonb_array_elements(v_users) LOOP
        INSERT INTO auth.users (
            instance_id, id, aud, role, email,
            encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data,
            is_super_admin, created_at, updated_at,
            confirmation_token, recovery_token, email_change_token_new,
            email_change, email_change_token_current, reauthentication_token,
            phone_change, phone_change_token
        )
        VALUES (
            '00000000-0000-0000-0000-000000000000',
            (v_row->>'id')::uuid,
            'authenticated', 'authenticated',
            v_row->>'email',
            crypt('placeholder', gen_salt('bf')),
            now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('first_name', v_row->>'first', 'last_name', v_row->>'last'),
            FALSE, now(), now(),
            '', '', '', '', '', '', '', ''
        )
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO auth.identities (
            user_id, identity_data, provider, provider_id,
            last_sign_in_at, created_at, updated_at
        )
        VALUES (
            (v_row->>'id')::uuid,
            jsonb_build_object(
                'sub',           v_row->>'id',
                'email',         v_row->>'email',
                'email_verified', true,
                'provider',      'email'
            ),
            'email',
            v_row->>'email',
            now(), now(), now()
        )
        ON CONFLICT (provider_id, provider) DO NOTHING;
    END LOOP;
END
$seed_users$;


-- ---------------------------------------------------------------------------
-- 2. Tenant
--    Insert tenant first WITHOUT owner_agent_id, then insert owner agent,
--    then wire owner_agent_id. Mirrors provision_tenant_and_owner RPC order.
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug, status, feature_flags, annual_goal_amount)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    'Demo Agency',
    'demo-agency',
    'active',
    '{"comp_grid_v1": true}'::jsonb,
    1000000
)
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 3. Agents
--    Order matters: owner first, then directors (upline_email = owner email),
--    then 3rd level (upline_email = a director's email). The
--    resolve_upline_agent_id trigger fires BEFORE INSERT and looks up the
--    upline_agent_id from upline_email; ordering ensures the upline exists.
--    All emails lowercased per Phase 5 convention.
-- ---------------------------------------------------------------------------

-- Owner
INSERT INTO public.agents (id, tenant_id, email, first_name, last_name, is_owner, status)
VALUES (
    '22222222-0000-0000-0000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    'demo@baseshophq.test',
    'Demo', 'Owner', TRUE, 'active'
)
ON CONFLICT (id) DO NOTHING;

-- Wire owner_agent_id on tenant
UPDATE public.tenants
   SET owner_agent_id = '22222222-0000-0000-0000-000000000001'
 WHERE id = '11111111-1111-1111-1111-111111111111'
   AND owner_agent_id IS DISTINCT FROM '22222222-0000-0000-0000-000000000001';

-- Directors (upline_email = owner email)
INSERT INTO public.agents (id, tenant_id, email, first_name, last_name, upline_email, is_owner, status)
VALUES
    ('22222222-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'director1@baseshophq.test', 'Alice', 'Anderson', 'demo@baseshophq.test', FALSE, 'active'),
    ('22222222-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'director2@baseshophq.test', 'Bob',   'Brown',    'demo@baseshophq.test', FALSE, 'active'),
    ('22222222-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'director3@baseshophq.test', 'Carol', 'Clark',    'demo@baseshophq.test', FALSE, 'active'),
    ('22222222-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'director4@baseshophq.test', 'David', 'Davis',    'demo@baseshophq.test', FALSE, 'active')
ON CONFLICT (id) DO NOTHING;

-- Third-level (3 per director)
INSERT INTO public.agents (id, tenant_id, email, first_name, last_name, upline_email, is_owner, status)
VALUES
    -- Under Alice (director1)
    ('22222222-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'agent01@baseshophq.test', 'Emma',   'Evans',   'director1@baseshophq.test', FALSE, 'active'),
    ('22222222-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'agent02@baseshophq.test', 'Frank',  'Foster',  'director1@baseshophq.test', FALSE, 'active'),
    ('22222222-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'agent03@baseshophq.test', 'Grace',  'Garcia',  'director1@baseshophq.test', FALSE, 'active'),
    -- Under Bob (director2)
    ('22222222-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'agent04@baseshophq.test', 'Henry',  'Hill',    'director2@baseshophq.test', FALSE, 'active'),
    ('22222222-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'agent05@baseshophq.test', 'Ivy',    'Irwin',   'director2@baseshophq.test', FALSE, 'active'),
    ('22222222-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'agent06@baseshophq.test', 'Jack',   'Jones',   'director2@baseshophq.test', FALSE, 'active'),
    -- Under Carol (director3)
    ('22222222-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'agent07@baseshophq.test', 'Kate',   'Kim',     'director3@baseshophq.test', FALSE, 'active'),
    ('22222222-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'agent08@baseshophq.test', 'Liam',   'Lee',     'director3@baseshophq.test', FALSE, 'active'),
    ('22222222-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'agent09@baseshophq.test', 'Mia',    'Martin',  'director3@baseshophq.test', FALSE, 'active'),
    -- Under David (director4)
    ('22222222-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111', 'agent10@baseshophq.test', 'Noah',   'Nelson',  'director4@baseshophq.test', FALSE, 'active'),
    ('22222222-0000-0000-0000-000000000016', '11111111-1111-1111-1111-111111111111', 'agent11@baseshophq.test', 'Olivia', 'Owens',   'director4@baseshophq.test', FALSE, 'active'),
    ('22222222-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111', 'agent12@baseshophq.test', 'Peter',  'Parker',  'director4@baseshophq.test', FALSE, 'active')
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 4. Comp grid positions (4 levels, sort_order ascending)
-- ---------------------------------------------------------------------------
INSERT INTO public.comp_grid_positions (id, tenant_id, position_code, position_name, sort_order, is_active, is_commissioned)
VALUES
    ('55555555-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'TRAINEE', 'Trainee',  10, TRUE, TRUE),
    ('55555555-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'AGENT',   'Agent',    20, TRUE, TRUE),
    ('55555555-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'DIRECTOR','Director', 30, TRUE, TRUE),
    ('55555555-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'OWNER',   'Owner',    40, TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 5. agent_positions — assign each agent to a position (start_date past)
-- ---------------------------------------------------------------------------
INSERT INTO public.agent_positions (id, tenant_id, agent_id, position_id, start_date)
VALUES
    -- Owner → Owner
    ('66666666-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000004', (now() - interval '1 year')::date),
    -- 4 directors → Director
    ('66666666-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000003', (now() - interval '1 year')::date),
    ('66666666-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000003', '55555555-0000-0000-0000-000000000003', (now() - interval '1 year')::date),
    ('66666666-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000004', '55555555-0000-0000-0000-000000000003', (now() - interval '1 year')::date),
    ('66666666-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000005', '55555555-0000-0000-0000-000000000003', (now() - interval '1 year')::date),
    -- 12 third-level → Agent
    ('66666666-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000006', '55555555-0000-0000-0000-000000000002', (now() - interval '6 months')::date),
    ('66666666-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000007', '55555555-0000-0000-0000-000000000002', (now() - interval '6 months')::date),
    ('66666666-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000008', '55555555-0000-0000-0000-000000000002', (now() - interval '6 months')::date),
    ('66666666-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000009', '55555555-0000-0000-0000-000000000002', (now() - interval '6 months')::date),
    ('66666666-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000010', '55555555-0000-0000-0000-000000000002', (now() - interval '6 months')::date),
    ('66666666-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000011', '55555555-0000-0000-0000-000000000002', (now() - interval '6 months')::date),
    ('66666666-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000012', '55555555-0000-0000-0000-000000000002', (now() - interval '6 months')::date),
    ('66666666-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000013', '55555555-0000-0000-0000-000000000002', (now() - interval '6 months')::date),
    ('66666666-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000014', '55555555-0000-0000-0000-000000000002', (now() - interval '6 months')::date),
    ('66666666-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000015', '55555555-0000-0000-0000-000000000002', (now() - interval '6 months')::date),
    ('66666666-0000-0000-0000-000000000016', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000016', '55555555-0000-0000-0000-000000000002', (now() - interval '6 months')::date),
    ('66666666-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000017', '55555555-0000-0000-0000-000000000002', (now() - interval '6 months')::date)
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 6. Carriers (3) — mix of life and annuity
--    Mutual of Omaha (life), Athene (annuity), F&G Life (life)
-- ---------------------------------------------------------------------------
INSERT INTO public.comp_grid_carriers (id, tenant_id, carrier_name, product_type, is_active)
VALUES
    ('33333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mutual of Omaha', 'life',    TRUE),
    ('33333333-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Athene',          'annuity', TRUE),
    ('33333333-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'F&G Life',        'life',    TRUE)
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 7. Products (2-3 per carrier)
--    product_type column is auto-synced from carrier via trigger; we pass it
--    anyway so the INSERT row is complete.
-- ---------------------------------------------------------------------------
INSERT INTO public.comp_grid_products (id, tenant_id, carrier_id, product_name, product_type, is_active)
VALUES
    -- Mutual of Omaha (life) — 3 products
    ('44444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '33333333-0000-0000-0000-000000000001', 'Living Promise Whole Life',  'life',    TRUE),
    ('44444444-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '33333333-0000-0000-0000-000000000001', 'Term Life Express',          'life',    TRUE),
    ('44444444-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '33333333-0000-0000-0000-000000000001', 'IUL Income Advantage',       'life',    TRUE),
    -- Athene (annuity) — 2 products
    ('44444444-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '33333333-0000-0000-0000-000000000002', 'Performance Elite Plus 10', 'annuity', TRUE),
    ('44444444-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '33333333-0000-0000-0000-000000000002', 'Ascent Pro 10',             'annuity', TRUE),
    -- F&G Life (life) — 3 products
    ('44444444-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '33333333-0000-0000-0000-000000000003', 'Pathsetter IUL',            'life',    TRUE),
    ('44444444-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', '33333333-0000-0000-0000-000000000003', 'Safe Income Plus',          'life',    TRUE),
    ('44444444-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', '33333333-0000-0000-0000-000000000003', 'Final Expense Plus',        'life',    TRUE)
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 8. Master comp grid rates — every (position × product) pair
--    Commission scaled by position rank: Trainee 50%, Agent 75%, Director 95%,
--    Owner 110%. Effective today.
-- ---------------------------------------------------------------------------
DO $seed_rates$
DECLARE
    v_tenant uuid := '11111111-1111-1111-1111-111111111111';
    v_pos    RECORD;
    v_prod   RECORD;
    v_pct    NUMERIC(6,2);
BEGIN
    FOR v_pos IN
        SELECT id, position_code FROM public.comp_grid_positions
         WHERE tenant_id = v_tenant
    LOOP
        FOR v_prod IN
            SELECT id FROM public.comp_grid_products
             WHERE tenant_id = v_tenant
        LOOP
            v_pct := CASE v_pos.position_code
                       WHEN 'TRAINEE'  THEN 50.00
                       WHEN 'AGENT'    THEN 75.00
                       WHEN 'DIRECTOR' THEN 95.00
                       WHEN 'OWNER'    THEN 110.00
                       ELSE 60.00
                     END;
            -- ON CONFLICT on (tenant_id, position_id, product_id, effective_date)
            INSERT INTO public.comp_grid_rates (
                tenant_id, position_id, product_id, commission_pct,
                schedule_code, effective_date
            )
            VALUES (
                v_tenant, v_pos.id, v_prod.id, v_pct,
                'BASE-' || v_pos.position_code, CURRENT_DATE
            )
            ON CONFLICT (tenant_id, position_id, product_id, effective_date) DO NOTHING;
        END LOOP;
    END LOOP;
END
$seed_rates$;


-- ---------------------------------------------------------------------------
-- 9. agent_carrier_rates — per-agent default rates (templated from position)
--    Engine reads this table; without rows the engine returns 0% spread and
--    writes no policy_commissions. Seed each non-archived agent × product.
-- ---------------------------------------------------------------------------
DO $seed_acr$
DECLARE
    v_tenant uuid := '11111111-1111-1111-1111-111111111111';
    v_agent  RECORD;
    v_prod   RECORD;
    v_pos_id uuid;
    v_pct    NUMERIC(6,2);
BEGIN
    FOR v_agent IN
        SELECT a.id, ap.position_id
          FROM public.agents a
          JOIN public.agent_positions ap
            ON ap.agent_id = a.id AND ap.end_date IS NULL
         WHERE a.tenant_id = v_tenant
    LOOP
        SELECT commission_pct INTO v_pct
          FROM public.comp_grid_rates
         WHERE tenant_id = v_tenant
           AND position_id = v_agent.position_id
         LIMIT 1;
        IF v_pct IS NULL THEN
            v_pct := 50.00;
        END IF;

        FOR v_prod IN
            SELECT id FROM public.comp_grid_products WHERE tenant_id = v_tenant
        LOOP
            INSERT INTO public.agent_carrier_rates (
                tenant_id, agent_id, product_id, rate, source,
                templated_from_position_id, templated_at, start_date
            )
            VALUES (
                v_tenant, v_agent.id, v_prod.id, v_pct, 'position_default',
                v_agent.position_id, now(), (CURRENT_DATE - interval '1 year')::date
            )
            ON CONFLICT (tenant_id, agent_id, product_id, start_date) DO NOTHING;
            -- start_date back-dated 1 year so the commission engine resolves
            -- rates for every policy in the 90-day distribution; otherwise
            -- only policies dated today would have an applicable rate row.
        END LOOP;
    END LOOP;
END
$seed_acr$;


-- ---------------------------------------------------------------------------
-- 10. agent_contracts — one row per (agent × carrier)
--     UNIQUE (tenant_id, carrier_id, writing_number) — use agent_initials +
--     carrier_initials so writing numbers don't collide across the matrix.
--     Owner included for completeness; they don't write business so policy
--     join is unused. NOTE: orphan auto-link trigger fires AFTER INSERT.
--     Orphan policies (inserted later) use a separate "ORPHAN-N" agent_number
--     that won't match any contract, so the trigger is a no-op for them.
-- ---------------------------------------------------------------------------
DO $seed_contracts$
DECLARE
    v_tenant uuid := '11111111-1111-1111-1111-111111111111';
    v_agent  RECORD;
    v_carr   RECORD;
    v_wn     TEXT;
    v_init   TEXT;
    v_carrinit TEXT;
BEGIN
    FOR v_agent IN
        SELECT id, first_name, last_name FROM public.agents WHERE tenant_id = v_tenant
    LOOP
        v_init := upper(left(coalesce(v_agent.first_name, 'X'), 1) || left(coalesce(v_agent.last_name, 'X'), 1));
        FOR v_carr IN
            SELECT id, carrier_name FROM public.comp_grid_carriers WHERE tenant_id = v_tenant
        LOOP
            v_carrinit := upper(left(regexp_replace(v_carr.carrier_name, '[^A-Za-z]', '', 'g'), 3));
            v_wn := 'WN-' || v_init || '-' || v_carrinit;
            INSERT INTO public.agent_contracts (
                tenant_id, agent_id, carrier_id, writing_number,
                effective_date, status
            )
            VALUES (
                v_tenant, v_agent.id, v_carr.id, v_wn,
                (now() - interval '1 year')::date, 'Active'
            )
            ON CONFLICT (tenant_id, carrier_id, writing_number) DO NOTHING;
        END LOOP;
    END LOOP;
END
$seed_contracts$;


-- ---------------------------------------------------------------------------
-- 11. Policies — 120 total, recent-weighted distribution
--     ~40 in last 7 days, ~30 in days 8-30, ~30 in days 31-60, ~20 in days 61-90.
--     Distributed across the 16 non-owner agents. Owner writes nothing.
--     Engineered so ≥ 12 distinct agents have policies in last 30 days.
--     Deterministic via setseed(0.42).
--
--     Policy id pattern: 77777777-0000-0000-0000-{12-digit hex of i}
-- ---------------------------------------------------------------------------
DO $seed_policies$
DECLARE
    v_tenant      uuid := '11111111-1111-1111-1111-111111111111';
    v_agents      uuid[];
    v_products    RECORD;
    v_prod_ids    uuid[];
    v_prod_count  INT;
    v_carrier_for_prod uuid;
    v_carrier_name_for_prod TEXT;
    v_product_name_for_prod TEXT;

    v_i           INT;
    v_age_days    INT;
    v_application DATE;
    v_effective   DATE;
    v_agent_idx   INT;
    v_agent_id    uuid;
    v_writing_number TEXT;
    v_prod_idx    INT;
    v_prod_id     uuid;
    v_status      TEXT;
    v_status_r    NUMERIC;
    v_premium     NUMERIC(12,2);
    v_first       TEXT;
    v_last        TEXT;
    v_first_names TEXT[] := ARRAY['James','John','Robert','Michael','William','David','Richard','Joseph','Thomas','Charles','Mary','Patricia','Jennifer','Linda','Elizabeth','Barbara','Susan','Jessica','Sarah','Karen','Nancy','Lisa','Betty','Sandra','Donna'];
    v_last_names  TEXT[] := ARRAY['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris'];
    v_policy_id   uuid;
    v_policy_num  TEXT;

    -- Per-agent target count for last 30 days (engineered so all 16 agents
    -- get at least one in that window — gives us 16 ≥ 12 active in 30d)
    v_first_30_per_agent INT[] := ARRAY[5,4,4,4, 4,4,4,4, 4,4,4,4, 4,4,4,3];  -- sums to 64 (covers 40+24 ≈ 64 days 0-30)
    v_assigned_30 INT := 0;

    v_existing_count INT;
BEGIN
    -- Skip entirely if already seeded
    SELECT COUNT(*) INTO v_existing_count FROM public.policies WHERE tenant_id = v_tenant;
    IF v_existing_count >= 120 THEN
        RAISE NOTICE 'policies already seeded (% rows); skipping policy generation', v_existing_count;
        RETURN;
    END IF;

    PERFORM setseed(0.42);

    -- non-owner agents only, ordered for determinism (id order)
    SELECT array_agg(id ORDER BY id) INTO v_agents
      FROM public.agents
     WHERE tenant_id = v_tenant AND is_owner = FALSE;

    -- ordered products
    SELECT array_agg(id ORDER BY id) INTO v_prod_ids
      FROM public.comp_grid_products
     WHERE tenant_id = v_tenant;
    v_prod_count := array_length(v_prod_ids, 1);

    FOR v_i IN 1..120 LOOP
        -- Bucket the policy into age windows:
        --   1..40   → 0-7 days   (most recent)
        --   41..70  → 8-30 days
        --   71..100 → 31-60 days
        --   101..120→ 61-90 days
        IF v_i <= 40 THEN
            v_age_days := (v_i - 1) % 8;                  -- 0..7
        ELSIF v_i <= 70 THEN
            v_age_days := 8 + ((v_i - 41) % 23);          -- 8..30
        ELSIF v_i <= 100 THEN
            v_age_days := 31 + ((v_i - 71) % 30);         -- 31..60
        ELSE
            v_age_days := 61 + ((v_i - 101) % 30);        -- 61..90
        END IF;

        v_application := (CURRENT_DATE - v_age_days)::date;
        v_effective   := (v_application + (3 + (v_i % 12)))::date;

        -- Spread across agents:
        --   For first 64 policies (≤30-day window) force one-per-agent rotation
        --   so each of the 16 agents has at least a few recent application_dates.
        --   After that, distribute purely round-robin.
        IF v_age_days <= 30 AND v_assigned_30 < array_length(v_first_30_per_agent, 1) * 4 THEN
            v_agent_idx := (v_assigned_30 % array_length(v_agents, 1)) + 1;
            v_assigned_30 := v_assigned_30 + 1;
        ELSE
            v_agent_idx := ((v_i - 1) % array_length(v_agents, 1)) + 1;
        END IF;
        v_agent_id := v_agents[v_agent_idx];

        -- Pick product (rotate)
        v_prod_idx := ((v_i - 1) % v_prod_count) + 1;
        v_prod_id  := v_prod_ids[v_prod_idx];

        SELECT p.carrier_id, c.carrier_name, p.product_name
          INTO v_carrier_for_prod, v_carrier_name_for_prod, v_product_name_for_prod
          FROM public.comp_grid_products p
          JOIN public.comp_grid_carriers c ON c.id = p.carrier_id
         WHERE p.id = v_prod_id;

        -- writing_number lookup so policies.agent_number matches the
        -- corresponding contract (so the orphan auto-link path is symmetric).
        SELECT writing_number INTO v_writing_number
          FROM public.agent_contracts
         WHERE tenant_id = v_tenant
           AND agent_id  = v_agent_id
           AND carrier_id = v_carrier_for_prod
         LIMIT 1;

        -- Status distribution — weight toward booked / realized
        v_status_r := random();
        v_status := CASE
            WHEN v_status_r < 0.30 THEN 'Submitted'
            WHEN v_status_r < 0.55 THEN 'Pending'
            WHEN v_status_r < 0.75 THEN 'Issued'
            WHEN v_status_r < 0.92 THEN 'Issue Paid'
            WHEN v_status_r < 0.97 THEN 'Potential Lapse'
            ELSE 'Terminated'
        END;

        v_premium := 500 + round((random() * 14500)::numeric, 2);

        v_first := v_first_names[((v_i - 1) % array_length(v_first_names, 1)) + 1];
        v_last  := v_last_names[((v_i * 7 - 1) % array_length(v_last_names, 1)) + 1];

        v_policy_id := ('77777777-0000-0000-0000-' || lpad(to_hex(v_i), 12, '0'))::uuid;
        v_policy_num := 'POL-' || lpad(v_i::text, 6, '0');

        INSERT INTO public.policies (
            id, tenant_id, policy_number, agent_id, agent_number,
            carrier, product, product_id,
            client_first_name, client_last_name,
            application_date, effective_date, annual_premium,
            status
        )
        VALUES (
            v_policy_id, v_tenant, v_policy_num, v_agent_id, v_writing_number,
            v_carrier_name_for_prod, v_product_name_for_prod, v_prod_id,
            v_first, v_last,
            v_application, v_effective, v_premium,
            v_status::public.policy_status
        )
        ON CONFLICT (id) DO NOTHING;
    END LOOP;
END
$seed_policies$;


-- ---------------------------------------------------------------------------
-- 12. Orphan policies — exactly 5, agent_id IS NULL, agent_number doesn't
--     match any contract. Inserted AFTER contracts/policies so the orphan
--     auto-link trigger has nothing to attach them to.
-- ---------------------------------------------------------------------------
INSERT INTO public.policies (
    id, tenant_id, policy_number, agent_id, agent_number,
    carrier, product, product_id,
    client_first_name, client_last_name,
    application_date, effective_date, annual_premium,
    status
)
VALUES
    ('77777777-0000-0000-0000-0000000000F1', '11111111-1111-1111-1111-111111111111', 'POL-ORPHAN-1', NULL, 'ORPHAN-1', 'Mutual of Omaha', 'Living Promise Whole Life', '44444444-0000-0000-0000-000000000001', 'Unknown', 'Client', (CURRENT_DATE - 12)::date, (CURRENT_DATE - 2)::date,  3500.00, 'Submitted'),
    ('77777777-0000-0000-0000-0000000000F2', '11111111-1111-1111-1111-111111111111', 'POL-ORPHAN-2', NULL, 'ORPHAN-2', 'Athene',          'Performance Elite Plus 10','44444444-0000-0000-0000-000000000004', 'Pending', 'Match',    (CURRENT_DATE - 8)::date,  (CURRENT_DATE + 3)::date,  8200.00, 'Pending'),
    ('77777777-0000-0000-0000-0000000000F3', '11111111-1111-1111-1111-111111111111', 'POL-ORPHAN-3', NULL, 'ORPHAN-3', 'F&G Life',        'Pathsetter IUL',            '44444444-0000-0000-0000-000000000006', 'No',      'Agent',    (CURRENT_DATE - 5)::date,  (CURRENT_DATE + 5)::date,  1850.00, 'Submitted'),
    ('77777777-0000-0000-0000-0000000000F4', '11111111-1111-1111-1111-111111111111', 'POL-ORPHAN-4', NULL, 'ORPHAN-4', 'Mutual of Omaha', 'Term Life Express',         '44444444-0000-0000-0000-000000000002', 'Review',  'Needed',   (CURRENT_DATE - 20)::date, (CURRENT_DATE - 10)::date, 1200.00, 'Issued'),
    ('77777777-0000-0000-0000-0000000000F5', '11111111-1111-1111-1111-111111111111', 'POL-ORPHAN-5', NULL, 'ORPHAN-5', 'F&G Life',        'Safe Income Plus',          '44444444-0000-0000-0000-000000000007', 'Manual',  'Review',   (CURRENT_DATE - 3)::date,  (CURRENT_DATE + 7)::date, 14500.00, 'Submitted')
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 13. policy_status_history — the standard policies_record_status_change
--     trigger writes one row per INSERT automatically (source='manual').
--     No explicit inserts needed. This block documents the behavior so a
--     future maintainer doesn't think it's missing.
-- ---------------------------------------------------------------------------
-- (intentionally empty)


-- ---------------------------------------------------------------------------
-- 14. activity_events — the AFTER INSERT trigger on policies already writes
--     one 'policy_created' event per policy (Phase 10A.1). To ensure the
--     recent-activity feed has a mix of event_types, add 10 hand-crafted
--     rows spanning agent_invited / agent_position_changed / master_grid_edited.
-- ---------------------------------------------------------------------------
INSERT INTO public.activity_events (
    id, tenant_id, event_type, event_at, actor_user_id, subject_user_id, summary, metadata
)
VALUES
    ('88888888-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'agent_invited',         now() - interval '13 days', '22222222-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000006', 'Demo Owner invited Emma Evans',           '{"role":"agent"}'::jsonb),
    ('88888888-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'agent_invited',         now() - interval '11 days', '22222222-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000007', 'Demo Owner invited Frank Foster',         '{"role":"agent"}'::jsonb),
    ('88888888-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'agent_position_changed', now() - interval '9 days',  '22222222-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'Alice Anderson promoted to Director',     '{"from":"AGENT","to":"DIRECTOR"}'::jsonb),
    ('88888888-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'master_grid_edited',    now() - interval '8 days',  '22222222-0000-0000-0000-000000000001', NULL,                                       'Master grid updated for Mutual of Omaha', '{"carrier":"Mutual of Omaha"}'::jsonb),
    ('88888888-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'agent_invited',         now() - interval '7 days',  '22222222-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000010', 'Demo Owner invited Ivy Irwin',            '{"role":"agent"}'::jsonb),
    ('88888888-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'master_grid_edited',    now() - interval '5 days',  '22222222-0000-0000-0000-000000000001', NULL,                                       'Master grid updated for Athene',          '{"carrier":"Athene"}'::jsonb),
    ('88888888-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'agent_position_changed', now() - interval '4 days',  '22222222-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000006', 'Emma Evans promoted to Agent',            '{"from":"TRAINEE","to":"AGENT"}'::jsonb),
    ('88888888-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'agent_invited',         now() - interval '3 days',  '22222222-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000017', 'Demo Owner invited Peter Parker',         '{"role":"agent"}'::jsonb),
    ('88888888-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'master_grid_edited',    now() - interval '2 days',  '22222222-0000-0000-0000-000000000001', NULL,                                       'Master grid updated for F&G Life',        '{"carrier":"F&G Life"}'::jsonb),
    ('88888888-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'agent_position_changed', now() - interval '1 day',   '22222222-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000003', 'Bob Brown promoted to Director',          '{"from":"AGENT","to":"DIRECTOR"}'::jsonb)
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 15. announcements — 2 pinned + 2 non-pinned
-- ---------------------------------------------------------------------------
INSERT INTO public.announcements (
    id, tenant_id, posted_by_user_id, title, body, pinned, created_at
)
VALUES
    ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001', 'Welcome to Baseshop HQ!',          'This is your team headquarters. Pin important updates here.', TRUE,  now() - interval '14 days'),
    ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001', 'Q2 Annual Goal: $1,000,000',       'Lock in. Push the leaderboard. Quarterly review on the 30th.', TRUE,  now() - interval '10 days'),
    ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001', 'New carrier: F&G Life',            'F&G Life now appears in your master grid. Contracts dropped.', FALSE, now() - interval '6 days'),
    ('aaaaaaaa-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001', 'Reminder: log apps daily',         'Daily activity > heroic Fridays.',                            FALSE, now() - interval '2 days')
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 16. Phase 10F seed: leadership broadcast, action item, promotion target.
--     Gives /home immediate content on first login after a fresh reset.
-- ---------------------------------------------------------------------------

INSERT INTO public.leadership_broadcasts (
    id, tenant_id, created_by_user_id, title, body, cta_text, cta_url,
    targeting, start_at, end_at, is_active
)
VALUES (
    'bbbbbbbb-0000-0000-0000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '22222222-0000-0000-0000-000000000001',
    'Vegas conference registration is OPEN',
    'Book your seat for the annual leadership summit. Limited to 200 agents.',
    'Register now',
    'https://baseshophq.com/events/vegas-2026',
    '{"all": true}'::jsonb,
    now() - interval '1 day',
    now() + interval '14 days',
    TRUE
)
ON CONFLICT (id) DO NOTHING;

-- One action item per third-level agent: "submit your writing number for F&G Life".
-- Demonstrates the per-user banner pattern without targeting every agent.
INSERT INTO public.user_action_items (
    id, tenant_id, user_id, action_type, title, body,
    cta_text, cta_url, is_dismissible
)
VALUES
    ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000006', 'submit_writing_number',
        'Submit your F&G Life writing number',
        'Your commissions for F&G Life will not match until you submit your writing number.',
        'Add now', '/contracts', TRUE),
    ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000007', 'submit_writing_number',
        'Submit your F&G Life writing number',
        'Your commissions for F&G Life will not match until you submit your writing number.',
        'Add now', '/contracts', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Promotion ladder: AGENT → DIRECTOR.
-- Owners stay at OWNER (top rung, no target). Directors have no next rung
-- in this seed. The 12 agents will see a populated promotion gauge.
INSERT INTO public.promotion_targets (
    id, tenant_id, from_position_id, to_position_id, criteria
)
VALUES (
    'dddddddd-0000-0000-0000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '55555555-0000-0000-0000-000000000002',   -- AGENT
    '55555555-0000-0000-0000-000000000003',   -- DIRECTOR
    jsonb_build_object(
        'min_premium_last_3_months', 50000,
        'min_personal_policies',     12,
        'min_active_downline_count', 3
    )
)
ON CONFLICT (tenant_id, from_position_id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 17. (Removed) Post-insert recalc loop.
--     Previously this section ran recalculate_policy_payouts on every
--     Issued + Issue Paid policy because the old trigger only fired on
--     INSERT-as-Issued / UPDATE-to-Issued. As of migration
--     20260512130000_fix_commission_trigger_to_fire_on_all_status_changes.sql
--     the trigger fires on every status change and the engine owns the
--     commissionable gate. No explicit recalc needed — if this seed ever
--     starts producing significantly fewer commission rows than the
--     Checkpoint-C baseline (~122 across 44+ policies), the trigger has
--     regressed and migration-check will surface it.
-- ---------------------------------------------------------------------------


COMMIT;

-- ============================================================================
-- Verification queries (run after `supabase db reset --local`)
-- Expected counts: 1, 17, 4, 12, 17, 120, 5, ≥12
-- ============================================================================
-- SELECT 'tenants',       COUNT(*) FROM public.tenants WHERE slug = 'demo-agency';
-- SELECT 'agents',        COUNT(*) FROM public.agents  WHERE tenant_id = '11111111-1111-1111-1111-111111111111';
-- SELECT 'directors',     COUNT(*) FROM public.agents  WHERE upline_agent_id = '22222222-0000-0000-0000-000000000001';
-- SELECT 'third_level',   COUNT(*) FROM public.agents
--   WHERE upline_agent_id IN (SELECT id FROM public.agents WHERE upline_agent_id = '22222222-0000-0000-0000-000000000001');
-- SELECT 'auth_users',    COUNT(*) FROM auth.users     WHERE email LIKE '%@baseshophq.test';
-- SELECT 'policies',      COUNT(*) FROM public.policies WHERE tenant_id = '11111111-1111-1111-1111-111111111111';
-- SELECT 'orphans',       COUNT(*) FROM public.policies
--   WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND agent_id IS NULL;
-- SELECT 'active_agents', COUNT(DISTINCT agent_id) FROM public.policies
--   WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
--     AND application_date >= now() - interval '30 days'
--     AND agent_id IS NOT NULL;
