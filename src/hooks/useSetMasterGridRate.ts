import { useState } from "react";
import { supabase } from "@/lib/supabase-browser";

export type SetRateResult =
  | {
      ok: true;
      priorRate: number | null;
      newRate: number;
      effectiveDate: string;
      propagation: { agents_updated: number; master_rate: number; master_schedule: string | null; master_effective_date: string };
    }
  | { ok: false; errorCode: string; errorMessage: string };

export function useSetMasterGridRate() {
  const [submitting, setSubmitting] = useState(false);

  async function setRate(args: {
    positionId: string;
    productId: string;
    newRate: number;
    scheduleCode: string | null;
    effective: string; // ISO date
  }): Promise<SetRateResult> {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("set_master_grid_rate", {
        p_position_id: args.positionId,
        p_product_id: args.productId,
        p_new_rate: args.newRate,
        p_schedule_code: args.scheduleCode,
        p_effective: args.effective,
      });
      if (error) {
        return { ok: false, errorCode: "rpc_error", errorMessage: error.message };
      }
      const r = data as {
        success: boolean;
        error_code?: string;
        prior_rate: number | null;
        new_rate: number;
        effective_date: string;
        propagation: SetRateResult extends { ok: true } ? never : never;
      };
      if (!r?.success) {
        return {
          ok: false,
          errorCode: r?.error_code ?? "unknown",
          errorMessage: mapErrorCode(r?.error_code ?? "unknown"),
        };
      }
      return {
        ok: true,
        priorRate: r.prior_rate === null ? null : Number(r.prior_rate),
        newRate: Number(r.new_rate),
        effectiveDate: r.effective_date,
        propagation: (data as { propagation: SetRateResult extends { ok: true } ? never : never }).propagation as never,
      };
    } finally {
      setSubmitting(false);
    }
  }

  return { setRate, submitting };
}

function mapErrorCode(code: string): string {
  switch (code) {
    case "forbidden": return "Owner-only action.";
    case "rate_out_of_range": return "Rate must be between 0 and 200%.";
    default: return "Failed to update rate.";
  }
}
