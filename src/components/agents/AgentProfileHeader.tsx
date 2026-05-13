import type { AgentProfile } from "@/hooks/useAgent";
import { Badge } from "@/components/ui/badge";
import { AgentAvatar } from "@/components/agents/AgentAvatar";
import { Mail, Phone } from "lucide-react";

type Props = {
  agent: AgentProfile;
  rightSlot?: React.ReactNode;
};

/**
 * Phase 13.3: Profile-photo aware header.
 *
 * Photo on the left, name + status + position + upline + contact details
 * on the right. Falls back to colored initials when no photo is set. Title
 * (designation/badge) shows under the name; bio shows underneath the chip
 * row if present.
 */
export function AgentProfileHeader({ agent, rightSlot }: Props) {
  const fullName =
    [agent.first_name, agent.last_name].filter(Boolean).join(" ") || agent.email;
  const positionLabel = agent.current_position_code
    ? `${agent.current_position_code} ${agent.current_position_name ?? ""}`.trim()
    : "No position assigned";

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-1 items-start gap-4">
          <AgentAvatar
            avatarUrl={agent.avatar_url}
            firstName={agent.first_name}
            lastName={agent.last_name}
            email={agent.email}
            size="xl"
            fallbackBg="bg-primary/15 border-primary/40"
            fallbackText="text-primary"
            className="shadow-lg"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-shadow-soft">{fullName}</h1>
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
            {agent.title && (
              <p className="text-xs font-medium text-primary">{agent.title}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Mail className="h-3 w-3" />
                {agent.email}
              </span>
              {agent.phone && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {agent.phone}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">Position:</span> {positionLabel}
              </span>
              <span>
                <span className="font-medium text-foreground">Upline:</span>{" "}
                {agent.is_owner ? "—" : (agent.upline_email ?? "—")}
              </span>
            </div>
          </div>
        </div>
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>

      {agent.bio && (
        <p className="mt-4 max-w-2xl border-t border-white/[0.04] pt-3 text-sm leading-relaxed text-muted-foreground">
          {agent.bio}
        </p>
      )}
    </div>
  );
}
