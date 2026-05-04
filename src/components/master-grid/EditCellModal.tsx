import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMasterGridBlastRadius } from "@/hooks/useMasterGridBlastRadius";

type Props = {
  open: boolean;
  onClose: () => void;
  positionId: string;
  positionLabel: string;
  productId: string;
  productLabel: string;
  priorRate: number | null;
  proposedRate: number;
  proposedScheduleCode: string | null;
  onConfirm: (effective: string) => void;
  submitting: boolean;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export function EditCellModal({
  open, onClose, positionId, positionLabel, productLabel,
  productId, priorRate, proposedRate, proposedScheduleCode,
  onConfirm, submitting,
}: Props) {
  const { fetchBlast } = useMasterGridBlastRadius();
  const [blast, setBlast] = useState<{ eligible_agents: number; overridden_agents: number } | null>(null);
  const [effective, setEffective] = useState(todayIso());

  useEffect(() => {
    if (!open) return;
    setEffective(todayIso());
    void fetchBlast(positionId, productId).then(setBlast);
  }, [open, positionId, productId, fetchBlast]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update master grid rate</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{positionLabel}</span>
            {" · "}
            <span className="font-medium text-foreground">{productLabel}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Previous</p>
              <p className="text-lg font-semibold">
                {priorRate === null ? "(none)" : `${Number(priorRate).toFixed(2)}%`}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">New</p>
              <p className="text-lg font-semibold">
                {proposedRate.toFixed(2)}%
                {proposedScheduleCode && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({proposedScheduleCode})
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="eff" className="text-xs uppercase text-muted-foreground">Effective date</label>
            <Input id="eff" type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
          </div>

          <div className="rounded-md border bg-muted/40 p-3">
            {blast === null ? (
              <p className="text-xs text-muted-foreground">Calculating blast radius…</p>
            ) : (
              <div className="space-y-1 text-xs">
                <p>
                  <span className="font-medium">{blast.eligible_agents}</span> agent
                  {blast.eligible_agents === 1 ? "" : "s"} at this position without an override
                  on this product will receive the new rate.
                </p>
                {blast.overridden_agents > 0 && (
                  <p className="text-muted-foreground">
                    {blast.overridden_agents} with an override won't be touched.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={() => onConfirm(effective)} disabled={submitting}>
            {submitting ? "Saving…" : "Confirm and propagate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
