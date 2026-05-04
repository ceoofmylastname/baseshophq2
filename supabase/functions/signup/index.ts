/**
 * Supabase Edge Function: signup
 *
 * Atomic provisioning flow:
 *
 *   1. Validate the request payload (email format, password length, slug regex,
 *      required text fields).
 *   2. Create auth.users via supabase.auth.admin.createUser({ email_confirm: true }).
 *   3. Call provision_tenant_and_owner RPC with the new user_id + tenant data
 *      + the bundled Agora payload. The RPC inserts tenants + agents + wires
 *      owner_agent_id + bootstraps the master grid in a single transaction.
 *   4. ROLLBACK ON FAILURE: If the RPC returns success=false OR throws, this
 *      function calls supabase.auth.admin.deleteUser to remove the orphaned
 *      auth.users row. The auth.users creation lives outside the SQL
 *      transaction (no SQL admin API), so this compensating delete is the
 *      only way to keep state consistent across the auth schema and public.
 *
 * verify_jwt = false:
 *   This endpoint creates new accounts; the caller is by definition not yet
 *   authenticated. Future hardening: add rate limiting + CAPTCHA + per-IP
 *   throttling. Tracked for the public-launch checklist.
 *
 * Error responses (4xx) include a structured `error_code` mirrored from
 * provision_tenant_and_owner, so the client form can map specific codes to
 * targeted UX (e.g. slug_collision → focus the slug field).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// NOTE: Auto-bootstrap of the Agora master grid on signup is deferred to a
// Phase 5.1 follow-up. The 96KB payload doesn't fit through the deploy tool
// boundary cleanly; the planned mechanism is a system_seeds table populated
// once via a chunked migration, then read by a server-side wrapper. Until
// then, owners run bootstrap_agora_grid_for_tenant manually after signup
// (or via the eventual Phase 8 Master Comp Grid "Restore default grid" UI).

type SignupBody = {
  email: string;
  password: string;
  agencyName: string;
  agencySlug: string;
  ownerFirstName: string;
  ownerLastName: string;
};

type ProvisionResult = {
  success: boolean;
  tenant_id: string | null;
  tenant_slug: string | null;
  agent_id: string | null;
  bootstrap: unknown;
  error_code: string | null;
  error_message: string | null;
};

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function validate(body: SignupBody): string | null {
  if (!body.email?.includes("@")) return "Invalid email.";
  if (!body.password || body.password.length < 8) return "Password must be at least 8 characters.";
  if (!body.agencyName?.trim()) return "Agency name is required.";
  if (!body.agencySlug || !SLUG_RE.test(body.agencySlug)) return "Agency slug must be lowercase letters, digits, and hyphens.";
  if (!body.ownerFirstName?.trim()) return "First name is required.";
  if (!body.ownerLastName?.trim()) return "Last name is required.";
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return jsonResponse(204, {});
  if (req.method !== "POST")     return jsonResponse(405, { ok: false, error: "method not allowed" });

  let body: SignupBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid JSON body" });
  }

  const validationError = validate(body);
  if (validationError) {
    return jsonResponse(400, { ok: false, error_code: "validation_failed", error_message: validationError });
  }

  const supabaseUrl     = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { ok: false, error: "edge function missing required env vars" });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Step 1: create auth.users
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    user_metadata: {
      first_name: body.ownerFirstName,
      last_name: body.ownerLastName,
    },
  });

  if (createErr || !created.user) {
    return jsonResponse(400, {
      ok: false,
      error_code: "auth_create_failed",
      error_message: createErr?.message ?? "createUser returned no user",
    });
  }

  const userId = created.user.id;

  // Step 2: provision tenant + owner + bootstrap (single SQL transaction)
  let provision: ProvisionResult | null = null;
  let provisionThrew = false;
  let provisionErrMsg: string | null = null;

  try {
    const { data, error: rpcErr } = await admin.rpc("provision_tenant_and_owner", {
      p_owner_user_id:    userId,
      p_owner_email:      body.email,
      p_owner_first_name: body.ownerFirstName,
      p_owner_last_name:  body.ownerLastName,
      p_tenant_name:      body.agencyName,
      p_tenant_slug:      body.agencySlug,
    });
    if (rpcErr) {
      provisionThrew = true;
      provisionErrMsg = rpcErr.message;
    } else {
      provision = data as ProvisionResult;
    }
  } catch (e) {
    provisionThrew = true;
    provisionErrMsg = e instanceof Error ? e.message : String(e);
  }

  // Rollback path: delete the orphan auth.users row
  if (provisionThrew || !provision || !provision.success) {
    await admin.auth.admin.deleteUser(userId).catch(() => {
      // log-and-continue: failure to delete is bad but we still need to surface
      // the original provision error to the caller
    });
    if (provisionThrew) {
      return jsonResponse(500, {
        ok: false,
        error_code: "provision_threw",
        error_message: provisionErrMsg ?? "provision_tenant_and_owner threw without a message",
      });
    }
    return jsonResponse(400, {
      ok: false,
      error_code: provision!.error_code,
      error_message: provision!.error_message,
    });
  }

  // Success
  return jsonResponse(200, {
    ok: true,
    tenant_id:   provision.tenant_id,
    tenant_slug: provision.tenant_slug,
    agent_id:    provision.agent_id,
    bootstrap:   provision.bootstrap,
  });
});
