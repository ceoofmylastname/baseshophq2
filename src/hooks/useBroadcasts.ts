import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";

export type Broadcast = {
  id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  cta_text: string | null;
  cta_url: string | null;
  targeting: { all?: boolean; positions?: string[] };
  start_at: string;
  end_at: string | null;
  is_active: boolean;
  created_at: string;
};

export type BroadcastInput = {
  id?: string | null;
  title: string;
  body?: string | null;
  image_url?: string | null;
  cta_text?: string | null;
  cta_url?: string | null;
  targeting?: { all?: boolean; positions?: string[] };
  start_at?: string | null;
  end_at?: string | null;
  is_active?: boolean;
};

/**
 * Owner-only list of every broadcast in the tenant. Different from
 * useCurrentBroadcast which fetches only the single active+matching one
 * for the calling user.
 */
export function useBroadcasts() {
  const tenant = useTenant();
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("leadership_broadcasts")
      .select("id, title, body, image_url, cta_text, cta_url, targeting, start_at, end_at, is_active, created_at")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false });
    setLoading(false);
    setBroadcasts((data ?? []) as Broadcast[]);
  }, [tenant?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`broadcasts-editor-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "leadership_broadcasts", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  async function upsert(input: BroadcastInput) {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("upsert_leadership_broadcast", {
        p_id:         input.id ?? null,
        p_title:      input.title,
        p_body:       input.body ?? null,
        p_image_url:  input.image_url ?? null,
        p_cta_text:   input.cta_text ?? null,
        p_cta_url:    input.cta_url ?? null,
        p_targeting:  input.targeting ?? { all: true },
        p_start_at:   input.start_at ?? null,
        p_end_at:     input.end_at ?? null,
        p_is_active:  input.is_active ?? true,
      });
      if (error) return { ok: false as const, errorMessage: error.message };
      const r = data as { success: boolean; error_code?: string; broadcast_id?: string };
      if (!r.success) return { ok: false as const, errorMessage: r.error_code ?? "unknown" };
      return { ok: true as const, id: r.broadcast_id! };
    } finally { setSubmitting(false); }
  }

  async function remove(id: string) {
    const { data, error } = await supabase.rpc("delete_leadership_broadcast", { p_id: id });
    if (error) return { ok: false as const, errorMessage: error.message };
    const r = data as { success: boolean; error_code?: string };
    if (!r.success) return { ok: false as const, errorMessage: r.error_code ?? "unknown" };
    return { ok: true as const };
  }

  return { broadcasts, loading, submitting, refresh, upsert, remove };
}
