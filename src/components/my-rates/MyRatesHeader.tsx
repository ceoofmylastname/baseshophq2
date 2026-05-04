import type { AgentProfile } from "@/hooks/useAgent";
import { Badge } from "@/components/ui/badge";

type Props = { agent: AgentProfile };

export function MyRatesHeader({ agent }: Props) {
  const fullName = [agent.first_name, agent.last_name].filter(Boolean).join(" ") || agent.email;
  const positionLabel = agent.current_position_code
    ? `${agent.current_position_code} ${agent.current_position_name ?? ""}`.trim()
    : "—";

  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">{fullName}'s rates</h1>
          <div className="flex flex-wrap gap-x-4 text-sm">
            <span>
              <span className="text-xs uppercase text-muted-foreground">Position </span>
              <span className="font-medium">{positionLabel}</span>
            </span>
            {agent.current_position_start_date && (
              <span>
                <span className="text-xs uppercase text-muted-foreground">Effective </span>
                <span className="font-medium">{agent.current_position_start_date}</span>
              </span>
            )}
          </div>
        </div>
        {agent.current_position_is_commissioned !== null && (
          agent.current_position_is_commissioned
            ? <Badge variant="success">Commissioned</Badge>
            : <Badge variant="muted">Non-commissioned</Badge>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Contact your owner to change a rate. Updates appear here automatically.
      </p>
    </div>
  );
}
