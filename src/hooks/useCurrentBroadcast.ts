import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";

export type Broadcast = {
  id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  cta_text: string | null;
  cta_url: string | null;
  start_at: string;
  end_at: string | null;
  created_at: string;
};

/**
 * Wraps current_leadership_broadcast() RPC. Server-side resolves targeting +
 * scheduling, so the UI just renders or hides.
 */
export function useCurrentBroadcast() {
  const tenant = useTenant();
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data } = await supabase.rpc("current_leadership_broadcast");
    setLoading(false);
    const r = data as { success: boolean; broadcast: Broadcast | null } | null;
    setBroadcast(r?.success ? (r.broadcast ?? null) : null);
  }, [tenant?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Subscribe to broadcast changes so a new push or toggle reflects live.
  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`leadership-broadcasts-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "leadership_broadcasts", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { broadcast, loading, refresh };
}
