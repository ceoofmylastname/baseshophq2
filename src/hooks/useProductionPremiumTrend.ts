/**
 * Phase 10D: Production line chart data.
 *
 * Modes: total | submitted | active | per_agent.
 * Buckets: day | week | month — UI auto-picks based on range width.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useTenant } from "@/contexts/AuthContext";
import type { ProductionBasis } from "./useProductionMetrics";

export type TrendMode   = "total" | "submitted" | "active" | "per_agent";
export type BucketSize  = "day"   | "week"      | "month";

export type SinglePoint   = { bucket_date: string; amount: number };
export type PerAgentPoint = { bucket_date: string; agent_id: string; agent_name: string; amount: number };

export type TrendPayload =
  | { mode: Exclude<TrendMode, "per_agent">; series: SinglePoint[] }
  | { mode: "per_agent";                     series: PerAgentPoint[] };

export function pickBucket(startISO: string, endISO: string): BucketSize {
  const days = Math.max(1, Math.round((+new Date(endISO) - +new Date(startISO)) / 86_400_000) + 1);
  if (days <= 60)  return "day";
  if (days <= 365) return "week";
  return "month";
}

export function useProductionPremiumTrend(args: {
  startDate: string;
  endDate:   string;
  carrierId: string | null;
  basis:     ProductionBasis;
  mode:      TrendMode;
}) {
  const tenant = useTenant();
  const bucket = useMemo(() => pickBucket(args.startDate, args.endDate), [args.startDate, args.endDate]);
  const [data,    setData]    = useState<TrendPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: result, error: err } = await supabase.rpc("production_premium_trend", {
      p_start_date: args.startDate,
      p_end_date:   args.endDate,
      p_carrier_id: args.carrierId,
      p_basis:      args.basis,
      p_mode:       args.mode,
      p_bucket:     bucket,
    });
    setLoading(false);
    if (err) { setError(err.message); return; }
    const r = result as { success?: boolean; error_code?: string; data?: TrendPayload };
    if (!r?.success) { setError(r?.error_code ?? "unknown"); return; }
    setError(null);
    setData(r.data ?? null);
  }, [args.startDate, args.endDate, args.carrierId, args.basis, args.mode, bucket]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(`production-trend-${tenant.id}-${args.mode}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policies", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policy_status_history", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, args.mode, refresh]);

  return { data, bucket, loading, error, refresh };
}
