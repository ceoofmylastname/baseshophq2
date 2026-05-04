import { useState } from "react";
import { supabase } from "@/lib/supabase-browser";

export type BlastRadius = { eligible_agents: number; overridden_agents: number };

export function useMasterGridBlastRadius() {
  const [loading, setLoading] = useState(false);

  async function fetchBlast(positionId: string, productId: string): Promise<BlastRadius | null> {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("master_grid_blast_radius", {
        p_position_id: positionId,
        p_product_id: productId,
      });
      if (error) return null;
      const r = data as { success?: boolean } & BlastRadius;
      if (!r?.success) return null;
      return { eligible_agents: r.eligible_agents, overridden_agents: r.overridden_agents };
    } finally {
      setLoading(false);
    }
  }

  return { fetchBlast, loading };
}
