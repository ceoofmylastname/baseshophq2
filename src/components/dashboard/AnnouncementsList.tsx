import { useState } from "react";
import { Pin, PinOff, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { Button } from "@/components/ui/button";
import { PostAnnouncementDialog } from "./PostAnnouncementDialog";

export function AnnouncementsList() {
  const { isOwner } = useAuth();
  const { announcements, loading, remove, togglePin } = useAnnouncements();
  const [postOpen, setPostOpen] = useState(false);

  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Announcements</h3>
        {isOwner && (
          <Button size="sm" variant="outline" onClick={() => setPostOpen(true)}>
            Post
          </Button>
        )}
      </div>
      {loading ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading…</p>
      ) : announcements.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No active announcements.</p>
      ) : (
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
      )}

      <PostAnnouncementDialog open={postOpen} onClose={() => setPostOpen(false)} />
    </div>
  );
}
