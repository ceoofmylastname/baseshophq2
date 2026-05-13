import { useState, type FormEvent } from "react";
import {
  usePositionsManagement, type ManagedPosition, type PositionInput,
} from "@/hooks/usePositionsManagement";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Archive, RotateCcw, Check, X } from "lucide-react";

type NewFormState = PositionInput;

const EMPTY_NEW: NewFormState = {
  position_code: "",
  position_name: "",
  sort_order: 50,
  is_commissioned: true,
};

/**
 * Owner-only editor for the position ladder (comp_grid_positions).
 *
 * Operations:
 *   - Add new rung (code is locked once created; name and sort order are editable)
 *   - Inline rename
 *   - Inline reorder via sort_order numeric input
 *   - Toggle is_commissioned
 *   - Archive (soft delete; sets is_active=false). Hard delete deliberately
 *     not exposed because agent_positions and comp_grid_rates FK to
 *     comp_grid_positions. Archived rungs are hidden from agent assignment
 *     pickers but kept in the database so historical commission rows still
 *     resolve correctly.
 *   - Restore (un-archive)
 *
 * Editing is row-inline (click pencil, fields become inputs, save or cancel).
 * Keeps the page from ballooning into a modal-heavy flow.
 */
export function PositionEditor() {
  const { positions, loading, submitting, add, update, archive, restore } = usePositionsManagement();

  const [adding, setAdding] = useState(false);
  const [newForm, setNewForm] = useState<NewFormState>(EMPTY_NEW);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSort, setEditSort] = useState<number>(0);
  const [editCommissioned, setEditCommissioned] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  function startNew() {
    setError(null);
    setAdding(true);
    setNewForm(EMPTY_NEW);
  }
  function cancelNew() {
    setError(null);
    setAdding(false);
  }

  function startEdit(p: ManagedPosition) {
    setError(null);
    setEditingId(p.id);
    setEditName(p.position_name);
    setEditSort(p.sort_order);
    setEditCommissioned(p.is_commissioned);
  }
  function cancelEdit() {
    setError(null);
    setEditingId(null);
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await add(newForm);
    if (!res.ok) { setError(res.errorMessage); return; }
    setAdding(false);
    setNewForm(EMPTY_NEW);
  }

  async function handleSaveEdit(id: string) {
    setError(null);
    const res = await update(id, {
      position_name:   editName,
      sort_order:      editSort,
      is_commissioned: editCommissioned,
    });
    if (!res.ok) { setError(res.errorMessage); return; }
    setEditingId(null);
  }

  async function handleArchive(p: ManagedPosition) {
    const ok = window.confirm(
      `Archive position "${p.position_name}"? Existing agent assignments and historical commissions stay intact, but no new agents can be assigned to this rung. You can restore it anytime.`,
    );
    if (!ok) return;
    const res = await archive(p.id);
    if (!res.ok) setError(res.errorMessage);
  }

  async function handleRestore(p: ManagedPosition) {
    const res = await restore(p.id);
    if (!res.ok) setError(res.errorMessage);
  }

  const activeCount = positions.filter((p) => p.is_active).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Position ladder</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {activeCount} active rung{activeCount === 1 ? "" : "s"}. Sort order descending — highest rank on top.
            Code is locked once created; name and sort order are editable.
          </p>
        </div>
        {!adding && (
          <Button size="sm" onClick={startNew}>
            <Plus className="mr-1.5 h-4 w-4" /> New position
          </Button>
        )}
      </div>

      {/* New position form */}
      {adding && (
        <form onSubmit={handleAdd} className="space-y-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="np-code">Code <span className="text-destructive">*</span></Label>
              <Input
                id="np-code"
                value={newForm.position_code}
                onChange={(e) => setNewForm({ ...newForm, position_code: e.target.value })}
                placeholder="MASTER"
                required
                className="border-white/10 bg-white/[0.03] uppercase"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="np-name">Name <span className="text-destructive">*</span></Label>
              <Input
                id="np-name"
                value={newForm.position_name}
                onChange={(e) => setNewForm({ ...newForm, position_name: e.target.value })}
                placeholder="Master Agent"
                required
                className="border-white/10 bg-white/[0.03]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-sort">Sort order</Label>
              <Input
                id="np-sort"
                type="number"
                value={newForm.sort_order}
                onChange={(e) => setNewForm({ ...newForm, sort_order: Number(e.target.value) || 0 })}
                className="border-white/10 bg-white/[0.03]"
              />
            </div>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newForm.is_commissioned}
                onChange={(e) => setNewForm({ ...newForm, is_commissioned: e.target.checked })}
                className="h-4 w-4 accent-primary"
              />
              <span>Commissioned (uncheck for admin / non-producing roles)</span>
            </label>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={cancelNew}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Add position"}
            </Button>
          </div>
        </form>
      )}

      {/* List */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : positions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-muted-foreground">
          No positions yet. Click "New position" to seed your first rung.
        </div>
      ) : (
        <div className="space-y-2">
          {positions.map((p) => {
            const isEditing = editingId === p.id;
            return (
              <div
                key={p.id}
                className={
                  p.is_active
                    ? "rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
                    : "rounded-lg border border-white/[0.04] bg-white/[0.01] p-3 opacity-60"
                }
              >
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Code</Label>
                        <div className="flex h-10 items-center rounded-md border border-white/10 bg-white/[0.01] px-3 text-sm text-muted-foreground">
                          {p.position_code}
                        </div>
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label htmlFor={`edit-name-${p.id}`} className="text-[10px] uppercase tracking-wider text-muted-foreground">Name</Label>
                        <Input
                          id={`edit-name-${p.id}`}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="border-white/10 bg-white/[0.03]"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`edit-sort-${p.id}`} className="text-[10px] uppercase tracking-wider text-muted-foreground">Sort</Label>
                        <Input
                          id={`edit-sort-${p.id}`}
                          type="number"
                          value={editSort}
                          onChange={(e) => setEditSort(Number(e.target.value) || 0)}
                          className="border-white/10 bg-white/[0.03]"
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editCommissioned}
                        onChange={(e) => setEditCommissioned(e.target.checked)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span>Commissioned</span>
                    </label>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                        aria-label="Cancel edit"
                      >
                        <X className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSaveEdit(p.id)}
                        disabled={submitting}
                        className="rounded-md p-1.5 text-primary hover:bg-primary/10"
                        aria-label="Save edit"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{p.position_name}</p>
                        <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {p.position_code}
                        </span>
                        {!p.is_active && (
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Archived
                          </span>
                        )}
                        {!p.is_commissioned && p.is_active && (
                          <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Non-comm
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Sort order {p.sort_order} · {p.is_commissioned ? "Earns commission" : "Admin role (no commission)"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => startEdit(p)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                      aria-label="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {p.is_active ? (
                      <button
                        type="button"
                        onClick={() => void handleArchive(p)}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        aria-label="Archive"
                      >
                        <Archive className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleRestore(p)}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-300"
                        aria-label="Restore"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && !adding && editingId === null && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
