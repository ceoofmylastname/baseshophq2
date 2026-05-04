import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useTenant } from "@/contexts/AuthContext";

export type IngestRun = {
  id: string;
  started_at: string;
  completed_at: string | null;
  rows_total: number;
  rows_assigned: number;
  rows_orphan: number;
  rows_skipped: number;
};

export function useLastImportRun() {
  const tenant = useTenant();
  const [run, setRun] = useState<IngestRun | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("ingest_runs")
      .select("id, started_at, completed_at, rows_total, rows_assigned, rows_orphan, rows_skipped")
      .eq("tenant_id", tenant.id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLoading(false);
    setRun((data ?? null) as IngestRun | null);
  }, [tenant?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Realtime: ingest_runs INSERT triggers refetch
  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(`ingest-runs-${tenant.id}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "ingest_runs", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { run, loading, refresh };
}
