/**
 * Realtime cascade dependencies (Phase 10A.1 build rule):
 *   policies              - row inserts/updates/deletes
 *   policy_deletions_audit - row gone after delete; we already see deletion
 *                            via the policies channel, but subscribing to
 *                            audit gives us a future hook for restore UX
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";
import { statusesInBucket, type PolicyBucket, type PolicyStatus } from "@/lib/policy-bucket";

export type PolicyRow = {
  id: string;
  tenant_id: string;
  policy_number: string;
  agent_id: string | null;
  agent_first_name: string | null;
  agent_last_name: string | null;
  agent_email: string | null;
  carrier: string | null;
  product: string | null;
  product_id: string | null;
  client_first_name: string | null;
  client_last_name: string | null;
  application_date: string | null;
  effective_date: string | null;
  annual_premium: number | null;
  status: PolicyStatus;
  created_at: string;
  updated_at: string;
};

export type SortKey =
  | "client_name" | "carrier" | "product" | "policy_number" | "status"
  | "annual_premium" | "agent_name" | "application_date" | "effective_date";

export type Filters = {
  search: string;
  status: PolicyStatus | null;
  bucket: PolicyBucket | null;
  carrierId: string | null;
  unassignedOnly: boolean;
  hasRisk: boolean;
  needsReview: boolean;
  missingProduct: boolean;
};

const PAGE_SIZE = 50;

const SORT_COLUMN_MAP: Record<SortKey, string> = {
  client_name: "client_last_name",
  carrier: "carrier",
  product: "product",
  policy_number: "policy_number",
  status: "status",
  annual_premium: "annual_premium",
  agent_name: "agent_id",
  application_date: "application_date",
  effective_date: "effective_date",
};

export function useBookOfBusiness(args: {
  filters: Filters;
  sortKey: SortKey;
  sortAsc: boolean;
}) {
  const tenant = useTenant();
  const [rows, setRows] = useState<PolicyRow[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildQuery = useCallback((from: number, to: number) => {
    const sortCol = SORT_COLUMN_MAP[args.sortKey];
    let q = supabase
      .from("policies")
      .select(`
        id, tenant_id, policy_number, agent_id, carrier, product, product_id,
        client_first_name, client_last_name, application_date, effective_date,
        annual_premium, status, created_at, updated_at,
        agents!policies_agent_id_fkey ( first_name, last_name, email )
      `)
      .order(sortCol, { ascending: args.sortAsc, nullsFirst: false })
      .range(from, to);

    const f = args.filters;
    if (f.unassignedOnly) {
      q = q.is("agent_id", null);
    } else {
      if (f.search) {
        const s = f.search.replace(/[%_]/g, "");
        q = q.or(`client_first_name.ilike.%${s}%,client_last_name.ilike.%${s}%,policy_number.ilike.%${s}%`);
      }
      if (f.status) q = q.eq("status", f.status);
      if (f.bucket) q = q.in("status", statusesInBucket(f.bucket));
      if (f.carrierId) q = q.eq("product_id", f.carrierId); // owner picks carrier; we filter on the join below
      if (f.hasRisk) q = q.eq("status", "Potential Lapse");
      if (f.needsReview) q = q.or("agent_id.is.null,product_id.is.null");
    }
    if (f.missingProduct) q = q.is("product_id", null);
    return q;
  }, [args.filters, args.sortKey, args.sortAsc]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setPage(0);
    const { data, error: err } = await buildQuery(0, PAGE_SIZE - 1);
    setLoading(false);
    if (err) { setError(err.message); return; }
    setError(null);
    setRows(mapRows(data ?? []));
    setHasMore((data?.length ?? 0) === PAGE_SIZE);
  }, [buildQuery]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const next = page + 1;
    const from = next * PAGE_SIZE;
    const { data, error: err } = await buildQuery(from, from + PAGE_SIZE - 1);
    setLoadingMore(false);
    if (err) { setError(err.message); return; }
    const fresh = mapRows(data ?? []);
    setRows((prev) => [...prev, ...fresh]);
    setPage(next);
    setHasMore(fresh.length === PAGE_SIZE);
  }

  // Realtime: any policies change in this tenant triggers a refresh
  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`book-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policies", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { rows, loading, loadingMore, hasMore, loadMore, error, refresh };
}

function mapRows(data: unknown[]): PolicyRow[] {
  return (data as Array<Record<string, unknown> & {
    agents?: { first_name: string | null; last_name: string | null; email: string | null } | null;
  }>).map((d) => ({
    id: d.id as string,
    tenant_id: d.tenant_id as string,
    policy_number: d.policy_number as string,
    agent_id: (d.agent_id as string | null) ?? null,
    agent_first_name: d.agents?.first_name ?? null,
    agent_last_name: d.agents?.last_name ?? null,
    agent_email: d.agents?.email ?? null,
    carrier: (d.carrier as string | null) ?? null,
    product: (d.product as string | null) ?? null,
    product_id: (d.product_id as string | null) ?? null,
    client_first_name: (d.client_first_name as string | null) ?? null,
    client_last_name: (d.client_last_name as string | null) ?? null,
    application_date: (d.application_date as string | null) ?? null,
    effective_date: (d.effective_date as string | null) ?? null,
    annual_premium: d.annual_premium === null ? null : Number(d.annual_premium),
    status: d.status as PolicyStatus,
    created_at: d.created_at as string,
    updated_at: d.updated_at as string,
  }));
}
