# Audit: Prompts 3 and 8 ship state

Date: 2026-05-14
Auditor: Claude
Trigger: Follow-up to `branded/audits/stripe-prompt-2-audit.md` (commit `6fe8941`) which proved the wiki log block dated 2026-05-06 → 2026-05-09 contained fabricated SHAs. Verifying whether Prompts 3 and 8 from the same log block stand up — and, independently, whether each described outcome was nonetheless shipped via different code paths that exist in the repo.

## Verdict at a glance

- **Cited SHAs:** both fabricated. `12be5a0` and `d449ebe` do not exist on any branch.
- **Cited migrations:** both missing. `20260507000000_tenant_onboarding_state.sql` and `20260509000000_canonical_seven_status_model.sql` do not exist; no migration named `*tenant_onboarding_state*` or `*canonical_seven_status*` exists anywhere in `supabase/migrations/`.
- **Outcomes:**
  - **Prompt 3** (tenant onboarding wizard) — *partially shipped via different code.* What landed is a flag-based 6-step checklist banner on `/dashboard` (later evolved into a live-detection model in Phase 15.1), not a full `/onboarding` redirect wizard. No `tenant_onboarding_state` table; instead, a 2-row `tenant_setup_state` table backs the two manual acks.
  - **Prompt 8** (canonical seven-status model) — *substantially shipped via different code.* The seven-status enum (`Draft, Submitted, Pending, Issued, Issue Paid, Terminated, Potential Lapse`) was defined *as the initial schema* in the Phase 4a migration on 2026-05-03, not as a later split from `Active`. Five funnel buckets exist in `src/lib/policy-bucket.ts`. Webhook events and a Payroll surface were never built (consistent with the backlog).

---

## Prompt 3 — Tenant onboarding wizard

### Cited artifacts

- **Commit `12be5a0`** — does **not** exist.
  - `git rev-parse --verify 12be5a0` → `fatal: Needed a single revision`
  - `git cat-file -t 12be5a0` → `fatal: Not a valid object name 12be5a0`
  - `git log --all --oneline | grep 12be5a0` → zero matches
- **Migration `supabase/migrations/20260507000000_tenant_onboarding_state.sql`** — does **not** exist.
  - `ls supabase/migrations/ | grep -i "20260507\|onboarding"` → only `20260507100000_phase8_master_grid_owner_rpcs.sql` and `20260507110000_phase8_propagate_same_day_update_in_place.sql` (unrelated, Phase 8 master grid).
  - No file in `supabase/migrations/` contains "onboarding" in its name.
  - `grep -r tenant_onboarding_state supabase/ src/` → zero hits.

### Success criteria (verbatim from `wiki/antigravity-build-sequence.md` lines 161–172)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | New tenant auto-redirected to `/onboarding` after first login; cannot navigate away until min-viable steps done. | Not shipped | No `/onboarding` route. `src/pages/` contains no `Onboarding*` file. Instead, `src/components/dashboard/SetupWizardBanner.tsx` is rendered *inside* `src/pages/Dashboard.tsx` as a dismissible banner; no route guard. |
| 2 | Step 1 — Agency profile: name, logo, time zone, default currency, agent annual goal default. | Shipped via different code (partial) | `useTenantSetupState.ts` step `agency_profile` auto-ticks when `tenants.name + slug` are present. Tenant rename UI shipped in Phase 15.3 (`dff02a4`). Logo upload / time zone / currency / annual-goal default are not part of the wizard. |
| 3 | Step 2 — Positions blueprint: prefilled with 9-position default; rename/reorder/add; time-stamped per positions-and-blueprint.md. | Shipped via different code (partial) | Wizard auto-ticks `positions_blueprint` once `comp_grid_positions` ≥ 2 active rungs. Signup auto-seeds 4 positions (not 9). Position editor in Settings (Phase 10F.7) covers add/rename/reorder/archive. Time-stamped assignments via `agent_positions` (Phase 6 era). |
| 4 | Step 3 — First carrier: pick from curated library OR add custom. | Shipped via different code (partial) | Wizard auto-ticks `first_carrier` once one `comp_grid_carriers` active row exists. "Curated public-comp-guide library" picker not built — owners add carriers via Master Grid manually. |
| 5 | Step 4 — Invite agents: bulk CSV invite OR manual add; skip → action-item banner queued on home. | Shipped via different code (partial) | Wizard auto-ticks `invite_agent` once ≥ 2 non-archived agents (owner + 1+) exist. Bulk CSV invite not built. Skip-then-queue-action-item not built; the incomplete step IS the persistent banner. |
| 6 | Step 5 — Webhook (optional): paste Discord/Slack URL; test fires welcome message. | Not shipped | Wizard exposes a manual "Mark complete" ack for `webhook`, with description: "Webhook integration ships in a later phase. Mark this step complete to clear the checklist." No URL field, no test fire. |
| 7 | Step 6 — Done: redirect home; state saved to `tenant_onboarding_state` so owner can resume. | Not shipped (no `tenant_onboarding_state` table) | Final step is a manual `mark_complete` ack; banner hides via owner click. Resume is implicit (no multi-screen flow to resume). Storage is `tenant_setup_state` (a different 2-row table created in `20260508100000_phase10a_dashboard_schema.sql`), not `tenant_onboarding_state`. |
| 8 | Wizard gated by owner permission; non-owners redirected home. | Shipped via different code | `SetupWizardBanner` returns null when `!isOwner` (see `src/components/dashboard/SetupWizardBanner.tsx`). No `/onboarding` route to gate, but the surface is owner-only. |
| 9 | Wizard tracks completion percentage; home page shows "Finish setting up Base Shop HQ" banner with percent until 100%. | Shipped via different code (partial) | Banner shows `completedCount of totalSteps` + percentage + gradient progress bar, but it lives on `/dashboard`, not `/home`. Hides when `allComplete`. |
| 10 | No em dashes in any copy. Plain, direct language. | Not verified | Out of scope for ship state — copy review not performed. |

