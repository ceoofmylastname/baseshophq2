/**
 * Supabase Edge Function: enterprise-snapshot (Phase 17 PR 2 + gap closure)
 *
 * verify_jwt = false. Authenticated via the shared `X-Snapshot-Secret`
 * header — pg_cron POSTs to this endpoint daily at 00:05 UTC and includes
 * the secret read from the Vault entry `active_agent_snapshot_secret`. The
 * cron schedule + secret expectation are documented in branded/stripe-products.md.
 *
 * Run gate (daily-with-1st-of-month-gate):
 *   - On the 1st of the month (UTC): process all eligible enterprise tenants.
 *   - Any other day: act as a "recovery" pass — if every enterprise tenant
 *     already has a billing_snapshots row for the prior period_start, fast-
 *     skip with `{ ok: true, skipped: 'not_first_of_month' }`. Otherwise
 *     process only the missing ones so a one-off failure on the 1st gets
 *     caught up automatically by the next day's run.
 *
 * Per processed tenant:
 *   1. Compute active-agent count via the SECURITY DEFINER
 *      public.compute_active_agent_count RPC (canonical definition from
 *      wiki/active-agent-billing-model.md).
 *   2. Find the Enterprise per-active-agent subscription item by resolving
 *      the subscription's items against the
 *      stripe_price_enterprise_active_agent_unit catalog entry.
 *   3. Report the count to Stripe via
 *      `stripe.subscriptionItems.createUsageRecord` (timestamp = period
 *      start, action = 'set' — overwrites any prior report for the period).
 *   4. UPSERT into billing_snapshots with ignoreDuplicates so that silent
 *      re-runs are no-ops at the DB layer (the unique constraint on
 *      (tenant_id, period_start) is the source of truth).
 *
 * Filter: only `billing_status IN ('active','past_due')` enterprise tenants
 * are processed. Cancelled / suspended tenants are skipped — they aren't
 * being charged so there is nothing to report.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  CORS_HEADERS,
  getAdminClient,
  getStripeClient,
  getVaultSecret,
  jsonResponse,
} from "../_shared/stripe-client.ts";

type TenantRow = {
  id: string;
  stripe_subscription_id: string | null;
  current_plan_tier: string;
};

type SnapshotResult = {
  tenant_id: string;
  active_agent_count: number | null;
  stripe_usage_record_id: string | null;
  skipped: boolean;
  reason?: string;
  error?: string;
};

/**
 * Compute the prior-month period [period_start, period_end] for snapshotting
 * usage. Run on the 1st → period covers the just-completed calendar month.
 */
function priorMonthPeriod(now: Date): { period_start: Date; period_end: Date } {
  // First day of the previous month, in UTC
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  // Last day of the previous month, in UTC (= day 0 of the current month)
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { period_start: periodStart, period_end: periodEnd };
}

