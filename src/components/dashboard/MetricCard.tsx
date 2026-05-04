import type { ReactNode } from "react";

type Props = {
  label: string;
  value: string;
  icon?: ReactNode;
  tooltip?: string;
  loading?: boolean;
};

export function MetricCard({ label, value, icon, tooltip, loading }: Props) {
  return (
    <div className="rounded-md border bg-card p-4" title={tooltip}>
      <div className="flex items-start justify-between">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">
        {loading ? <span className="text-muted-foreground">…</span> : value}
      </p>
    </div>
  );
}
