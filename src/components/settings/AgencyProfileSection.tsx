import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useTenant } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, AlertTriangle } from "lucide-react";

/**
 * Phase 15.3: Agency profile editor.
 *
 * Owner-only. Edits the tenants row (name + slug). RLS already enforces
 * is_owner() on UPDATE, so a non-owner who somehow gets this UI rendered
 * will hit a row-level violation at save time. The Settings page also
 * gates this section behind isOwner, so non-owners shouldn't see it.
 *
 * Slug changes carry a real warning: the slug is part of any URL that
 * references the tenant (future whitelabel subdomain routing). Renaming
 * the slug breaks bookmarks and existing deep links. We allow it but
 * surface the consequence.
 *
 * After save, reload the page so the TopBar 'TENANT / {name}' label
 * picks up the change. The AuthContext doesn't currently expose a
 * tenant-refresh, so window.location.reload() is the simplest reliable
 * path. Trade-off: 200ms of perceived 'reset' for the operator after
 * an action they explicitly initiated. Acceptable.
 */

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function AgencyProfileSection() {
  const tenant = useTenant();
  const [name, setName] = useState(tenant?.name ?? "");
  const [slug, setSlug] = useState(tenant?.slug ?? "");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(tenant?.name ?? "");
    setSlug(tenant?.slug ?? "");
    setSlugManuallyEdited(false);
  }, [tenant?.id, tenant?.name, tenant?.slug]);

  // Auto-derive the slug from the name UNTIL the owner touches the slug
  // field directly. After that, slug is independent.
  useEffect(() => {
    if (!slugManuallyEdited) setSlug(slugify(name));
  }, [name, slugManuallyEdited]);

  const slugChanged = slug !== tenant?.slug;
  const nameChanged = name.trim() !== (tenant?.name ?? "");
  const hasChanges = nameChanged || slugChanged;
  const slugValid = SLUG_PATTERN.test(slug);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!tenant?.id) {
      setError("Tenant not loaded yet. Reload the page and try again.");
      return;
    }
    if (!name.trim()) {
      setError("Agency name is required.");
      return;
    }
    if (!slugValid) {
      setError("Slug must be lowercase letters, digits, and hyphens — no leading or trailing hyphens.");
      return;
    }

    setSubmitting(true);
    const { error: err } = await supabase
      .from("tenants")
      .update({ name: name.trim(), slug })
      .eq("id", tenant.id);
    setSubmitting(false);

    if (err) {
      // Common one: unique slug collision
      if (err.code === "23505") {
        setError(`Slug "${slug}" is already in use by another agency.`);
      } else {
        setError(err.message);
      }
      return;
    }

    setSavedFlash(true);
    // Reload after a brief success flash so the new tenant name shows
    // up in the TopBar.
    setTimeout(() => { window.location.reload(); }, 1200);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold tracking-tight">Agency profile</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The name and URL slug that identify your agency. Visible in the top bar
          and (in a future whitelabel phase) used in your custom domain.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="space-y-2">
          <Label htmlFor="ap-name">Agency name</Label>
          <Input
            id="ap-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="JRM Enterprise Group"
            className="h-11 border-white/10 bg-white/[0.03] focus-visible:ring-primary sm:h-10"
          />
          <p className="text-[11px] text-muted-foreground">Shown in the top bar and on every printable document.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ap-slug">URL slug</Label>
          <Input
            id="ap-slug"
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setSlugManuallyEdited(true); }}
            required
            pattern="^[a-z0-9]+(-[a-z0-9]+)*$"
            placeholder="jrm-enterprise-group"
            className="h-11 border-white/10 bg-white/[0.03] focus-visible:ring-primary sm:h-10"
          />
          <p className="text-[11px] text-muted-foreground">
            Lowercase letters, digits, hyphens. Auto-generated from agency name unless you edit it.
          </p>
          {slugChanged && (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-orange-400/30 bg-orange-400/[0.08] p-2.5 text-[11px] text-orange-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Changing the slug will affect any saved bookmarks or invite links that
                reference the old slug. Future whitelabel subdomain routing will also
                use this value. Only change if you mean it.
              </span>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          <p className="text-[11px] text-muted-foreground">
            {savedFlash
              ? <span className="inline-flex items-center gap-1 text-emerald-300"><Check className="h-3.5 w-3.5" /> Saved — reloading…</span>
              : "Changes apply immediately."}
          </p>
          <Button type="submit" disabled={submitting || !hasChanges || !slugValid || !name.trim()}>
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
