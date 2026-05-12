/**
 * Phase 10E: agent_contracts list with filters + realtime.
 *
 * RLS scopes the rows: owners see all in tenant; non-owners see their own
 * + downline (per can_view_agent). Filters are applied server-side via the
 * supabase query builder.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";

export type ContractStatus = "Active" | "Pending" | "Terminated";

export type ContractRow = {
  id:                   string;
  tenant_id:            string;
  agent_id:             string;
  agent_name:           string;
  agent_email:          string;
  carrier_id:           string;
  carrier_name:         string;
  writing_number:       string;
  status:               ContractStatus;
  effective_date:       string | null;
  end_date:             string | null;
  loa_upline_agent_id:  string | null;
  loa_upline_name:      string | null;
  loa_upline_writing:   string | null;   // upline's writing number on the SAME carrier
  referral_code:        string | null;
  notes:                string | null;
  created_at:           string;
  updated_at:           string;
};

export type ContractFilters = {
  carrierId:    string | null;
  agentId:      string | null;
  status:       ContractStatus | null;
  loaOnly:      boolean;
  search:       string;             // matches writing_number ILIKE
};

export const DEFAULT_CONTRACT_FILTERS: ContractFilters = {
  carrierId: null, agentId: null, status: null, loaOnly: false, search: "",
};

type RawRow = {
  id: string;
  tenant_id: string;
  agent_id: string;
  carrier_id: string;
  writing_number: string;
  status: ContractStatus;
  effective_date: string | null;
  end_date: string | null;
  loa_upline_agent_id: string | null;
  referral_code: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  agent:   { first_name: string | null; last_name: string | null; email: string } | null;
  carrier: { carrier_name: string } | null;
  loa_upline_agent: { first_name: string | null; last_name: string | null; email: string } | null;
};

function nameOf(a: { first_name: string | null; last_name: string | null; email: string } | null): string {
  if (!a) return "—";
  const n = [a.first_name, a.last_name].filter(Boolean).join(" ").trim();
  return n || a.email;
}

export function useContracts(filters: ContractFilters) {
  const tenant = useTenant();
  const [rows,    setRows]    = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("agent_contracts")
      .select(`
        id, tenant_id, agent_id, carrier_id, writing_number, status,
        effective_date, end_date, loa_upline_agent_id, referral_code, notes,
        created_at, updated_at,
        agent:agents!agent_contracts_agent_id_fkey ( first_name, last_name, email ),
        carrier:comp_grid_carriers!agent_contracts_carrier_id_fkey ( carrier_name ),
        loa_upline_agent:agents!agent_contracts_loa_upline_agent_id_fkey ( first_name, last_name, email )
      `)
      .order("updated_at", { ascending: false });

    if (filters.carrierId) q = q.eq("carrier_id", filters.carrierId);
    if (filters.agentId)   q = q.eq("agent_id",   filters.agentId);
    if (filters.status)    q = q.eq("status",     filters.status);
    if (filters.loaOnly)   q = q.not("loa_upline_agent_id", "is", null);
    if (filters.search.trim()) q = q.ilike("writing_number", `%${filters.search.trim()}%`);

    const { data, error: err } = await q;
    setLoading(false);
    if (err) { setError(err.message); return; }
    setError(null);

    const raw = (data ?? []) as unknown as RawRow[];

    // Resolve LOA upline writing number on the SAME carrier in a separate
    // query — we display "Stapleton, Marie: GNW6138365" per wiki.
    const uplineKeys = raw
      .filter((r) => r.loa_upline_agent_id)
      .map((r) => `${r.loa_upline_agent_id}|${r.carrier_id}`);

    const uplineWritingMap = new Map<string, string>();
    if (uplineKeys.length > 0) {
      const uniqueAgentIds = Array.from(new Set(raw.map((r) => r.loa_upline_agent_id).filter(Boolean) as string[]));
      const uniqueCarrierIds = Array.from(new Set(raw.map((r) => r.carrier_id)));
      const { data: ups } = await supabase
        .from("agent_contracts")
        .select("agent_id, carrier_id, writing_number")
        .in("agent_id",   uniqueAgentIds)
        .in("carrier_id", uniqueCarrierIds);
      for (const u of (ups ?? []) as Array<{ agent_id: string; carrier_id: string; writing_number: string }>) {
        uplineWritingMap.set(`${u.agent_id}|${u.carrier_id}`, u.writing_number);
      }
    }

    setRows(raw.map((r) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      agent_id: r.agent_id,
      agent_name: nameOf(r.agent),
      agent_email: r.agent?.email ?? "",
      carrier_id: r.carrier_id,
      carrier_name: r.carrier?.carrier_name ?? "—",
      writing_number: r.writing_number,
      status: r.status,
      effective_date: r.effective_date,
      end_date: r.end_date,
      loa_upline_agent_id: r.loa_upline_agent_id,
      loa_upline_name: r.loa_upline_agent ? nameOf(r.loa_upline_agent) : null,
      loa_upline_writing: r.loa_upline_agent_id
        ? (uplineWritingMap.get(`${r.loa_upline_agent_id}|${r.carrier_id}`) ?? null)
        : null,
      referral_code: r.referral_code,
      notes: r.notes,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })));
  }, [filters.carrierId, filters.agentId, filters.status, filters.loaOnly, filters.search]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`contracts-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "agent_contracts", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { rows, loading, error, refresh };
}
