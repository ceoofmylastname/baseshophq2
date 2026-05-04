/**
 * Bulk-edit dialog for one product across all positions.
 *
 * STOP-ON-FIRST-FAILURE UX (per Phase 8 build decision): if cell N of M fails,
 * the loop halts and the summary modal shows {committed: N-1, failed: 1,
 * remaining: M-N}. Lower-risk than continue-and-collect because the owner
 * sees the exact stop point and can manually reconcile.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GridPosition, GridRate } from "@/hooks/useMasterGrid";
import { useSetMasterGridRate } from "@/hooks/useSetMasterGridRate";
import { useMasterGridBlastRadius } from "@/hooks/useMasterGridBlastRadius";

type Mode = "flat" | "scale";

type Props = {
  open: boolean;
  onClose: () => void;
  productId: string;
  productLabel: string;
  positions: GridPosition[];
  rates: GridRate[];
  onAllCommitted: () => void;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export function SetColumnDialog({
  open, onClose, productId, productLabel, positions, rates, onAllCommitted,
}: Props) {
  const { setRate } = useSetMasterGridRate();
  const { fetchBlast } = useMasterGridBlastRadius();

  const [mode, setMode] = useState<Mode>("flat");
  const [valueInput, setValueInput] = useState("");
  const [effective, setEffective] = useState(todayIso());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stoppedAt, setStoppedAt] = useState<{ idx: number; msg: string } | null>(null);
  const [committedCount, setCommittedCount] = useState(0);
  const [cumulativeBlast, setCumulativeBlast] = useState<number | null>(null);

  const eligiblePositions = useMemo(
    () => positions.filter((p) => p.is_commissioned),
    [positions],
  );

  const previewRows = useMemo(() => {
    if (valueInput === "") return [];
    const n = Number(valueInput);
    if (Number.isNaN(n)) return [];
    return eligiblePositions.map((p) => {
      const r = rates.find((x) => x.position_id === p.id && x.product_id === productId);
      const prior = r ? Number(r.commission_pct) : null;
      let next: number;
      if (mode === "flat") next = n;
      else next = prior === null ? n : Math.max(0, Math.min(200, prior * (1 + n / 100)));
      return { position: p, prior, next: Number(next.toFixed(2)) };
    });
  }, [valueInput, mode, eligiblePositions, rates, productId]);

  // Cumulative blast radius across all eligible positions
  useEffect(() => {
    if (!open || eligiblePositions.length === 0) return;
    let cancelled = false;
    (async () => {
      const counts = await Promise.all(
        eligiblePositions.map((p) => fetchBlast(p.id, productId)),
      );
      if (cancelled) return;
      const total = counts.reduce((sum, c) => sum + (c?.eligible_agents ?? 0), 0);
      setCumulativeBlast(total);
    })();
    return () => { cancelled = true; };
  }, [open, eligiblePositions, productId, fetchBlast]);

  function reset() {
    setMode("flat");
    setValueInput("");
    setEffective(todayIso());
    setRunning(false);
    setProgress(0);
    setStoppedAt(null);
    setCommittedCount(0);
  }

  function handleClose() {
    onClose();
    setTimeout(reset, 150);
  }

  async function handleApply() {
    setRunning(true);
    setStoppedAt(null);
    setCommittedCount(0);
    for (let i = 0; i < previewRows.length; i++) {
      const row = previewRows[i];
      const result = await setRate({
        positionId: row.position.id,
        productId,
        newRate: row.next,
        scheduleCode: null,
        effective,
      });
      if (!result.ok) {
        setStoppedAt({ idx: i, msg: result.errorMessage });
        setRunning(false);
        return;
      }
      setCommittedCount(i + 1);
      setProgress((i + 1) / previewRows.length);
    }
    setRunning(false);
    onAllCommitted();
    handleClose();
  }

  const valid = valueInput !== "" && !Number.isNaN(Number(valueInput));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Set column · {productLabel}</DialogTitle>
          <DialogDescription>
            Apply a single change across all {eligiblePositions.length} commissioned positions.
            Stops on the first failure (no rollback of prior committed cells).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <fieldset className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === "flat"} onChange={() => setMode("flat")} />
              Flat: every position to
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === "scale"} onChange={() => setMode("scale")} />
              Scale: increase/decrease by
            </label>
          </fieldset>

          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="0.01"
              value={valueInput}
              onChange={(e) => setValueInput(e.target.value)}
              className="w-24"
              placeholder={mode === "flat" ? "e.g. 100" : "e.g. 5 (=+5%)"}
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase text-muted-foreground">Effective date</label>
            <Input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
          </div>

          {valid && (
            <div className="max-h-48 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="text-left uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1">Position</th>
                    <th className="px-2 py-1 text-right">Prior</th>
                    <th className="px-2 py-1 text-right">New</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r) => (
                    <tr key={r.position.id} className="border-t">
                      <td className="px-2 py-1">
                        <span className="font-mono text-muted-foreground">{r.position.position_code}</span>{" "}
                        {r.position.position_name}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                        {r.prior === null ? "—" : `${r.prior.toFixed(2)}%`}
                      </td>
                      <td className="px-2 py-1 text-right font-medium tabular-nums">
                        {r.next.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="rounded-md border bg-muted/40 p-3 text-xs">
            <p>
              {previewRows.length} cell{previewRows.length === 1 ? "" : "s"} will update.
              {cumulativeBlast !== null && (
                <>
                  {" "}Cumulative blast: <span className="font-medium">{cumulativeBlast}</span> agent
                  -position pairs without overrides will receive new rates.
                </>
              )}
            </p>
          </div>

          {running && (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                Committing… {committedCount} / {previewRows.length}
              </p>
            </div>
          )}

          {stoppedAt && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
              <p className="font-medium text-destructive">Stopped at position {stoppedAt.idx + 1} of {previewRows.length}.</p>
              <p className="mt-1">{stoppedAt.msg}</p>
              <p className="mt-1 text-muted-foreground">
                Committed: {committedCount}. Remaining: {previewRows.length - committedCount - 1}.
                Prior cells were NOT rolled back.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={running}>
            {stoppedAt ? "Close" : "Cancel"}
          </Button>
          {!stoppedAt && (
            <Button onClick={handleApply} disabled={!valid || running}>
              {running ? "Applying…" : `Apply to ${previewRows.length} cells`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
