/**
 * useAnnouncements -- announcements read + write hook.
 *
 * Shape after Phase 19.3:
 *   - Reads flow through list_active_announcements() (Phase 19.1 RPC):
 *     tenant-scoped, soft-delete filtered, pinned-first ordering.
 *   - Announcement type includes updated_by_user_id and updated_at
 *     (Phase 19.1 audit columns).
 *   - post(), update(), togglePin() all route through
 *     upsert_announcement(p_id, p_title, p_body, p_pinned). The legacy
 *     post_announcement RPC was retired in Phase 19.3 (see
 *     20260526100000_retire_post_announcement_rpc.sql).
 *   - remove() calls delete_announcement(p_announcement_id).
 *
 * Consumers:
 *   - AnnouncementsList (Dashboard, read-only since Phase 19.3) uses
 *     announcements, remove, togglePin.
 *   - AnnouncementsManager (Settings, owner-only authoring) uses the full
 *     surface for create / edit / pin / delete.
 *
 * Realtime: postgres_changes subscription on the announcements table fires
 * refresh() on any INSERT / UPDATE / DELETE for the current tenant.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";

export type Announcement = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  posted_by_user_id: string;
  created_at: string;
  updated_by_user_id: string | null;
  updated_at: string;
};

type MutationResult =
  | { ok: true }
  | { ok: false; errorMessage: string };

export function useAnnouncements() {
  const tenant = useTenant();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("list_active_announcements");
    setLoading(false);
    if (error) {
      setAnnouncements([]);
      return;
    }
    setAnnouncements((data ?? []) as Announcement[]);
  }, [tenant?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`announcements-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "announcements", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  async function post(args: { title: string; body: string; pinned: boolean }): Promise<MutationResult> {
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("upsert_announcement", {
        p_id: null,
        p_title: args.title,
        p_body: args.body,
        p_pinned: args.pinned,
      });
      if (error) return { ok: false, errorMessage: error.message };
      return { ok: true };
    } finally { setSubmitting(false); }
  }

  async function update(args: { id: string; title: string; body: string; pinned: boolean }): Promise<MutationResult> {
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("upsert_announcement", {
        p_id: args.id,
        p_title: args.title,
        p_body: args.body,
        p_pinned: args.pinned,
      });
      if (error) return { ok: false, errorMessage: error.message };
      return { ok: true };
    } finally { setSubmitting(false); }
  }

  async function remove(id: string): Promise<MutationResult> {
    const { data, error } = await supabase.rpc("delete_announcement", { p_announcement_id: id });
    if (error) return { ok: false, errorMessage: error.message };
    const r = data as { success: boolean; error_code?: string };
    if (!r.success) return { ok: false, errorMessage: r.error_code ?? "unknown" };
    return { ok: true };
  }

  // Pin toggle now routes through upsert_announcement (D-8 resolution). The
  // RPC requires title to be non-empty, so we look up the row's current
  // title/body from local state and pass them through unchanged. If the row
  // is missing from local state (e.g. mid-realtime-replace), we fail closed
  // rather than guess.
  async function togglePin(id: string, pinned: boolean): Promise<MutationResult> {
    const row = announcements.find((a) => a.id === id);
    if (!row) return { ok: false, errorMessage: "announcement not in local state" };
    const { error } = await supabase.rpc("upsert_announcement", {
      p_id: id,
      p_title: row.title,
      p_body: row.body,
      p_pinned: pinned,
    });
    if (error) return { ok: false, errorMessage: error.message };
    return { ok: true };
  }

  return { announcements, loading, submitting, refresh, post, update, remove, togglePin };
}
