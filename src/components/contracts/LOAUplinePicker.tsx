/**
 * Phase 10E: LOA upline picker with transitive cycle guard.
 *
 * For an agent X selecting an LOA upline on carrier C, exclude:
 *   1. X themselves (self-reference; the server RPC also rejects this).
 *   2. Any agent Y whose LOA chain on carrier C reaches X.
 *
 * The chain is built once from existing agent_contracts on the same carrier.
 * Walk depth-limited (16 hops) as a paranoia safeguard against bad data.
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

type AgentOption = { id: string; first_name: string | null; last_name: string | null; email: string };

type Props = {
  /** The agent the contract belongs to (excluded as self). */
  agentId:   string | null;
  /** The carrier — LOA chain is per-carrier. */
  carrierId: string | null;
  value:     string | null;
  onChange:  (id: string | null) => void;
};

const MAX_CHAIN_DEPTH = 16;

function displayName(a: AgentOption): string {
  const n = [a.first_name, a.last_name].filter(Boolean).join(" ").trim();
  return n || a.email;
}

export function LOAUplinePicker({ agentId, carrierId, value, onChange }: Props) {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [chainMap, setChainMap] = useState<Map<string, string | null>>(new Map());
  const [loading, setLoading] = useState(false);

  // Load all agents in the tenant (RLS scopes them) + the existing LOA chain
  // on this carrier. The chain is per-carrier, so changing carrier reloads.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const [{ data: agentRows }, { data: chainRows }] = await Promise.all([
        supabase.from("agents").select("id, first_name, last_name, email").neq("status", "archived").order("email"),
        carrierId
          ? supabase.from("agent_contracts")
              .select("agent_id, loa_upline_agent_id")
              .eq("carrier_id", carrierId)
          : Promise.resolve({ data: [] as Array<{ agent_id: string; loa_upline_agent_id: string | null }> }),
      ]);
      if (cancelled) return;
      setAgents((agentRows ?? []) as AgentOption[]);
      const map = new Map<string, string | null>();
      for (const c of (chainRows ?? []) as Array<{ agent_id: string; loa_upline_agent_id: string | null }>) {
        map.set(c.agent_id, c.loa_upline_agent_id);
      }
      setChainMap(map);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [carrierId]);

  // For each candidate agent Y, walk Y's LOA chain (Y → Y.upline → …) until
  // we hit NULL, the editing agent (= cycle, exclude), or MAX_CHAIN_DEPTH.
  const eligibleAgents = useMemo(() => {
    if (!agentId) return agents.filter((a) => a.id !== "");
    return agents.filter((candidate) => {
      if (candidate.id === agentId) return false;     // self-reference
      let cursor: string | null = candidate.id;
      const visited = new Set<string>();
      for (let i = 0; i < MAX_CHAIN_DEPTH; i++) {
        if (cursor === null) return true;             // chain reaches direct-pay; safe
        if (cursor === agentId) return false;         // chain reaches editing agent; cycle
        if (visited.has(cursor)) return false;        // pre-existing cycle in data; bail
        visited.add(cursor);
        cursor = chainMap.get(cursor) ?? null;
      }
      return false;                                   // depth exceeded; exclude defensively
    });
  }, [agents, agentId, chainMap]);

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={!carrierId || loading}
      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
    >
      <option value="">None — direct pay</option>
      {eligibleAgents.map((a) => (
        <option key={a.id} value={a.id}>{displayName(a)}</option>
      ))}
    </select>
  );
}
