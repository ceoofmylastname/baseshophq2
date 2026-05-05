import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Returns Set<string> of agent IDs the caller can drill into:
 *   self UNION descendants_of(self).
 * For owners this prop is unused (they pass through all rows), but the hook
 * still returns the set so callers can render Lock icons consistently.
 */
export function useVisibleAgentIds(): { visibleAgentIds: Set<string>; loading: boolean } {
  const { currentAgent } = useAuth();
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!currentAgent?.id) { setIds(new Set()); setLoading(false); return; }
      const { data } = await supabase.rpc("descendants_of", { root_agent_id: currentAgent.id });
      if (cancelled) return;
      const set = new Set<string>([currentAgent.id]);
      for (const row of (data ?? []) as Array<{ agent_id: string }>) {
        if (row.agent_id) set.add(row.agent_id);
      }
      setIds(set);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [currentAgent?.id]);

  return { visibleAgentIds: ids, loading };
}
