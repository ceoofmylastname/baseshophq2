/**
 * Active Agents = agents who wrote >= 1 policy in [now() - days, now()].
 * View-down enforced via RLS on the underlying policies query.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";

export type ActiveAgentRow = {
  agent_id: string;
  agent_name: string;
  email: string;
  status: string;
  position_code: string | null;
  position_name: string | null;
  last_policy_date: string;
  policies_count: number;
  premium_total: number;
};

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function useActiveAgents(args: { days: number }) {
  const tenant = useTenant();
  const [rows, setRows] = useState<ActiveAgentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const today = new Date();
    const start = new Date();
    start.setDate(today.getDate() - args.days);

    // Step 1: pull policies in window grouped by agent (RLS-scoped)
    const { data: policiesData } = await supabase
      .from("policies")
      .select("agent_id, application_date, annual_premium")
      .gte("application_date", isoDate(start))
      .lte("application_date", isoDate(today))
      .not("agent_id", "is", null);

    setLoading(false);
    if (!policiesData || policiesData.length === 0) { setRows([]); return; }

    const byAgent = new Map<string, { last: string; count: number; premium: number }>();
    for (const p of policiesData as Array<{ agent_id: string; application_date: string; annual_premium: number | null }>) {
      const existing = byAgent.get(p.agent_id) ?? { last: "", count: 0, premium: 0 };
      existing.count++;
      existing.premium += Number(p.annual_premium ?? 0);
      if (p.application_date > existing.last) existing.last = p.application_date;
      byAgent.set(p.agent_id, existing);
    }

    // Step 2: enrich with agent + position metadata
    const ids = Array.from(byAgent.keys());
    const { data: agentsData } = await supabase
      .from("agents_with_current_position")
      .select("id, first_name, last_name, email, status, current_position_code, current_position_name")
      .in("id", ids);

    const enriched: ActiveAgentRow[] = (agentsData ?? []).map((a) => {
      const stats = byAgent.get(a.id as string)!;
      const name = [a.first_name, a.last_name].filter(Boolean).join(" ") || (a.email as string);
      return {
        agent_id: a.id as string,
        agent_name: name,
        email: a.email as string,
        status: a.status as string,
        position_code: (a.current_position_code as string | null) ?? null,
        position_name: (a.current_position_name as string | null) ?? null,
        last_policy_date: stats.last,
        policies_count: stats.count,
        premium_total: stats.premium,
      };
    }).filter((r) => r.status !== "archived")
      .sort((a, b) => b.last_policy_date.localeCompare(a.last_policy_date));

    setRows(enriched);
  }, [args.days]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`active-agents-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policies", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "agents", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  return { rows, loading, refresh };
}
