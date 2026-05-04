import { useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { useTenant } from "@/contexts/AuthContext";

/**
 * Thin wrappers around direct comp_grid_carriers / comp_grid_products
 * inserts/updates. RLS policies enforce owner-only writes; the UI must
 * still hide these actions for non-owners (defense-in-depth).
 */
export function useCarrierProductMutations() {
  const tenant = useTenant();
  const [submitting, setSubmitting] = useState(false);

  async function addCarrier(args: {
    carrierName: string;
    productType: "life" | "annuity";
  }): Promise<{ ok: true; id: string } | { ok: false; errorMessage: string }> {
    if (!tenant?.id) return { ok: false, errorMessage: "no tenant" };
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("comp_grid_carriers")
        .insert({
          tenant_id: tenant.id,
          carrier_name: args.carrierName,
          product_type: args.productType,
          is_active: true,
        })
        .select("id")
        .single();
      if (error) return { ok: false, errorMessage: error.message };
      return { ok: true, id: data.id as string };
    } finally { setSubmitting(false); }
  }

  async function archiveCarrier(carrierId: string): Promise<{ ok: boolean; errorMessage?: string }> {
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("comp_grid_carriers")
        .update({ is_active: false })
        .eq("id", carrierId);
      if (error) return { ok: false, errorMessage: error.message };
      return { ok: true };
    } finally { setSubmitting(false); }
  }

  async function addProduct(args: {
    carrierId: string;
    productName: string;
    productVariant: string | null;
    productType: "life" | "annuity";
    hasBonusColumn: boolean;
  }): Promise<{ ok: true; id: string } | { ok: false; errorMessage: string }> {
    if (!tenant?.id) return { ok: false, errorMessage: "no tenant" };
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("comp_grid_products")
        .insert({
          tenant_id: tenant.id,
          carrier_id: args.carrierId,
          product_name: args.productName,
          product_variant: args.productVariant,
          product_type: args.productType,
          has_bonus_column: args.hasBonusColumn,
          is_active: true,
        })
        .select("id")
        .single();
      if (error) return { ok: false, errorMessage: error.message };
      return { ok: true, id: data.id as string };
    } finally { setSubmitting(false); }
  }

  async function archiveProduct(productId: string): Promise<{ ok: boolean; errorMessage?: string }> {
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("comp_grid_products")
        .update({ is_active: false })
        .eq("id", productId);
      if (error) return { ok: false, errorMessage: error.message };
      return { ok: true };
    } finally { setSubmitting(false); }
  }

  async function renameCarrier(carrierId: string, newName: string): Promise<{ ok: boolean; errorMessage?: string }> {
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("comp_grid_carriers")
        .update({ carrier_name: newName })
        .eq("id", carrierId);
      if (error) return { ok: false, errorMessage: error.message };
      return { ok: true };
    } finally { setSubmitting(false); }
  }

  async function renameProduct(productId: string, newName: string): Promise<{ ok: boolean; errorMessage?: string }> {
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("comp_grid_products")
        .update({ product_name: newName })
        .eq("id", productId);
      if (error) return { ok: false, errorMessage: error.message };
      return { ok: true };
    } finally { setSubmitting(false); }
  }

  return { addCarrier, archiveCarrier, renameCarrier, addProduct, archiveProduct, renameProduct, submitting };
}
