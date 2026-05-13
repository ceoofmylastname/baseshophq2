import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useUpdatePolicyStatus } from "@/hooks/useUpdatePolicyStatus";
import { POLICY_STATUS_VALUES, type PolicyStatus } from "@/lib/policy-bucket";
import { StatusPill } from "@/components/ui/status-pill";
import { ChevronDown } from "lucide-react";

type Props = { policyId: string; status: PolicyStatus };

/**
 * Owner-editable status pill. Non-owners see a static StatusPill (read-only).
 * Owners get the same pill with a chevron + dropdown of all 7 statuses;
 * picking a new one writes via useUpdatePolicyStatus.
 */
export function StatusPillEdit({ policyId, status }: Props) {
  const { isOwner } = useAuth();
  const { update, submitting } = useUpdatePolicyStatus();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOwner) {
    return <StatusPill status={status} />;
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
        aria-label="Change status"
      >
        <StatusPill
          status={status}
          trailing={submitting ? <span className="opacity-70">…</span> : <ChevronDown className="h-3 w-3 opacity-70" />}
        />
      </button>
      {open && (
        <ul
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-50 mt-1 w-48 rounded-lg border border-white/10 bg-popover p-1 text-sm shadow-2xl backdrop-blur-xl"
        >
          {POLICY_STATUS_VALUES.map((s) => (
            <li key={s}>
              <button
                onClick={() => void handleChange(s)}
                className={
                  s === status
                    ? "flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground"
                    : "flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/[0.06]"
                }
              >
                <StatusPill status={s} />
                {s === status && <span className="ml-auto text-[10px] text-muted-foreground">current</span>}
              </button>
            </li>
          ))}
          {error && <li className="px-2 py-1 text-xs text-destructive">{error}</li>}
        </ul>
      )}
    </div>
  );
}
