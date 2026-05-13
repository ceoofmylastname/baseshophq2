import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useAuth, useTenant } from "@/contexts/AuthContext";

export type ActionItem = {
  id: string;
  action_type: string;
  title: string;
  body: string | null;
  cta_text: string | null;
  cta_url: string | null;
  is_dismissible: boolean;
  created_at: string;
};

/**
 * Reads + realtime-subscribes to user_action_items for the current user.
 * Only returns open items (not dismissed, not resolved). Direct table query —
 * RLS handles the user_id = auth.uid() OR is_owner gate.
 */
export function useActionItems() {
  const tenant = useTenant();
  const { currentAgent } = useAuth();
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tenant?.id || !currentAgent?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("user_action_items")
      .select("id, action_type, title, body, cta_text, cta_url, is_dismissible, created_at")
      .eq("tenant_id", tenant.id)
      .eq("user_id", currentAgent.id)
      .is("dismissed_at", null)
      .is("resolved_at", null)
      .order("created_at", { ascending: false });
    setLoading(false);
    setItems((data ?? []) as ActionItem[]);
  }, [tenant?.id, currentAgent?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`user-action-items-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "user_action_items", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  async function dismiss(id: string) {
    const { data, error } = await supabase.rpc("dismiss_action_item", { p_id: id });
    if (error) return { ok: false as const, errorMessage: error.message };
    const r = data as { success: boolean; error_code?: string };
    if (!r.success) return { ok: false as const, errorMessage: r.error_code ?? "unknown" };
    void refresh();
    return { ok: true as const };
  }

  return { items, loading, refresh, dismiss };
}
