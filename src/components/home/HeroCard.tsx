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
        <span className={c.met ? "font-semibold text-emerald-400" : "font-semibold text-foreground"}>
          {fmt(c.key, c.current)} / {fmt(c.key, c.target)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={
            c.met
              ? "h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-[0_0_12px_hsl(150_70%_50%/0.5)]"
              : "h-full rounded-full bg-gradient-to-r from-primary to-amber-300 shadow-[0_0_12px_hsl(38_92%_60%/0.5)]"
          }
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
    <div className="relative overflow-hidden rounded-2xl glass p-6">
      {/* Kinetic gradient wash — sits behind content, doesn't block clicks. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 gradient-rim opacity-90" />

      <div className="relative flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Welcome back
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-shadow-hero">
            {firstName}
          </h1>
        </div>
        {data?.current_position && (
          <div className="text-right text-sm">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Position
            </p>
            <p className="mt-1 font-semibold text-shadow-soft">
              {data.current_position.name}
              <span className="ml-1 text-muted-foreground">({data.current_position.code})</span>
            </p>
          </div>
        )}
      </div>

      {/* Promotion progress */}
      <div className="relative mt-5">
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
              <p className="text-sm font-semibold">
                Next: <span className="text-shadow-soft">{data.next_position.name}</span>{" "}
                <span className="font-normal text-muted-foreground">({data.next_position.code})</span>
              </p>
              {data.all_met && (
                <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                  Promotion ready
                </span>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.criteria_progress.map(c => <CriterionBar key={c.key} c={c} />)}
            </div>
          </div>
        )}
      </div>

      {/* Annual goal */}
      {goal != null && goal > 0 && (
        <div className="relative mt-5 border-t border-white/[0.06] pt-4">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Annual goal
          </p>
          <p className="mt-1 text-sm font-semibold tracking-tight">
            {goal.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
          </p>
        </div>
      )}
    </div>
  );
}
