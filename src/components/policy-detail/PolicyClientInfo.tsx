import type { PolicyDetail } from "@/hooks/usePolicyDetail";

type Props = { policy: PolicyDetail };

export function PolicyClientInfo({ policy }: Props) {
  const name = [policy.client_first_name, policy.client_last_name].filter(Boolean).join(" ") || "—";
  return (
    <div className="rounded-md border p-4">
      <h2 className="text-sm font-semibold">Client</h2>
      <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-xs uppercase text-muted-foreground">Name</dt><dd>{name}</dd></div>
        <div><dt className="text-xs uppercase text-muted-foreground">DOB</dt><dd>{policy.client_dob ?? "—"}</dd></div>
        <div><dt className="text-xs uppercase text-muted-foreground">Application date</dt><dd>{policy.application_date ?? "—"}</dd></div>
        <div><dt className="text-xs uppercase text-muted-foreground">Effective date</dt><dd>{policy.effective_date ?? "—"}</dd></div>
      </dl>
    </div>
  );
}
