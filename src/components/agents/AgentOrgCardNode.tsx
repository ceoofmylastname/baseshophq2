import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, AlertTriangle, Sparkles, Zap, Moon, Snowflake } from "lucide-react";
import {
  type OrgChartNode, activityTier, type ActivityTier,
} from "@/hooks/useAgentsOrgChart";
import { cn } from "@/lib/utils";

/**
 * Per-tier visual treatment. Color rationale:
 *   issue_paid   emerald  — strongest: realized money in this window
 *   active       gold     — warm, brand primary; "writing right now"
 *   inactive_with_history zinc — neutral; "knows the work, just dormant"
 *   never_written         muted; "fresh recruit, hasn't shipped yet"
 *
 * The at-risk overlay (orange ring + Risk badge) is independent — it stacks
 * on top of whatever base tier the agent has.
 */
const TIER_VISUAL: Record<ActivityTier, {
  ribbon: string;     // top color ribbon (3px, full saturation)
  avatarBg: string;   // avatar circle background
  avatarText: string; // avatar initials color
  ring: string;       // ring around whole card
  label: string;
  Icon: typeof Sparkles;
  iconClass: string;
  glow: string;       // box-shadow glow under card
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

function initials(firstName: string | null, lastName: string | null, email: string): string {
  const f = (firstName ?? "").trim();
  const l = (lastName ?? "").trim();
  if (f || l) return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase() || email.charAt(0).toUpperCase();
  return email.charAt(0).toUpperCase();
}

type Props = { node: OrgChartNode };

export function AgentOrgCardNode({ node }: Props) {
  // Root + first 2 levels start expanded so the pyramid reads on first load.
  // Deeper levels start collapsed to keep wide trees manageable.
  const [expanded, setExpanded] = useState(node.depth <= 2);

  const tier = activityTier(node);
  const v = TIER_VISUAL[tier];
  const hasChildren = node.children.length > 0;
  const displayName =
    [node.first_name, node.last_name].filter(Boolean).join(" ").trim() || node.email;
  const position = node.position_name
    ? `${node.position_name}${node.position_code ? ` · ${node.position_code}` : ""}`
    : node.is_owner ? "Owner" : "—";

  return (
    <div className="org-chart-node">
      {/* Card */}
      <div
        className={cn(
          "org-chart-card relative flex w-[220px] flex-col overflow-hidden rounded-2xl glass-strong ring-1 transition-all duration-200",
          v.ring,
          v.glow,
          node.subtreeHasRisk && "ring-2 ring-orange-400/40",
        )}
      >
        {/* Tier ribbon — colored band at the very top */}
        <div className={cn("h-[3px] w-full", v.ribbon)} aria-hidden />

        {/* Body */}
        <div className="flex flex-col items-center px-4 pb-3 pt-4">
          {/* Avatar circle with initials */}
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-full border text-base font-semibold shadow-lg",
              v.avatarBg,
              v.avatarText,
            )}
          >
            {initials(node.first_name, node.last_name, node.email)}
          </div>

          {/* Name + Owner badge */}
          <div className="mt-2.5 flex items-center justify-center gap-1.5">
            <Link
              to={`/agents/${node.id}`}
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

          {/* Position */}
          <p className="mt-0.5 truncate text-center text-[11px] text-muted-foreground max-w-[200px]">
            {position}
          </p>

          {/* Tier label + risk badge */}
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

          {/* Numeric stats — small footer row */}
          <div className="mt-2 flex w-full items-center justify-between border-t border-white/[0.06] pt-2 text-[10px] tabular-nums text-muted-foreground">
            <span title="Policies written in selected window">
              <span className="font-semibold text-foreground/80">{node.in_window_count}</span> window
            </span>
            <span title="Total policies all time">
              <span className="font-semibold text-foreground/80">{node.lifetime_count}</span> all time
            </span>
          </div>
        </div>

        {/* Expand / collapse button — bottom-right floating chip */}
        {hasChildren && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className={cn(
              "absolute -bottom-3 left-1/2 z-10 flex h-6 -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-popover/90 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur-xl transition-all hover:bg-white/[0.08] hover:text-foreground",
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

      {/* Children — only render when expanded */}
      {hasChildren && expanded && (
        <div className="org-chart-children">
          {node.children.map((child) => (
            <AgentOrgCardNode key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}
