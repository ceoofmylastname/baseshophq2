import { Sparkles, Zap, Moon, Snowflake, AlertTriangle } from "lucide-react";
import { useAgentsOrgChart, type OrgChartRange } from "@/hooks/useAgentsOrgChart";
import { AgentOrgCardNode } from "./AgentOrgCardNode";
import { cn } from "@/lib/utils";

type Props = {
  range: OrgChartRange;
  onRangeChange: (r: OrgChartRange) => void;
};

const RANGES: { value: OrgChartRange; label: string }[] = [
  { value: "day",   label: "Day" },
  { value: "week",  label: "Week" },
  { value: "month", label: "Month" },
  { value: "year",  label: "Year" },
];

/** Legend strip explaining the four activity tiers + the at-risk overlay. */
function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Sparkles className="h-3 w-3 text-emerald-300" />
        Issue Paid
      </span>
      <span className="inline-flex items-center gap-1">
        <Zap className="h-3 w-3 text-primary" />
        Active writer
      </span>
      <span className="inline-flex items-center gap-1">
        <Moon className="h-3 w-3 text-zinc-300" />
        Dormant
      </span>
      <span className="inline-flex items-center gap-1">
        <Snowflake className="h-3 w-3 text-muted-foreground" />
        Never written
      </span>
      <span className="inline-flex items-center gap-1">
        <AlertTriangle className="h-3 w-3 text-orange-300" />
        Team at risk
      </span>
    </div>
  );
}

export function AgentsOrgChart({ range, onRangeChange }: Props) {
  const { forest, loading, error } = useAgentsOrgChart({ range });

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Legend />
        <div className="flex items-center gap-1 text-xs">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => onRangeChange(r.value)}
              className={cn(
                "rounded-full px-3 py-1 font-medium transition-colors",
                range === r.value
                  ? "bg-primary text-primary-foreground shadow-[0_0_16px_hsl(38_92%_60%/0.4)]"
                  : "border border-white/10 bg-white/[0.02] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tree */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : forest.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-muted-foreground">
          No agents in your scope yet. Add your first agent to start building the tree.
        </div>
      ) : (
        <div className="space-y-3">
          {forest.map((root) => (
            <AgentOrgCardNode key={root.id} node={root} />
          ))}
        </div>
      )}
    </div>
  );
}
