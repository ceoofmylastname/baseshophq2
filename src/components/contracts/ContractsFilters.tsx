/**
 * Phase 10E: filter row for /contracts.
 * Carrier · Agent · Status · LOA-only · search-by-writing-number.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useTenant } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import type { ContractFilters, ContractStatus } from "@/hooks/useContracts";

type Carrier = { id: string; carrier_name: string };
type Agent = { id: string; first_name: string | null; last_name: string | null; email: string };

const STATUSES: ContractStatus[] = ["Active", "Pending", "Terminated"];

function nameOf(a: Agent): string {
  const n = [a.first_name, a.last_name].filter(Boolean).join(" ").trim();
  return n || a.email;
}

type Props = { value: ContractFilters; onChange: (next: ContractFilters) => void };

export function ContractsFilters({ value, onChange }: Props) {
  const tenant = useTenant();
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [agents,   setAgents]   = useState<Agent[]>([]);

  useEffect(() => {
    if (!tenant?.id) return;
    let cancelled = false;
    void (async () => {
      const [{ data: cs }, { data: as }] = await Promise.all([
        supabase.from("comp_grid_carriers").select("id, carrier_name").eq("is_active", true).order("carrier_name"),
        supabase.from("agents").select("id, first_name, last_name, email").neq("status", "archived").order("email"),
      ]);
      if (cancelled) return;
      setCarriers((cs ?? []) as Carrier[]);
      setAgents((as ?? []) as Agent[]);
    })();
    return () => { cancelled = true; };
  }, [tenant?.id]);

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border bg-card p-3 text-sm">
      <Field label="Carrier">
        <select
          value={value.carrierId ?? ""}
          onChange={(e) => onChange({ ...value, carrierId: e.target.value || null })}
          className="h-9 rounded-md border border-input bg-background px-2"
        >
          <option value="">All carriers</option>
          {carriers.map((c) => <option key={c.id} value={c.id}>{c.carrier_name}</option>)}
        </select>
      </Field>

      <Field label="Agent">
        <select
          value={value.agentId ?? ""}
          onChange={(e) => onChange({ ...value, agentId: e.target.value || null })}
          className="h-9 rounded-md border border-input bg-background px-2"
        >
          <option value="">All agents</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{nameOf(a)}</option>)}
        </select>
      </Field>

      <Field label="Status">
        <select
          value={value.status ?? ""}
          onChange={(e) => onChange({ ...value, status: (e.target.value || null) as ContractStatus | null })}
          className="h-9 rounded-md border border-input bg-background px-2"
        >
          <option value="">Any</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>

      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={value.loaOnly} onChange={(e) => onChange({ ...value, loaOnly: e.target.checked })} />
        LOA only
      </label>

      <div className="flex-1 min-w-[200px]">
        <Input
          placeholder="Search by writing number…"
          value={value.search}
          onChange={(e) => onChange({ ...value, search: e.target.value })}
          className="h-9"
        />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
