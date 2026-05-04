-- =============================================================================
-- Baseshop HQ — Phase 4b-1: match RPCs + ingest_policy_row orchestrator
-- Target: Supabase project oarstmxbgdczytwzpyxj
-- Status: DRAFT — do not apply until user green-lights
--
-- Four service-role-only RPCs for the carrier ingest pipeline:
--
--   1. match_agent_by_writing_number(tenant, carrier_name, writing_number)
--      Returns agent_id from agent_contracts, NULL if no match.
--
--   2. match_agent_by_email(tenant, email)
--      Returns agent_id from agents, NULL if no match. Case-insensitive.
--
--   3. canonicalize_product(tenant, carrier_name, product_string)
--      Strips carrier prefix, looks up against comp_grid_products by literal
--      name. Returns product_id, NULL if no match. Phase 4b-2 will add a
--      tenant-scoped product_aliases table for owner-managed alias resolution;
--      Phase 4b-1 keeps it literal-only.
--
--   4. ingest_policy_row(tenant, payload)
--      Orchestrator. Takes a normalized JSONB row, calls match + canonicalize,
--      INSERTs into policies. Sets app.policy_status_source = 'csv_import'
--      so the status history trigger tags correctly. Returns policy_id +
--      flags array (orphan / unmatched / product_ambiguous / status_unknown).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. match_agent_by_writing_number
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_agent_by_writing_number(
    p_tenant_id      UUID,
    p_carrier_name   TEXT,
    p_writing_number TEXT
)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT ac.agent_id
    FROM public.agent_contracts ac
    JOIN public.comp_grid_carriers car ON car.id = ac.carrier_id
    WHERE ac.tenant_id     = p_tenant_id
      AND car.carrier_name = p_carrier_name
      AND ac.writing_number = p_writing_number
    LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.match_agent_by_writing_number(UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_agent_by_writing_number(UUID, TEXT, TEXT)
    TO service_role;


-- -----------------------------------------------------------------------------
-- 2. match_agent_by_email
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_agent_by_email(
    p_tenant_id UUID,
    p_email     TEXT
)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT id
    FROM public.agents
    WHERE tenant_id    = p_tenant_id
      AND lower(email) = lower(p_email)
    LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.match_agent_by_email(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_agent_by_email(UUID, TEXT)
    TO service_role;


-- -----------------------------------------------------------------------------
-- 3. canonicalize_product
-- -----------------------------------------------------------------------------
-- Phase 4b-1 implementation: literal carrier-prefix-strip + name match.
-- Phase 4b-2 will introduce a tenant-scoped product_aliases table for
-- owner-managed alias resolution. Until then, the wizard layer (Phase 4b-2)
-- can pre-process strings using the TS canonicalization map at
-- src/lib/comp-grid-product-canonicalization.ts before calling this RPC.
--
-- Returns NULL when no literal match is found; caller surfaces in the
-- Resolve Agents step.
CREATE OR REPLACE FUNCTION public.canonicalize_product(
    p_tenant_id      UUID,
    p_carrier_name   TEXT,
    p_product_string TEXT
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_stripped   TEXT;
    v_product_id UUID;
BEGIN
    IF p_product_string IS NULL OR p_product_string = '' THEN
        RETURN NULL;
    END IF;

    -- Strip carrier prefix if present (case-insensitive)
    IF lower(p_product_string) LIKE lower(p_carrier_name) || ' %' THEN
        v_stripped := substr(p_product_string, length(p_carrier_name) + 2);
    ELSE
        v_stripped := p_product_string;
    END IF;

    SELECT prd.id INTO v_product_id
    FROM public.comp_grid_products prd
    JOIN public.comp_grid_carriers car ON car.id = prd.carrier_id
    WHERE prd.tenant_id      = p_tenant_id
      AND car.carrier_name   = p_carrier_name
      AND prd.product_name   = v_stripped
      AND prd.product_variant IS NULL  -- variants need explicit selection at ingest time
    LIMIT 1;

    RETURN v_product_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.canonicalize_product(UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonicalize_product(UUID, TEXT, TEXT)
    TO service_role;


-- -----------------------------------------------------------------------------
-- 4. ingest_policy_row (orchestrator)
-- -----------------------------------------------------------------------------
-- Payload shape (the wizard will normalize CSV columns into this):
--   {
--     "policy_number":     "POL-001",
--     "writing_number":    "TEST-002",        // optional
--     "agent_email":       "agent1@..."        // optional, fallback when writing_number absent
--     "carrier":           "Mutual of Omaha",  // raw carrier string from CSV
--     "product":           "Term Life Express",
--     "client_first_name": "...", "client_last_name": "...",
--     "client_dob":        "1965-01-15",
--     "application_date":  "2026-05-05",
--     "effective_date":    "2026-05-05",
--     "annual_premium":    1500.00,
--     "status":            "Issued",           // optional, defaults to 'Submitted'
--     "notes":             "..."
--   }
--
-- Match priority (per carrier-ingest-pipeline wiki):
--   1. writing_number → match_agent_by_writing_number
--   2. else if email present → match_agent_by_email
--   3. else → unmatched (orphan if writing_number was present but no match,
--             unmatched-no-id if neither writing_number nor email present)
--
-- Status: validates against policy_status enum. Unknown values default to
-- 'Submitted' and add 'status_unknown' to flags.
--
-- Sets app.policy_status_source = 'csv_import' so the status history trigger
-- tags the inserted row's history with the right source.
CREATE OR REPLACE FUNCTION public.ingest_policy_row(
    p_tenant_id UUID,
    p_payload   JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_writing_number TEXT;
    v_email          TEXT;
    v_carrier        TEXT;
    v_product        TEXT;
    v_status         TEXT;
    v_status_enum    public.policy_status;
    v_agent_id       UUID;
    v_product_id     UUID;
    v_policy_id      UUID;
    v_flags          JSONB := '[]'::jsonb;
BEGIN
    -- Tag history rows from this insert with csv_import source
    PERFORM set_config('app.policy_status_source', 'csv_import', true);

    v_writing_number := NULLIF(p_payload ->> 'writing_number', '');
    v_email          := NULLIF(p_payload ->> 'agent_email', '');
    v_carrier        := NULLIF(p_payload ->> 'carrier', '');
    v_product        := NULLIF(p_payload ->> 'product', '');
    v_status         := COALESCE(NULLIF(p_payload ->> 'status', ''), 'Submitted');

    -- Match agent
    IF v_writing_number IS NOT NULL THEN
        v_agent_id := public.match_agent_by_writing_number(p_tenant_id, v_carrier, v_writing_number);
        IF v_agent_id IS NULL THEN
            v_flags := v_flags || jsonb_build_array('orphan');
        END IF;
    ELSIF v_email IS NOT NULL THEN
        v_agent_id := public.match_agent_by_email(p_tenant_id, v_email);
        IF v_agent_id IS NULL THEN
            v_flags := v_flags || jsonb_build_array('unmatched');
        END IF;
    ELSE
        v_flags := v_flags || jsonb_build_array('unmatched');
    END IF;

    -- Canonicalize product
    IF v_product IS NOT NULL AND v_carrier IS NOT NULL THEN
        v_product_id := public.canonicalize_product(p_tenant_id, v_carrier, v_product);
        IF v_product_id IS NULL THEN
            v_flags := v_flags || jsonb_build_array('product_ambiguous');
        END IF;
    END IF;

    -- Validate status
    BEGIN
        v_status_enum := v_status::public.policy_status;
    EXCEPTION WHEN invalid_text_representation THEN
        v_status_enum := 'Submitted'::public.policy_status;
        v_flags := v_flags || jsonb_build_array('status_unknown');
    END;

    INSERT INTO public.policies (
        tenant_id, policy_number, agent_id, agent_number, carrier, product, product_id,
        client_first_name, client_last_name, client_dob,
        application_date, effective_date, annual_premium, status, notes
    )
    VALUES (
        p_tenant_id,
        p_payload ->> 'policy_number',
        v_agent_id,
        v_writing_number,
        v_carrier,
        v_product,
        v_product_id,
        NULLIF(p_payload ->> 'client_first_name', ''),
        NULLIF(p_payload ->> 'client_last_name', ''),
        NULLIF(p_payload ->> 'client_dob', '')::date,
        NULLIF(p_payload ->> 'application_date', '')::date,
        NULLIF(p_payload ->> 'effective_date', '')::date,
        NULLIF(p_payload ->> 'annual_premium', '')::numeric,
        v_status_enum,
        NULLIF(p_payload ->> 'notes', '')
    )
    RETURNING id INTO v_policy_id;

    RETURN jsonb_build_object(
        'policy_id',   v_policy_id,
        'agent_id',    v_agent_id,
        'product_id',  v_product_id,
        'status',      v_status_enum,
        'flags',       v_flags
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ingest_policy_row(UUID, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_policy_row(UUID, JSONB)
    TO service_role;


-- -----------------------------------------------------------------------------
-- 5. Verification
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_fn TEXT;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY[
        'match_agent_by_writing_number',
        'match_agent_by_email',
        'canonicalize_product',
        'ingest_policy_row'
    ]
    LOOP
        ASSERT EXISTS (
            SELECT 1 FROM pg_proc
            WHERE proname = v_fn AND pronamespace = 'public'::regnamespace
        ), format('function public.%s missing', v_fn);
    END LOOP;

    -- Service role only
    ASSERT NOT has_function_privilege('anon',
        'public.match_agent_by_writing_number(uuid, text, text)', 'EXECUTE');
    ASSERT NOT has_function_privilege('authenticated',
        'public.match_agent_by_writing_number(uuid, text, text)', 'EXECUTE');
    ASSERT has_function_privilege('service_role',
        'public.match_agent_by_writing_number(uuid, text, text)', 'EXECUTE');

    ASSERT NOT has_function_privilege('anon',
        'public.ingest_policy_row(uuid, jsonb)', 'EXECUTE');
    ASSERT NOT has_function_privilege('authenticated',
        'public.ingest_policy_row(uuid, jsonb)', 'EXECUTE');
    ASSERT has_function_privilege('service_role',
        'public.ingest_policy_row(uuid, jsonb)', 'EXECUTE');

    RAISE NOTICE 'Phase 4b-1 match RPCs verification passed.';
END $$;

COMMIT;
