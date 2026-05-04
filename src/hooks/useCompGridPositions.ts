import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

export type GridPosition = {
  id: string;
  position_code: string;
  position_name: string;
  sort_order: number;
  is_commissioned: boolean;
  is_active: boolean;
};

export function useCompGridPositions() {
  const [positions, setPositions] = useState<GridPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error: err } = await supabase
        .from("comp_grid_positions")
        .select("id, position_code, position_name, sort_order, is_commissioned, is_active")
        .eq("is_active", true)
        .order("sort_order", { ascending: false });
      if (cancelled) return;
      setLoading(false);
      if (err) {
        setError(err.message);
        return;
      }
      setError(null);
      setPositions((data ?? []) as GridPosition[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { positions, loading, error };
}
