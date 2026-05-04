/**
 * Carrier ingest TS wrappers around the Phase 4b-1 SQL RPCs.
 *
 * The actual matching + canonicalization + insert logic happens in Postgres
 * (transactional, single roundtrip per row). This module exists so app code
 * (eventual Phase 4b-2 wizard) can invoke the pipeline with typed I/O.
 *
 * All four RPCs are SECURITY DEFINER + service_role only. Caller MUST pass a
 * service-role Supabase client.
 */

import type { SupabaseLikeClient } from "./comp-grid-templating.ts";

// -----------------------------------------------------------------------------
// match_agent_by_writing_number
// -----------------------------------------------------------------------------

export type MatchAgentByWritingNumberInput = {
  tenantId: string;
  carrierName: string;
  writingNumber: string;
  supabaseAdminClient: SupabaseLikeClient;
};

export async function matchAgentByWritingNumber(
  input: MatchAgentByWritingNumberInput,
): Promise<string | null> {
  const { data, error } = await input.supabaseAdminClient.rpc(
    "match_agent_by_writing_number",
    {
      p_tenant_id:      input.tenantId,
      p_carrier_name:   input.carrierName,
      p_writing_number: input.writingNumber,
    },
  );
  if (error) throw new Error(`match_agent_by_writing_number RPC failed: ${error.message}`);
  return (data as string | null) ?? null;
}

// -----------------------------------------------------------------------------
// match_agent_by_email
// -----------------------------------------------------------------------------

export type MatchAgentByEmailInput = {
  tenantId: string;
  email: string;
  supabaseAdminClient: SupabaseLikeClient;
};

export async function matchAgentByEmail(
  input: MatchAgentByEmailInput,
): Promise<string | null> {
  const { data, error } = await input.supabaseAdminClient.rpc(
    "match_agent_by_email",
    { p_tenant_id: input.tenantId, p_email: input.email },
  );
  if (error) throw new Error(`match_agent_by_email RPC failed: ${error.message}`);
  return (data as string | null) ?? null;
}

// -----------------------------------------------------------------------------
// canonicalize_product
// -----------------------------------------------------------------------------

export type CanonicalizeProductInput = {
  tenantId: string;
  carrierName: string;
  productString: string;
  supabaseAdminClient: SupabaseLikeClient;
};

export async function canonicalizeProduct(
  input: CanonicalizeProductInput,
): Promise<string | null> {
  const { data, error } = await input.supabaseAdminClient.rpc(
    "canonicalize_product",
    {
      p_tenant_id:      input.tenantId,
      p_carrier_name:   input.carrierName,
      p_product_string: input.productString,
    },
  );
  if (error) throw new Error(`canonicalize_product RPC failed: ${error.message}`);
  return (data as string | null) ?? null;
}

// -----------------------------------------------------------------------------
// ingest_policy_row
// -----------------------------------------------------------------------------

export type IngestFlag = "orphan" | "unmatched" | "product_ambiguous" | "status_unknown";

export type IngestPolicyPayload = {
  policy_number: string;
  writing_number?: string;
  agent_email?: string;
  carrier?: string;
  product?: string;
  client_first_name?: string;
  client_last_name?: string;
  client_dob?: string;            // ISO date
  application_date?: string;
  effective_date?: string;
  annual_premium?: number;
  status?: string;                // mapped to policy_status enum
  notes?: string;
};

export type IngestPolicyResult = {
  policy_id: string;
  agent_id: string | null;
  product_id: string | null;
  status: string;
  flags: IngestFlag[];
};

export type IngestPolicyRowInput = {
  tenantId: string;
  payload: IngestPolicyPayload;
  supabaseAdminClient: SupabaseLikeClient;
};

export async function ingestPolicyRow(
  input: IngestPolicyRowInput,
): Promise<IngestPolicyResult> {
  const { data, error } = await input.supabaseAdminClient.rpc(
    "ingest_policy_row",
    { p_tenant_id: input.tenantId, p_payload: input.payload },
  );
  if (error) throw new Error(`ingest_policy_row RPC failed: ${error.message}`);
  return data as IngestPolicyResult;
}
