# Stripe Products and Vault Configuration

Last updated: 2026-05-15
Sourced from: `wiki/pricing-and-checkout.md` (final pricing lock 2026-05-01).

This file documents the Stripe product catalog and the Supabase Vault secrets the platform expects. It is **manual setup** — no code in this repo creates the Stripe products or writes the Vault entries. PR 2 (Stripe Edge Functions) reads them at runtime; this file is the recipe for any operator standing up a fresh environment.

---

## The Stripe product catalog

Five recurring products + one usage-priced unit + one add-on per domain. All monthly recurring unless noted.

| Internal name | Stripe Product name | Stripe Price | Type | Notes |
|---|---|---|---|---|
| Starter | Base Shop HQ — Starter | `$97.00 / mo` | Flat recurring | Default tier on new self-serve signups. 3-agent cap. White-label NOT available. |
| Growth | Base Shop HQ — Growth | `$297.00 / mo` | Flat recurring | 10-agent cap. White-label available. |
| Pro | Base Shop HQ — Pro | `$497.00 / mo` | Flat recurring | 50-agent cap. White-label available. Most popular highlight on the marketing page. |
| Enterprise (per-agent unit) | Base Shop HQ — Enterprise (Active Agent) | `$25.00 / mo / unit` (default — negotiable per contract) | Usage-based recurring (Stripe metered) | 50+ agents. Unit = active agent for the prior 30 days. Reported monthly via `/v1/subscription_items/{id}/usage_records` from the snapshot job (PR 2). |
| White-Label Add-On | Base Shop HQ — White-Label Add-On | `$97.00 / mo` | Flat recurring | Attached to Growth, Pro, or Enterprise subscriptions only. Database CHECK blocks it on Starter. |
| Additional Vanity Domain | Base Shop HQ — Additional Vanity Domain | `$25.00 / mo / domain` | Flat recurring, per quantity | Only attachable when White-Label Add-On is active. One vanity domain is included with the add-on; additional domains bill per this line item. |
| Starter (annual) | Base Shop HQ — Starter (Annual) | `$970.00 / yr` | Flat recurring | Annual variant of Starter. Two months free vs monthly. Same 3-agent cap. |
| Growth (annual) | Base Shop HQ — Growth (Annual) | `$2,970.00 / yr` | Flat recurring | Annual variant of Growth. Two months free vs monthly. |
| Pro (annual) | Base Shop HQ — Pro (Annual) | `$4,970.00 / yr` | Flat recurring | Annual variant of Pro. Two months free vs monthly. |
| White-Label Add-On (annual) | Base Shop HQ — White-Label Add-On (Annual) | `$970.00 / yr` | Flat recurring | Annual variant of the white-label add-on. Two months free vs monthly. |

### Setup checklist (Stripe Dashboard)

1. Create the six products above with the exact names and monthly recurring prices.
2. For the Enterprise per-agent product:
   - Choose **Usage-based** pricing.
   - Aggregation: **Sum of usage values during period**.
   - Default unit price: $25.00. Override per contract by creating a tenant-specific price or by negotiating a custom price ID.
3. For the Additional Vanity Domain product: **Per-unit** pricing so multiple domains stack.
4. Set up a webhook endpoint pointing at `https://<project>.functions.supabase.co/stripe-webhook` (created in PR 2). Subscribe to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
5. Copy the **webhook signing secret** into Supabase Vault as `stripe_webhook_signing_secret`.
6. Copy each Price ID into Supabase Vault per the table below.

### pg_cron and pg_net (one-time operator step, required for Enterprise metering)

The monthly active-agent snapshot job runs as a `pg_cron` schedule that calls the `active-agent-snapshot` Edge Function via `pg_net.http_post`. Both extensions are off by default on Supabase Cloud and must be enabled manually before the schedule will fire:

1. Open **Supabase Dashboard → Database → Extensions**.
2. Search for `pg_cron` and toggle it **on**. Confirm the schema (`extensions` is fine).
3. Search for `pg_net` and toggle it **on**.
4. Open the Vault and create a new secret named **`active_agent_snapshot_secret`** (see the table below). The value should be a fresh 32-byte random hex string — generate with `openssl rand -hex 32`. This is the shared secret pg_cron will send in the `X-Snapshot-Secret` header; the Edge Function compares against the same Vault entry.
5. Re-apply migration `20260518100000_phase17_vault_helpers.sql` (or run a no-op follow-up that re-executes the DO block). The migration is defensively wrapped — the first apply succeeds even without `pg_cron`, and only the cron schedule install gets skipped (with a `RAISE NOTICE`). After enabling the extensions, the re-apply installs the schedule.

The schedule line is `0 6 1 * *` (06:00 UTC on the 1st of each month), with target URL `https://<project>.functions.supabase.co/active-agent-snapshot`.

---

## Supabase Vault entries

The platform reads these at runtime via `vault.decrypted_secrets`. Set them via the **Supabase Dashboard → Project Settings → Vault** UI. Do not commit values.

