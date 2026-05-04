import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAnnualGoal } from "@/hooks/useAnnualGoal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

type Props = { progressAmount: number };  // bookedPremium + realizedPremium

export function AnnualGoalProgress({ progressAmount }: Props) {
  const { isOwner } = useAuth();
  const { goal, setAnnualGoal } = useAnnualGoal();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const goalNum = goal ?? 1000000;
  const pct = goalNum > 0 ? Math.min(100, Math.round((progressAmount / goalNum) * 100)) : 0;

  function startEdit() {
    setInput(String(goalNum));
    setError(null);
    setEditing(true);
  }
  async function save() {
    setSaving(true);
    const n = Number(input);
    const r = await setAnnualGoal(n);
    setSaving(false);
    if (!r.ok) { setError(r.errorMessage); return; }
    setEditing(false);
  }

  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Annual goal progress</h3>
        {!editing && isOwner && (
          <button onClick={startEdit} className="text-xs text-primary hover:underline">
            Edit goal
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">$</span>
          <Input
            type="number" min="0" step="1000" value={input}
            onChange={(e) => setInput(e.target.value)} className="h-8 max-w-[180px]"
          />
          <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-baseline justify-between text-sm">
            <span className="font-medium">{fmtMoney(progressAmount)}</span>
            <span className="text-muted-foreground">of {fmtMoney(goalNum)}</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{pct}%</p>
        </>
      )}
    </div>
  );
}