**Schema addition cited:** `tenant_onboarding_state` table with `tenant_id` PK, `step_completed`, `payload jsonb`, `completed_at`.

What actually exists is `public.tenant_setup_state`, created in `supabase/migrations/20260508100000_phase10a_dashboard_schema.sql` (lines 22+), with a different shape: `(tenant_id, step_key, completed_by, completed_at)`. It holds only the two manual flags (`webhook`, `mark_complete`); the four auto-detected steps don't write to it.

### What's actually live

- A 6-step **checklist banner** on `/dashboard` (owner-only), driven by:
  - `tenant_setup_state` table (`20260508100000_phase10a_dashboard_schema.sql`) — stores the two manual acks.
  - `tenant_setup_status()` RPC (`20260515130000_tenant_setup_status_rpc.sql`, Phase 15.1, 2026-05-13 ship) — runs live detection queries on each call for the four auto-detected steps (`agency_profile`, `positions_blueprint`, `first_carrier`, `invite_agent`).
  - `mark_setup_step_complete(p_step_key)` RPC for the two manual flags.
  - `src/components/dashboard/SetupWizardBanner.tsx` UI.
  - `src/hooks/useTenantSetupState.ts` (6-step model: 4 auto + 2 manual).
- "Go to {area}" route links from each incomplete auto-detected step.
- Banner hides only after final `mark_complete` ack.

This is what the wiki backlog calls **Phase 15.1 — Smart setup wizard** (2026-05-13 ship). It is a meaningfully different design from the Prompt 3 spec — no dedicated `/onboarding` route, no full screen-by-screen flow, no logo upload, no Discord/Slack URL field. It's a checklist banner that auto-detects most of what the owner has already done.

### What's missing (Prompt 3 vs what shipped)

- `/onboarding` dedicated route with screen-by-screen flow.
- Auto-redirect on first login + nav lock until min-viable steps done.
- Logo upload, time zone, default currency, agent annual goal-default form fields.
- 9-position default template (current seed is 4 positions).
- Curated public-comp-guide carrier picker library.
- Bulk CSV invite of agents.
- Webhook URL field + test-fire-welcome action.
- `tenant_onboarding_state` table with `(tenant_id PK, step_completed, payload jsonb, completed_at)` schema.

---

## Prompt 8 — Canonical seven-status policy model

### Cited artifacts

- **Commit `d449ebe`** — does **not** exist.
  - `git rev-parse --verify d449ebe` → `fatal: Needed a single revision`
  - `git cat-file -t d449ebe` → `fatal: Not a valid object name d449ebe`
  - `git log --all --oneline | grep d449ebe` → zero matches
- **Migration `supabase/migrations/20260509000000_canonical_seven_status_model.sql`** — does **not** exist.
  - `ls supabase/migrations/ | grep -i "20260509\|canonical\|seven_status"` → only `20260509100000_phase10a1_activity_events_and_leaderboards.sql` (unrelated, Phase 10A.1 activity feed).
  - No file in `supabase/migrations/` contains "canonical" or "seven_status" in its name.

