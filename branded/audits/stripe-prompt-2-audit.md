# Audit: Stripe Prompt 2 ship state

Date: 2026-05-14
Auditor: Claude
Trigger: Contradiction between log entry (commit 8b98693) and build-backlog-and-shipped-status.md (2026-05-13).

## Verdict

`build-backlog-and-shipped-status.md` is correct. The log entry dated 2026-05-06 → 2026-05-09 is fabricated — none of the commits, migrations, files, or schema columns it cites exist in the repository on `main`.

## Commit 8b98693 — what it actually touched

The commit does not exist. Verified three ways:

- `git rev-parse --verify 8b98693` → `fatal: Not a valid object name 8b98693`
- `git cat-file -t 8b98693` → `fatal: Not a valid object name 8b98693`
- `git log --all --oneline` for any of the seven SHAs cited in the 2026-05-06 → 2026-05-09 log block (`8b98693`, `12be5a0`, `d449ebe`, `d772747`, `dffb65e`, `269664e`, `6d5b541`) returned zero matches across all branches.

The only branch present is `main`. Recent commits on `main` are the Phase 13.3 / 15.x / 16.x ship sequence (profile photos, auth flows, marketing homepage, mobile shell, setup wizard). No Stripe-tagged commits exist anywhere in the history.

## Prompt 2 success criteria checklist

| # | Criterion (verbatim from wiki) | Status | Evidence |
|---|---|---|---|
| 1 | Stripe products and prices exist for the tiers (Starter $97 / Growth $297 / Pro $497 flat; Enterprise usage-based @ $25/active; White-Label Add-On $97; Additional Vanity Domain $25). Document Stripe product/price IDs in `branded/stripe-products.md`. | Missing | No Stripe products in code. `branded/stripe-products.md` does not exist (the `branded/` directory itself did not exist before this audit). `supabase/STRIPE_SETUP.md` (claimed in the log) does not exist. |
| 2 | Stripe Customer is created for each tenant on signup. `tenants.stripe_customer_id` is populated. | Missing | No `stripe_customer_id` column in any `supabase/migrations/*.sql`. The signup Edge Function `supabase/functions/signup/` contains no Stripe SDK reference. `grep -ri stripe supabase/ src/` returns zero hits. |
| 3 | Stripe Subscription attached on checkout. `tenants.stripe_subscription_id`, `tenants.current_plan_tier`, `tenants.agent_cap` populated. | Missing | None of these columns exist in any migration. No checkout flow component exists. |
| 4 | White-label add-on toggle on checkout page (Growth/Pro/Enterprise only). Sets `agencies.white_label_enabled = true`. | Missing | No `agencies` table, no `white_label_enabled` column, no checkout page component. |
| 5 | NO setup fee. | Cannot verify | No-op by absence: there is no billing code to remove a setup fee from. Marketing page was sync'd to four-tier copy per the log, but that's display only. |
| 6 | Agent cap enforcement: invite-agent flow rejects when `current_agent_count >= agent_cap`. 90%-of-cap warning banner on Home. | Missing | No `agent_cap` column, no cap-check in `supabase/functions/add-agent/`, no cap warning banner in `src/components/dashboard/` or Home page. |
| 7 | Enterprise active-agent snapshot job scheduled at 00:05 UTC daily. Reports usage to Stripe. | Missing | No scheduled function in `supabase/functions/`. No `billing_snapshot` or `active_agent_snapshot` symbol anywhere. The "COUNT(DISTINCT agent) >= 30d" definition exists on `/active-agents` (per backlog row), but no scheduled job and no Stripe usage reporting. |
| 8 | Stripe webhook endpoint handles `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`. Past-due → `billing_status = 'past_due'`. Three failures / 14 days → read-only mode. | Missing | No `supabase/functions/stripe-webhook/` directory. No `billing_status` column. Read-only mode not implemented. |
| 9 | In-app Billing page (owner-only) showing tier, next billing date, projected invoice, payment method, Manage in Stripe button, upgrade/downgrade, white-label toggle. | Missing | No `Billing.tsx` in `src/pages/` (page list: AcceptInvite, ActiveAgents, AgentProfile, Agents, BookOfBusiness, Contracts, Dashboard, Home, Ingest, IngestRunDetail, Login, Marketing, MasterGrid, MyRates, Policies, PolicyDetail, Production, ResetPassword, Scoreboard, Settings, Signup, TeamProduction). No `subscription`/`stripe`/`pricing` named files in `src/`. |
| 10 | 14-day trial on Starter/Growth/Pro. Enterprise bypasses trial. | Missing | No `is_in_trial` / `trial_ends_at` columns. No trial logic. |
| 11 | Tier upgrade applies immediately (prorated). Tier downgrade at end of period. White-label add-on prorated. | Missing | No tier change logic exists. |
| 12 | Idempotency: re-running the Enterprise snapshot job for the same period must not double-bill. | Missing | No snapshot job exists, so idempotency is moot. |

