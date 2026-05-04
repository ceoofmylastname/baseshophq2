import { useAuth } from "@/contexts/AuthContext";
import { useAgentsDirectory } from "@/hooks/useAgentsDirectory";
import { AgentsDirectoryTable } from "@/components/agents/AgentsDirectoryTable";
import { AddAgentDialog } from "@/components/agents/AddAgentDialog";

export function AgentsPage() {
  const { isOwner } = useAuth();
  const { rows, loading, error, refresh } = useAgentsDirectory();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Agents</h1>
          <p className="text-sm text-muted-foreground">
            Your team. {rows.length} {rows.length === 1 ? "agent" : "agents"} visible.
          </p>
        </div>
        {isOwner && <AddAgentDialog existingAgents={rows} onAdded={refresh} />}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && !error && <AgentsDirectoryTable rows={rows} />}
    </div>
  );
}