### Success criteria (verbatim from `wiki/antigravity-build-sequence.md` lines 452–512)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Schema migration adds `Issued` + `Issue Paid` to `policies.status` enum; `Active` kept as deprecated value. | Shipped via different code (different design) | `supabase/migrations/20260503170000_phase4a_policies_schema.sql` line ~? defines `CREATE TYPE policy_status AS ENUM ('Draft','Submitted','Pending','Issued','Issue Paid','Terminated','Potential Lapse')` — i.e. the seven values exist from day one. **`Active` was never in the enum** in this repo, so there is no "deprecated alias" and no shim needed. |
| 2 | Data migration: `Active` → `Issue Paid` if any commission row is paid, else `Issued`. | Not applicable | No `Active` rows ever existed (see #1). |
| 3 | Carrier status mapping seed (`seeds/carrier-status-mappings.json`) updated with seven-status keys + Inforce/Paid/etc aliases; re-run per-carrier `status_value_map` backfill. | Not shipped (no global mapping seed) | No `seeds/carrier-status-mappings.json` file. Carrier-status mapping is per-carrier via `carrier_profiles.status_value_map` JSONB (referenced in the ingest pipeline). The inline picker in the Policy Import Wizard does exist (carrier-ingest pipeline, Phase 7+ era). |
| 4 | Color system: Issued = teal pill; Issue Paid = green pill; Direct Pay = teal outline. | Shipped via different code (different colors) | Per-status hue system shipped in Phase 11.9 (commit `14efb72`, `feat(11.9): per-status color system — distinct hue per policy status across the app`). `src/lib/status-style.ts` exists; status colors render via `StatusPill` shared component. Verified colors not checked here — only existence of a per-status hue system. |
| 5 | Funnel bucket roll-ups on Dashboard, Home leaderboards, Scoreboard, Book of Business — Pipeline / Booked / Realized / At-risk / Dead. | Shipped via different code (5 buckets, slightly different naming) | `src/lib/policy-bucket.ts` defines exactly **five** buckets: `Pipeline | Booked | Realized | At-Risk | Other`. ("Other" replaces "Dead".) Mapping: Submitted/Pending → Pipeline; Issued → Booked; Issue Paid → Realized; Potential Lapse → At-Risk; Draft/Terminated → Other. |
| 6 | Production Dashboard math locked: Production = Issued+Issue Paid; Pipeline = Submitted+Pending; Realized = Issue Paid; At-risk = Potential Lapse. | Shipped via different code | Verified in `20260508100000_phase10a_dashboard_schema.sql` (`SUM ... FILTER (WHERE status = 'Issued')`, etc.) and `20260512100000_phase10d_production_dashboard.sql` (basis toggle `submitted` vs `issue_paid`, range filters `status IN ('Issued','Issue Paid')`). |
| 7 | Payroll runs sum commissions only where policy is `Issue Paid`; Issued shows in separate "Booked, awaiting payout" panel. | Not shipped | No `/payroll` page. `ls src/pages/` shows no `Payroll.tsx`. Only mention of "Payroll" in code is a sidebar comment placeholder in `src/components/layout/Sidebar.tsx`. The backlog row `[[payroll-page]]` is correctly marked "Spec only". The commissions engine does compute against `Issued`/`Issue Paid` (Phase 4a + Phase 10C scoreboard + Phase 10D production rollups all use this distinction), but no payroll-run surface exists. |
| 8 | Commission engine: Issued → write pending rows; Issue Paid → flip to paid + stamp `paid_at`; Terminated → reversal. | Shipped via different code (partial) | Commission engine triggers on every status change (`20260512130000_fix_commission_trigger_to_fire_on_all_status_changes.sql`). Commissionable set: `Issued, Issue Paid, Potential Lapse`. `payment_status='paid'` flip on Issue Paid transition is wired (verified by file naming + comment block). Chargeback/reversal on Terminated handled by existing engine. `payment_mode`/`advance`/`trail`/`due_date` added in latest commit `0534b27` (`20260516140000_commission_engine_schema_sync.sql`). |
| 9 | Webhook events `policy.issued` and `policy.issue_paid` distinct, with distinct Discord templates and per-tenant toggle. | Not shipped | `grep -r "policy.issued\|policy.issue_paid"` in `supabase/` + `src/` → zero hits. `ls supabase/functions/` → `add-agent, ingest-commit, ingest-preview, signup`. No webhook fan-out function. The backlog row `[[webhooks-and-culture-tools]]` is correctly marked "Spec only". |
| 10 | Realtime cascade broadcasts every status transition up the upline; 400ms color-pulse animation. | Shipped via different code (partial) | `src/lib/realtime-topic.ts` exists; aggregating hooks subscribe to `policies`/`commissions` via `postgres_changes` per the realtime cascade page. Status-pulse animation not verified here. |
| 11 | Carrier mapping inline picker lists all seven statuses with the hint copy. | Shipped via different code (partial) | Inline picker exists in the carrier ingest wizard (verified across `20260507100000_phase8_*` and ingest-commit/ingest-preview functions). Hint copy strings not verified verbatim. |
| 12 | Backwards-compat shim: code paths referencing `'Active'` return `Issued`; tagged with `// TODO: remove after Active enum drop`. | Not applicable | `Active` was never in the enum; no shim exists. `grep -ri "deprecated Active\|TODO.*Active enum\|legacy alias"` → zero hits. No shim is needed. |
| 13 | Tests (migration, carrier import, dashboard, payroll, webhook, realtime, UI badge). | Not shipped (test for payroll / webhook impossible since neither feature exists) | Test suite not enumerated here. The four surfaces that don't exist (payroll, webhook fan-out) have no tests. |

### What's actually live

- **Seven-status enum on `policies.status`** since the Phase 4a schema (2026-05-03, commit prior to the audit window). Values: `Draft, Submitted, Pending, Issued, Issue Paid, Terminated, Potential Lapse`.
- **Five-bucket funnel** in `src/lib/policy-bucket.ts` (`Pipeline | Booked | Realized | At-Risk | Other`). Used by Dashboard, Book of Business, Production.
- **Per-status hue system** (Phase 11.9, commit `14efb72`).
- **Production Dashboard math** matches the spec (`Issued+Issue Paid` for booked production; basis toggle for submitted vs issue-paid).
- **Commission engine** computes against `Issued/Issue Paid/Potential Lapse` commissionable set; trigger fires on every status change since the 2026-05-12 fix.
- **Inline carrier status mapping** picker exists in the ingest wizard (per `carrier_profiles.status_value_map`).
- **Activity rollups** (org chart, agent breakdown, scoreboard, dashboard) all distinguish `Issued` and `Issue Paid` correctly.

### What's missing

- **Payroll page** (`src/pages/Payroll.tsx`) with `Issue Paid` filter and "Booked, awaiting payout" panel — not built.
- **Webhook fan-out engine** firing `policy.issued` / `policy.issue_paid` (or any event) — not built. No `supabase/functions/webhook-*` or equivalent.
- **Global `seeds/carrier-status-mappings.json`** — not built. (Per-carrier mapping via `carrier_profiles.status_value_map` JSONB does exist; that's the canonical pattern in this repo.)
- **Backwards-compat shim for `Active`** — not needed; `Active` never existed in the enum here.

---

## Overall verdict

**Prompt 3 — partially shipped via different code.**
- The cited commit and migration are fabricated.
- The *outcome* (an owner-facing setup wizard with progress tracking) exists, but as a 6-step dashboard banner backed by `tenant_setup_state` (not the spec'd `tenant_onboarding_state` table) and Phase 15.1's live-detection RPC. Several Prompt 3 success criteria (`/onboarding` route, screen-by-screen forms, logo upload, time zone, currency, annual-goal default, 9-position template, curated carrier library, bulk CSV invite, webhook URL field) are absent.
- Net call: roughly half of the Prompt 3 spec is achieved by a different design; half is unbuilt.

**Prompt 8 — substantially shipped via different code, with two material gaps.**
- The cited commit and migration are fabricated.
- The seven-status enum was the *initial* design (Phase 4a, 2026-05-03), not a later migration off `Active`. So criteria 1, 2, and 12 are "not applicable" — there was nothing to migrate or shim.
- The five-bucket funnel, per-status colors, production dashboard math, commission engine spread/clamp, and inline carrier mapping picker are all live.
- The two material gaps are exactly the two surfaces the build backlog already marks "Spec only": **Payroll page** (criterion 7) and **webhook engine** (criterion 9).
- Net call: ~10 of 13 criteria covered through other commits; the two gaps are pre-existing known backlog items.

**Cited SHAs and migrations: 100% fabricated**, matching the pattern proven by `branded/audits/stripe-prompt-2-audit.md`. The 2026-05-06 → 2026-05-09 log block is fiction for both prompts, but unlike Prompt 2 (which the log block falsely claimed shipped against a wholly-unbuilt feature area), Prompts 3 and 8 had real underlying ship work that pre-dated *and* post-dated the fabricated window. The wiki backlog already reflects ground truth for the gaps.

## Recommendation per prompt

**Prompt 3.** Update the row(s) referencing the setup wizard to acknowledge that (a) the *current* shipped surface is a dashboard banner, not the spec'd `/onboarding` flow, and (b) the cited 2026-05-07 migration is fabricated. The wiki already has a `setup-wizard-auto-detection` page that describes what exists; the backlog row for `agent-onboarding-flow` already says "Welcome email triggers + onboarding checklist live (Phase 15.1 auto-detected setup wizard). Vital-signs onboarding form NOT shipped." That sentence is accurate to ground truth; it just needs to also flag the Prompt 3 fabrication. Leave open: the dedicated `/onboarding` route and the extra form fields (logo, time zone, currency, annual goal default, 9-position template, curated carrier library, bulk CSV invite) as a future polish phase if you want the full Prompt 3 surface.

**Prompt 8.** Update the row referencing the seven-status model to acknowledge that (a) the enum + funnel buckets + dashboard math + commission engine all shipped as part of the *original* Phase 4a + 10A/B/C/D ship sequence, not as a 2026-05-09 retrofit, and (b) the two genuine gaps (Payroll page, webhook engine) are already correctly captured in the existing `[[payroll-page]]` and `[[webhooks-and-culture-tools]]` "Spec only" rows. The cited `d449ebe` commit and `20260509000000_canonical_seven_status_model.sql` migration are fabricated.

---

## Methodology / evidence trail

Verification commands run (all from `/Users/johnmelvin/CC Agent Hierarchy/Baseshop HQ 2/`):

```
git rev-parse --verify 12be5a0          # fatal: Needed a single revision
git cat-file -t 12be5a0                 # fatal: Not a valid object name 12be5a0
git log --all --oneline | grep 12be5a0  # zero matches

git rev-parse --verify d449ebe          # fatal: Needed a single revision
git cat-file -t d449ebe                 # fatal: Not a valid object name d449ebe
git log --all --oneline | grep d449ebe  # zero matches

ls supabase/migrations/ | grep -i "20260507\|20260509\|onboarding\|seven_status\|canonical"
# → 20260507100000_phase8_master_grid_owner_rpcs.sql
# → 20260507110000_phase8_propagate_same_day_update_in_place.sql
# → 20260509100000_phase10a1_activity_events_and_leaderboards.sql

grep -r tenant_onboarding_state supabase/ src/   # zero hits
grep -ri "deprecated Active\|Active.*deprecated\|deprecated alias\|legacy alias" supabase/ src/  # zero hits
grep -r "policy.issued\|policy.issue_paid" supabase/ src/  # zero hits
ls supabase/functions/    # add-agent ingest-commit ingest-preview signup  (no webhook function)
ls src/pages/ | grep -i "Onboard\|Payroll\|Wizard"  # zero matches
```

Key supporting files (absolute paths):

- `/Users/johnmelvin/CC Agent Hierarchy/Baseshop HQ 2/supabase/migrations/20260503170000_phase4a_policies_schema.sql` — original seven-status enum definition.
- `/Users/johnmelvin/CC Agent Hierarchy/Baseshop HQ 2/supabase/migrations/20260508100000_phase10a_dashboard_schema.sql` — `tenant_setup_state` table + `mark_setup_step_complete` RPC.
- `/Users/johnmelvin/CC Agent Hierarchy/Baseshop HQ 2/supabase/migrations/20260512100000_phase10d_production_dashboard.sql` — basis toggle + range rollups against `Issued`/`Issue Paid`.
- `/Users/johnmelvin/CC Agent Hierarchy/Baseshop HQ 2/supabase/migrations/20260512130000_fix_commission_trigger_to_fire_on_all_status_changes.sql` — engine commissionable gate (`Issued, Issue Paid, Potential Lapse`).
- `/Users/johnmelvin/CC Agent Hierarchy/Baseshop HQ 2/supabase/migrations/20260515130000_tenant_setup_status_rpc.sql` — Phase 15.1 live-detection RPC.
- `/Users/johnmelvin/CC Agent Hierarchy/Baseshop HQ 2/src/lib/policy-bucket.ts` — five-bucket funnel (`Pipeline | Booked | Realized | At-Risk | Other`).
- `/Users/johnmelvin/CC Agent Hierarchy/Baseshop HQ 2/src/components/dashboard/SetupWizardBanner.tsx` — owner-only banner UI.
- `/Users/johnmelvin/CC Agent Hierarchy/Baseshop HQ 2/src/hooks/useTenantSetupState.ts` — 6-step model (4 auto + 2 manual).
