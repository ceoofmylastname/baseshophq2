import type { PolicyDetail } from "@/hooks/usePolicyDetail";

const fmtMoney = (n: number | null) =>
  n === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

type Props = { policy: PolicyDetail };

export function PolicyFinancialSummary({ policy }: Props) {
  return (
    <div className="rounded-md border p-4">
      <h2 className="text-sm font-semibold">Financial summary</h2>
      <dl className="mt-2 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Annual premium</dt>
          <dd className="text-lg font-semibold tabular-nums">{fmtMoney(policy.annual_premium)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Commission paid</dt>
          <dd className="text-lg font-semibold tabular-nums">{fmtMoney(policy.commission_paid_amount)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Commission owed</dt>
          <dd className="text-lg font-semibold tabular-nums">{fmtMoney(policy.commission_owed_amount)}</dd>
        </div>
      </dl>
    </div>
  );
}
