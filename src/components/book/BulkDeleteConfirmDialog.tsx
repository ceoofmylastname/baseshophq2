import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDeletePolicyWithAudit } from "@/hooks/useDeletePolicyWithAudit";

type Props = {
  open: boolean;
  onClose: () => void;
  policyIds: string[];
  onComplete: (committedIds: string[]) => void;
};

export function BulkDeleteConfirmDialog({ open, onClose, policyIds, onComplete }: Props) {
  const { deleteOne } = useDeletePolicyWithAudit();
  const [reason, setReason] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stoppedAt, setStoppedAt] = useState<{ idx: number; msg: string; policyId: string } | null>(null);
  const [committed, setCommitted] = useState(0);

  function reset() {
    setReason(""); setRunning(false); setProgress(0); setStoppedAt(null); setCommitted(0);
  }

  async function handleApply() {
    setRunning(true); setStoppedAt(null); setCommitted(0);
    const committedIds: string[] = [];
    for (let i = 0; i < policyIds.length; i++) {
      const id = policyIds[i];
      const result = await deleteOne(id, reason.trim() || null);
      if (!result.ok) {
        setStoppedAt({ idx: i, msg: result.errorMessage, policyId: id });
        setRunning(false);
        onComplete(committedIds);
        return;
      }
      committedIds.push(id);
      setCommitted(i + 1);
      setProgress((i + 1) / policyIds.length);
    }
    setRunning(false);
    onComplete(committedIds);
    reset();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setTimeout(reset, 150); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {policyIds.length} polic{policyIds.length === 1 ? "y" : "ies"}?</DialogTitle>
          <DialogDescription>
            Each policy gets an audit row in <span className="font-mono">policy_deletions_audit</span> capturing
            its full state. Linked commission rows cascade-delete. Stops on the first failure (no rollback).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <label className="text-xs uppercase text-muted-foreground">Reason (optional)</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. duplicate from carrier statement" />
          </div>
          {running && (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-destructive transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">Deleting… {committed} / {policyIds.length}</p>
            </div>
          )}
          {stoppedAt && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
              <p className="font-medium text-destructive">
                Stopped at {stoppedAt.idx + 1} of {policyIds.length}.
              </p>
              <p className="mt-1">{stoppedAt.msg}</p>
              <p className="mt-1 text-muted-foreground">
                Committed: {committed}. Remaining: {policyIds.length - committed - 1}. Prior deletes were not rolled back.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={running}>{stoppedAt ? "Close" : "Cancel"}</Button>
          {!stoppedAt && (
            <Button variant="destructive" onClick={handleApply} disabled={running || policyIds.length === 0}>
              {running ? "Deleting…" : `Delete ${policyIds.length}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
