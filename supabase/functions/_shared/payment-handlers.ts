/**
 * Stateful handlers for invoice.paid / invoice.payment_failed.
 *
 * Lives under supabase/functions/_shared/ but the surface is a pair of pure
 * functions that take a "minimal admin client" interface — small enough to
 * fake from bun tests, broad enough to satisfy the real
 * @supabase/supabase-js client at the call site.
 *
 * RULES (S-1 §5 update for PR 2 gap closure):
 *   - invoice.payment_failed →
 *       count := tenants.payment_failure_count + 1
 *       UPDATE payment_failure_count = count
 *       IF count >= 3 ALSO UPDATE billing_status = 'past_due'
 *   - invoice.paid →
 *       UPDATE payment_failure_count = 0,
 *              billing_status = 'active',
 *              is_in_trial = false
 *
 * AUDIT INTEGRATION:
 *   These functions do NOT read from or write to stripe_webhook_events. The
 *   audit row is owned by the webhook outer flow: it inserts the row on
 *   event arrival (with `processed_at = NULL`), then calls the handler, then
 *   stamps `processed_at = now()` if the handler returns ok. A redelivery
 *   short-circuits in the outer flow (see handleAuditInsert below) so the
 *   handler is never re-entered for an already-processed event.
 */

export type BillingStatus = "active" | "past_due" | "suspended" | "cancelled";

/**
 * Minimum admin-client surface used by the stateful handlers. Real callers
 * pass a @supabase/supabase-js SupabaseClient; tests pass an in-memory fake.
 *
 * The shape is awkward because supabase-js returns a chainable builder
 * rather than a plain function. To keep tests sane we narrow to just the
 * three call patterns we use:
 *   1. admin.from('tenants').select(...).eq('id', tid).maybeSingle()
 *   2. admin.from('tenants').update(patch).eq('id', tid)
 *   3. admin.from('stripe_webhook_events').insert({...})
 *   4. admin.from('stripe_webhook_events').select(...).eq('event_id', e).maybeSingle()
 *   5. admin.from('stripe_webhook_events').update({...}).eq('event_id', e)
 */
export type AdminLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
      };
    };
    insert: (row: Record<string, unknown>) => Promise<{ error: { code?: string; message: string } | null }>;
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
  };
};

export type PaymentFailedResult =
  | { ok: true; tenant_id: string; new_count: number; billing_status_set?: "past_due" }
  | { ok: false; error_code: "tenant_lookup_failed" | "tenant_update_failed"; error_message: string };

export type PaymentPaidResult =
  | { ok: true; tenant_id: string }
  | { ok: false; error_code: "tenant_update_failed"; error_message: string };

const PAST_DUE_THRESHOLD = 3;

/**
 * Apply the invoice.payment_failed state transition for a tenant.
 *
 * count := current payment_failure_count + 1; if count >= 3 also flip
 * billing_status to 'past_due' atomically.
 */
export async function applyInvoicePaymentFailed(
  admin: AdminLike,
  tenantId: string,
): Promise<PaymentFailedResult> {
  const { data, error } = await admin
    .from("tenants")
    .select("payment_failure_count")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    return { ok: false, error_code: "tenant_lookup_failed", error_message: error.message };
  }

  const current = typeof data?.payment_failure_count === "number" ? (data.payment_failure_count as number) : 0;
  const newCount = current + 1;

  const patch: Record<string, unknown> = { payment_failure_count: newCount };
  let billingStatusSet: "past_due" | undefined;
  if (newCount >= PAST_DUE_THRESHOLD) {
    patch.billing_status = "past_due";
    billingStatusSet = "past_due";
  }

  const { error: updErr } = await admin.from("tenants").update(patch).eq("id", tenantId);
  if (updErr) {
    return { ok: false, error_code: "tenant_update_failed", error_message: updErr.message };
  }

  return billingStatusSet
    ? { ok: true, tenant_id: tenantId, new_count: newCount, billing_status_set: billingStatusSet }
    : { ok: true, tenant_id: tenantId, new_count: newCount };
}

/**
 * Apply the invoice.paid state transition for a tenant: reset failure count,
 * clear past_due / trialing flags.
 */
export async function applyInvoicePaid(
  admin: AdminLike,
  tenantId: string,
): Promise<PaymentPaidResult> {
  const { error: updErr } = await admin
    .from("tenants")
    .update({
      payment_failure_count: 0,
      billing_status: "active" as BillingStatus,
      is_in_trial: false,
    })
    .eq("id", tenantId);

  if (updErr) {
    return { ok: false, error_code: "tenant_update_failed", error_message: updErr.message };
  }

  return { ok: true, tenant_id: tenantId };
}

export type AuditInsertResult =
  | { ok: true; new_row: true }
  | { ok: true; new_row: false; already_processed: boolean }
  | { ok: false; error_code: "audit_insert_failed"; error_message: string };

/**
 * Insert into stripe_webhook_events, handling the redelivery path.
 *
 *   - If the insert succeeds → new event, processed_at starts NULL → caller
 *     proceeds with mutation. Returns { ok: true, new_row: true }.
 *   - If the insert fails with 23505 (unique_violation on event_id PK) →
 *     redelivery. Read the existing row's processed_at:
 *       - non-null → already fully processed; caller should return 200
 *         immediately. Returns { ok: true, new_row: false,
 *         already_processed: true }.
 *       - null → prior attempt errored mid-flight; caller should re-run
 *         the handler. Returns { ok: true, new_row: false,
 *         already_processed: false }.
 *   - Any other insert error → opaque failure. Returns ok=false.
 */
export async function handleAuditInsert(
  admin: AdminLike,
  eventId: string,
  eventType: string,
  raw: Record<string, unknown>,
): Promise<AuditInsertResult> {
  const { error: insErr } = await admin
    .from("stripe_webhook_events")
    .insert({
      event_id: eventId,
      event_type: eventType,
      raw,
    });

  if (!insErr) {
    return { ok: true, new_row: true };
  }

  if (insErr.code === "23505") {
    // Redelivery. Inspect the existing row.
    const { data: existing, error: selErr } = await admin
      .from("stripe_webhook_events")
      .select("processed_at")
      .eq("event_id", eventId)
      .maybeSingle();
    if (selErr) {
      return { ok: false, error_code: "audit_insert_failed", error_message: selErr.message };
    }
    const processedAt = existing?.processed_at;
    return { ok: true, new_row: false, already_processed: processedAt !== null && processedAt !== undefined };
  }

  return { ok: false, error_code: "audit_insert_failed", error_message: insErr.message };
}

/**
 * Stamp processed_at = now() and (optionally) tenant_id on the audit row.
 * Best-effort: errors are surfaced to the caller for logging but the
 * webhook response stays 200 — the state mutation already committed.
 */
export async function markAuditProcessed(
  admin: AdminLike,
  eventId: string,
  tenantId: string | null,
): Promise<{ ok: boolean; error_message?: string }> {
  const patch: Record<string, unknown> = { processed_at: new Date().toISOString() };
  if (tenantId !== null) patch.tenant_id = tenantId;
  const { error } = await admin
    .from("stripe_webhook_events")
    .update(patch)
    .eq("event_id", eventId);
  if (error) return { ok: false, error_message: error.message };
  return { ok: true };
}
