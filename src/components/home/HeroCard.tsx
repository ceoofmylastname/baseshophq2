import { useAuth } from "@/contexts/AuthContext";
import { usePromotionProgress, type CriterionProgress } from "@/hooks/usePromotionProgress";
import { useAnnualGoal } from "@/hooks/useAnnualGoal";

const CRITERION_LABELS: Record<string, string> = {
  min_premium_last_3_months: "Premium (last 3 mo)",
  min_active_downline_count: "Active downline",
  min_personal_policies:     "Personal policies",
};

function fmt(key: string, value: number): string {
  if (key === "min_premium_last_3_months") {
    return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function CriterionBar({ c }: { c: CriterionProgress }) {
  const label = CRITERION_LABELS[c.key] ?? c.key;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={c.met ? "font-semibold text-emerald-600" : "font-semibold"}>
          {fmt(c.key, c.current)} / {fmt(c.key, c.target)}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-muted">
        <div
          className={c.met ? "h-1.5 rounded-full bg-emerald-500" : "h-1.5 rounded-full bg-primary"}
          style={{ width: `${Math.min(100, Math.max(0, c.pct * 100))}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Personal hero card. Shows name, current position, promotion progress
 * (multiple criterion bars) and annual goal progress. If no promotion target
 * is configured for the agent's current position, the promotion section
 * gracefully degrades to a "configure your promotion ladder" hint for owners
 * and silence for everyone else.
 */
export function HeroCard() {
  const { currentAgent, isOwner } = useAuth();
  const { data, loading } = usePromotionProgress();
  const { goal } = useAnnualGoal();

  const firstName = currentAgent?.first_name ?? currentAgent?.email ?? "there";

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Welcome back</p>
          <h1 className="text-2xl font-semibold">{firstName}</h1>
        </div>
        {data?.current_position && (
          <div className="text-right text-sm">
            <p className="text-muted-foreground">Position</p>
            <p className="font-medium">{data.current_position.name} ({data.current_position.code})</p>
          </div>
        )}
      </div>

      {/* Promotion progress */}
      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading promotion progress…</p>
        ) : !data?.next_position || data.criteria_progress.length === 0 ? (
          isOwner ? (
            <p className="text-sm text-muted-foreground">
              Configure promotion criteria in Settings to surface a next-rung gauge here.
            </p>
          ) : null
        ) : (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium">
                Next: {data.next_position.name}{" "}
                <span className="text-muted-foreground">({data.next_position.code})</span>
              </p>
              {data.all_met && (
                <span className="text-xs font-semibold text-emerald-600">
                  All criteria met — promotion ready
                </span>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {data.criteria_progress.map(c => <CriterionBar key={c.key} c={c} />)}
            </div>
          </div>
        )}
      </div>

      {/* Annual goal */}
      {goal != null && goal > 0 && (
        <div className="mt-5 border-t pt-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Annual goal</p>
          <p className="mt-1 text-sm font-medium">
            {goal.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
          </p>
        </div>
      )}
    </div>
  );
}
