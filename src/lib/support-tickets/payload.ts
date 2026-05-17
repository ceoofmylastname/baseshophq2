/**
 * Phase 18.1 — Support ticket payload builder.
 *
 * Pure helper, no IO. Used by <ContactSupportModal /> to assemble the row
 * that gets INSERTed into public.support_tickets. Subject is defaulted
 * server-side to "Contact request from ${source}" and is NOT surfaced in
 * the modal UI per locked D11. Email and message are trimmed; tenant_id
 * null-coalesces because unauthenticated mounts will not have a tenant.
 */

export type SupportTicketPayloadInput = {
  email: string;
  message: string;
  source: string;
  tenant_id?: string | null;
};

export type SupportTicketPayload = {
  email: string;
  subject: string;
  message: string;
  source: string;
  tenant_id: string | null;
};

export function buildSupportTicketPayload(
  input: SupportTicketPayloadInput,
): SupportTicketPayload {
  return {
    email: input.email.trim(),
    subject: `Contact request from ${input.source}`,
    message: input.message.trim(),
    source: input.source,
    tenant_id: input.tenant_id ?? null,
  };
}
