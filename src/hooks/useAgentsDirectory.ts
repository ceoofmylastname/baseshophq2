import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

export type DirectoryRow = {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  is_owner: boolean;
  status: "active" | "inactive" | "archived";
  upline_email: string | null;
  current_position_id: string | null;
  current_position_code: string | null;
  current_position_name: string | null;
  current_position_sort_order: number | null;
  current_position_is_commissioned: boolean | null;
};

/**
 * Reads from the agents_with_current_position view (Phase 6a). RLS scopes to
 * the calling user's tenant + view-down (existing agents_select_visible
 * policy from Phase 1; agents_select_self for the user's own row).
 */
export function useAgentsDirectory() {
  const [rows, setRows] = useState<DirectoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("agents_with_current_position")
      .select("*")
      .order("is_owner", { ascending: false })
      .order("current_position_sort_order", { ascending: false, nullsFirst: false })
      .order("last_name", { ascending: true, nullsFirst: false });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    setRows((data ?? []) as DirectoryRow[]);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rows, loading, error, refresh };
}
