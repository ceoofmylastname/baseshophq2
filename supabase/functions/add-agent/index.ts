/**
 * Supabase Edge Function: add-agent (Phase 6a)
 *
 * verify_jwt = true. Caller must be an authenticated tenant owner.
 *
 * Flow:
 *   1. Read caller's user_id from the validated JWT.
 *   2. Service-role query agents → confirm caller is is_owner=TRUE; capture
 *      caller's tenant_id. Reject with 403 / caller_not_owner otherwise.
 *   3. Validate request payload (email, names, optional uplineEmail).
 *   4. PRE-CHECK email-already-in-auth via check_email_exists_in_auth RPC.
 *      If true → return 400 / email_already_in_use. Multi-agency users
 *      (one auth identity in multiple tenants) is a Phase 8+ concern;
 *      6a rejects cleanly to keep the model deterministic.
 *   5. supabase.auth.admin.inviteUserByEmail(email, { data: {...} })
 *      → creates auth.users + sends Supabase invite email.
 *   6. add_agent_to_tenant RPC (service-role) → INSERT agents row.
 *   7. ROLLBACK: if RPC fails, supabase.auth.admin.deleteUser to remove
 *      the orphan auth.users row created by invite.
 *
 * Default Supabase SMTP for invite emails has rate limits — fine for owner-
 * adds-downline volume in the dev/single-tenant phase. Custom SMTP via
 * Resend is on the public-launch checklist.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type AddAgentBody = {
  email: string;
  firstName: string;
  lastName: string;
  uplineEmail?: string;
};

type AddAgentRpcResult = {
  success: boolean;
  agent_id: string | null;
  tenant_id: string | null;
  error_code: string | null;
  error_message: string | null;
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

  const supabaseUrl    = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { ok: false, error: "edge function missing required env vars" });
  }

  // verify_jwt=true means the runtime already validated the token. Re-extract
  // the user_id from it for the owner check below.
  const authHeader = req.headers.get("authorization") ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    return jsonResponse(401, { ok: false, error_code: "no_token", error_message: "missing bearer token" });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user: caller }, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !caller) {
    return jsonResponse(401, { ok: false, error_code: "invalid_token", error_message: "could not resolve caller" });
  }

  // Service-role query agents — bypasses RLS — to confirm caller is owner.
  const { data: callerAgent, error: callerErr } = await admin
    .from("agents")
    .select("is_owner, tenant_id")
    .eq("id", caller.id)
    .maybeSingle();

  if (callerErr) {
    return jsonResponse(500, { ok: false, error_code: "caller_lookup_failed", error_message: callerErr.message });
  }
  if (!callerAgent) {
    return jsonResponse(403, { ok: false, error_code: "caller_no_agent_record", error_message: "your account is not linked to a tenant" });
  }
  if (!callerAgent.is_owner) {
    return jsonResponse(403, { ok: false, error_code: "caller_not_owner", error_message: "only the tenant owner can add agents" });
  }

  // Parse + validate payload
  let body: AddAgentBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { ok: false, error_code: "validation_failed", error_message: "invalid JSON body" });
  }

  if (!body.email?.includes("@")) {
    return jsonResponse(400, { ok: false, error_code: "validation_failed", error_message: "valid email is required" });
  }
  if (!body.firstName?.trim()) {
    return jsonResponse(400, { ok: false, error_code: "validation_failed", error_message: "first name is required" });
  }
  if (!body.lastName?.trim()) {
    return jsonResponse(400, { ok: false, error_code: "validation_failed", error_message: "last name is required" });
  }

  // Pre-check: email-already-in-auth (any tenant)
  const { data: emailExists, error: existsErr } = await admin.rpc("check_email_exists_in_auth", { p_email: body.email });
  if (existsErr) {
    return jsonResponse(500, { ok: false, error_code: "email_check_failed", error_message: existsErr.message });
  }
  if (emailExists === true) {
    return jsonResponse(400, {
      ok: false,
      error_code: "email_already_in_use",
      error_message: "this email is already registered",
    });
  }

  // Invite (creates auth.users + sends invite email).
  //
  // redirectTo points at /accept-invite so the invitee lands on the
  // "set your password" page rather than being silently auto-signed-in
  // to /home without ever setting credentials. Without this, the invitee
  // has a session but no password, which makes /settings → Change Password
  // impossible (the form requires a current password to verify before
  // updating).
  //
  // Site URL is read from a public env (PUBLIC_SITE_URL) with a fall-back
  // to https://baseshophq.com so this works in prod even if the env var
  // is unset. Local dev should set PUBLIC_SITE_URL=http://localhost:5173.
  const siteUrl = Deno.env.get("PUBLIC_SITE_URL") ?? "https://baseshophq.com";
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(body.email, {
    data: { first_name: body.firstName, last_name: body.lastName },
    redirectTo: `${siteUrl}/accept-invite`,
  });
  if (inviteErr || !invited.user) {
    return jsonResponse(500, {
      ok: false,
      error_code: "invite_failed",
      error_message: inviteErr?.message ?? "inviteUserByEmail returned no user",
    });
  }

  const newUserId = invited.user.id;

  // add_agent_to_tenant RPC (writes the agents row in a single transaction)
  let rpcResult: AddAgentRpcResult | null = null;
  let rpcThrew = false;
  let rpcErrMsg: string | null = null;

  try {
    const { data, error: rpcErr } = await admin.rpc("add_agent_to_tenant", {
      p_caller_user_id: caller.id,
      p_new_user_id:    newUserId,
      p_email:          body.email,
      p_first_name:     body.firstName,
      p_last_name:      body.lastName,
      p_upline_email:   body.uplineEmail ?? null,
    });
    if (rpcErr) {
      rpcThrew = true;
      rpcErrMsg = rpcErr.message;
    } else {
      rpcResult = data as AddAgentRpcResult;
    }
  } catch (e) {
    rpcThrew = true;
    rpcErrMsg = e instanceof Error ? e.message : String(e);
  }

  // Rollback: remove the orphan auth.users row on RPC failure
  if (rpcThrew || !rpcResult || !rpcResult.success) {
    await admin.auth.admin.deleteUser(newUserId).catch(() => {});
    if (rpcThrew) {
      return jsonResponse(500, {
        ok: false,
        error_code: "provision_threw",
        error_message: rpcErrMsg ?? "add_agent_to_tenant threw without a message",
      });
    }
    return jsonResponse(400, {
      ok: false,
      error_code: rpcResult!.error_code,
      error_message: rpcResult!.error_message,
    });
  }

  return jsonResponse(200, {
    ok: true,
    agent_id:  rpcResult.agent_id,
    tenant_id: rpcResult.tenant_id,
  });
});
