import { useState } from "react";
import type { AgentRateRow } from "@/hooks/useAgentRates";
import { useSetAgentRateOverride } from "@/hooks/useSetAgentRateOverride";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Props = {
  row: AgentRateRow;
  canEdit: boolean;
  onChanged: () => void;
};

export function RateRow({ row, canEdit, onChanged }: Props) {
  const { setOverride, resetToDefault, submitting } = useSetAgentRateOverride();

  const [editing, setEditing] = useState(false);
  const [rateInput, setRateInput] = useState(String(row.rate));
  const [scheduleInput, setScheduleInput] = useState(row.schedule_code ?? "");
  const [error, setError] = useState<string | null>(null);

  const isOverride = row.source === "override";
  const productLabel = row.product_variant
    ? `${row.product_name} (${row.product_variant})`
    : row.product_name;

  function startEdit() {
    setRateInput(String(row.rate));
    setScheduleInput(row.schedule_code ?? "");
    setError(null);
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
    setError(null);
  }
  async function save() {
    const n = Number(rateInput);
    if (Number.isNaN(n)) {
      setError("Rate must be a number.");
      return;
    }
    const result = await setOverride({
      agentId: row.agent_id,
      productId: row.product_id,
      rate: n,
      scheduleCode: scheduleInput.trim() || null,
    });
    if (!result.ok) {
      setError(result.errorMessage);
      return;
    }
    setEditing(false);
    onChanged();
  }
  async function reset() {
    setError(null);
    const result = await resetToDefault({
      agentId: row.agent_id,
      productId: row.product_id,
    });
    if (!result.ok) {
      setError(result.errorMessage);
      return;
    }
    onChanged();
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2 border-b py-2 text-sm last:border-b-0 sm:flex-row sm:items-center">
        <div className="flex-1">
          <span>{productLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max="200"
            value={rateInput}
            onChange={(e) => setRateInput(e.target.value)}
            className="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm"
          />
          <span className="text-muted-foreground">%</span>
          <input
            type="text"
            value={scheduleInput}
            onChange={(e) => setScheduleInput(e.target.value)}
            placeholder="schedule"
            className="h-8 w-28 rounded-md border border-input bg-background px-2 text-sm"
          />
          <Button size="sm" onClick={save} disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="outline" onClick={cancelEdit} disabled={submitting}>
            Cancel
          </Button>
        </div>
        {error && <p className="text-xs text-destructive sm:basis-full">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 border-b py-2 text-sm last:border-b-0 sm:flex-row sm:items-center">
      <div className="flex-1">{productLabel}</div>
      <div className="flex items-center gap-3">
        <span className="font-medium tabular-nums">{Number(row.rate).toFixed(2)}%</span>
        {row.schedule_code && (
          <span className="text-xs text-muted-foreground">({row.schedule_code})</span>
        )}
        {isOverride ? (
          <Badge variant="warning">Override</Badge>
        ) : (
          <Badge variant="muted">Default</Badge>
        )}
        {canEdit && (
          <>
            <Button size="sm" variant="ghost" onClick={startEdit}>
              Edit
            </Button>
            {isOverride && (
              <Button size="sm" variant="ghost" onClick={reset} disabled={submitting}>
                Reset
              </Button>
            )}
          </>
        )}
      </div>
      {error && <p className="text-xs text-destructive sm:basis-full">{error}</p>}
    </div>
  );
}
