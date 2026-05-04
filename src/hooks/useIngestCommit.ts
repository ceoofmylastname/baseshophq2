import { useState } from "react";
import { supabase, SUPABASE_FUNCTIONS_URL } from "@/lib/supabase-browser";
import type { IngestPolicyPayload } from "@/lib/carrier-ingest";

export type CommitRow = { row_index: number; payload: IngestPolicyPayload };

export type CommitResult = {
  row_index: number;
  policy_id: string | null;
  agent_id: string | null;
  product_id: string | null;
  flags: string[];
  error_code?: string;
  error_message?: string;
};

const CHUNK_SIZE = 50;

export function useIngestCommit() {
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1

  async function commit(
    rows: CommitRow[],
  ): Promise<
    | { ok: true; results: CommitResult[] }
    | { ok: false; errorCode: string; errorMessage: string; partialResults?: CommitResult[] }
  > {
    setSubmitting(true);
    setProgress(0);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return { ok: false, errorCode: "no_session", errorMessage: "Sign in required." };

      const all: CommitResult[] = [];
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/ingest-commit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ rows: chunk }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          return {
            ok: false,
            errorCode: json.error_code ?? "unknown",
            errorMessage: json.error_message ?? "Commit batch failed.",
            partialResults: all,
          };
        }
        all.push(...(json.results as CommitResult[]));
        setProgress(Math.min(1, (i + chunk.length) / rows.length));
      }
      return { ok: true, results: all };
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

  return { commit, submitting, progress };
}
