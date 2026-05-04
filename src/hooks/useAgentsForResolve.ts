import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

export type ResolveAgent = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
};

export function useAgentsForResolve() {
  const [agents, setAgents] = useState<ResolveAgent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("agents_with_current_position")
        .select("id, email, first_name, last_name")
        .order("first_name", { ascending: true, nullsFirst: false });
      if (cancelled) return;
      setLoading(false);
      setAgents((data ?? []) as ResolveAgent[]);
    })();
    return () => { cancelled = true; };
  }, []);

  return { agents, loading };
}
