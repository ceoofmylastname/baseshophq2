/**
 * Phase 19.3 -- Dashboard Announcements card, read-only.
 *
 * Authoring lives in Settings -> Announcements (AnnouncementsManager). The
 * inline Post button + PostAnnouncementDialog are retired in this PR.
 *
 * Behavior:
 *   - Card disappears entirely when there are no announcements (early
 *     return null, not an empty-state placeholder).
 *   - Owner-only pin / unpin / delete actions remain on each row, routed
 *     through useAnnouncements (which writes via upsert_announcement and
 *     delete_announcement under owner-gated RLS).
 *   - Realtime refresh continues to fire via useAnnouncements's
 *     postgres_changes subscription on the announcements table.
 */

import { Pin, PinOff, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { Button } from "@/components/ui/button";

export function AnnouncementsList() {
  const { isOwner } = useAuth();
  const { announcements, remove, togglePin } = useAnnouncements();

  if (announcements.length === 0) return null;

  return (
    <div className="rounded-md border bg-card p-4">
      <h3 className="text-sm font-semibold">Announcements</h3>
      <ul className="mt-3 space-y-3">
        {announcements.map((a) => (
          <li key={a.id} className="rounded-md border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {a.pinned && <Pin className="h-3 w-3 text-amber-600" />}
                  <span className="text-sm font-medium">{a.title}</span>
                </div>
                {a.body && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{a.body}</p>}
                <p className="text-[10px] text-muted-foreground">
                  {new Date(a.created_at).toLocaleString()}
                </p>
              </div>
              {isOwner && (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => void togglePin(a.id, !a.pinned)} title={a.pinned ? "Unpin" : "Pin"}>
                    {a.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(a.id)} title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
