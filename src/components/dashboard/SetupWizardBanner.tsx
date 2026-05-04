import { CheckCircle, Circle } from "lucide-react";
import { useTenantSetupState } from "@/hooks/useTenantSetupState";
import { Button } from "@/components/ui/button";

export function SetupWizardBanner() {
  const { steps, completedKeys, completedCount, totalSteps, allComplete, markComplete, loading } = useTenantSetupState();

  if (loading || allComplete) return null;

  const pct = Math.round((completedCount / totalSteps) * 100);

  return (
    <div className="rounded-md border bg-primary/5 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Set up your agency ({completedCount} of {totalSteps})</h2>
        <span className="text-xs text-muted-foreground">{pct}%</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-3 space-y-2">
        {steps.map((s) => {
          const done = completedKeys.has(s.key);
          return (
            <li key={s.key} className="flex items-start gap-3 text-sm">
              {done ? (
                <CheckCircle className="mt-0.5 h-4 w-4 text-emerald-600" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 text-muted-foreground" />
              )}
              <div className="flex-1">
                <div className={done ? "text-muted-foreground line-through" : "font-medium"}>{s.label}</div>
                <p className="text-xs text-muted-foreground">{s.description}</p>
              </div>
              {!done && (
                <Button size="sm" variant="outline" onClick={() => void markComplete(s.key)}>
                  Mark complete
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
