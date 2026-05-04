import { useState, type FormEvent } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAnnouncements } from "@/hooks/useAnnouncements";

type Props = { open: boolean; onClose: () => void };

export function PostAnnouncementDialog({ open, onClose }: Props) {
  const { post, submitting } = useAnnouncements();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle(""); setBody(""); setPinned(false); setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await post({ title: title.trim(), body: body.trim(), pinned });
    if (!result.ok) { setError(result.errorMessage); return; }
    reset();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setTimeout(reset, 150); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Post an announcement</DialogTitle>
          <DialogDescription>Visible to every agent in your tenant.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs uppercase text-muted-foreground">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase text-muted-foreground">Body</label>
            <textarea
              value={body} onChange={(e) => setBody(e.target.value)} rows={4}
              className="w-full rounded-md border border-input bg-background p-2 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            Pin to top
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? "Posting…" : "Post"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
