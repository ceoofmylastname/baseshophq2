import { useState } from "react";
import { supabase } from "@/lib/supabase-browser";

export type DeleteResult =
  | { ok: true; auditId: string; policyNumber: string }
  | { ok: false; errorCode: string; errorMessage: string };

/**
 * Wraps delete_policy_with_audit RPC. Bulk callers should loop with
 * stop-on-first-failure UX (Phase 7 ingest-commit pattern).
 */
export function useDeletePolicyWithAudit() {
  const [submitting, setSubmitting] = useState(false);

  async function deleteOne(policyId: string, reason: string | null): Promise<DeleteResult> {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("delete_policy_with_audit", {
        p_policy_id: policyId,
        p_reason: reason,
      });
      if (error) return { ok: false, errorCode: "rpc_error", errorMessage: error.message };
      const r = data as { success: boolean; error_code?: string; audit_id?: string; policy_number?: string };
      if (!r.success) return {
        ok: false, errorCode: r.error_code ?? "unknown",
        errorMessage: mapError(r.error_code ?? "unknown"),
      };
      return { ok: true, auditId: r.audit_id!, policyNumber: r.policy_number! };
    } finally { setSubmitting(false); }
  }

  return { deleteOne, submitting };
}

function mapError(code: string): string {
  switch (code) {
    case "forbidden": return "Owner-only action.";
    case "not_found": return "Policy not found.";
    case "rpc_error": return "Database error.";
    default: return "Delete failed.";
  }
}
