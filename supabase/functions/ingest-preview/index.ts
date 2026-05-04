/**
 * Supabase Edge Function: ingest-preview (Phase 7)
 *
 * Dry-run pass for the carrier ingest wizard. Loops over the rows the wizard
 * proposes to ingest, calling the Phase 4b-1 lookup RPCs WITHOUT inserting
 * anything, plus checks whether each policy_number already exists in the
 * tenant. Returns per-row {agent_id, product_id, flags, existing_policy_number}.
 *
 * verify_jwt = true. Owner-only.
 *
 * SECURITY CONTRACT — JWT-to-tenant resolution (Phase 6.5 build rule)
 * --------------------------------------------------------------------
 * The Phase 7 wizard must NEVER pass tenant_id from the request body to the
 * caller-trust ingest RPCs. This edge function resolves tenantId from the
 * caller's JWT via auth.uid() → agents.tenant_id and uses that value
 * exclusively. Any tenant_id field in the request body is silently ignored.
 *
 * Documented at /Users/johnmelvin/Documents/Baseshop HQ/Wiki/
 *   hierarchy-permissions-model.md (Phase 6.5 section).
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

type PreviewRow = { row_index: number; payload: IngestPayload };

type PreviewResult = {
  row_index: number;
  agent_id: string | null;
  product_id: string | null;
  flags: ("orphan" | "unmatched" | "product_ambiguous" | "status_unknown")[];
  existing_policy_number: boolean;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_STATUSES = new Set([
  "Draft", "Submitted", "Pending", "Issued", "Issue Paid", "Terminated", "Potential Lapse",
]);

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
  if (userErr || !user) {
    return jsonResponse(401, { ok: false, error_code: "invalid_token" });
  }
  const { data: callerAgent, error: lookupErr } = await admin
    .from("agents")
    .select("tenant_id, is_owner")
    .eq("id", user.id)
    .maybeSingle();
  if (lookupErr) {
    return jsonResponse(500, { ok: false, error_code: "caller_lookup_failed", error_message: lookupErr.message });
  }
  if (!callerAgent) {
    return jsonResponse(403, { ok: false, error_code: "caller_no_agent_record" });
  }
  if (!callerAgent.is_owner) {
    return jsonResponse(403, { ok: false, error_code: "caller_not_owner" });
  }
  const tenantId = callerAgent.tenant_id;
  // Any `tenant_id` in req.body is intentionally ignored from this point on.

  let body: { rows?: PreviewRow[] };
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
    return jsonResponse(400, { ok: false, error_code: "batch_too_large", error_message: "max 200 rows per preview batch" });
  }

  // Bulk-check existing policy_numbers in this tenant
  const policyNumbers = Array.from(new Set(rows.map((r) => r.payload?.policy_number).filter((p): p is string => !!p)));
  const existingSet = new Set<string>();
  if (policyNumbers.length > 0) {
    const { data: existing } = await admin
      .from("policies")
      .select("policy_number")
      .eq("tenant_id", tenantId)
      .in("policy_number", policyNumbers);
    for (const r of existing ?? []) existingSet.add(r.policy_number as string);
  }

  // Per-row dry-run: lookup-only, no INSERT
  const results: PreviewResult[] = [];
  for (const row of rows) {
    const p = row.payload ?? ({} as IngestPayload);
    const flags: PreviewResult["flags"] = [];
    let agent_id: string | null = null;
    let product_id: string | null = null;

    if (p.writing_number) {
      const { data } = await admin.rpc("match_agent_by_writing_number", {
        p_tenant_id: tenantId, p_carrier_name: p.carrier ?? "", p_writing_number: p.writing_number,
      });
      agent_id = (data as string | null) ?? null;
      if (!agent_id) flags.push("orphan");
    } else if (p.agent_email) {
      const { data } = await admin.rpc("match_agent_by_email", {
        p_tenant_id: tenantId, p_email: p.agent_email,
      });
      agent_id = (data as string | null) ?? null;
      if (!agent_id) flags.push("unmatched");
    } else {
      flags.push("unmatched");
    }

    if (p.carrier && p.product) {
      const { data } = await admin.rpc("canonicalize_product", {
        p_tenant_id: tenantId, p_carrier_name: p.carrier, p_product_string: p.product,
      });
      product_id = (data as string | null) ?? null;
      if (!product_id) flags.push("product_ambiguous");
    }

    if (p.status && !VALID_STATUSES.has(p.status)) flags.push("status_unknown");

    results.push({
      row_index: row.row_index,
      agent_id,
      product_id,
      flags,
      existing_policy_number: existingSet.has(p.policy_number ?? ""),
    });
  }

  return jsonResponse(200, { ok: true, results });
});
