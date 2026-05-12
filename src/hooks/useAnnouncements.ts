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
};

export function useAnnouncements() {
  const tenant = useTenant();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("announcements")
      .select("id, title, body, pinned, posted_by_user_id, created_at")
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false });
    setLoading(false);
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

  async function post(args: { title: string; body: string; pinned: boolean }) {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("post_announcement", {
        p_title: args.title, p_body: args.body, p_pinned: args.pinned,
      });
      if (error) return { ok: false as const, errorMessage: error.message };
      const r = data as { success: boolean; error_code?: string };
      if (!r.success) return { ok: false as const, errorMessage: r.error_code ?? "unknown" };
      return { ok: true as const };
    } finally { setSubmitting(false); }
  }

  async function remove(id: string) {
    const { data, error } = await supabase.rpc("delete_announcement", { p_announcement_id: id });
    if (error) return { ok: false as const, errorMessage: error.message };
    const r = data as { success: boolean; error_code?: string };
    if (!r.success) return { ok: false as const, errorMessage: r.error_code ?? "unknown" };
    return { ok: true as const };
  }

  async function togglePin(id: string, pinned: boolean) {
    const { error } = await supabase.from("announcements").update({ pinned }).eq("id", id);
    if (error) return { ok: false as const, errorMessage: error.message };
    return { ok: true as const };
  }

  return { announcements, loading, submitting, refresh, post, remove, togglePin };
}
