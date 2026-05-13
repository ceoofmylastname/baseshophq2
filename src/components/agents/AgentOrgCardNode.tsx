import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, AlertTriangle, Sparkles, Zap, Moon, Snowflake } from "lucide-react";
import {
  type OrgChartNode, activityTier, type ActivityTier, type OrgChartRange,
} from "@/hooks/useAgentsOrgChart";
import { cn } from "@/lib/utils";

/**
 * Per-tier visual treatment.
 *
 * The at-risk overlay (orange ring + Risk badge) is independent — it stacks
 * on top of whatever base tier the agent has.
 */
const TIER_VISUAL: Record<ActivityTier, {
  ribbon: string;
  avatarBg: string;
  avatarText: string;
  ring: string;
  label: string;
  Icon: typeof Sparkles;
  iconClass: string;
  glow: string;
}> = {
  issue_paid: {
    ribbon:     "bg-gradient-to-r from-emerald-400 via-emerald-300 to-emerald-500",
    avatarBg:   "bg-emerald-400/15 border-emerald-400/40",
    avatarText: "text-emerald-300",
    ring:       "ring-emerald-400/30",
    label:      "Issue Paid",
    Icon:       Sparkles,
    iconClass:  "text-emerald-300",
    glow:       "shadow-[0_8px_24px_-12px_hsl(150_70%_55%/0.6)]",
  },
  active: {
    ribbon:     "bg-gradient-to-r from-primary via-amber-300 to-primary",
    avatarBg:   "bg-primary/15 border-primary/40",
    avatarText: "text-primary",
    ring:       "ring-primary/30",
    label:      "Active writer",
    Icon:       Zap,
    iconClass:  "text-primary",
    glow:       "shadow-[0_8px_24px_-12px_hsl(38_92%_60%/0.6)]",
  },
  inactive_with_history: {
    ribbon:     "bg-gradient-to-r from-zinc-500 via-zinc-400 to-zinc-500",
    avatarBg:   "bg-zinc-500/10 border-zinc-500/30",
    avatarText: "text-zinc-300",
    ring:       "ring-zinc-500/20",
    label:      "Dormant",
    Icon:       Moon,
    iconClass:  "text-zinc-300",
    glow:       "shadow-[0_4px_16px_-8px_hsl(0_0%_0%/0.6)]",
  },
  never_written: {
    ribbon:     "bg-gradient-to-r from-white/10 via-white/[0.05] to-white/10",
    avatarBg:   "bg-white/[0.04] border-white/[0.10]",
    avatarText: "text-muted-foreground",
    ring:       "ring-white/[0.06]",
    label:      "Never written",
    Icon:       Snowflake,
    iconClass:  "text-muted-foreground",
    glow:       "shadow-[0_4px_16px_-8px_hsl(0_0%_0%/0.6)]",
  },
};

const RANGE_LABEL: Record<OrgChartRange, string> = {
  day:   "today",
  week:  "this week",
  month: "this month",
  year:  "this year",
};

function initialsOf(firstName: string | null, lastName: string | null, email: string): string {
  const f = (firstName ?? "").trim();
  const l = (lastName ?? "").trim();
  if (f || l) return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase() || email.charAt(0).toUpperCase();
  return email.charAt(0).toUpperCase();
}

export type AgentCardSelection = {
  agentId: string;
  agentName: string;
  agentPosition: string;
  initials: string;
  initialsBg: string;
  initialsText: string;
};

type Props = {
  node: OrgChartNode;
  range: OrgChartRange;
  onSelect: (selection: AgentCardSelection) => void;
};

