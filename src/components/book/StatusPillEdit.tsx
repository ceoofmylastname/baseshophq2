import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useUpdatePolicyStatus } from "@/hooks/useUpdatePolicyStatus";
import { POLICY_STATUS_VALUES, statusToBucket, type PolicyStatus } from "@/lib/policy-bucket";
import { Badge } from "@/components/ui/badge";

const BUCKET_VARIANT: Record<string, "default" | "success" | "warning" | "muted" | "destructive"> = {
  Pipeline: "default",
  Booked: "success",
  Realized: "success",
  "At-Risk": "warning",
  Other: "muted",
};

type Props = { policyId: string; status: PolicyStatus };

export function StatusPillEdit({ policyId, status }: Props) {
  const { isOwner } = useAuth();
  const { update, submitting } = useUpdatePolicyStatus();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOwner) {
    return <Badge variant={BUCKET_VARIANT[statusToBucket(status)]}>{status}</Badge>;
  }

  async function handleChange(newStatus: PolicyStatus) {
    if (newStatus === status) { setOpen(false); return; }
    setError(null);
    const result = await update(policyId, newStatus);
    if (!result.ok) { setError(result.errorMessage); return; }
    setOpen(false);
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="cursor-pointer"
        disabled={submitting}
      >
        <Badge variant={BUCKET_VARIANT[statusToBucket(status)]}>{status} {submitting ? "…" : "▾"}</Badge>
      </button>
      {open && (
        <ul
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-50 mt-1 w-44 rounded-md border bg-popover p-1 text-sm shadow-md"
        >
          {POLICY_STATUS_VALUES.map((s) => (
            <li key={s}>
              <button
                onClick={() => void handleChange(s)}
                className={
                  s === status
                    ? "flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-muted-foreground"
                    : "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent"
                }
              >
                <Badge variant={BUCKET_VARIANT[statusToBucket(s)]}>{s}</Badge>
                {s === status && <span className="text-xs">current</span>}
              </button>
            </li>
          ))}
          {error && <li className="px-2 py-1 text-xs text-destructive">{error}</li>}
        </ul>
      )}
    </div>
  );
}
