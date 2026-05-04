import { useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import type { PolicyStatus } from "@/lib/policy-bucket";

export function useUpdatePolicyStatus() {
  const [submitting, setSubmitting] = useState(false);

  async function update(policyId: string, newStatus: PolicyStatus): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("policies")
        .update({ status: newStatus })
        .eq("id", policyId);
      if (error) return { ok: false, errorMessage: error.message };
      return { ok: true };
    } finally { setSubmitting(false); }
  }

  return { update, submitting };
}