| Vault key | What it holds | Where it's read |
|---|---|---|
| `stripe_secret_key` | Stripe API secret key (`sk_live_...` or `sk_test_...`) | Every Stripe API call from Edge Functions (PR 2). |
| `stripe_webhook_signing_secret` | Stripe webhook signing secret (`whsec_...`) | The `stripe-webhook` Edge Function verifies signatures using this. |
| `stripe_price_starter` | Price ID for the Starter monthly | Checkout session creation for Starter signups. |
| `stripe_price_growth` | Price ID for the Growth monthly | Checkout session creation for Growth signups. |
| `stripe_price_pro` | Price ID for the Pro monthly | Checkout session creation for Pro signups. |
| `stripe_price_enterprise_active_agent_unit` | Price ID for the Enterprise per-active-agent unit | Used by the monthly snapshot job to find the subscription item to report usage against. |
| `stripe_price_white_label_addon` | Price ID for the White-Label Add-On | Attached as a second line item on Growth/Pro/Enterprise checkouts when the toggle is on; can also be added/removed via the in-app Billing page. |
| `stripe_price_additional_vanity_domain` | Price ID for additional vanity domains beyond the first | Quantity-based line item, incremented when an agency provisions a second (or third…) custom domain. |
| `active_agent_snapshot_secret` | Shared secret for pg_cron → Edge Function authentication, 32-byte random hex (generate with `openssl rand -hex 32`) | The monthly `pg_cron` job sends this in `X-Snapshot-Secret`; the `active-agent-snapshot` Edge Function reads it from Vault and compares. |
| `stripe_price_starter_annual` | Price ID for the Starter annual | Used by `create-checkout-session` and `billing-mutate` (PR 3c) when `interval='annual'` and tier='starter'. |
| `stripe_price_growth_annual` | Price ID for the Growth annual | Same as above for Growth. |
| `stripe_price_pro_annual` | Price ID for the Pro annual | Same as above for Pro. |
| `stripe_price_white_label_addon_annual` | Price ID for the White-Label Add-On annual | Attached as a second line item on annual Growth/Pro/Enterprise subscriptions when the WL toggle is on. |

### Verifying Vault is populated (from psql)

```sql
SELECT name FROM vault.decrypted_secrets WHERE name IN (
  'stripe_secret_key',
  'stripe_webhook_signing_secret',
  'stripe_price_starter',
  'stripe_price_growth',
  'stripe_price_pro',
  'stripe_price_enterprise_active_agent_unit',
  'stripe_price_white_label_addon',
  'stripe_price_additional_vanity_domain',
  'active_agent_snapshot_secret',
  'stripe_price_starter_annual',
  'stripe_price_growth_annual',
  'stripe_price_pro_annual',
  'stripe_price_white_label_addon_annual'
) ORDER BY name;
```

Should return all 13 names. If any are missing, code paths that need them fail explicitly at the call site rather than silently — the Edge Function checks each lookup and returns a structured error if the secret is absent.

---

## Annual pricing math

The annual prices use a 2-months-free convention vs the monthly price:

| Tier | Monthly | Annual | Annual = (Monthly × 10) |
|---|---|---|---|
| Starter | `$97.00 / mo` | `$970.00 / yr` | `$97 × 10 = $970` |
| Growth  | `$297.00 / mo` | `$2,970.00 / yr` | `$297 × 10 = $2,970` |
| Pro     | `$497.00 / mo` | `$4,970.00 / yr` | `$497 × 10 = $4,970` |
| White-Label Add-On | `$97.00 / mo` | `$970.00 / yr` | `$97 × 10 = $970` |

Enterprise is metered (active-agent), so no annual variant exists — its catalog row stays monthly only. The validation chain (`tier-resolver` → `create-checkout-session` → `billing-mutate`) rejects `tier='enterprise' && interval='annual'` with `enterprise_annual_not_supported`.

---

## Tier → cap denormalization

For convenience, the migration `20260517100000_phase17_billing_schema.sql` writes `tenants.agent_cap` automatically based on `tenants.current_plan_tier`:

| Tier | `agent_cap` |
|---|---|
| `starter` | `3` |
| `growth` | `10` |
| `pro` | `50` |
| `enterprise` | `9999` (sentinel for "unbounded by tier; billed by active-agent usage") |

The sync runs in a BEFORE trigger on `tenants.current_plan_tier` change, so `agent_cap` is always consistent with the tier. The `enforce_agent_cap(uuid)` RPC short-circuits to `ok=true` whenever the tenant is on Enterprise (or whenever `agent_cap >= 9999`).

---

## What's NOT in this PR

This PR (PR 1 of 3) ships the schema, the cap-denormalization trigger, the `enforce_agent_cap` RPC, and this doc. The following remain queued:

- **PR 2 — Stripe integration code:** Edge Functions for `stripe-webhook`, `create-checkout-session`, and the monthly active-agent snapshot job. Subscription state machine that maps Stripe events to `tenants.billing_status` transitions. Failed-payment grace period that flips a tenant to `billing_status = 'past_due'` after 3 failures or 14 days, then to `'suspended'` (read-only).
- **PR 3 — Billing page UI:** owner-only `/billing` route, current-tier display, agent-cap usage bar, Enterprise active-agent count, "Manage in Stripe" button (Customer Portal link), upgrade/downgrade flow, white-label toggle, last 6 snapshots.

When PR 2 lands, this doc gains a "PR 2 Vault sanity check" section. When PR 3 lands, this doc gains the in-app surfaces listed.

---

## Related

- `wiki/pricing-and-checkout.md` — the canonical pricing model
- `wiki/active-agent-billing-model.md` — Enterprise metering definition
- `wiki/white-label-and-sub-account-architecture.md` — White-Label Add-On context
- `branded/audits/stripe-prompt-2-audit.md` — the 12 success criteria this rollout begins to ship
- `supabase/migrations/20260517100000_phase17_billing_schema.sql` — this PR's schema migration
