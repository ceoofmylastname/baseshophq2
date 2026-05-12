/**
 * Phase 10D: Per-agent table — Individual / Team / Total AP, paginated.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";
import type { ProductionBasis } from "./useProductionMetrics";

export type AgentTotalsRow = {
  agent_id:       string;
  agent_name:     string;
  email:          string;
  status:         string;
  position_code:  string | null;
  position_name:  string | null;
  individual_ap:  number;
  team_ap:        number;
  total_ap:       number;
};

export function useProductionAgentTotals(args: {
  startDate: string;
  endDate:   string;
  carrierId: string | null;
  basis:     ProductionBasis;
  limit:     number;
  offset:    number;
}) {
  const tenant = useTenant();
  const [rows,    setRows]    = useState<AgentTotalsRow[]>([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: result, error: err } = await supabase.rpc("production_agent_totals", {
      p_start_date: args.startDate,
      p_end_date:   args.endDate,
      p_carrier_id: args.carrierId,
      p_basis:      args.basis,
      p_limit:      args.limit,
      p_offset:     args.offset,
    });
    setLoading(false);
    if (err) { setError(err.message); return; }
    const r = result as { success?: boolean; error_code?: string; rows?: AgentTotalsRow[]; total?: number };
    if (!r?.success) { setError(r?.error_code ?? "unknown"); return; }
    setError(null);
    const num = (n: unknown) => Number(n ?? 0);
    setRows((r.rows ?? []).map((row) => ({
      ...row,
      individual_ap: num(row.individual_ap),
      team_ap:       num(row.team_ap),
      total_ap:      num(row.total_ap),
    })));
    setTotal(num(r.total));
  }, [args.startDate, args.endDate, args.carrierId, args.basis, args.limit, args.offset]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`production-totals-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policies", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policy_status_history", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "agents", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { rows, total, loading, error, refresh };
}
