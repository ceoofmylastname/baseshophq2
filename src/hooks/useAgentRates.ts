import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

export type AgentRateRow = {
  id: string;
  tenant_id: string;
  agent_id: string;
  product_id: string;
  rate: number;
  source: "position_default" | "override";
  schedule_code: string | null;
  start_date: string;
  end_date: string | null;
  templated_from_position_id: string | null;
  templated_at: string | null;
  product_name: string;
  product_variant: string | null;
  product_type: "life" | "annuity";
  has_bonus_column: boolean;
  carrier_id: string;
  carrier_name: string;
  current_default_rate: number | null;
};

/**
 * Reads agent_rates_with_product (current rows only). Subscribes to
 * agent_carrier_rates changes filtered by agent_id and refetches on any
 * INSERT/UPDATE/DELETE so admin overrides + re-template events appear live.
 *
 * Master-grid edits don't auto-propagate (snapshot model) — Phase 8 will
 * call propagate_master_grid_change explicitly, which then writes new rows
 * here and triggers the subscription.
 */
export function useAgentRates(agentId: string | undefined) {
  const [rows, setRows] = useState<AgentRateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!agentId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: err } = await supabase
      .from("agent_rates_with_product")
      .select("*")
      .eq("agent_id", agentId)
      .order("carrier_name", { ascending: true })
      .order("product_name", { ascending: true });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    setRows((data ?? []) as AgentRateRow[]);
  }, [agentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!agentId) return;
    const channel = supabase
      .channel(`agent-rates-${agentId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_carrier_rates",
          filter: `agent_id=eq.${agentId}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [agentId, refresh]);

  return { rows, loading, error, refresh };
}
