/**
 * Templating engine TS wrappers around the Phase 3a Postgres RPCs.
 *
 * These thin wrappers exist so application code (eventual Phase 4 carrier
 * ingest, Phase 4-5 owner UIs) can call the RPCs with typed inputs and
 * outputs instead of raw `supabase.rpc("...")` invocations.
 *
 * All three RPCs are SECURITY DEFINER + service_role only. The caller MUST
 * pass a service-role Supabase client. Authenticated client calls will fail
 * with permission denied.
 */

// Minimal client shape — keeps this module decoupled from @supabase/supabase-js
// at the type level. Real callers pass a Supabase admin client.
export interface SupabaseLikeClient {
  rpc(
    fn: string,
    params: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

// -----------------------------------------------------------------------------
// template_agent_from_position
// -----------------------------------------------------------------------------

export type TemplateAgentInput = {
  agentId: string;
  positionId: string;
  assignedBy?: string | null;
  supabaseAdminClient: SupabaseLikeClient;
};

export type TemplateAgentResult = {
  rates_inserted: number;
  rates_closed: number;
  overrides_preserved: number;
  skipped_non_commissioned: boolean;
  position_id: string;
};

export async function templateAgentFromPosition(
  input: TemplateAgentInput,
): Promise<TemplateAgentResult> {
  const { data, error } = await input.supabaseAdminClient.rpc(
    "template_agent_from_position",
    {
      p_agent_id: input.agentId,
      p_position_id: input.positionId,
      p_assigned_by: input.assignedBy ?? null,
    },
  );
  if (error) {
    throw new Error(`template_agent_from_position RPC failed: ${error.message}`);
  }
  return data as TemplateAgentResult;
}

// -----------------------------------------------------------------------------
// assign_agent_to_position
// -----------------------------------------------------------------------------

export type OverridesAction = "keep" | "clear" | "review";

export type AssignAgentInput = {
  agentId: string;
  positionId: string;
  startDate: string;            // ISO date "YYYY-MM-DD"
  assignedBy?: string | null;
  overridesAction?: OverridesAction;  // defaults to 'keep'
  supabaseAdminClient: SupabaseLikeClient;
};

export type OverrideRecord = {
  agent_carrier_rate_id: string;
  product_id: string;
  product_name: string;
  product_variant: string | null;
  current_rate: number;
  position_default_rate: number | null;
};

export type AssignAgentResult = {
  noop_same_position: boolean;
  prior_position_id: string | null;
  new_position_id: string;
  start_date: string;
  overrides_action: OverridesAction;
  overrides_cleared: number;
  template_result: TemplateAgentResult;
  overrides: OverrideRecord[];
};

export async function assignAgentToPosition(
  input: AssignAgentInput,
): Promise<AssignAgentResult> {
  const action: OverridesAction = input.overridesAction ?? "keep";
  const { data, error } = await input.supabaseAdminClient.rpc(
    "assign_agent_to_position",
    {
      p_agent_id: input.agentId,
      p_position_id: input.positionId,
      p_start_date: input.startDate,
      p_assigned_by: input.assignedBy ?? null,
      p_overrides_action: action,
    },
  );
  if (error) {
    throw new Error(`assign_agent_to_position RPC failed: ${error.message}`);
  }
  return data as AssignAgentResult;
}

// -----------------------------------------------------------------------------
// propagate_master_grid_change
// -----------------------------------------------------------------------------

export type PropagateMasterGridChangeInput = {
  positionId: string;
  productId: string;
  supabaseAdminClient: SupabaseLikeClient;
};

export type PropagateMasterGridChangeResult = {
  agents_updated: number;
  master_rate: number;
  master_schedule: string | null;
};

export async function propagateMasterGridChange(
  input: PropagateMasterGridChangeInput,
): Promise<PropagateMasterGridChangeResult> {
  const { data, error } = await input.supabaseAdminClient.rpc(
    "propagate_master_grid_change",
    {
      p_position_id: input.positionId,
      p_product_id: input.productId,
    },
  );
  if (error) {
    throw new Error(`propagate_master_grid_change RPC failed: ${error.message}`);
  }
  return data as PropagateMasterGridChangeResult;
}