export function AgentOrgCardNode({ node, range, onSelect }: Props) {
  const [expanded, setExpanded] = useState(node.depth <= 2);

  const tier = activityTier(node);
  const v = TIER_VISUAL[tier];
  const hasChildren = node.children.length > 0;
  const displayName =
    [node.first_name, node.last_name].filter(Boolean).join(" ").trim() || node.email;
  const position = node.position_name
    ? `${node.position_name}${node.position_code ? ` · ${node.position_code}` : ""}`
    : node.is_owner ? "Owner" : "—";
  const initials = initialsOf(node.first_name, node.last_name, node.email);
  const windowLabel = RANGE_LABEL[range];

  function handleCardClick(e: React.MouseEvent) {
    // If the click landed on a Link or a button inside the card, let them
    // handle their own navigation/action and don't open the panel.
    const target = e.target as HTMLElement;
    if (target.closest("a, button")) return;
    onSelect({
      agentId:       node.id,
      agentName:     displayName,
      agentPosition: position,
      initials,
      initialsBg:    v.avatarBg,
      initialsText:  v.avatarText,
    });
  }

  return (
    <div className="org-chart-node">
      {/* Card + floating button live in a relative wrapper. Card has
          overflow-hidden so the tier ribbon clips to the rounded corners.
          The expand button sits OUTSIDE the overflow-hidden so its bottom
          half (which floats below the card edge) isn't clipped. z-20
          puts it above the connector line that drops from the card. */}
      <div className="relative">
        <div
          onClick={handleCardClick}
          className={cn(
            "org-chart-card relative flex w-[220px] cursor-pointer flex-col overflow-hidden rounded-2xl glass-strong ring-1 transition-all duration-200 hover:ring-2",
            v.ring,
            v.glow,
            node.subtreeHasRisk && "ring-2 ring-orange-400/40",
          )}
        >
          <div className={cn("h-[3px] w-full", v.ribbon)} aria-hidden />

          <div className="flex flex-col items-center px-4 pb-3 pt-4">
            <div
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full border text-base font-semibold shadow-lg",
                v.avatarBg,
                v.avatarText,
              )}
            >
              {initials}
            </div>

            <div className="mt-2.5 flex items-center justify-center gap-1.5">
              <Link
                to={`/agents/${node.id}`}
                onClick={(e) => e.stopPropagation()}
                className="truncate text-center text-sm font-semibold tracking-tight hover:underline text-shadow-soft max-w-[180px]"
              >
                {displayName}
              </Link>
              {node.is_owner && (
                <span className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
                  Owner
                </span>
              )}
            </div>

            <p className="mt-0.5 truncate text-center text-[11px] text-muted-foreground max-w-[200px]">
              {position}
            </p>

            <div className="mt-2 flex items-center gap-1.5">
              <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider", v.iconClass)}>
                <v.Icon className="h-3 w-3" />
                {v.label}
              </span>
              {node.subtreeHasRisk && (
                <span className="inline-flex items-center gap-0.5 rounded-md border border-orange-400/30 bg-orange-400/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-orange-300">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  Risk
                </span>
              )}
            </div>

            <div className="mt-2 flex w-full items-center justify-between border-t border-white/[0.06] pt-2 text-[10px] tabular-nums text-muted-foreground">
              <span title={`Policies written ${windowLabel}`}>
                <span className="font-semibold text-foreground/80">{node.in_window_count}</span> {windowLabel}
              </span>
              <span title="Total policies ever written">
                <span className="font-semibold text-foreground/80">{node.lifetime_count}</span> lifetime
              </span>
            </div>
          </div>
        </div>

        {hasChildren && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x); }}
            className={cn(
              "absolute -bottom-3 left-1/2 z-20 flex h-6 -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-popover/95 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shadow-md backdrop-blur-xl transition-all hover:bg-white/[0.10] hover:text-foreground",
              expanded && "opacity-80",
            )}
            aria-label={expanded ? "Collapse downline" : `Expand ${node.children.length} downline`}
          >
            <ChevronDown
              className={cn(
                "h-3 w-3 transition-transform duration-200",
                !expanded && "-rotate-90",
              )}
            />
            <span>{node.children.length}</span>
          </button>
        )}
      </div>

      {hasChildren && expanded && (
        <div className="org-chart-children">
          {node.children.map((child) => (
            <AgentOrgCardNode key={child.id} node={child} range={range} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
