import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useAgent } from "@/hooks/useAgent";
import { useAgentRates } from "@/hooks/useAgentRates";
import type { GridPosition } from "@/hooks/useCompGridPositions";
import { AgentProfileHeader } from "@/components/agents/AgentProfileHeader";
import { PositionDropdown } from "@/components/agents/PositionDropdown";
import { AssignPositionModal } from "@/components/agents/AssignPositionModal";
import { OverridesPanel } from "@/components/agents/OverridesPanel";

export function AgentProfilePage() {
  const { agentId } = useParams<{ agentId: string }>();
  const { isOwner } = useAuth();
  const { agent, loading: agentLoading, error: agentError, refresh: refreshAgent } = useAgent(agentId);
  const {
    rows,
    loading: ratesLoading,
    error: ratesError,
    refresh: refreshRates,
  } = useAgentRates(agentId);

  const [pendingPosition, setPendingPosition] = useState<GridPosition | null>(null);

  if (agentLoading) {
    return <p className="text-sm text-muted-foreground">Loading agent…</p>;
  }
  if (agentError) {
    return <p className="text-sm text-destructive">{agentError}</p>;
  }
  if (!agent) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">Agent not found.</p>
        <Link to="/agents" className="text-sm text-primary underline">
          Back to agents
        </Link>
      </div>
    );
  }

  const fullName =
    [agent.first_name, agent.last_name].filter(Boolean).join(" ") || agent.email;

  return (
    <div className="space-y-4">
      <Link to="/agents" className="text-sm text-muted-foreground hover:underline">
        ← Back to agents
      </Link>

      <AgentProfileHeader
        agent={agent}
        rightSlot={
          isOwner ? (
            <PositionDropdown
              currentPositionId={agent.current_position_id}
              onSelect={(p) => setPendingPosition(p)}
            />
          ) : null
        }
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Carrier rates</h2>
          <p className="text-xs text-muted-foreground">
            {isOwner ? "Click Edit on any row to override." : "Read-only view."}
          </p>
        </div>
        <OverridesPanel
          rows={rows}
          loading={ratesLoading}
          error={ratesError}
          canEdit={isOwner}
          onChanged={refreshRates}
        />
      </div>

      <AssignPositionModal
        agentId={agent.id}
        agentName={fullName}
        position={pendingPosition}
        onClose={() => setPendingPosition(null)}
        onApplied={() => {
          void refreshAgent();
          void refreshRates();
        }}
      />
    </div>
  );
}
