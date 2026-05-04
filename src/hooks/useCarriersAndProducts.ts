import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

export type Carrier = {
  id: string;
  carrier_name: string;
  product_type: "life" | "annuity";
  is_active: boolean;
};

export type Product = {
  id: string;
  carrier_id: string;
  product_name: string;
  product_variant: string | null;
  product_type: "life" | "annuity";
  has_bonus_column: boolean;
  is_active: boolean;
};

export function useCarriersAndProducts() {
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [carRes, prodRes] = await Promise.all([
      supabase
        .from("comp_grid_carriers")
        .select("id, carrier_name, product_type, is_active")
        .order("carrier_name"),
      supabase
        .from("comp_grid_products")
        .select("id, carrier_id, product_name, product_variant, product_type, has_bonus_column, is_active")
        .order("product_name"),
    ]);
    setLoading(false);
    if (carRes.error || prodRes.error) {
      setError(carRes.error?.message ?? prodRes.error?.message ?? "load failed");
      return;
    }
    setError(null);
    setCarriers((carRes.data ?? []) as Carrier[]);
    setProducts((prodRes.data ?? []) as Product[]);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  return { carriers, products, loading, error, refresh };
}
