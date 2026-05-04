import { useAuth } from "@/contexts/AuthContext";
import { useDeletePolicyWithAudit } from "@/hooks/useDeletePolicyWithAudit";
import { Button } from "@/components/ui/button";
import { StatusPillEdit } from "@/components/book/StatusPillEdit";
import type { PolicyDetail } from "@/hooks/usePolicyDetail";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

type Props = { policy: PolicyDetail };

export function PolicyDetailHeader({ policy }: Props) {
  const { isOwner } = useAuth();
  const navigate = useNavigate();
  const { deleteOne, submitting } = useDeletePolicyWithAudit();
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleDelete() {
    const result = await deleteOne(policy.id, null);
    if (result.ok) navigate("/book-of-business");
  }

  return (
    <div className="rounded-md border p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">{policy.policy_number}</h1>
          <p className="text-sm text-muted-foreground">
            {policy.carrier ?? "—"} · {policy.product ?? "—"}
          </p>
          <div className="pt-1">
            <StatusPillEdit policyId={policy.id} status={policy.status} />
          </div>
        </div>
        {isOwner && (
          <div className="flex flex-wrap gap-2">
            {confirmDelete ? (
              <>
                <Button variant="destructive" size="sm" onClick={() => void handleDelete()} disabled={submitting}>
                  {submitting ? "Deleting…" : "Confirm delete"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)} disabled={submitting}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
                Delete policy
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
