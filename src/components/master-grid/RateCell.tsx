import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSetMasterGridRate } from "@/hooks/useSetMasterGridRate";
import { EditCellModal } from "./EditCellModal";

type Props = {
  positionId: string;
  positionLabel: string;
  productId: string;
  productLabel: string;
  currentRate: number | null;          // null = no rate set
  currentScheduleCode: string | null;
  isCommissioned: boolean;
  onCommitted: () => void;
};

/**
 * Cell state machine: idle → editing → confirming → committing → idle.
 * Optimistic UI: cell shows new value while RPC runs; rolls back on failure.
 */
export function RateCell({
  positionId, positionLabel,
  productId, productLabel,
  currentRate, currentScheduleCode,
  isCommissioned, onCommitted,
}: Props) {
  const { setRate, submitting } = useSetMasterGridRate();
  const [editing, setEditing] = useState(false);
  const [rateInput, setRateInput] = useState(
    currentRate === null ? "" : currentRate.toFixed(2),
  );
  const [scheduleInput, setScheduleInput] = useState(currentScheduleCode ?? "");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<number | null>(null);

  if (!isCommissioned) {
    return (
      <div className="flex h-9 w-full items-center justify-center text-xs text-muted-foreground">
        —
      </div>
    );
  }

  const display = optimistic ?? currentRate;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setRateInput(currentRate === null ? "" : currentRate.toFixed(2));
          setScheduleInput(currentScheduleCode ?? "");
          setError(null);
          setEditing(true);
        }}
        className="flex h-9 w-full items-center justify-center rounded text-sm tabular-nums hover:bg-accent"
        title={
          currentScheduleCode
            ? `${positionLabel} · ${productLabel}\n${display ?? "—"}% (${currentScheduleCode})\nClick to edit`
            : `${positionLabel} · ${productLabel}\n${display ?? "—"}%\nClick to edit`
        }
      >
        {display === null ? <span className="text-muted-foreground">—</span> : `${Number(display).toFixed(2)}%`}
        {optimistic !== null && submitting && (
          <span className="ml-1 text-xs text-muted-foreground">…</span>
        )}
      </button>
    );
  }

  function openConfirm() {
    const n = Number(rateInput);
    if (rateInput === "" || Number.isNaN(n)) {
      setError("Rate must be a number.");
      return;
    }
    if (n < 0 || n > 200) {
      setError("Rate must be between 0 and 200.");
      return;
    }
    setError(null);
    setConfirming(true);
  }

  async function handleConfirm(effective: string) {
    const n = Number(rateInput);
    setOptimistic(n);
    const result = await setRate({
      positionId,
      productId,
      newRate: n,
      scheduleCode: scheduleInput.trim() || null,
      effective,
    });
    setConfirming(false);
    if (!result.ok) {
      setOptimistic(null);
      setError(result.errorMessage);
      return;
    }
    setEditing(false);
    setOptimistic(null);
    onCommitted();
  }

  return (
    <>
      <div className="flex flex-col gap-1 p-1">
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          max="200"
          value={rateInput}
          onChange={(e) => setRateInput(e.target.value)}
          autoFocus
          className="h-7 w-full rounded border border-input bg-background px-1 text-xs tabular-nums"
        />
        <input
          type="text"
          value={scheduleInput}
          onChange={(e) => setScheduleInput(e.target.value)}
          placeholder="schedule"
          className="h-6 w-full rounded border border-input bg-background px-1 text-[10px]"
        />
        <div className="flex gap-1">
          <Button size="sm" className="h-6 px-2 text-xs" onClick={openConfirm}>Save</Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={() => { setEditing(false); setError(null); }}
          >
            ✕
          </Button>
        </div>
        {error && <p className="text-[10px] text-destructive">{error}</p>}
      </div>

      <EditCellModal
        open={confirming}
        onClose={() => setConfirming(false)}
        positionId={positionId}
        positionLabel={positionLabel}
        productId={productId}
        productLabel={productLabel}
        priorRate={currentRate}
        proposedRate={Number(rateInput)}
        proposedScheduleCode={scheduleInput.trim() || null}
        onConfirm={handleConfirm}
        submitting={submitting}
      />
    </>
  );
}
