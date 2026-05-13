import { useMemo, useState, type FormEvent } from "react";
import { useCompGridPositions, type GridPosition } from "@/hooks/useCompGridPositions";
import { usePromotionTargets, type PromotionTarget } from "@/hooks/usePromotionTargets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, ArrowRight } from "lucide-react";

type FormState = {
  from_position_id: string;
  to_position_id: string;
  min_premium_last_3_months: string;
  min_personal_policies: string;
  min_active_downline_count: string;
};

const EMPTY: FormState = {
  from_position_id: "",
  to_position_id: "",
  min_premium_last_3_months: "",
  min_personal_policies: "",
  min_active_downline_count: "",
};

function fmtPosition(p?: GridPosition): string {
  if (!p) return "—";
  return `${p.position_name} (${p.position_code})`;
}

export function PromotionTargetEditor() {
  const { positions, loading: positionsLoading } = useCompGridPositions();
  const { targets, loading, submitting, upsert, remove } = usePromotionTargets();

  const [editing, setEditing] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const positionById = useMemo(() => {
    const m = new Map<string, GridPosition>();
    positions.forEach((p) => m.set(p.id, p));
    return m;
  }, [positions]);

  // For NEW targets only, hide from_positions that already have a target —
  // the DB enforces UNIQUE(tenant_id, from_position_id), so showing them as
  // options would just produce an upsert that overwrites silently. Better
  // to force the owner to click Edit on the existing one.
  const availableFromPositions = useMemo(() => {
    if (editingId) return positions; // editing existing: keep current selection visible
    const taken = new Set(targets.map((t) => t.from_position_id));
    return positions.filter((p) => !taken.has(p.id));
  }, [positions, targets, editingId]);

  function startNew() {
    setError(null);
    setEditingId(null);
    setEditing(EMPTY);
  }

  function startEdit(t: PromotionTarget) {
    setError(null);
    setEditingId(t.id);
    setEditing({
      from_position_id: t.from_position_id,
      to_position_id:   t.to_position_id,
      min_premium_last_3_months: t.criteria.min_premium_last_3_months?.toString() ?? "",
      min_personal_policies:     t.criteria.min_personal_policies?.toString() ?? "",
      min_active_downline_count: t.criteria.min_active_downline_count?.toString() ?? "",
    });
  }

  function cancel() {
    setError(null);
    setEditingId(null);
    setEditing(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (!editing.from_position_id || !editing.to_position_id) {
      setError("Select both positions.");
      return;
    }
    if (editing.from_position_id === editing.to_position_id) {
      setError("From and To positions must differ.");
      return;
    }

    const criteria: Record<string, number> = {};
    const tryNum = (k: keyof FormState, target: string) => {
      const raw = editing[k] as string;
      if (raw === "") return;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) throw new Error(`${target} must be a non-negative number.`);
      criteria[target] = n;
    };

    try {
      tryNum("min_premium_last_3_months", "min_premium_last_3_months");
      tryNum("min_personal_policies",     "min_personal_policies");
      tryNum("min_active_downline_count", "min_active_downline_count");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid criteria value.");
      return;
    }

    if (Object.keys(criteria).length === 0) {
      setError("Set at least one criterion (otherwise the gauge has nothing to show).");
      return;
    }

    setError(null);
    const res = await upsert({
      from_position_id: editing.from_position_id,
      to_position_id:   editing.to_position_id,
      criteria,
    });
    if (!res.ok) { setError(res.errorMessage); return; }
    cancel();
  }

  async function handleDelete(id: string) {
    const ok = window.confirm("Delete this promotion target? Agents at this position will lose their next-rung gauge.");
    if (!ok) return;
    const res = await remove(id);
    if (!res.ok) setError(res.errorMessage);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Promotion ladder</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Criteria for moving from one position to the next. Powers the hero card gauge on /home.
          </p>
        </div>
        {!editing && availableFromPositions.length > 0 && (
          <Button size="sm" onClick={startNew}>
            <Plus className="mr-1.5 h-4 w-4" /> New rung
          </Button>
        )}
      </div>

      {!editing && (
        loading || positionsLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : targets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-muted-foreground">
            No promotion targets configured. Add one to surface a next-rung gauge on agents&apos; home pages.
          </div>
        ) : (
          <div className="space-y-2">
            {targets.map((t) => {
              const from = positionById.get(t.from_position_id);
              const to   = positionById.get(t.to_position_id);
              const c = t.criteria;
              return (
                <div key={t.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex flex-1 items-center gap-2 text-sm font-medium">
                      <span>{fmtPosition(from)}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{fmtPosition(to)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => startEdit(t)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                      aria-label="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(t.id)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    {c.min_premium_last_3_months != null && (
                      <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5">
                        Premium 3mo ≥ ${Number(c.min_premium_last_3_months).toLocaleString()}
                      </span>
                    )}
                    {c.min_personal_policies != null && (
                      <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5">
                        Personal policies ≥ {c.min_personal_policies}
                      </span>
                    )}
                    {c.min_active_downline_count != null && (
                      <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5">
                        Active downline ≥ {c.min_active_downline_count}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {editing && (
        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pt-from">From position</Label>
              <select
                id="pt-from"
                value={editing.from_position_id}
                onChange={(e) => setEditing({ ...editing, from_position_id: e.target.value })}
                disabled={!!editingId}
                className="flex h-10 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="">Select…</option>
                {availableFromPositions.map((p) => (
                  <option key={p.id} value={p.id}>{fmtPosition(p)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pt-to">To position</Label>
              <select
                id="pt-to"
                value={editing.to_position_id}
                onChange={(e) => setEditing({ ...editing, to_position_id: e.target.value })}
                className="flex h-10 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
              >
                <option value="">Select…</option>
                {positions
                  .filter((p) => p.id !== editing.from_position_id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>{fmtPosition(p)}</option>
                  ))}
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Criteria (at least one required, all set must be met)
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pt-prem">Premium (3 mo)</Label>
                <Input
                  id="pt-prem"
                  type="number"
                  min={0}
                  inputMode="decimal"
                  placeholder="50000"
                  value={editing.min_premium_last_3_months}
                  onChange={(e) => setEditing({ ...editing, min_premium_last_3_months: e.target.value })}
                  className="border-white/10 bg-white/[0.03]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pt-pol">Personal policies</Label>
                <Input
                  id="pt-pol"
                  type="number"
                  min={0}
                  placeholder="12"
                  value={editing.min_personal_policies}
                  onChange={(e) => setEditing({ ...editing, min_personal_policies: e.target.value })}
                  className="border-white/10 bg-white/[0.03]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pt-dl">Active downline</Label>
                <Input
                  id="pt-dl"
                  type="number"
                  min={0}
                  placeholder="3"
                  value={editing.min_active_downline_count}
                  onChange={(e) => setEditing({ ...editing, min_active_downline_count: e.target.value })}
                  className="border-white/10 bg-white/[0.03]"
                />
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={cancel}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : editingId ? "Save changes" : "Add rung"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
