import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useTenant } from "@/contexts/AuthContext";

export type ActivityEvent = {
  id: string;
  event_type:
    | "policy_created" | "policy_status_changed"
    | "agent_invited" | "agent_position_changed" | "master_grid_edited";
  event_at: string;
  actor_user_id: string | null;
  subject_user_id: string | null;
  summary: string;
  metadata: Record<string, unknown>;
};

const DEBOUNCE_MS = 400;
const PAGE_SIZE = 20;

/**
 * Reads recent_activity_feed RPC. Debounces realtime invalidation per
 * Phase 10A.1 Flag B — bulk Set Column flows can fire 10+ events in seconds;
 * without debouncing the React Query cache invalidates 10x in 2s and the UI
 * flickers. Standard pattern: collect events in a ref, refetch once.
 *
 * Pagination uses (event_at, id) tuple cursor server-side; client sends the
 * last row's id as p_after_id.
 */
export function useRecentActivityFeed() {
  const tenant = useTenant();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDirty = useRef(false);

  const fetchPage = useCallback(async (afterId: string | null): Promise<ActivityEvent[]> => {
    const { data } = await supabase.rpc("recent_activity_feed", {
      p_limit: PAGE_SIZE, p_after_id: afterId,
    });
    const r = data as { success?: boolean; rows?: ActivityEvent[] };
    if (!r?.success) return [];
    return r.rows ?? [];
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const page = await fetchPage(null);
    setLoading(false);
    setEvents(page);
    setHasMore(page.length === PAGE_SIZE);
  }, [fetchPage]);

  async function loadMore() {
    if (events.length === 0 || loadingMore) return;
    setLoadingMore(true);
    const last = events[events.length - 1];
    const more = await fetchPage(last.id);
    setLoadingMore(false);
    setEvents((prev) => [...prev, ...more]);
    setHasMore(more.length === PAGE_SIZE);
  }

  useEffect(() => { void refresh(); }, [refresh]);

  // Realtime with debounce
  useEffect(() => {
    if (!tenant?.id) return;

    function scheduleRefresh() {
      pendingDirty.current = true;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        if (pendingDirty.current) {
          pendingDirty.current = false;
          void refresh();
        }
      }, DEBOUNCE_MS);
    }

    const channel = supabase
      .channel(`activity-feed-${tenant.id}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_events", filter: `tenant_id=eq.${tenant.id}` },
        () => scheduleRefresh())
      .subscribe();
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [tenant?.id, refresh]);

  return { events, loading, refresh, loadMore, hasMore, loadingMore };
}
