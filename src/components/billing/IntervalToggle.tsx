import type { BillingInterval } from "@/lib/billing/helpers";

/**
 * Monthly / Annual segmented toggle for the /billing page (Phase 17 PR 3c).
 *
 * Matches the inline pattern used by BasisToggle in
 * src/components/production/BasisToggle.tsx — single inline-flex pill with
 * rounded child buttons. The active button uses primary fill; inactive
 * buttons sit on the card background.
 *
 * The toggle does NOT itself fire the mutation. It calls onChange, the
 * caller opens MutationConfirmDialog with the proration label, and only
 * a confirmed dialog actually POSTs to billing-mutate.
 */

type Props = {
  value: BillingInterval;
  onChange: (next: BillingInterval) => void;
  disabled?: boolean;
};

const OPTIONS: { value: BillingInterval; label: string; hint: string }[] = [
  { value: "monthly", label: "Monthly", hint: "Standard month-to-month billing." },
  { value: "annual",  label: "Annual",  hint: "Pay annually upfront. Two months free vs monthly." },
];

export function IntervalToggle({ value, onChange, disabled = false }: Props) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border bg-card p-0.5 text-xs">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => !disabled && onChange(opt.value)}
          title={opt.hint}
          disabled={disabled}
          className={
            value === opt.value
              ? "rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground"
              : "rounded-full px-3 py-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
