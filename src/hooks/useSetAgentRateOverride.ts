import { useState } from "react";
import { supabase } from "@/lib/supabase-browser";

export type RateMutationResult =
  | { ok: true }
  | { ok: false; errorCode: string; errorMessage: string };

/**
 * Wraps set_agent_carrier_rate_override + reset_agent_carrier_rate_to_default
 * RPCs. Both are owner-only at the RPC layer (is_owner() guard).
 */
export function useSetAgentRateOverride() {
  const [submitting, setSubmitting] = useState(false);

  async function setOverride(args: {
    agentId: string;
    productId: string;
    rate: number;
    scheduleCode: string | null;
  }): Promise<RateMutationResult> {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("set_agent_carrier_rate_override", {
        p_agent_id: args.agentId,
        p_product_id: args.productId,
        p_rate: args.rate,
        p_schedule_code: args.scheduleCode,
      });
      if (error) return { ok: false, errorCode: "rpc_error", errorMessage: error.message };
      const r = data as { success?: boolean; error_code?: string };
      if (!r?.success) {
        return {
          ok: false,
          errorCode: r?.error_code ?? "unknown",
          errorMessage: mapOverrideErrorCode(r?.error_code ?? "unknown"),
        };
      }
      return { ok: true };
    } finally {
      setSubmitting(false);
    }
  }

  async function resetToDefault(args: {
    agentId: string;
    productId: string;
  }): Promise<RateMutationResult> {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("reset_agent_carrier_rate_to_default", {
        p_agent_id: args.agentId,
        p_product_id: args.productId,
      });
      if (error) return { ok: false, errorCode: "rpc_error", errorMessage: error.message };
      const r = data as { success?: boolean; error_code?: string };
      if (!r?.success) {
        return {
          ok: false,
          errorCode: r?.error_code ?? "unknown",
          errorMessage: mapOverrideErrorCode(r?.error_code ?? "unknown"),
        };
      }
      return { ok: true };
    } finally {
      setSubmitting(false);
    }
  }

  return { setOverride, resetToDefault, submitting };
}

function mapOverrideErrorCode(code: string): string {
  switch (code) {
    case "forbidden":
      return "Only the tenant owner can edit override rates.";
    case "rate_out_of_range":
      return "Rate must be between 0 and 200%.";
    case "agent_not_found":
      return "Agent not found.";
    case "product_not_in_tenant":
      return "Product not found in this tenant.";
    case "agent_unassigned":
      return "Assign the agent to a position before resetting.";
    case "no_master_rate":
      return "No master grid rate exists for this position+product.";
    case "rpc_error":
      return "Database error.";
    default:
      return "Override change failed.";
  }
}
