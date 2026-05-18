/**
 * Phase 19.2 -- Settings inline section for managing tenant announcements.
 *
 * Owner-only (defensive check; Settings.tsx is responsible for the route-level
 * gate). Mirrors the BroadcastEditor pattern: raw useState, inline validators,
 * no third-party form library (L-4).
 *
 * Trimmed surface vs the original wiki spec:
 *   - Fields: title, body, pinned. No image, no CTA, no targeting, no
 *     scheduling, no status select. Locked in the PR 19.2 brief.
 *   - Edit is inline (not a drawer) per L-5.
 *   - Pin toggle and create/edit both route through upsert_announcement
 *     (D-8 resolution).
 *
 * Realtime is handled by useAnnouncements; this component just reads.
 */

import { useState } from "react";
import { Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAnnouncements, type Announcement } from "@/hooks/useAnnouncements";
import {
  filterAnnouncements,
  type AnnouncementFilter,
} from "@/lib/announcements-filter";
import {
  BODY_MAX,
  TITLE_MAX,
  validateAnnouncementInput,
} from "@/lib/announcements-validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type EditingState = {
  id: string | null;
  title: string;
  body: string;
  pinned: boolean;
};

const EMPTY_EDIT: EditingState = { id: null, title: "", body: "", pinned: false };

function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AnnouncementsManager() {
  const { isOwner } = useAuth();
  const {
    announcements,
    loading,
    submitting,
    refresh,
    post,
    update,
    remove,
    togglePin,
  } = useAnnouncements();

  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Announcement | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Defensive: Settings.tsx tab nav also gates on isOwner, but if this
  // component is ever mounted elsewhere by mistake, render nothing.
  if (!isOwner) return null;

  const filter: AnnouncementFilter = { pinnedOnly, searchTerm };
  const filtered = filterAnnouncements(announcements, filter);

  function startNew() {
    setEditing({ ...EMPTY_EDIT });
    setActionError(null);
  }
  function startEdit(row: Announcement) {
    setEditing({ id: row.id, title: row.title, body: row.body, pinned: row.pinned });
    setActionError(null);
  }
  function cancelEdit() {
    setEditing(null);
    setActionError(null);
  }

  async function handleSave() {
    if (!editing) return;
    const errors = validateAnnouncementInput({ title: editing.title, body: editing.body });
    if (errors.length > 0) {
      setActionError(errors.map((e) => e.message).join(" "));
      return;
    }
    const result = editing.id
      ? await update({
          id: editing.id,
          title: editing.title.trim(),
          body: editing.body,
          pinned: editing.pinned,
        })
      : await post({
          title: editing.title.trim(),
          body: editing.body,
          pinned: editing.pinned,
        });
    if (!result.ok) {
      setActionError(result.errorMessage);
      return;
    }
    setEditing(null);
    setActionError(null);
    void refresh();
  }

  async function handleConfirmDelete() {
    if (!confirmDelete) return;
    const result = await remove(confirmDelete.id);
    if (!result.ok) {
      setActionError(result.errorMessage);
      return;
    }
    setConfirmDelete(null);
    void refresh();
  }

  async function handlePinToggle(row: Announcement) {
    const result = await togglePin(row.id, !row.pinned);
    if (!result.ok) {
      setActionError(result.errorMessage);
      return;
    }
    void refresh();
  }

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Announcements</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Greet your team on login. Pinned announcements sort above unpinned.
          </p>
        </div>
        {!editing && (
          <Button size="sm" onClick={startNew}>
            <Plus className="mr-1.5 h-4 w-4" />
            New announcement
          </Button>
        )}
      </header>

      {actionError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/[0.05] p-3 text-sm text-destructive">
          {actionError}
        </p>
      )}

      {editing ? (
        <EditForm
          editing={editing}
          setEditing={setEditing}
          submitting={submitting}
          onSave={handleSave}
          onCancel={cancelEdit}
        />
      ) : (
        <>
          <FilterRow
            pinnedOnly={pinnedOnly}
            setPinnedOnly={setPinnedOnly}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
          />
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : announcements.length === 0 ? (
            <EmptyState onStart={startNew} />
          ) : filtered.length === 0 ? (
            <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm text-muted-foreground">
              No announcements match the current filters.
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.04] overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
              {filtered.map((a) => (
                <Row
                  key={a.id}
                  row={a}
                  onTogglePin={() => void handlePinToggle(a)}
                  onEdit={() => startEdit(a)}
                  onDelete={() => setConfirmDelete(a)}
                />
              ))}
            </ul>
          )}
        </>
      )}

      <ConfirmDeleteDialog
        target={confirmDelete}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </section>
  );
}

