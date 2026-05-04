/**
 * Supabase Edge Function: ingest-commit (Phase 7)
 *
 * Commit pass for the carrier ingest wizard. Loops the rows the wizard sends
 * (already canonicalized + owner-overridden in the browser) through
 * ingest_policy_row. Per-row try/catch so a single bad row doesn't break the
 * batch — silent-orphan path verified in 4b-1 ensures most rows succeed even
 * with NULL agent_id.
 *
 * verify_jwt = true. Owner-only.
 *
 * SECURITY CONTRACT — JWT-to-tenant resolution (Phase 6.5 build rule)
 * --------------------------------------------------------------------
 * Same as ingest-preview: tenantId comes from the caller's JWT via
 * agents.tenant_id lookup. Any tenant_id field in the request body is
 * silently ignored.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type IngestPayload = {
  policy_number: string;
  writing_number?: string;
  agent_email?: string;
  carrier?: string;
  product?: string;
  status?: string;
  client_first_name?: string;
  client_last_name?: string;
  client_dob?: string;
  application_date?: string;
  effective_date?: string;
  annual_premium?: number;
  notes?: string;
};

type CommitRow = { row_index: number; payload: IngestPayload };

type CommitResult = {
  row_index: number;
  policy_id: string | null;
  agent_id: string | null;
  product_id: string | null;
  flags: string[];
  error_code?: string;
  error_message?: string;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse(405, { ok: false, error: "method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { ok: false, error: "edge function missing required env vars" });
  }

  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!accessToken) return jsonResponse(401, { ok: false, error_code: "no_token" });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ---- JWT-to-tenant resolution (mandatory pattern, Phase 6.5 build rule) ----
  const { data: { user }, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !user) return jsonResponse(401, { ok: false, error_code: "invalid_token" });

  const { data: callerAgent, error: lookupErr } = await admin
    .from("agents")
    .select("tenant_id, is_owner")
    .eq("id", user.id)
    .maybeSingle();
  if (lookupErr) return jsonResponse(500, { ok: false, error_code: "caller_lookup_failed", error_message: lookupErr.message });
  if (!callerAgent) return jsonResponse(403, { ok: false, error_code: "caller_no_agent_record" });
  if (!callerAgent.is_owner) return jsonResponse(403, { ok: false, error_code: "caller_not_owner" });

  const tenantId = callerAgent.tenant_id;
  // tenant_id from req.body is intentionally ignored.

  let body: { rows?: CommitRow[] };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { ok: false, error_code: "validation_failed", error_message: "invalid JSON body" });
  }
  const rows = body.rows ?? [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonResponse(400, { ok: false, error_code: "validation_failed", error_message: "rows array required" });
  }
  if (rows.length > 200) {
    return jsonResponse(400, { ok: false, error_code: "batch_too_large", error_message: "max 200 rows per commit batch" });
  }

  const results: CommitResult[] = [];
  for (const row of rows) {
    try {
      const { data, error } = await admin.rpc("ingest_policy_row", {
        p_tenant_id: tenantId,
        p_payload: row.payload,
      });
      if (error) {
        results.push({
          row_index: row.row_index,
          policy_id: null, agent_id: null, product_id: null, flags: [],
          error_code: "rpc_error", error_message: error.message,
        });
        continue;
      }
      const r = data as { policy_id: string; agent_id: string | null; product_id: string | null; status: string; flags: string[] };
      results.push({
        row_index: row.row_index,
        policy_id: r.policy_id,
        agent_id: r.agent_id,
        product_id: r.product_id,
        flags: r.flags ?? [],
      });
    } catch (e) {
      results.push({
        row_index: row.row_index,
        policy_id: null, agent_id: null, product_id: null, flags: [],
        error_code: "exception",
        error_message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return jsonResponse(200, { ok: true, results });
});
