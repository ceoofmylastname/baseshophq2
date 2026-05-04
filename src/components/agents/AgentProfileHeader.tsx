import type { AgentProfile } from "@/hooks/useAgent";
import { Badge } from "@/components/ui/badge";

type Props = {
  agent: AgentProfile;
  rightSlot?: React.ReactNode;
};

export function AgentProfileHeader({ agent, rightSlot }: Props) {
  const fullName =
    [agent.first_name, agent.last_name].filter(Boolean).join(" ") || agent.email;
  const positionLabel = agent.current_position_code
    ? `${agent.current_position_code} ${agent.current_position_name ?? ""}`.trim()
    : "No position assigned";

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{fullName}</h1>
          {agent.is_owner ? (
            <Badge variant="default">Owner</Badge>
          ) : agent.status === "active" ? (
            <Badge variant="success">Active</Badge>
          ) : agent.status === "inactive" ? (
            <Badge variant="warning">Inactive</Badge>
          ) : (
            <Badge variant="muted">Archived</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{agent.email}</p>
        <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">Position:</span> {positionLabel}
          </span>
          <span>
            <span className="font-medium text-foreground">Upline:</span>{" "}
            {agent.is_owner ? "—" : (agent.upline_email ?? "—")}
          </span>
        </div>
      </div>
      {rightSlot}
    </div>
  );
}
