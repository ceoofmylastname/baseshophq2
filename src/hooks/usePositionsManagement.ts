import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useTenant } from "@/contexts/AuthContext";

export type ManagedPosition = {
  id: string;
  position_code: string;
  position_name: string;
  sort_order: number;
  is_commissioned: boolean;
  is_active: boolean;
};

export type PositionInput = {
  position_code: string;
  position_name: string;
  sort_order: number;
  is_commissioned: boolean;
};

export type PositionUpdate = {
  position_name?: string;
  sort_order?: number;
  is_commissioned?: boolean;
  is_active?: boolean;
};

/**
 * Owner-only management hook. Lists BOTH active and archived positions so
 * the editor can show full state and let the owner restore an archived rung.
 * Distinct from useCompGridPositions which filters to active-only for the
 * read paths in the rest of the app.
 *
 * Mutations go through direct table operations because RLS already gates
 * owner-only INSERT/UPDATE on comp_grid_positions. PostgreSQL errors are
 * surfaced verbatim; the most common one (unique violation on position_code)
 * gets a friendly remap.
 */
export function usePositionsManagement() {
  const tenant = useTenant();
  const [positions, setPositions] = useState<ManagedPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("comp_grid_positions")
      .select("id, position_code, position_name, sort_order, is_commissioned, is_active")
      .eq("tenant_id", tenant.id)
      .order("sort_order", { ascending: false })
      .order("position_name", { ascending: true });
    setLoading(false);
    setPositions((data ?? []) as ManagedPosition[]);
  }, [tenant?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function add(input: PositionInput) {
    if (!tenant?.id) return { ok: false as const, errorMessage: "no tenant" };
    setSubmitting(true);
    try {
      const code = input.position_code.trim().toUpperCase();
      const name = input.position_name.trim();
      if (!code) return { ok: false as const, errorMessage: "Position code is required." };
      if (!name) return { ok: false as const, errorMessage: "Position name is required." };

      const { error } = await supabase
        .from("comp_grid_positions")
        .insert({
          tenant_id:       tenant.id,
          position_code:   code,
          position_name:   name,
          sort_order:      input.sort_order,
          is_commissioned: input.is_commissioned,
          is_active:       true,
        });
      if (error) {
        if (error.code === "23505") {
          return { ok: false as const, errorMessage: `Position code "${code}" already exists in this tenant.` };
        }
        return { ok: false as const, errorMessage: error.message };
      }
      await refresh();
      return { ok: true as const };
    } finally { setSubmitting(false); }
  }

  async function update(id: string, patch: PositionUpdate) {
    setSubmitting(true);
    try {
      const cleaned: Record<string, unknown> = {};
      if (patch.position_name !== undefined) cleaned.position_name = patch.position_name.trim();
      if (patch.sort_order   !== undefined) cleaned.sort_order   = patch.sort_order;
      if (patch.is_commissioned !== undefined) cleaned.is_commissioned = patch.is_commissioned;
      if (patch.is_active    !== undefined) cleaned.is_active    = patch.is_active;
      if (Object.keys(cleaned).length === 0) return { ok: true as const };

      const { error } = await supabase
        .from("comp_grid_positions")
        .update(cleaned)
        .eq("id", id);
      if (error) return { ok: false as const, errorMessage: error.message };
      await refresh();
      return { ok: true as const };
    } finally { setSubmitting(false); }
  }

  async function archive(id: string) {
    return update(id, { is_active: false });
  }

  async function restore(id: string) {
    return update(id, { is_active: true });
  }

  return { positions, loading, submitting, refresh, add, update, archive, restore };
}
