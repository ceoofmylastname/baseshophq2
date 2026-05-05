/**
 * Phase 10D: Submitted Business vs Issue Paid Business toggle.
 * Kevin's explicit ask on the 2026-02-12 call. See
 * wiki/production-dashboard-page.md "Filtering" section.
 */

import type { ProductionBasis } from "@/hooks/useProductionMetrics";

type Props = { value: ProductionBasis; onChange: (next: ProductionBasis) => void };

const OPTIONS: { value: ProductionBasis; label: string; hint: string }[] = [
  { value: "submitted",  label: "Submitted Business",  hint: "Counts policies by application date, any status (raw activity)." },
  { value: "issue_paid", label: "Issue Paid Business", hint: "Counts policies that hit Issue Paid in the window (cash flow)." },
];

export function BasisToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border bg-card p-0.5 text-xs">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          title={opt.hint}
          className={
            value === opt.value
              ? "rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground"
              : "rounded-full px-3 py-1 text-muted-foreground hover:text-foreground"
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
