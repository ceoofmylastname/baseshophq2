import { useState } from "react";
import { supabase, SUPABASE_FUNCTIONS_URL } from "@/lib/supabase-browser";
import type { IngestPolicyPayload } from "@/lib/carrier-ingest";

export type PreviewRow = { row_index: number; payload: IngestPolicyPayload };

export type IngestFlag = "orphan" | "unmatched" | "product_ambiguous" | "status_unknown";

export type PreviewResult = {
  row_index: number;
  agent_id: string | null;
  product_id: string | null;
  flags: IngestFlag[];
  existing_policy_number: boolean;
};

export function useIngestPreview() {
  const [submitting, setSubmitting] = useState(false);

  async function preview(rows: PreviewRow[]): Promise<
    | { ok: true; results: PreviewResult[] }
    | { ok: false; errorCode: string; errorMessage: string }
  > {
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return { ok: false, errorCode: "no_session", errorMessage: "Sign in required." };
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/ingest-preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ rows }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        return {
          ok: false,
          errorCode: json.error_code ?? "unknown",
          errorMessage: json.error_message ?? "Preview failed.",
        };
      }
      return { ok: true, results: json.results as PreviewResult[] };
    } catch (e) {
      return {
        ok: false,
        errorCode: "network_error",
        errorMessage: e instanceof Error ? e.message : String(e),
      };
    } finally {
      setSubmitting(false);
    }
  }

  return { preview, submitting };
}
