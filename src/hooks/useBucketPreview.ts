/**
 * Ad-hoc 30s in-memory cache for the dashboard_bucket_preview RPC.
 *
 * Why a cache, not React Query: this codebase already uses bare
 * supabase.rpc() inside useEffect for every other hook (useDashboardMetrics,
 * useProductionMetrics, etc.). Introducing React Query just for this one
 * popover would be a one-off dependency and a new pattern to maintain.
 * A ~30-line module-level Map matches the existing aesthetic, prevents
 * thundering-herd refetches when an owner hovers multiple tiles in
 * sequence, and times out fast enough that a status mutation never
 * looks stale by more than half a minute.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import type { BucketKey } from "@/lib/bucket-destination";

export type { BucketKey };

export type BucketPreviewRow = {
  id: string;
  policy_number: string | null;
  client_name: string;
  agent_name: string;
  carrier: string | null;
  product: string | null;
  status: string;
  annual_premium: number | null;
  commission_amount: number | null;
  application_date: string | null;
};

export type BucketPreviewPayload = {
  success: true;
  bucket: BucketKey;
  mode: "policy" | "commission";
  total_policies: number;
  total_premium: number | null;
  total_commission: number | null;
  preview_rows: BucketPreviewRow[];
};

type CacheEntry = { data: BucketPreviewPayload | null; error: string | null; expiresAt: number };

const TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

function cacheKey(args: {
  bucket: BucketKey;
  carrierId: string | null;
  startDate: string;
  endDate: string;
}) {
  return [args.bucket, args.carrierId ?? "", args.startDate, args.endDate].join("|");
}

/** Reset helper for tests. Not exported by default — exposed only for tests. */
export function _clearBucketPreviewCache() {
  cache.clear();
}

export function useBucketPreview(args: {
  bucket: BucketKey;
  carrierId: string | null;
  startDate: string;
  endDate: string;
  enabled: boolean;
}) {
  const { bucket, carrierId, startDate, endDate, enabled } = args;
  const [data, setData] = useState<BucketPreviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const key = cacheKey({ bucket, carrierId, startDate, endDate });
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) {
      setData(hit.data);
      setError(hit.error);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: result, error: err } = await supabase.rpc("dashboard_bucket_preview", {
        p_bucket:     bucket,
        p_carrier_id: carrierId,
        p_start_date: startDate,
        p_end_date:   endDate,
        p_limit:      5,
      });
      if (cancelled) return;
      setLoading(false);
      if (err) {
        setData(null);
        setError(err.message);
        cache.set(key, { data: null, error: err.message, expiresAt: Date.now() + TTL_MS });
        return;
      }
      const r = result as { success?: boolean; error_code?: string } & BucketPreviewPayload;
      if (!r?.success) {
        const code = r?.error_code ?? "unknown";
        setData(null);
        setError(code);
        cache.set(key, { data: null, error: code, expiresAt: Date.now() + TTL_MS });
        return;
      }
      setError(null);
      setData(r);
      cache.set(key, { data: r, error: null, expiresAt: Date.now() + TTL_MS });
    })();
    return () => { cancelled = true; };
  }, [enabled, bucket, carrierId, startDate, endDate]);

  return { data, loading, error };
}
