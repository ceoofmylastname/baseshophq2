import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";

/**
 * Master grid matrix data: positions × products with current rates.
 * Reads from comp_grid_rates / positions / products / carriers.
 *
 * Realtime: subscribes to postgres_changes on comp_grid_rates filtered by
 * tenant_id so multiple owners editing simultaneously see each other's
 * writes. Last-write-wins at the DB level via the close-prior + insert-new
 * transaction in set_master_grid_rate.
 */

export type GridPosition = {
  id: string;
  position_code: string;
  position_name: string;
  sort_order: number;
  is_commissioned: boolean;
};

export type GridCarrier = {
  id: string;
  carrier_name: string;
  product_type: "life" | "annuity";
};

export type GridProduct = {
  id: string;
  carrier_id: string;
  product_name: string;
  product_variant: string | null;
  product_type: "life" | "annuity";
  has_bonus_column: boolean;
};

export type GridRate = {
  position_id: string;
  product_id: string;
  commission_pct: number;
  schedule_code: string | null;
  effective_date: string;
};

export function useMasterGrid(productType: "life" | "annuity") {
  const tenant = useTenant();
  const [positions, setPositions] = useState<GridPosition[]>([]);
  const [carriers, setCarriers] = useState<GridCarrier[]>([]);
  const [products, setProducts] = useState<GridProduct[]>([]);
  const [rates, setRates] = useState<GridRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [posRes, carRes, prodRes, rateRes] = await Promise.all([
      supabase
        .from("comp_grid_positions")
        .select("id, position_code, position_name, sort_order, is_commissioned")
        .eq("is_active", true)
        .order("sort_order", { ascending: false }),
      supabase
        .from("comp_grid_carriers")
        .select("id, carrier_name, product_type")
        .eq("is_active", true)
        .eq("product_type", productType)
        .order("carrier_name"),
      supabase
        .from("comp_grid_products")
        .select("id, carrier_id, product_name, product_variant, product_type, has_bonus_column")
        .eq("is_active", true)
        .eq("product_type", productType)
        .order("product_name"),
      supabase
        .from("comp_grid_rates")
        .select("position_id, product_id, commission_pct, schedule_code, effective_date")
        .is("end_date", null),
    ]);

    setLoading(false);
    const err = posRes.error || carRes.error || prodRes.error || rateRes.error;
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    setPositions((posRes.data ?? []) as GridPosition[]);
    setCarriers((carRes.data ?? []) as GridCarrier[]);
    setProducts((prodRes.data ?? []) as GridProduct[]);
    setRates(((rateRes.data ?? []) as GridRate[]).map((r) => ({
      ...r,
      commission_pct: Number(r.commission_pct),
    })));
  }, [productType]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime: any comp_grid_rates change in this tenant triggers a refresh.
  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`master-grid-${tenant.id}-${productType}`))
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "comp_grid_rates",
          filter: `tenant_id=eq.${tenant.id}`,
        },
        () => { void refresh(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, productType, refresh]);

  return { positions, carriers, products, rates, loading, error, refresh };
}
