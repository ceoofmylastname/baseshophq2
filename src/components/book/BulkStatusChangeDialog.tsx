import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUpdatePolicyStatus } from "@/hooks/useUpdatePolicyStatus";
import { POLICY_STATUS_VALUES, type PolicyStatus } from "@/lib/policy-bucket";

type Props = {
  open: boolean;
  onClose: () => void;
  policyIds: string[];
  onComplete: (committedIds: string[]) => void;
};

export function BulkStatusChangeDialog({ open, onClose, policyIds, onComplete }: Props) {
  const { update } = useUpdatePolicyStatus();
  const [newStatus, setNewStatus] = useState<PolicyStatus>("Issued");
  const [running, setRunning] = useState(false);
  const [committed, setCommitted] = useState(0);
  const [stopped, setStopped] = useState<{ idx: number; msg: string } | null>(null);

  async function handleApply() {
    setRunning(true); setStopped(null); setCommitted(0);
    const committedIds: string[] = [];
    for (let i = 0; i < policyIds.length; i++) {
      const result = await update(policyIds[i], newStatus);
      if (!result.ok) { setStopped({ idx: i, msg: result.errorMessage }); setRunning(false); onComplete(committedIds); return; }
      committedIds.push(policyIds[i]);
      setCommitted(i + 1);
    }
    setRunning(false);
    onComplete(committedIds);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change status for {policyIds.length} polic{policyIds.length === 1 ? "y" : "ies"}</DialogTitle>
          <DialogDescription>
            Each row fires the Phase 4a status-change trigger (writes policy_status_history) and the Phase 4a
            engine recalc (if to/from Issued). Stops on first failure.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <label className="text-xs uppercase text-muted-foreground">New status</label>
            <select
              value={newStatus} onChange={(e) => setNewStatus(e.target.value as PolicyStatus)}
              className="h-9 w-full rounded-md border border-input bg-background px-2"
            >
              {POLICY_STATUS_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {running && <p className="text-xs text-muted-foreground">Updating… {committed} / {policyIds.length}</p>}
          {stopped && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
              <p className="font-medium text-destructive">Stopped at {stopped.idx + 1} of {policyIds.length}.</p>
              <p className="mt-1">{stopped.msg}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={running}>Cancel</Button>
          <Button onClick={handleApply} disabled={running || policyIds.length === 0}>
            {running ? "Updating…" : `Apply to ${policyIds.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
