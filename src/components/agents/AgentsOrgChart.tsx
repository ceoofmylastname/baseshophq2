import { useEffect, useRef, useState, useCallback } from "react";
import { Sparkles, Zap, Moon, Snowflake, AlertTriangle, ZoomIn, ZoomOut, Maximize2, RotateCcw } from "lucide-react";
import { useAgentsOrgChart, type OrgChartRange } from "@/hooks/useAgentsOrgChart";
import { AgentOrgCardNode, type AgentCardSelection } from "./AgentOrgCardNode";
import { AgentDetailPanel } from "./AgentDetailPanel";
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

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.1;

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
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

  // Zoom state. 1.0 = native size. Auto-fit on load + when forest changes.
  const [zoom, setZoom] = useState(1);
  const [selection, setSelection] = useState<AgentCardSelection | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  // Fit-to-view: measure tree intrinsic width, set zoom = viewport/tree.
  const fitToView = useCallback(() => {
    const vp = viewportRef.current;
    const tree = treeRef.current;
    if (!vp || !tree) return;
    // Reset transform to measure intrinsic dimensions accurately.
    const prev = tree.style.transform;
    tree.style.transform = "scale(1)";
    const treeW = tree.scrollWidth;
    const treeH = tree.scrollHeight;
    tree.style.transform = prev;
    if (treeW === 0 || treeH === 0) return;
    const vpW = vp.clientWidth - 64;   // account for px-8 padding
    const vpH = vp.clientHeight - 80;  // account for py-10 padding
    const scaleX = vpW / treeW;
    const scaleY = vpH / treeH;
    const next = Math.min(scaleX, scaleY, MAX_ZOOM);
    setZoom(Math.max(MIN_ZOOM, next));
  }, []);

  // Auto-fit on first load and whenever the tree changes meaningfully.
  // Run twice (first frame measures initial layout, second after children settle).
  useEffect(() => {
    if (loading) return;
    if (forest.length === 0) return;
    const t1 = requestAnimationFrame(() => fitToView());
    const t2 = requestAnimationFrame(() => requestAnimationFrame(() => fitToView()));
    return () => {
      cancelAnimationFrame(t1);
      cancelAnimationFrame(t2);
    };
  }, [forest, loading, fitToView]);

  // Also refit on window resize.
  useEffect(() => {
    const onResize = () => fitToView();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitToView]);

  const zoomIn  = () => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)));
  const reset   = () => setZoom(1);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Legend />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Range pills */}
          <div className="flex items-center gap-1">
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

          {/* Zoom controls */}
          <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.02] p-0.5">
            <button
              type="button"
              onClick={zoomOut}
              disabled={zoom <= MIN_ZOOM}
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground disabled:opacity-40"
              title="Zoom out"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[3ch] text-center text-[10px] tabular-nums text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={zoomIn}
              disabled={zoom >= MAX_ZOOM}
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground disabled:opacity-40"
              title="Zoom in"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <span className="mx-0.5 h-4 w-px bg-white/10" aria-hidden />
            <button
              type="button"
              onClick={fitToView}
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
              title="Fit to view"
              aria-label="Fit to view"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
              title="Reset zoom to 100%"
              aria-label="Reset zoom"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Tree canvas */}
      <div className="relative overflow-hidden rounded-2xl glass-strong">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            background:
              "radial-gradient(at 50% 0%, hsl(38 92% 60% / 0.06) 0px, transparent 50%), " +
              "radial-gradient(at 50% 100%, hsl(280 60% 50% / 0.04) 0px, transparent 50%)",
          }}
        />

        <div
          ref={viewportRef}
          className="relative overflow-auto"
          style={{ height: "min(80vh, 900px)" }}
        >
          <div className="min-w-full px-8 py-10">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : forest.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-muted-foreground">
                No agents in your scope yet. Add your first agent to start building the tree.
              </div>
            ) : (
              <div
                ref={treeRef}
                className="flex justify-center gap-12 transition-transform duration-200"
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "top center",
                  willChange: "transform",
                }}
              >
                {forest.map((root) => (
                  <AgentOrgCardNode
                    key={root.id}
                    node={root}
                    range={range}
                    onSelect={setSelection}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Slide-in detail panel */}
      <AgentDetailPanel
        agentId={selection?.agentId ?? null}
        agentName={selection?.agentName ?? ""}
        agentPosition={selection?.agentPosition ?? ""}
        initialsBg={selection?.initialsBg ?? ""}
        initialsText={selection?.initialsText ?? ""}
        avatarUrl={selection?.avatarUrl ?? null}
        firstName={selection?.firstName ?? null}
        lastName={selection?.lastName ?? null}
        email={selection?.email ?? ""}
        onClose={() => setSelection(null)}
      />
    </div>
  );
}
