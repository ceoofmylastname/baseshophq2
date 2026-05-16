/**
 * Phase 18 PR 1: Monthly / Annual segmented toggle for the public pricing
 * page. Visual pattern matches `src/components/billing/IntervalToggle.tsx`
 * (the authenticated equivalent) so the chrome reads the same on both
 * surfaces. When "Annual" is selected, an inline "Save 2 months" gold pill
 * surfaces on the right side as a value reinforcement.
 *
 * Stateless: the parent owns the selected interval and passes it back in.
 */

import type { BillingIntervalLite } from "@/lib/pricing/pricing-math";

type Props = {
  value: BillingIntervalLite;
  onChange: (next: BillingIntervalLite) => void;
};

const OPTIONS: { value: BillingIntervalLite; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "annual",  label: "Annual"  },
];

export function AnnualToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex items-center gap-2">
      <div className="inline-flex items-center gap-1 rounded-full border bg-card p-0.5 text-xs">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
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
      {value === "annual" && (
        <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
          Save 2 months
        </span>
      )}
    </div>
  );
}