function FilterRow({
  pinnedOnly,
  setPinnedOnly,
  searchTerm,
  setSearchTerm,
}: {
  pinnedOnly: boolean;
  setPinnedOnly: (v: boolean) => void;
  searchTerm: string;
  setSearchTerm: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Input
        placeholder="Search by title..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="h-9 border-white/10 bg-white/[0.03] sm:max-w-xs"
      />
      <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
        <input
          type="checkbox"
          checked={pinnedOnly}
          onChange={(e) => setPinnedOnly(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-white/20 bg-white/[0.03] accent-primary"
        />
        Pinned only
      </label>
    </div>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
      <p className="text-sm font-medium text-foreground">No announcements yet.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Post one to greet your team on login.
      </p>
      <Button size="sm" onClick={onStart} className="mt-4">
        <Plus className="mr-1.5 h-4 w-4" />
        New announcement
      </Button>
    </div>
  );
}

function Row({
  row,
  onTogglePin,
  onEdit,
  onDelete,
}: {
  row: Announcement;
  onTogglePin: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // Author + timestamp line. We do not resolve user IDs to names here; PR 19.2
  // intentionally keeps the surface narrow. Use updated_at when present, else
  // created_at, so the row reflects the latest change.
  const stampIso = row.updated_at && row.updated_at !== row.created_at ? row.updated_at : row.created_at;
  const stampLabel = row.updated_at && row.updated_at !== row.created_at ? "Updated" : "Posted";

  return (
    <li className="flex items-start gap-3 p-4">
      <button
        type="button"
        onClick={onTogglePin}
        aria-label={row.pinned ? "Unpin announcement" : "Pin announcement"}
        title={row.pinned ? "Unpin" : "Pin"}
        className={cn(
          "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors",
          row.pinned
            ? "border-primary/40 bg-primary/15 text-primary hover:bg-primary/25"
            : "border-white/10 bg-white/[0.02] text-muted-foreground hover:text-foreground",
        )}
      >
        {row.pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-shadow-soft">{row.title}</p>
        {row.body && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{row.body}</p>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          {stampLabel} {fmtTimestamp(stampIso)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit announcement"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete announcement"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/[0.15] hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

function EditForm({
  editing,
  setEditing,
  submitting,
  onSave,
  onCancel,
}: {
  editing: EditingState;
  setEditing: (e: EditingState) => void;
  submitting: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const titleRemaining = TITLE_MAX - editing.title.trim().length;
  const bodyRemaining = BODY_MAX - editing.body.length;
  const isEdit = editing.id !== null;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave(); }}
      className="space-y-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
    >
      <div>
        <h4 className="text-sm font-semibold tracking-tight">
          {isEdit ? "Edit announcement" : "New announcement"}
        </h4>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Visible to everyone in this tenant on the home page until removed.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="ann-title">Title</Label>
          <span
            className={cn(
              "text-[11px]",
              titleRemaining < 0 ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {titleRemaining} left
          </span>
        </div>
        <Input
          id="ann-title"
          value={editing.title}
          onChange={(e) => setEditing({ ...editing, title: e.target.value })}
          required
          maxLength={TITLE_MAX + 10}
          placeholder="Vegas conference registration opens Friday"
          className="h-10 border-white/10 bg-white/[0.03] focus-visible:ring-primary"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="ann-body">Body</Label>
          <span
            className={cn(
              "text-[11px]",
              bodyRemaining < 0 ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {bodyRemaining} left
          </span>
        </div>
        <textarea
          id="ann-body"
          value={editing.body}
          onChange={(e) => setEditing({ ...editing, body: e.target.value })}
          rows={5}
          maxLength={BODY_MAX + 100}
          placeholder="Optional context. Plain text, no formatting."
          className="block w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>

      <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={editing.pinned}
          onChange={(e) => setEditing({ ...editing, pinned: e.target.checked })}
          className="h-4 w-4 rounded border-white/20 bg-white/[0.03] accent-primary"
        />
        <span className="text-foreground">Pin to top</span>
        <span className="text-xs text-muted-foreground">
          Pinned announcements sort above unpinned in the home page card.
        </span>
      </label>

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : isEdit ? "Save changes" : "Post announcement"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ConfirmDeleteDialog({
  target,
  onConfirm,
  onCancel,
}: {
  target: Announcement | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>Delete this announcement?</DialogTitle>
        <DialogDescription>
          {target ? `"${target.title}" will be removed from the home page immediately.` : ""}
        </DialogDescription>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
