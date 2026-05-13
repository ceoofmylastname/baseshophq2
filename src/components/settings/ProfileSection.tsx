import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AgentAvatar } from "@/components/agents/AgentAvatar";
import { Camera, Check, Trash2, Upload } from "lucide-react";

/**
 * Phase 13.3: Profile editor.
 *
 * Every authenticated agent gets this section. Edits their OWN row in
 * agents — first_name, last_name, phone, title, bio, avatar_url. RLS
 * already enforces self-edit on agents UPDATE (agents_update_self).
 *
 * Photo upload path layout: avatars/{tenant_id}/{agent_id}/avatar-{ts}.{ext}
 * Storage RLS gates writes to the user's own folder. Cache-busting via a
 * timestamp in the filename means a fresh upload immediately wins over the
 * CDN-cached previous version.
 *
 * After save, we refresh() the auth context so the TopBar avatar and any
 * other consumer of currentAgent reflects the new state without a reload.
 */

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function ProfileSection() {
  const { currentAgent, tenant, refresh } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");
  const [phone,     setPhone]     = useState("");
  const [title,     setTitle]     = useState("");
  const [bio,       setBio]       = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hydrate form whenever the auth agent loads or changes.
  // Phone + bio + title aren't on the AuthContext Agent type yet, so we
  // pull them with a single targeted select on first render.
  useEffect(() => {
    if (!currentAgent?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("agents")
        .select("first_name, last_name, phone, title, bio, avatar_url")
        .eq("id", currentAgent.id)
        .maybeSingle();
      if (cancelled || !data) return;
      setFirstName(data.first_name ?? "");
      setLastName(data.last_name ?? "");
      setPhone(data.phone ?? "");
      setTitle(data.title ?? "");
      setBio(data.bio ?? "");
      setAvatarUrl(data.avatar_url ?? null);
    })();
    return () => { cancelled = true; };
  }, [currentAgent?.id]);

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!currentAgent?.id || !tenant?.id) {
      setError("Account not loaded yet. Try again in a moment.");
      return;
    }
    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
      setError("Photo must be JPG, PNG, or WebP.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError("Photo must be under 5 MB.");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${tenant.id}/${currentAgent.id}/avatar-${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
      if (uploadErr) {
        // Storage RLS rejection comes through as a 400 with a generic
        // "new row violates row-level security" message. Translate to
        // something an operator can actually act on.
        if (/row-level security|new row/i.test(uploadErr.message)) {
          setError("Storage permission denied. Your account doesn't have write access to the avatars bucket. Reload the page and try again, or contact support.");
        } else {
          setError(`Upload failed: ${uploadErr.message}`);
        }
        return;
      }

      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const newUrl = pub.publicUrl;

      // Persist the URL on the agents row immediately so the rest of the
      // app picks it up on the next refresh (org chart, topbar, etc).
      //
      // .select() forces the response to return the affected rows. If
      // RLS blocks the update, PostgREST returns success with an empty
      // array (NOT an error) — we detect that here so we don't sit on a
      // silent "looked like it worked" state.
      const { data: rows, error: updateErr } = await supabase
        .from("agents")
        .update({ avatar_url: newUrl })
        .eq("id", currentAgent.id)
        .select("id");
      if (updateErr) { setError(`Saved photo but couldn't link it: ${updateErr.message}`); return; }
      if (!rows || rows.length === 0) {
        setError("Photo uploaded but your profile wasn't linked to it. Your account doesn't have permission to update its own row — contact your agency owner.");
        return;
      }

      setAvatarUrl(newUrl);
      void refresh();
    } catch (e) {
      // Network / fetch failure — surface so the user isn't stuck on "Uploading…"
      setError(e instanceof Error ? `Upload failed: ${e.message}` : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handlePhotoRemove() {
    if (!currentAgent?.id) return;
    setError(null);
    setUploading(true);
    try {
      const { data: rows, error: updateErr } = await supabase
        .from("agents")
        .update({ avatar_url: null })
        .eq("id", currentAgent.id)
        .select("id");
      if (updateErr) { setError(updateErr.message); return; }
      if (!rows || rows.length === 0) {
        setError("Couldn't remove the photo — your account doesn't have permission to update its own row.");
        return;
      }
      setAvatarUrl(null);
      void refresh();
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!currentAgent?.id) {
      setError("Account not loaded yet. Try again in a moment.");
      return;
    }
    setSubmitting(true);
    const { data: rows, error: err } = await supabase
      .from("agents")
      .update({
        first_name: firstName.trim() || null,
        last_name:  lastName.trim()  || null,
        phone:      phone.trim()     || null,
        title:      title.trim()     || null,
        bio:        bio.trim()       || null,
      })
      .eq("id", currentAgent.id)
      .select("id");
    setSubmitting(false);
    if (err) { setError(err.message); return; }
    if (!rows || rows.length === 0) {
      setError("Profile didn't save — your account doesn't have permission to update its own row.");
      return;
    }
    setSavedFlash(true);
    void refresh();
    setTimeout(() => setSavedFlash(false), 2200);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold tracking-tight">Your profile</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Your name, photo, and contact details. These show up everywhere
          you appear in the platform — org chart, leaderboards, and the
          activity feed.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        {/* Error banner — appears above the photo block so it's visible
            without scrolling, useful for surfacing storage/RLS failures. */}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/[0.08] px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Photo block */}
        <div className="flex items-start gap-4">
          <AgentAvatar
            avatarUrl={avatarUrl}
            firstName={firstName}
            lastName={lastName}
            email={currentAgent?.email ?? ""}
            size="xl"
            fallbackBg="bg-primary/15 border-primary/40"
            fallbackText="text-primary"
          />
          <div className="flex-1 space-y-2">
            <p className="text-sm font-medium">Profile photo</p>
            <p className="text-[11px] text-muted-foreground">
              JPG, PNG, or WebP. Up to 5 MB. Square crops look best.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {avatarUrl ? <Camera className="mr-1.5 h-3.5 w-3.5" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                {uploading ? "Uploading…" : avatarUrl ? "Change photo" : "Upload photo"}
              </Button>
              {avatarUrl && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void handlePhotoRemove()}
                  disabled={uploading}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Remove
                </Button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_PHOTO_TYPES.join(",")}
              onChange={(e) => void handlePhotoSelect(e)}
              className="hidden"
            />
          </div>
        </div>

        <div className="border-t border-white/[0.06]" />

        {/* Name grid */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pf-first">First name</Label>
            <Input
              id="pf-first"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
              placeholder="Johnathon"
              className="h-11 border-white/10 bg-white/[0.03] focus-visible:ring-primary sm:h-10"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-last">Last name</Label>
            <Input
              id="pf-last"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
              placeholder="Melvin"
              className="h-11 border-white/10 bg-white/[0.03] focus-visible:ring-primary sm:h-10"
            />
          </div>
        </div>

        {/* Phone */}
        <div className="space-y-2">
          <Label htmlFor="pf-phone">Phone</Label>
          <Input
            id="pf-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            inputMode="tel"
            placeholder="(702) 555-0123"
            className="h-11 border-white/10 bg-white/[0.03] focus-visible:ring-primary sm:h-10"
          />
        </div>

        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="pf-title">Title <span className="text-[10px] font-normal uppercase tracking-wider text-muted-foreground">optional</span></Label>
          <Input
            id="pf-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="MDRT 2025 · Licensed in 14 states"
            className="h-11 border-white/10 bg-white/[0.03] focus-visible:ring-primary sm:h-10"
          />
          <p className="text-[11px] text-muted-foreground">
            Shown next to your position. Designations, top producer
            awards, or anything you want clients and recruits to see.
          </p>
        </div>

        {/* Bio */}
        <div className="space-y-2">
          <Label htmlFor="pf-bio">Bio <span className="text-[10px] font-normal uppercase tracking-wider text-muted-foreground">optional</span></Label>
          <Textarea
            id="pf-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            maxLength={500}
            placeholder="A few sentences about who you are, who you serve, and what you stand for."
            className="border-white/10 bg-white/[0.03] focus-visible:ring-primary"
          />
          <p className="text-[11px] text-muted-foreground">
            {bio.length}/500 characters. Shown on your agent detail panel.
          </p>
        </div>

        <div className="flex items-center justify-between pt-1">
          <p className="text-[11px] text-muted-foreground">
            {savedFlash
              ? <span className="inline-flex items-center gap-1 text-emerald-300"><Check className="h-3.5 w-3.5" /> Profile saved.</span>
              : "Changes apply immediately."}
          </p>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </form>
    </div>
  );
}
