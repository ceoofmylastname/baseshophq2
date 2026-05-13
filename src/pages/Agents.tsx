import { useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAgentsDirectory } from "@/hooks/useAgentsDirectory";
import { AgentsDirectoryTable } from "@/components/agents/AgentsDirectoryTable";
import { AddAgentDialog } from "@/components/agents/AddAgentDialog";
import { AgentsOrgChart } from "@/components/agents/AgentsOrgChart";
import type { OrgChartRange } from "@/hooks/useAgentsOrgChart";
import { cn } from "@/lib/utils";

type View = "tree" | "table";

/**
 * Phase 13.0: /agents has two views.
 *
 * Tree view (default) — recursive org chart with activity color coding.
 * Time range pills drive what counts as 'active' for the color tier.
 *
 * Table view — the existing flat directory; kept for bulk scanning,
 * sorting, and filtering.
 */
export function AgentsPage() {
  const { isOwner } = useAuth();
  const { rows, loading, error, refresh } = useAgentsDirectory();
  const [view, setView] = useState<View>("tree");
  const [range, setRange] = useState<OrgChartRange>("month");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-shadow-soft">Agents</h1>
          <p className="text-sm text-muted-foreground">
            Your team. {rows.length} {rows.length === 1 ? "agent" : "agents"} visible.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setView("tree")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors",
                view === "tree"
                  ? "bg-white/[0.06] text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Org chart
            </button>
            <button
              type="button"
              onClick={() => setView("table")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors",
                view === "table"
                  ? "bg-white/[0.06] text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="h-3.5 w-3.5" />
              Table
            </button>
          </div>
          {isOwner && <AddAgentDialog existingAgents={rows} onAdded={refresh} />}
        </div>
      </div>

      {view === "tree" ? (
        <AgentsOrgChart range={range} onRangeChange={setRange} />
      ) : (
        <>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!loading && !error && <AgentsDirectoryTable rows={rows} />}
        </>
      )}
    </div>
  );
}