function isoDate(d: Date): string {
  // YYYY-MM-DD slice of the UTC ISO string — billing_snapshots.period_start is date
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST")     return jsonResponse(405, { ok: false, error: "method not allowed" });

  let admin;
  try {
    admin = getAdminClient();
  } catch (e) {
    return jsonResponse(500, { ok: false, error_code: "env_missing", error_message: e instanceof Error ? e.message : String(e) });
  }

  // ---- Shared-secret auth ----
  const providedSecret = req.headers.get("x-snapshot-secret") ?? "";
  let expectedSecret: string | null;
  try {
    expectedSecret = await getVaultSecret(admin, "active_agent_snapshot_secret");
  } catch (e) {
    return jsonResponse(500, { ok: false, error_code: "vault_read_failed", error_message: e instanceof Error ? e.message : String(e) });
  }
  if (!expectedSecret) {
    return jsonResponse(500, { ok: false, error_code: "snapshot_secret_missing", error_message: "active_agent_snapshot_secret is not set in Vault" });
  }
  if (providedSecret !== expectedSecret) {
    return jsonResponse(401, { ok: false, error_code: "invalid_snapshot_secret", error_message: "X-Snapshot-Secret header missing or wrong" });
  }

  const now = new Date();
  const isFirstOfMonth = now.getUTCDate() === 1;
  const { period_start: periodStartDate, period_end: periodEndDate } = priorMonthPeriod(now);
  const periodStartISO = isoDate(periodStartDate);
  const periodEndISO   = isoDate(periodEndDate);

  // ---- Pre-flight: find the enterprise unit price ID (we need it to map
  //      subscription items to the right line). Missing → fatal because the
  //      whole job needs it. ----
  let enterpriseUnitPriceId: string | null;
  try {
    enterpriseUnitPriceId = await getVaultSecret(admin, "stripe_price_enterprise_active_agent_unit");
  } catch (e) {
    return jsonResponse(500, { ok: false, error_code: "vault_read_failed", error_message: e instanceof Error ? e.message : String(e) });
  }
  if (!enterpriseUnitPriceId) {
    return jsonResponse(500, {
      ok: false,
      error_code: "price_id_missing",
      error_message: "Vault entry stripe_price_enterprise_active_agent_unit is not set",
    });
  }

  let stripe;
  try {
    stripe = await getStripeClient();
  } catch (e) {
    return jsonResponse(500, { ok: false, error_code: "stripe_init_failed", error_message: e instanceof Error ? e.message : String(e) });
  }

  // ---- Pull eligible Enterprise tenants ----
  //      Filter: active + past_due only. Cancelled/suspended tenants aren't
  //      being charged for the period so there's nothing to report.
  const { data: tenants, error: tenantsErr } = await admin
    .from("tenants")
    .select("id, stripe_subscription_id, current_plan_tier")
    .eq("current_plan_tier", "enterprise")
    .in("billing_status", ["active", "past_due"]);
  if (tenantsErr) {
    return jsonResponse(500, { ok: false, error_code: "tenants_query_failed", error_message: tenantsErr.message });
  }

  // ---- Run gate ----
  //      On the 1st of the month: process every eligible tenant.
  //      Other days: only process tenants whose prior-period snapshot is
  //      missing (recovery from a failed 1st-of-month run). If everyone is
  //      up-to-date, short-circuit with skipped='not_first_of_month'.
  let tenantsToProcess: TenantRow[] = (tenants ?? []) as TenantRow[];
  if (!isFirstOfMonth) {
    const { data: existing, error: existingErr } = await admin
      .from("billing_snapshots")
      .select("tenant_id")
      .eq("period_start", periodStartISO);
    if (existingErr) {
      return jsonResponse(500, { ok: false, error_code: "snapshots_query_failed", error_message: existingErr.message });
    }
    const haveSnapshot = new Set<string>((existing ?? []).map((r: { tenant_id: string }) => r.tenant_id));
    tenantsToProcess = tenantsToProcess.filter(t => !haveSnapshot.has(t.id));
    if (tenantsToProcess.length === 0) {
      return jsonResponse(200, {
        ok: true,
        skipped: "not_first_of_month",
        period_start: periodStartISO,
        period_end:   periodEndISO,
        eligible:     tenants?.length ?? 0,
        processed:    0,
      });
    }
  }

  // Stripe usage_record timestamp is UNIX seconds — anchor at period_start
  const usageTimestamp = Math.floor(periodStartDate.getTime() / 1000);

  const results: SnapshotResult[] = [];

  for (const tenant of tenantsToProcess) {
    const result: SnapshotResult = {
      tenant_id: tenant.id,
      active_agent_count: null,
      stripe_usage_record_id: null,
      skipped: false,
    };

    try {
      // 1. Compute count via SECURITY DEFINER RPC
      const { data: countData, error: countErr } = await admin.rpc(
        "compute_active_agent_count",
        { p_tenant_id: tenant.id },
      );
      if (countErr) {
        result.skipped = true;
        result.error = `compute_active_agent_count failed: ${countErr.message}`;
        results.push(result);
        continue;
      }
      const count = (countData as number | null) ?? 0;
      result.active_agent_count = count;

      // 2. Find the subscription item to report against
      if (!tenant.stripe_subscription_id) {
        result.skipped = true;
        result.reason = "no_stripe_subscription_id";
        results.push(result);
        continue;
      }

      let usageItemId: string | null = null;
      try {
        const sub = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
        for (const item of sub.items?.data ?? []) {
          if (item.price?.id === enterpriseUnitPriceId) {
            usageItemId = item.id;
            break;
          }
        }
      } catch (e) {
        result.skipped = true;
        result.error = `stripe.subscriptions.retrieve failed: ${e instanceof Error ? e.message : String(e)}`;
        results.push(result);
        continue;
      }

      if (!usageItemId) {
        result.skipped = true;
        result.reason = "no_enterprise_usage_item_on_subscription";
        results.push(result);
        continue;
      }

      // 3. Report usage to Stripe (action='set' so retries overwrite cleanly)
      try {
        const usageRecord = await stripe.subscriptionItems.createUsageRecord(
          usageItemId,
          {
            quantity: count,
            timestamp: usageTimestamp,
            action: "set",
          },
        );
        result.stripe_usage_record_id = usageRecord.id;
      } catch (e) {
        result.skipped = true;
        result.error = `stripe.subscriptionItems.createUsageRecord failed: ${e instanceof Error ? e.message : String(e)}`;
        results.push(result);
        continue;
      }

      // 4. Persist the snapshot via UPSERT with ignoreDuplicates so silent
      //    re-runs (e.g. cron firing on an already-processed period) are
      //    no-ops at the DB layer. The unique constraint on
      //    (tenant_id, period_start) — installed in PR 1 — is the source of
      //    truth; this just makes accidental double-fires harmless.
      const { error: upsertErr } = await admin
        .from("billing_snapshots")
        .upsert(
          {
            tenant_id:              tenant.id,
            period_start:           periodStartISO,
            period_end:             periodEndISO,
            active_agent_count:     count,
            tier_at_snapshot:       tenant.current_plan_tier,
            stripe_usage_record_id: result.stripe_usage_record_id,
          },
          { onConflict: "tenant_id,period_start", ignoreDuplicates: true },
        );
      if (upsertErr) {
        result.error = `billing_snapshots upsert failed: ${upsertErr.message}`;
        // We still report success for the Stripe usage_record; just flag.
      }

      results.push(result);
    } catch (e) {
      result.skipped = true;
      result.error = `unexpected: ${e instanceof Error ? e.message : String(e)}`;
      results.push(result);
    }
  }

  const summary = {
    ok: true,
    is_first_of_month: isFirstOfMonth,
    period_start: periodStartISO,
    period_end:   periodEndISO,
    eligible:     tenants?.length ?? 0,
    processed:    results.length,
    succeeded:    results.filter(r => !r.skipped && !r.error).length,
    skipped:      results.filter(r => r.skipped).length,
    errored:      results.filter(r => r.error && !r.skipped).length,
    results,
  };

  console.log(JSON.stringify({ msg: "enterprise_snapshot_run", ...summary }));

  return jsonResponse(200, summary);
});
