/**
 * Realtime cascade dependencies (Phase 10A.1 build rule):
 *   policies              - status, premium, client edits
 *   policy_status_history - new audit rows on status change
 *   policy_commissions    - engine recalc results
 *   activity_events       - audit log filtered by metadata.policy_id
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";
import type { PolicyStatus } from "@/lib/policy-bucket";

export type PolicyDetail = {
  id: string;
  tenant_id: string;
  policy_number: string;
  agent_id: string | null;
  agent_number: string | null;
  carrier: string | null;
  product: string | null;
  product_id: string | null;
  client_first_name: string | null;
  client_last_name: string | null;
  client_dob: string | null;
  application_date: string | null;
  effective_date: string | null;
  annual_premium: number | null;
  status: PolicyStatus;
  commission_paid_amount: number | null;
  commission_owed_amount: number | null;
  notes: string | null;
};

export type CommissionSplitRow = {
  id: string;
  agent_id: string;
  agent_name: string;
  position_code: string | null;
  position_name: string | null;
  rate: number;
  schedule_code: string | null;
  amount: number;
  is_override: boolean;
};

export type StatusHistoryRow = {
  id: string;
  status: PolicyStatus;            // the status the policy was set TO
  prev_status: PolicyStatus | null; // computed client-side from neighboring row
  source: string | null;
  changed_by: string | null;
  changed_by_name: string | null;
  notes: string | null;
  created_at: string;
};

export type ActivityEventRow = {
  id: string;
  event_type: string;
  event_at: string;
  actor_user_id: string | null;
  summary: string;
};

export function usePolicyDetail(policyId: string | undefined) {
  const tenant = useTenant();
  const [policy, setPolicy] = useState<PolicyDetail | null>(null);
  const [commissions, setCommissions] = useState<CommissionSplitRow[]>([]);
  const [history, setHistory] = useState<StatusHistoryRow[]>([]);
  const [activity, setActivity] = useState<ActivityEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!policyId) return;
    setLoading(true);
    const [polRes, comRes, histRes, evtRes] = await Promise.all([
      supabase.from("policies").select("*").eq("id", policyId).maybeSingle(),
      supabase
        .from("policy_commissions")
        .select(`
          id, agent_id, rate, schedule_code, amount, is_override,
          agents!policy_commissions_agent_id_fkey ( first_name, last_name, email ),
          comp_grid_positions!policy_commissions_position_id_fkey ( position_code, position_name )
        `)
        .eq("policy_id", policyId)
        .order("rate", { ascending: false }),
      supabase
        .from("policy_status_history")
        .select(`
          id, status, source, changed_by, notes, created_at,
          agents!policy_status_history_changed_by_fkey ( first_name, last_name, email )
        `)
        .eq("policy_id", policyId)
        .order("created_at", { ascending: true }),
      supabase
        .from("activity_events")
        .select("id, event_type, event_at, actor_user_id, summary, metadata")
        .filter("metadata->>policy_id", "eq", policyId)
        .order("event_at", { ascending: false })
        .limit(50),
    ]);
    setLoading(false);
    if (polRes.error) { setError(polRes.error.message); return; }
    setError(null);
    setPolicy(polRes.data ? mapPolicy(polRes.data) : null);
    setCommissions(mapCommissions(comRes.data ?? []));
    setHistory(mapHistory(histRes.data ?? []));
    setActivity((evtRes.data ?? []).map((e) => ({
      id: e.id as string, event_type: e.event_type as string,
      event_at: e.event_at as string, actor_user_id: e.actor_user_id as string | null,
      summary: e.summary as string,
    })));
  }, [policyId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Realtime: any of the 4 tables update for this policy_id triggers refresh
  useEffect(() => {
    if (!tenant?.id || !policyId) return;
    const channel = supabase
      .channel(realtimeTopic(`policy-detail-${policyId}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policies", filter: `id=eq.${policyId}` },
        () => { void refresh(); })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policy_commissions", filter: `policy_id=eq.${policyId}` },
        () => { void refresh(); })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policy_status_history", filter: `policy_id=eq.${policyId}` },
        () => { void refresh(); })
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_events", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, policyId, refresh]);

  return { policy, commissions, history, activity, loading, error, refresh };
}

function mapPolicy(d: Record<string, unknown>): PolicyDetail {
  return {
    id: d.id as string, tenant_id: d.tenant_id as string,
    policy_number: d.policy_number as string,
    agent_id: (d.agent_id as string | null) ?? null,
    agent_number: (d.agent_number as string | null) ?? null,
    carrier: (d.carrier as string | null) ?? null,
    product: (d.product as string | null) ?? null,
    product_id: (d.product_id as string | null) ?? null,
    client_first_name: (d.client_first_name as string | null) ?? null,
    client_last_name: (d.client_last_name as string | null) ?? null,
    client_dob: (d.client_dob as string | null) ?? null,
    application_date: (d.application_date as string | null) ?? null,
    effective_date: (d.effective_date as string | null) ?? null,
    annual_premium: d.annual_premium === null || d.annual_premium === undefined ? null : Number(d.annual_premium),
    status: d.status as PolicyStatus,
    commission_paid_amount: d.commission_paid_amount === null || d.commission_paid_amount === undefined ? null : Number(d.commission_paid_amount),
    commission_owed_amount: d.commission_owed_amount === null || d.commission_owed_amount === undefined ? null : Number(d.commission_owed_amount),
    notes: (d.notes as string | null) ?? null,
  };
}

function mapCommissions(data: unknown[]): CommissionSplitRow[] {
  return (data as Array<Record<string, unknown> & {
    agents?: { first_name: string | null; last_name: string | null; email: string | null } | null;
    comp_grid_positions?: { position_code: string; position_name: string } | null;
  }>).map((d) => ({
    id: d.id as string,
    agent_id: d.agent_id as string,
    agent_name: agentDisplay(d.agents),
    position_code: d.comp_grid_positions?.position_code ?? null,
    position_name: d.comp_grid_positions?.position_name ?? null,
    rate: Number(d.rate),
    schedule_code: (d.schedule_code as string | null) ?? null,
    amount: Number(d.amount),
    is_override: !!d.is_override,
  }));
}

function mapHistory(data: unknown[]): StatusHistoryRow[] {
  // Rows arrive ordered by created_at ascending; compute prev_status from the
  // previous row, then reverse so the timeline renders newest-first.
  const ordered = (data as Array<Record<string, unknown> & {
    agents?: { first_name: string | null; last_name: string | null; email: string | null } | null;
  }>).map((d, idx, arr) => ({
    id: d.id as string,
    status: d.status as PolicyStatus,
    prev_status: (idx === 0 ? null : (arr[idx - 1].status as PolicyStatus)) as PolicyStatus | null,
    source: (d.source as string | null) ?? null,
    changed_by: (d.changed_by as string | null) ?? null,
    changed_by_name: agentDisplay(d.agents),
    notes: (d.notes as string | null) ?? null,
    created_at: d.created_at as string,
  }));
  return ordered.reverse();
}

function agentDisplay(a: { first_name: string | null; last_name: string | null; email: string | null } | null | undefined): string {
  if (!a) return "—";
  const name = [a.first_name, a.last_name].filter(Boolean).join(" ");
  return name || a.email || "—";
}
