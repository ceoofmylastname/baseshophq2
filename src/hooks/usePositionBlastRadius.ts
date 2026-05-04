import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

export type BlastRadius = {
  life_rates_to_template: number;
  annuity_rates_to_template: number;
  existing_override_count: number;
};

/**
 * Calls position_template_blast_radius RPC. Returns null while loading or on
 * error. Skips the call when either id is missing.
 */
export function usePositionBlastRadius(
  agentId: string | undefined,
  positionId: string | undefined,
) {
  const [data, setData] = useState<BlastRadius | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId || !positionId) {
      setData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: result, error: err } = await supabase.rpc(
        "position_template_blast_radius",
        { p_agent_id: agentId, p_position_id: positionId },
      );
      if (cancelled) return;
      setLoading(false);
      if (err) {
        setError(err.message);
        setData(null);
        return;
      }
      const r = result as { success?: boolean; error_code?: string } & BlastRadius;
      if (!r?.success) {
        setError(r?.error_code ?? "unknown");
        setData(null);
        return;
      }
      setError(null);
      setData({
        life_rates_to_template: r.life_rates_to_template,
        annuity_rates_to_template: r.annuity_rates_to_template,
        existing_override_count: r.existing_override_count,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, positionId]);

  return { data, loading, error };
}
