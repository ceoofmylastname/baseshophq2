/**
 * Phase 19.2 update of useAnnouncements.
 *
 * Changes from the Phase 10A version:
 *   1. Reads now flow through list_active_announcements() (the Phase 19.1 RPC)
 *      instead of an inline .from("announcements").select(...). Functionally
 *      identical (same WHERE, same ORDER BY) but binds the frontend to the
 *      stable RLS-aware surface that PR 19.3 will also use.
 *   2. Announcement type expands to include updated_by_user_id and updated_at
 *      (Phase 19.1 audit columns). Backwards compatible with existing
 *      consumers (AnnouncementsList, PostAnnouncementDialog) which ignore the
 *      new fields.
 *   3. post() and togglePin() now route through upsert_announcement
 *      (Phase 19.1) instead of the legacy post_announcement RPC and the direct
 *      table UPDATE. Caller API of both methods is unchanged.
 *   4. New update() method for edit-existing-row, used by the Settings
 *      Announcements panel. PR 19.3 will retire the inline Post button on the
 *      dashboard and at that point a small cleanup can drop post_announcement
 *      once nothing references it.
 *
 * remove() still calls delete_announcement(p_announcement_id) per D-5.
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