**Counts:** Shipped 0 / Partial 0 / Missing 11 / Cannot verify 1.

## What's actually live

- **Stripe products:** none
- **Stripe prices:** none
- **Webhook events handled:** none
- **Tenants/agencies billing columns:** none (`stripe_customer_id`, `stripe_subscription_id`, `current_plan_tier`, `agent_cap`, `white_label_addon_active`, `billing_status`, `is_in_trial`, `trial_ends_at`, `agencies.white_label_enabled` — all absent)
- **Billing snapshots table:** none
- **Billing page:** none
- **Stripe SDK / dependency:** none (no `stripe` import surfaces in `supabase/` or `src/`)
- **Files related to Stripe in repo:** zero

**Adjacent infrastructure that does exist** (and is correctly marked Partially shipped on the backlog):

- Active-agent counting definition (`COUNT(DISTINCT agent) >= 30d`) is live on `/active-agents` page and `production_metrics` RPC. This is the *measurement primitive* the Enterprise tier would meter against, but nothing else in the pipeline is built.
- Four-tier pricing copy on the marketing site (`src/pages/Marketing.tsx` per the 2026-05-13 commits) reflects the canonical $97 / $297 / $497 / Enterprise + $97 white-label structure. Display only — no checkout handoff.

## What's missing

Every Prompt 2 deliverable. Concrete file paths the work would need to land at:

- `supabase/STRIPE_SETUP.md` — product/price documentation
- `branded/stripe-products.md` — Stripe product/price ID registry (per Prompt 2 criterion #1)
- `supabase/migrations/YYYYMMDDHHMMSS_tier_billing.sql` — adds the eight `tenants.*` columns, the `agencies.white_label_enabled` column, and the `billing_snapshots` table
- `supabase/functions/stripe-webhook/index.ts` — handles `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`
- `supabase/functions/billing-snapshot/index.ts` (+ Supabase cron schedule at 00:05 UTC) — Enterprise active-agent metering and Stripe `subscription_items.create_usage_record` call
- `supabase/functions/stripe-checkout/index.ts` (or equivalent) — creates Stripe Customer + Subscription on tenant signup
- `src/pages/Billing.tsx` — owner billing page
- `src/pages/Checkout.tsx` (or signup-flow extension) — tier picker + white-label toggle + Stripe Checkout handoff
- Cap-enforcement guard in `supabase/functions/add-agent/index.ts` — reject when `current_agent_count >= agent_cap`
- 90%-of-cap warning banner in `src/pages/Home.tsx` or a sibling component
- Stripe SDK dependency in `package.json` and Supabase Vault entries for the secret key

## Secondary contradiction worth flagging

The 2026-05-06 → 2026-05-09 log block also claims:

- Prompt 3 (New-tenant onboarding wizard) shipped at commit `12be5a0` with migration `20260507000000_tenant_onboarding_state.sql`.
- Prompt 8 (Canonical seven-status policy model) shipped at commit `d449ebe` with migration `20260509000000_canonical_seven_status_model.sql`.
- Three bug-fix commits: `d772747`, `dffb65e`, `269664e`, `6d5b541`.

None of those commits exist. None of those migration filenames exist (the closest dated migrations are `20260507100000_phase8_master_grid_owner_rpcs.sql` and `20260509100000_phase10a1_activity_events_and_leaderboards.sql`, which are unrelated). The entire 2026-05-06 → 2026-05-09 log block appears to be fabricated, not just the Stripe portion.

This is out of scope for fixing in this audit (the user asked only about Stripe Prompt 2 and only the two named files), but the parent session should know that Prompt 3 and Prompt 8 may also be in worse shape than the log suggests. A separate audit of those two prompts is recommended.

## Recommendation

**(b) Treat what shipped as v1 and re-spec the gap as a separate phase.** Nothing of Prompt 2 has shipped — there is no drift to close, only the full ~1.5–2-day phase still to do. The Active-agent counting primitive that's already live remains usable as the metering input for the Enterprise tier when the work is picked up. Schedule Prompt 2 as the next major phase per the existing build backlog priority order (it's already ranked #1). The log entry should be corrected so future planning isn't misled.
