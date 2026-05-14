/**
 * Phase 13.x polish: count of policies whose product mapping is missing
 * (product_id IS NULL), and the total in-scope count for context.
 *
 * Mirrors useExcludedPolicyCount. RLS handles view-down — counts are
 * automatically scoped to the caller. Realtime keeps the banner accurate
 * as ingest backfills (or new orphans) land.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";

export function useMissingProductCount() {
  const tenant = useTenant();
  const [missingProduct, setMissingProduct] = useState(0);
  const [totalInScope,   setTotalInScope]   = useState(0);
  const [loading,        setLoading]        = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ count: missing }, { count: total }] = await Promise.all([
      supabase
        .from("policies")
        .select("id", { count: "exact", head: true })
        .is("product_id", null),
      supabase
        .from("policies")
        .select("id", { count: "exact", head: true }),
    ]);
    setMissingProduct(missing ?? 0);
    setTotalInScope(total ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`missing-product-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policies", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { missingProduct, totalInScope, loading };
}
