import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

export type AgentProfile = {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  is_owner: boolean;
  status: "active" | "inactive" | "archived";
  upline_email: string | null;
  current_position_id: string | null;
  current_position_code: string | null;
  current_position_name: string | null;
  current_position_sort_order: number | null;
  current_position_is_commissioned: boolean | null;
  current_assignment_id: string | null;
  current_position_start_date: string | null;
};

export function useAgent(agentId: string | undefined) {
  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!agentId) {
      setAgent(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: err } = await supabase
      .from("agents_with_current_position")
      .select("*")
      .eq("id", agentId)
      .maybeSingle();
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    setAgent((data ?? null) as AgentProfile | null);
  }, [agentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { agent, loading, error, refresh };
}
