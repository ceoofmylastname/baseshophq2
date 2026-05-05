/**
 * Phase 10E: Contracts page at /contracts.
 *
 * Per wiki/contracts-page.md. The dedicated CRUD surface for agent_contracts.
 * Carrier writing numbers entered here unblock the carrier ingest pipeline:
 * the orphan auto-link trigger from Phase 4b1 retroactively claims existing
 * orphan policies for any new contract whose writing number matches.
 *
 * Realtime cascade dependencies (Build Rule):
 *   agent_contracts → table refresh on insert/update/delete
 */

import { useState } from "react";
import { Plus } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useContracts, DEFAULT_CONTRACT_FILTERS, type ContractRow } from "@/hooks/useContracts";
import { ContractsFilters } from "@/components/contracts/ContractsFilters";
import { ContractsTable } from "@/components/contracts/ContractsTable";
import { ContractEditModal } from "@/components/contracts/ContractEditModal";

export function ContractsPage() {
  const { isOwner, currentAgent } = useAuth();
  const [filters, setFilters] = useState(DEFAULT_CONTRACT_FILTERS);
  const [editing, setEditing] = useState<ContractRow | null>(null);
  const [adding,  setAdding]  = useState(false);

  const { rows, loading, refresh } = useContracts(filters);

  async function handleDelete(id: string) {
    const { data, error } = await supabase.rpc("delete_agent_contract", { p_id: id });
    if (error) throw new Error(error.message);
    const r = data as { success?: boolean; error_code?: string };
    if (!r?.success) throw new Error(r?.error_code ?? "delete_failed");
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Contracts</h1>
          <p className="text-sm text-muted-foreground">
            Carrier writing numbers per agent. Required for carrier-statement ingest matching.
          </p>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setAdding(true); }}>
          <Plus className="mr-1 h-4 w-4" /> Add contract
        </Button>
      </header>

      <ContractsFilters value={filters} onChange={setFilters} />

      <ContractsTable rows={rows} loading={loading} onRowClick={setEditing} />

      <p className="text-xs text-muted-foreground">
        {rows.length} contract{rows.length === 1 ? "" : "s"} loaded.
      </p>

      <ContractEditModal
        open={adding || editing !== null}
        onClose={() => { setAdding(false); setEditing(null); }}
        contract={editing}
        defaultAgentId={!isOwner ? (currentAgent?.id ?? null) : null}
        onSaved={refresh}
        onDelete={isOwner ? handleDelete : undefined}
      />
    </div>
  );
}
