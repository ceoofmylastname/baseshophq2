import { Link } from "react-router-dom";
import { CheckCircle, Circle, Sparkles, ArrowRight } from "lucide-react";
import { useTenantSetupState, type SetupStepKey } from "@/hooks/useTenantSetupState";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Each step optionally links to the page where the owner takes the action.
 * Auto-detect steps surface a 'Go to {area}' link so the owner has a path
 * forward without having to figure out where each thing lives.
 */
const STEP_ACTION: Partial<Record<SetupStepKey, { href: string; label: string }>> = {
  positions_blueprint: { href: "/settings",     label: "Open Settings" },
  first_carrier:       { href: "/master-grid",  label: "Open Master Grid" },
  invite_agent:        { href: "/agents",       label: "Open Agents" },
};

export function SetupWizardBanner() {
  const { steps, completedCount, totalSteps, allComplete, markComplete, loading } = useTenantSetupState();

  if (loading || allComplete) return null;

  const pct = Math.round((completedCount / totalSteps) * 100);

  return (
    <div className="rounded-2xl glass p-5">
      {/* Header: progress label + percentage */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            Set up your agency
          </p>
          <h2 className="mt-0.5 text-sm font-semibold tracking-tight">
            {completedCount} of {totalSteps} complete
          </h2>
        </div>
        <span className="text-xs font-semibold tabular-nums text-primary">{pct}%</span>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full bg-gradient-to-r from-primary via-amber-300 to-primary shadow-[0_0_12px_hsl(38_92%_60%/0.5)] transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Steps */}
      <ul className="mt-4 space-y-2.5">
        {steps.map((s) => {
          const action = STEP_ACTION[s.key];
          return (
            <li
              key={s.key}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3 transition-colors",
                s.complete
                  ? "border-emerald-400/15 bg-emerald-400/[0.04]"
                  : "border-white/[0.06] bg-white/[0.02]",
              )}
            >
              {/* Status icon */}
              {s.complete ? (
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              )}

              {/* Label + description */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "text-sm font-semibold",
                      s.complete && "text-muted-foreground line-through decoration-emerald-400/50",
                    )}
                  >
                    {s.label}
                  </span>
                  {s.mode === "auto" && (
                    <span className="inline-flex items-center gap-0.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <Sparkles className="h-2.5 w-2.5" />
                      Auto-detected
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
              </div>

              {/* Action: 'Go to X' link for auto steps (when incomplete),
                  'Mark complete' button for manual steps (when incomplete). */}
              {!s.complete && s.mode === "auto" && action && (
                <Button asChild size="sm" variant="ghost" className="shrink-0 self-center text-xs">
                  <Link to={action.href}>
                    {action.label} <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              )}
              {!s.complete && s.mode === "manual" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 self-center"
                  onClick={() => void markComplete(s.key)}
                >
                  Mark complete
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[11px] text-muted-foreground">
        <Sparkles className="mr-1 inline h-3 w-3 text-primary" />
        Auto-detected steps update the moment you complete them — no need to come back here and check a box.
      </p>
    </div>
  );
}
