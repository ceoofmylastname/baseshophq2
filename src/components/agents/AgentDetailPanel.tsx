import { useEffect } from "react";
import { Link } from "react-router-dom";
import { X, ExternalLink } from "lucide-react";
import {
  useAgentActivityBreakdown, type WindowKey, type WindowStats,
} from "@/hooks/useAgentActivityBreakdown";
import { StatusPill } from "@/components/ui/status-pill";
import { AgentAvatar } from "@/components/agents/AgentAvatar";
import { cn } from "@/lib/utils";

type Props = {
  agentId: string | null;
  agentName: string;
  agentPosition: string;
  /** Initials fallback styling — used when no photo is set. */
  initialsBg: string;
  initialsText: string;
  /** Optional photo URL — falls back to colored initials when null/missing. */
  avatarUrl?: string | null;
  firstName?: string | null;
  lastName?:  string | null;
  email?:     string;
  onClose: () => void;
};

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const fmtCount = (n: number) => new Intl.NumberFormat("en-US").format(n);

const WINDOW_LABELS: Record<WindowKey, string> = {
  today:    "Today",
  week:     "This Week",
  month:    "This Month",
  year:     "This Year",
  lifetime: "All Time",
};

/** One row in the per-window breakdown. */
function StatRow({
  label, count, premium,
}: { label: string; count: number; premium: number }) {
  return (
    <div className="flex items-baseline justify-between border-b border-white/[0.04] py-1.5 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs">
        <span className="font-semibold tabular-nums text-foreground">{fmtCount(count)}</span>
        <span className="ml-2 tabular-nums text-muted-foreground">{fmtMoney(premium)}</span>
      </span>
    </div>
  );
}

function WindowSection({ label, stats }: { label: string; stats: WindowStats }) {
  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </h3>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {fmtCount(stats.total_count)} pol · {fmtMoney(stats.total_premium)}
        </span>
      </div>
      <div className="space-y-0">
        <StatRow label="Submitted"       count={stats.submitted_count}  premium={stats.submitted_premium}  />
        <StatRow label="Pending"         count={stats.pending_count}    premium={stats.pending_premium}    />
        <StatRow label="Issued"          count={stats.issued_count}     premium={stats.issued_premium}     />
        <StatRow label="Issue Paid"      count={stats.issue_paid_count} premium={stats.issue_paid_premium} />
        <StatRow label="Potential Lapse" count={stats.lapse_count}      premium={stats.lapse_premium}      />
        <StatRow label="Terminated"      count={stats.terminated_count} premium={stats.terminated_premium} />
      </div>
    </section>
  );
}

export function AgentDetailPanel({
  agentId, agentName, agentPosition, initialsBg, initialsText,
  avatarUrl, firstName, lastName, email, onClose,
}: Props) {
  const { data, loading } = useAgentActivityBreakdown(agentId);

  // Escape closes the panel; lock body scroll while open.
  useEffect(() => {
    if (!agentId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [agentId, onClose]);

  const open = !!agentId;

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {/* Panel */}
      <aside
        className={cn(
          "fixed right-0 top-0 z-50 flex h-screen w-full max-w-md flex-col glass-strong border-l border-white/[0.08] shadow-2xl transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
        role="dialog"
        aria-modal="true"
        aria-label={open ? `${agentName} details` : undefined}
      >
        {/* Header */}
        <header className="flex items-start gap-3 border-b border-white/[0.06] p-5">
          <AgentAvatar
            avatarUrl={avatarUrl}
            firstName={firstName}
            lastName={lastName}
            email={email ?? agentName}
            size="xl"
            fallbackBg={initialsBg}
            fallbackText={initialsText}
            className="shadow-lg"
          />
          <div className="flex-1 min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight text-shadow-soft">
              {agentName}
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{agentPosition}</p>
            {agentId && (
              <Link
                to={`/agents/${agentId}`}
                onClick={onClose}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                Full profile <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <StatusPill status="Submitted" />
            <StatusPill status="Pending" />
            <StatusPill status="Issued" />
            <StatusPill status="Issue Paid" />
            <StatusPill status="Potential Lapse" />
            <StatusPill status="Terminated" />
          </div>
          <p className="mb-4 text-[11px] text-muted-foreground">
            Counts and premium sums per status across each time window.
            Today resets at midnight; Week is Monday-to-now; Month and Year are calendar-bound.
          </p>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading breakdown…</p>
          ) : data ? (
            <div className="space-y-3">
              <WindowSection label={WINDOW_LABELS.today}    stats={data.windows.today} />
              <WindowSection label={WINDOW_LABELS.week}     stats={data.windows.week} />
              <WindowSection label={WINDOW_LABELS.month}    stats={data.windows.month} />
              <WindowSection label={WINDOW_LABELS.year}     stats={data.windows.year} />
              <WindowSection label={WINDOW_LABELS.lifetime} stats={data.windows.lifetime} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No activity data.</p>
          )}
        </div>
      </aside>
    </>
  );
}
