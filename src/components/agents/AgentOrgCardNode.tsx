import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Users, AlertTriangle, Sparkles, Zap, Moon, Snowflake } from "lucide-react";
import {
  type OrgChartNode, activityTier, type ActivityTier,
} from "@/hooks/useAgentsOrgChart";
import { cn } from "@/lib/utils";

/**
 * Tier → visual treatment. Color rationale:
 *   issue_paid   emerald  — strongest signal: realized money this window
 *   active       gold     — warm, brand primary; "writing right now"
 *   inactive_with_history zinc — neutral; "knows the work, just dormant"
 *   never_written         muted; "fresh recruit, hasn't shipped yet"
 *
 * The at-risk overlay (orange ring) is independent — it stacks on top of
 * whatever base tier the agent has, signaling "this person or their team
 * has policies in Potential Lapse status." Orange ring + emerald card means
 * "they're producing but they also have chargeback exposure to address."
 */
const TIER_VISUAL: Record<ActivityTier, {
  ring: string;
  dot: string;
  label: string;
  Icon: typeof Sparkles;
  iconClass: string;
}> = {
  issue_paid: {
    ring:      "ring-emerald-400/40",
    dot:       "bg-emerald-400 shadow-[0_0_10px_hsl(150_70%_55%/0.7)]",
    label:     "Issue Paid",
    Icon:      Sparkles,
    iconClass: "text-emerald-300",
  },
  active: {
    ring:      "ring-primary/40",
    dot:       "bg-primary shadow-[0_0_10px_hsl(38_92%_60%/0.7)]",
    label:     "Active writer",
    Icon:      Zap,
    iconClass: "text-primary",
  },
  inactive_with_history: {
    ring:      "ring-zinc-500/20",
    dot:       "bg-zinc-400 shadow-[0_0_6px_hsl(0_0%_70%/0.4)]",
    label:     "Dormant",
    Icon:      Moon,
    iconClass: "text-zinc-300",
  },
  never_written: {
    ring:      "ring-white/[0.06]",
    dot:       "bg-white/30",
    label:     "Never written",
    Icon:      Snowflake,
    iconClass: "text-muted-foreground",
  },
};

type Props = { node: OrgChartNode };

export function AgentOrgCardNode({ node }: Props) {
  // Root and first level start expanded; deeper levels start collapsed so
  // a 12-agent agency doesn't visually explode on first render.
  const [expanded, setExpanded] = useState(node.depth <= 1);

  const tier = activityTier(node);
  const v = TIER_VISUAL[tier];
  const hasChildren = node.children.length > 0;
  const displayName =
    [node.first_name, node.last_name].filter(Boolean).join(" ").trim() || node.email;
  const position = node.position_name
    ? `${node.position_name}${node.position_code ? ` (${node.position_code})` : ""}`
    : node.is_owner ? "Owner" : "—";

  return (
    <div className="relative">
      {/* Card */}
      <div
        className={cn(
          "group relative flex items-center gap-3 rounded-xl glass p-3 ring-1 transition-all duration-200",
          v.ring,
          node.subtreeHasRisk && "ring-2 ring-orange-400/40",
        )}
      >
        {/* Expand / collapse */}
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <ChevronRight
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                expanded && "rotate-90",
              )}
            />
          </button>
        ) : (
          <span className="h-7 w-7 shrink-0" aria-hidden />
        )}

        {/* Tier glow dot */}
        <span
          aria-hidden
          className={cn("h-2 w-2 shrink-0 rounded-full", v.dot)}
        />

        {/* Identity */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              to={`/agents/${node.id}`}
              className="truncate text-sm font-semibold tracking-tight hover:underline"
            >
              {displayName}
            </Link>
            {node.is_owner && (
              <span className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
                Owner
              </span>
            )}
            {node.subtreeHasRisk && (
              <span
                className="inline-flex items-center gap-0.5 rounded-md border border-orange-400/30 bg-orange-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-orange-300"
                title="Self or a downline has policies in Potential Lapse"
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                Risk
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {position}
            {hasChildren && (
              <>
                {" · "}
                <span className="inline-flex items-center gap-0.5">
                  <Users className="h-3 w-3" />
                  {node.children.length} direct
                </span>
              </>
            )}
          </p>
        </div>

        {/* Activity tier + numeric tag */}
        <div className="flex flex-col items-end gap-0.5 text-right">
          <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider", v.iconClass)}>
            <v.Icon className="h-3 w-3" />
            {v.label}
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {node.in_window_count} in window · {node.lifetime_count} all time
          </span>
        </div>
      </div>

      {/* Children, indented with a connecting rail */}
      {hasChildren && expanded && (
        <div className="relative mt-2 space-y-2 pl-7">
          {/* Vertical rail aligned under the chevron */}
          <div
            aria-hidden
            className="absolute bottom-2 left-3 top-0 w-px bg-gradient-to-b from-white/[0.10] via-white/[0.05] to-transparent"
          />
          {node.children.map((child) => (
            <div key={child.id} className="relative">
              {/* Horizontal stub from rail into card */}
              <div
                aria-hidden
                className="pointer-events-none absolute left-[-16px] top-6 h-px w-4 bg-white/[0.08]"
              />
              <AgentOrgCardNode node={child} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
