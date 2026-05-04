import { useState } from "react";
import { supabase, SUPABASE_FUNCTIONS_URL } from "@/lib/supabase-browser";

export type AddAgentInput = {
  email: string;
  firstName: string;
  lastName: string;
  uplineEmail?: string;
};

export type AddAgentResult =
  | { ok: true; agentId: string; tenantId: string }
  | { ok: false; errorCode: string; errorMessage: string };

/**
 * Wraps the add-agent edge function. Caller must be authenticated as the
 * tenant owner (the edge function reads the JWT and validates is_owner).
 */
export function useAddAgent() {
  const [submitting, setSubmitting] = useState(false);

  async function addAgent(input: AddAgentInput): Promise<AddAgentResult> {
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        return { ok: false, errorCode: "no_session", errorMessage: "You must be signed in." };
      }

      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/add-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(input),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        return {
          ok: false,
          errorCode: json.error_code ?? "unknown",
          errorMessage: json.error_message ?? "Add agent failed.",
        };
      }
      return { ok: true, agentId: json.agent_id, tenantId: json.tenant_id };
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

  return { addAgent, submitting };
}

/** Map error_code values from the edge function / RPC to friendly user copy. */
export function mapAddAgentErrorCode(code: string, detail?: string): string {
  switch (code) {
    case "email_already_in_use":
      return "This email is already registered. The user must contact support to be added.";
    case "email_already_in_tenant":
      return "An agent with this email already exists in your tenant.";
    case "caller_not_owner":
      return "Only the tenant owner can add agents.";
    case "caller_no_agent_record":
      return "Your account is not linked to a tenant.";
    case "validation_failed":
      return detail ? `Please check your input. ${detail}` : "Please check your input and try again.";
    case "no_session":
      return "You must be signed in.";
    case "invite_failed":
      return detail ?? "Could not send the invite. Please try again.";
    case "provision_threw":
      return "Something went wrong on our end. Please try again.";
    case "network_error":
      return detail ?? "Network error.";
    default:
      return detail ?? "Add agent failed.";
  }
}
