import { useState, type FormEvent } from "react";
import { useBroadcasts, type Broadcast } from "@/hooks/useBroadcasts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, Eye } from "lucide-react";

type FormState = {
  id: string | null;
  title: string;
  body: string;
  image_url: string;
  cta_text: string;
  cta_url: string;
  end_at: string;
  is_active: boolean;
};

const EMPTY: FormState = {
  id: null,
  title: "",
  body: "",
  image_url: "",
  cta_text: "",
  cta_url: "",
  end_at: "",
  is_active: true,
};

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  // datetime-local expects "YYYY-MM-DDTHH:mm"
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Inline preview that mirrors the layout of BroadcastBanner so the owner can
 * see exactly what agents will see before publishing.
 */
function BroadcastPreview({ form }: { form: FormState }) {
  const showAny = form.title.trim() || form.body.trim() || form.image_url.trim();
  if (!showAny) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-muted-foreground">
        Preview appears here as you type.
      </div>
    );
  }
  return (
    <div className="relative overflow-hidden rounded-2xl glass">
      <div aria-hidden className="pointer-events-none absolute inset-0 gradient-rim" />
      <div className="relative flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
        {form.image_url && (
          <img
            src={form.image_url}
            alt=""
            className="h-20 w-20 shrink-0 rounded-xl border border-white/10 object-cover shadow-lg sm:h-24 sm:w-24"
          />
        )}
        <div className="flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Broadcast</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-shadow-hero">
            {form.title || "Untitled broadcast"}
          </h2>
          {form.body && (
            <p className="mt-1.5 text-sm text-muted-foreground">{form.body}</p>
          )}
        </div>
        {form.cta_url && form.cta_text && (
          <Button
            disabled
            className="border border-primary/40 bg-primary/90 text-primary-foreground shadow-[0_0_24px_hsl(38_92%_60%/0.35)]"
          >
            {form.cta_text}
          </Button>
        )}
      </div>
    </div>
  );
}

function fromBroadcast(b: Broadcast): FormState {
  return {
    id: b.id,
    title: b.title,
    body: b.body ?? "",
    image_url: b.image_url ?? "",
    cta_text: b.cta_text ?? "",
    cta_url: b.cta_url ?? "",
    end_at: toDatetimeLocal(b.end_at),
    is_active: b.is_active,
  };
}

export function BroadcastEditor() {
  const { broadcasts, loading, submitting, upsert, remove } = useBroadcasts();
  const [editing, setEditing] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  function startNew() { setError(null); setEditing(EMPTY); }
  function startEdit(b: Broadcast) { setError(null); setEditing(fromBroadcast(b)); }
  function cancel() { setError(null); setEditing(null); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    const res = await upsert({
      id: editing.id,
      title: editing.title.trim(),
      body: editing.body.trim() || null,
      image_url: editing.image_url.trim() || null,
      cta_text: editing.cta_text.trim() || null,
      cta_url: editing.cta_url.trim() || null,
      end_at: editing.end_at ? new Date(editing.end_at).toISOString() : null,
      is_active: editing.is_active,
    });
    if (!res.ok) { setError(res.errorMessage); return; }
    setEditing(null);
  }

  async function handleDelete(id: string) {
    const ok = window.confirm("Delete this broadcast? This cannot be undone.");
    if (!ok) return;
    const res = await remove(id);
    if (!res.ok) setError(res.errorMessage);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Leadership broadcasts</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Single hero banner shown on /home. Most recent active broadcast wins.
          </p>
        </div>
        {!editing && (
          <Button size="sm" onClick={startNew}>
            <Plus className="mr-1.5 h-4 w-4" /> New broadcast
          </Button>
        )}
      </div>

      {/* List */}
      {!editing && (
        loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : broadcasts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-muted-foreground">
            No broadcasts yet. Click "New broadcast" to publish your first.
          </div>
        ) : (
          <div className="space-y-2">
            {broadcasts.map((b) => (
              <div key={b.id} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{b.title}</p>
                    {b.is_active ? (
                      <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
                        Active
                      </span>
                    ) : (
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Paused
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {fmtDate(b.start_at)}
                    {b.end_at ? ` → ${fmtDate(b.end_at)}` : " · no end date"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(b)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                  aria-label="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(b.id)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )
      )}

      {/* Editor form */}
      {editing && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
            <Eye className="h-3.5 w-3.5" />
            Live preview
          </div>
          <BroadcastPreview form={editing} />

          <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="space-y-2">
              <Label htmlFor="b-title">Title <span className="text-destructive">*</span></Label>
              <Input
                id="b-title"
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                required
                placeholder="Vegas conference registration is OPEN"
                className="border-white/10 bg-white/[0.03]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-body">Body</Label>
              <textarea
                id="b-body"
                value={editing.body}
                onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                rows={3}
                placeholder="Book your seat for the annual summit. Limited to 200 agents."
                className="flex w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="b-cta-text">CTA label</Label>
                <Input
                  id="b-cta-text"
                  value={editing.cta_text}
                  onChange={(e) => setEditing({ ...editing, cta_text: e.target.value })}
                  placeholder="Register now"
                  className="border-white/10 bg-white/[0.03]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="b-cta-url">CTA URL</Label>
                <Input
                  id="b-cta-url"
                  type="url"
                  value={editing.cta_url}
                  onChange={(e) => setEditing({ ...editing, cta_url: e.target.value })}
                  placeholder="https://baseshophq.com/..."
                  className="border-white/10 bg-white/[0.03]"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-image">Image URL (optional)</Label>
              <Input
                id="b-image"
                type="url"
                value={editing.image_url}
                onChange={(e) => setEditing({ ...editing, image_url: e.target.value })}
                placeholder="https://..."
                className="border-white/10 bg-white/[0.03]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="b-end">End date (optional)</Label>
                <Input
                  id="b-end"
                  type="datetime-local"
                  value={editing.end_at}
                  onChange={(e) => setEditing({ ...editing, end_at: e.target.value })}
                  className="border-white/10 bg-white/[0.03]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="b-active" className="block">Status</Label>
                <label className="flex h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 text-sm">
                  <input
                    id="b-active"
                    type="checkbox"
                    checked={editing.is_active}
                    onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
                    className="h-4 w-4 accent-primary"
                  />
                  <span>Active</span>
                </label>
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={cancel}>Cancel</Button>
              <Button type="submit" disabled={submitting || !editing.title.trim()}>
                {submitting ? "Saving…" : editing.id ? "Save changes" : "Publish broadcast"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
