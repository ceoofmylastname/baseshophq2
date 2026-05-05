/**
 * Phase 10D polish: count of policies excluded from Production aggregations
 * because their application_date is NULL.
 *
 * RLS handles view-down — non-owners only see policies in their scope, so the
 * count is automatically scoped to what's relevant to the caller. Realtime
 * keeps the banner accurate as ingest backfills (or new orphans) land.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useTenant } from "@/contexts/AuthContext";

export function useExcludedPolicyCount() {
  const tenant = useTenant();
  const [count,   setCount]   = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { count: c } = await supabase
      .from("policies")
      .select("id", { count: "exact", head: true })
      .is("application_date", null);
    setLoading(false);
    setCount(c ?? 0);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(`excluded-policies-${tenant.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policies", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { count, loading };
}
