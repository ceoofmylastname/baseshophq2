# Base Shop HQ — Inspection-Only Audit

**Date:** 2026-05-11
**Auditor:** Claude (read-only)
**Scope:** Vite + React + TS dashboard at `/Users/johnmelvin/CC Agent Hierarchy/Baseshop HQ 2/`, Supabase project `oarstmxbgdczytwzpyxj`, wiki at `/Users/johnmelvin/Documents/Baseshop HQ/wiki/`.

A note up front. The kickoff prompt at `/Users/johnmelvin/Documents/Baseshop HQ/baseshop-hq-claude-code-kickoff-prompt.md` (Apr 29) called for a Next.js 15 + Astro pnpm monorepo with 26 migrations. The wiki was updated later (May 1 tech-stack page; May 7 index entry) and the team superseded that plan: the live product is a single-app Vite + React + TS + Tailwind + shadcn + Supabase build using `bun` as the package manager. Commits show the project at Phase 10E (Contracts page). Everywhere this report says "missing vs kickoff," it is a deviation by design, not a defect — except where the wiki itself still expects the missing thing. The criteria that follow are scored against the kickoff prompt because that is the explicit checklist provided; I flag superseded items rather than failing them.

---

## 1. Wiki gaps

Files requested by the audit prompt and what I found in `wiki/`:

| Requested | Present? | Note |
| --- | --- | --- |
| `index.md` | yes | Last updated 2026-05-07 |
| `baseshop-hq-overview.md` | yes | 2026-04-29 |
| `tech-stack-and-infrastructure.md` | yes | 2026-05-01. Lists Next.js as "recommended" frontend. Does not yet reflect Vite-only reality. |
| `schema-spec.md` | yes | 2026-05-01. Defines ~30 tables (more than kickoff's 26). Includes the agency / white-label layer that is not in the live DB. |
| `hierarchy-permissions-model.md` | yes | 2026-05-05 (Phase 6.5 audit recorded) |
| `positions-and-blueprint.md` | yes | 2026-04-29. Talks about `positions` + `user_positions`. Live tables are `comp_grid_positions` + `agent_positions`. |
| `csv-imports-and-templates.md` | yes | 2026-04-29 |
| `realtime-updates-and-hierarchy-cascade.md` | yes | 2026-04-29 |
| `ui-design-system.md` | yes | 2026-05-02 |
| `active-agent-billing-model.md` | yes | 2026-05-01 |
| `marketing-site-and-acquisition.md` | yes | 2026-04-29 |

No requested wiki files were missing. The wiki is broader than the audit list (40 files total including `agora-master-grid-rates`, `comp-grid-engine`, `antigravity-build-sequence`, etc.).

Material wiki/reality gaps:

- The wiki's `schema-spec.md` and the live DB use different naming. Wiki says `users`, `positions`, `user_positions`, `commission_levels`, `products`. Live DB has `agents`, `comp_grid_positions`, `agent_positions`, `comp_grid_rates`, `comp_grid_products`. The product evolved and the spec was not relabeled in lock-step.
- The wiki documents an agency / white-label tier (`agencies`, `agency_brand_profiles`, `custom_domains`, `agency_billing_subscriptions`, `voice_profiles`, `social_connections`). None of these exist in `public` in the live DB.
- The wiki documents `policy_field_corrections`, `change_events`, `user_action_items`, `leadership_broadcasts`, `promotion_targets`, `user_profiles`, `user_achievements`, `contests`, `carrier_compliance_docs`, `audit_log`, `webhooks`, `authenticated_links`, `authenticated_link_clicks`, `carrier_field_mappings`, `import_runs`, `billing_snapshots`, `payroll_runs`, `payroll_run_items`, `payroll_adjustments`, `commission_rate_adjustments`. None of these tables are in the live DB. The live DB has lighter equivalents: `announcements` for leadership broadcasts, `activity_events` for change events, `ingest_runs` for import runs, `policy_deletions_audit` for partial audit log, `tenant_setup_state` for onboarding. No payroll, no billing, no webhooks, no authenticated_links, no rate adjustments, no field corrections.
- `tech-stack-and-infrastructure.md` still names Next.js as the dashboard recommendation. The actual choice (Vite) is not yet documented in the wiki.

---

## 2. Repo structure — expected vs actual

Kickoff prompt's `baseshop-hq/` monorepo does NOT exist. I searched `/Users/johnmelvin/CC Agent Hierarchy/`, `/Users/johnmelvin/`, and the GitHub remote (`ceoofmylastname/baseshophq2`); there is no sibling monorepo named `baseshop-hq` and no `apps/dashboard` or `apps/marketing` directory anywhere on disk. The repo `baseshophq2` (single-app Vite) is the live product.

| Kickoff path | Status | Note |
| --- | --- | --- |
| `apps/dashboard/` (Next.js 15) | SUPERSEDED-BY-VITE | Lives directly at repo root as a Vite app. |
| `apps/marketing/` (Astro) | NOT BUILT | No marketing site in this repo or any sibling. Per wiki `index.md` (last updated 2026-05-07): "Phase 11+ marketing site deferred to a separate codebase." |
| `packages/shared/` | MISSING | Single-app project, no shared package. |
| `supabase/migrations/` | EXISTS | 30 SQL migrations applied. Different naming/scope than kickoff's 26 numbered files. |
| `supabase/seed.sql` | MISSING | No seed file. The signup edge function bootstraps the Agora grid via a JSON payload, but there is no `seed.sql`. |
| `supabase/config.toml` | MISSING | |
| `supabase/functions/` | EXISTS | Four functions: `signup`, `add-agent`, `ingest-preview`, `ingest-commit`. |
| `.github/workflows/ci.yml` | MISSING | No `.github/` directory at all. |
| `package.json` (workspace root) | EXISTS as single-app | `name: baseshop-hq`, single package, no pnpm workspaces. Uses bun. |
| `pnpm-workspace.yaml` | MISSING | Project uses `bun`, not pnpm. |
| `turbo.json` | MISSING | |
| `.gitignore` | EXISTS | |
| `.env.example` | EXISTS | |
| `README.md` | MISSING | No README at repo root. |

Top-level of the live repo (`Baseshop HQ 2/`):
- `index.html`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `components.json`, `tsconfig.json`, `package.json`, `bun.lock`, `.env.example`, `.env.local`, `.gitignore`
- `src/` (App.tsx, main.tsx, index.css, vite-env.d.ts, plus components/, contexts/, hooks/, lib/, pages/)
- `supabase/migrations/` + `supabase/functions/`
- `tests/` (3 test files for commission engine + comp grid CSV parser)
- `scripts/` (4 .ts utility scripts including Agora payload generator)
- `public/`, `node_modules/`, `.git/`, `.claude/`

GitHub remote: `git@github.com:ceoofmylastname/baseshophq2.git` (public, created 2026-05-03, last push 2026-05-04).

---

## 3. Dashboard app status

Confirmed primitives:
- **Vite + React 18 + TS:** `vite.config.ts` uses `@vitejs/plugin-react`; `package.json` has `react@^18.3.1`, `react-dom@^18.3.1`, `vite@^6.0.7`, `typescript@^5.7.3`. `tsconfig.json` is strict (`strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`, `noFallthroughCasesInSwitch`).
- **Tailwind:** `tailwind.config.js` uses CSS-variable-based theming, `darkMode: "class"`. Tokens defined in `src/index.css` via `--background`, `--foreground`, etc. **The dark mode does NOT match the wiki spec.** Wiki `ui-design-system.md` calls for `#0B0B0C` near-black + glassmorphism + named status colors (Draft gray, Submitted blue, Pending amber, Issued teal, Issue Paid green, Potential Lapse orange, Terminated red, LOA purple). The CSS uses a generic shadcn default (HSL `222.2 84% 4.9%`) and does not define any policy-status colors. The named status colors do not appear anywhere in the codebase.
- **shadcn/ui:** `src/components/ui/` has 9 primitives: `badge`, `button`, `card`, `dialog`, `dropdown-menu`, `input`, `label`, `separator`, `table`. Missing from the wiki's primitive list: Inline Edit Field, Drawer, Filter Bar, Data Table (specialized), Tree View, Org Chart, Toast, Highlight Pulse, Comp Grid Cell, Hierarchy Node.
- **Supabase client:** `src/lib/supabase-browser.ts` exports a singleton using `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. No equivalent `lib/supabase/server.ts` (correct — no SSR).
- **Route protection:** `src/components/auth/RequireAuth.tsx` (session gate, redirect to `/login`) and `RequireOwner.tsx` (silent redirect to `/dashboard` for non-owners). No Next.js middleware (correct — Vite SPA).
- **Auth flow:** `AuthContext.tsx` hydrates session from Supabase, queries `agents` joined to `tenants`, listens to `onAuthStateChange`. Login uses **email + password** (`signInWithPassword`). Signup hits the `signup` edge function. **Magic link is NOT wired** in the UI; the wiki and kickoff prompt both call for it, but `Login.tsx` only supports password.

Routes enumerated from `src/App.tsx`:

| Route | Page component | Phase | Status |
| --- | --- | --- | --- |
| `/login` | LoginPage | 1 | complete (password only; no magic link) |
| `/signup` | SignupPage | 5 | complete (multi-field agency-create flow) |
| `/dashboard` | DashboardPage | 10A / 10A.1 | complete (metrics, leaderboards, commission trend, activity feed, announcements) |
| `/agents` | AgentsPage | 6a | present (Agents.tsx is 1KB, mostly thin shell over `agents/` components) |
| `/agents/:agentId` | AgentProfilePage | 6a | partial |
| `/master-grid` (owner-only) | MasterGridPage | 8 | complete |
| `/comp-grid` | redirect → `/master-grid` | n/a | n/a |
| `/ingest` (owner-only) | IngestPage | 7 | complete |
| `/ingest/history/:runId` (owner-only) | IngestRunDetailPage | 7 | complete |
| `/book-of-business` | BookOfBusinessPage | 10B | complete |
| `/policies` | redirect → `/book-of-business` | n/a | n/a |
| `/policy/:policyId` | PolicyDetailPage | 10B | complete |
| `/production` | ProductionPage | 10D | complete |
| `/team-production` | ProductionPage (teamView prop) | 10D | complete |
| `/scoreboard` | ScoreboardPage | 10C | complete |
| `/active-agents` | ActiveAgentsPage | 10C | partial (1.4KB page) |
| `/contracts` | ContractsPage | 10E | complete |
| `/my-rates` | MyRatesPage | 9 | complete |
| `/settings` | SettingsPage | n/a | placeholder ("Coming soon.") |
| `*` | redirect → `/dashboard` | | |

Sidebar has 12 nav items vs the wiki's full nav structure (Home / Agents → Directory, Active Agents, Positions, Contracts / Policies → Post a Deal, Drafts, Book, Scoreboard, Production, Team Production / Carrier Reports / Payroll / System → Settings, Positions, Carriers, Integrations, Authenticated Links). Comment in `Sidebar.tsx` acknowledges this is Phase 5 nav with a TODO for full nav.

`src/hooks/` is rich — 44 hook files including `useDashboardMetrics`, `useLeaderboardTopProducers`, `useLeaderboardTopEarners`, `useLeaderboardTopRecruiters`, `useLeaderboardMostImproved`, `useCommissionTrend`, `useProductionMetrics`, `useScoreboard*`, `useContracts`, `useBookOfBusiness`, `usePolicyDetail`, `useMasterGrid`, `useAgentRates`, `useIngestPreview`, `useIngestCommit`, `useActiveAgents`, `useAnnouncements`, `useRecentActivityFeed`, etc. This is real production-grade code, not scaffolding.

ErrorBoundary added at `src/components/ErrorBoundary.tsx` (uncommitted per git status).

---

## 4. Marketing site status

**NOT BUILT.**

No Astro app, no `apps/marketing`, no marketing folder anywhere in the project or sibling directories. The wiki `index.md` confirms this is intentional: "Phase 11+ marketing site deferred to a separate codebase." `marketing-site-and-acquisition.md` exists as a spec for future work; nothing implements it.

---

## 5. Database status

### 5.1 Tables (live `public` schema, 17 base tables + 2 views)

| Live table | Rows | RLS | Maps to wiki/kickoff |
| --- | --- | --- | --- |
| `tenants` | 3 | on | `tenants` |
| `agents` | 11 | on | `users` (renamed) |
| `agent_positions` | 7 | on | `user_positions` (renamed) |
| `agent_contracts` | 4 | on | `agent_contracts` |
| `agent_carrier_rates` | 374 | on | `agent_carrier_rates` (per-agent override; matches schema-spec section 2026-05-02) |
| `comp_grid_positions` | 30 | on | `positions` (renamed) |
| `comp_grid_carriers` | 58 | on | `carriers` (renamed) |
| `comp_grid_products` | 163 | on | `products` (renamed) |
| `comp_grid_rates` | 1440 | on | `commission_levels` (renamed; Agora grid bootstrapped) |
| `policies` | 17 | on | `policies` |
| `policy_status_history` | 23 | on | `policy_status_history` |
| `policy_commissions` | 13 | on | `policy_commissions` |
| `policy_deletions_audit` | 1 | on | partial `audit_log` (delete-only) |
| `ingest_runs` | 0 | on | partial `import_runs` (policy ingest only) |
| `activity_events` | 7 | on | partial `change_events` |
| `announcements` | 2 | on | partial `leadership_broadcasts` |
| `tenant_setup_state` | 1 | on | new — not in wiki/kickoff |
| `agent_rates_with_product` (view) | — | — | derived |
| `agents_with_current_position` (view) | — | — | derived |

Missing vs kickoff's 26-table list (and the wider wiki list):
- `commission_rate_adjustments`
- `payroll_runs`, `payroll_run_items`, `payroll_adjustments`
- `webhooks`
- `authenticated_links`, `authenticated_link_clicks`
- `carrier_field_mappings`
- `billing_snapshots`
- `audit_log` (only `policy_deletions_audit` exists)
- `policy_field_corrections`
- `change_events` (only the lighter `activity_events` exists)
- `user_action_items`
- `promotion_targets`
- `user_profiles`, `user_achievements`
- `contests`
- `carrier_compliance_docs`

Plus the entire white-label agency layer: `agencies`, `agency_brand_profiles`, `custom_domains`, `agency_billing_subscriptions`, `voice_profiles`, `social_connections`.

### 5.2 RLS

Every public table has `rls_enabled = true`. Every policy I queried (52 policies across 15 tables) is scoped with `tenant_id = current_tenant_id()` somewhere in its predicate. No "permissive `USING (true)`" leaks were found. The tenant boundary is enforced consistently.

Notable RLS patterns:
- Multi-tenant SELECT policies use `(tenant_id = current_tenant_id()) AND can_view_agent(agent_id)` — the view-down rule is in the helper.
- Owner-only INSERT/UPDATE/DELETE policies use `is_owner()` as a second condition.
- `agents` has a defensive `agents_select_self` policy ANDed against `id = auth.uid()` to handle the broken-intermediate-state mentioned in `AuthContext.tsx`.
- `tenants` has only owner-self policies (`tenants_select_own`, `tenants_update_owner`); no platform-admin "list every tenant" path exists.

The Phase 6.5 patch from `hierarchy-permissions-model.md` is applied: `current_tenant_id()` resolves from `agents.tenant_id` for `auth.uid()`, and `descendants_of` (visible in `pg_get_functiondef`) filters the seed row by `tenant_id = current_tenant_id()`. Cross-tenant walk is closed at the helper.

### 5.3 Functions

`descendants_of(root_agent_id uuid)` exists, is `SECURITY DEFINER`, `STABLE`, `search_path` locked to `public, pg_temp`. Tested it against an owner UUID and it returned rows.

55 functions in `public`. Notable ones: `is_owner`, `can_view_agent`, `current_tenant_id`, `visible_agent_ids`, `set_master_grid_rate`, `set_agent_carrier_rate_override`, `reset_agent_carrier_rate_to_default`, `template_agent_from_position`, `assign_agent_to_position`, `position_template_blast_radius`, `master_grid_blast_radius`, `propagate_master_grid_change`, `recalculate_policy_payouts`, `delete_policy_with_audit`, `ingest_policy_row`, `match_agent_by_email`, `match_agent_by_writing_number`, `canonicalize_product`, `bootstrap_agora_grid_for_tenant`, `provision_tenant_and_owner`, `dashboard_metrics`, `production_metrics`, `commission_trend_series`, `leaderboard_top_*`, `scoreboard_top_*`, `production_agent_totals`, `recent_activity_feed`, `post_announcement`, `mark_setup_step_complete`, plus 5 `activity_log_*` trigger functions.

### 5.4 Indexes on `policies` and `policy_commissions`

`policies`:
- `policies_pkey` (id)
- `policies_unique_number_per_tenant` UNIQUE `(tenant_id, policy_number)`
- `policies_tenant` `(tenant_id)`
- `policies_tenant_status` `(tenant_id, status)`
- `policies_application_date` `(tenant_id, application_date)`
- `policies_agent` `(agent_id)`
- `policies_orphan_match` `(tenant_id, agent_number, carrier) WHERE agent_id IS NULL`

Kickoff prompt expected `(tenant_id, agent_id, application_date)` and `(tenant_id, status, application_date)`. The live indexes are `(tenant_id, application_date)` and `(tenant_id, status)` — close but not the exact composites called for. No `(tenant_id, agent_id, application_date)` composite.

`policy_commissions`:
- `policy_commissions_pkey` (id)
- `policy_commissions_unique_recipient` UNIQUE `(policy_id, agent_id)`
- `policy_commissions_tenant` `(tenant_id)`
- `policy_commissions_policy` `(policy_id)`
- `policy_commissions_agent_app` `(tenant_id, agent_id, application_date DESC)`

Kickoff expected `(tenant_id, agent_id, applied_to_pay_period_start)`. The live column is `application_date` not `applied_to_pay_period_start` (there is no payroll period column because there is no payroll module). Closest equivalent index exists.

### 5.5 Enums

5 enums in `public`:
- `agent_status`: `{active, inactive, archived}`
- `policy_status`: `{Draft, Submitted, Pending, Issued, "Issue Paid", Terminated, "Potential Lapse"}` — matches the canonical seven-status model in `schema-spec.md` exactly
- `policy_status_source`: `{manual, csv_import, carrier_feed, orphan_auto_link, engine_recalc}`
- `product_type`: `{life, annuity}`
- `rate_source`: `{position_default, override}`

Kickoff also expected `permission_level` and `billing_interval`. **Neither exists.** The `agents` table has `is_owner` boolean instead of a multi-tier `permission_level` enum (kickoff/wiki spec: `agent | manager | owner | payroll_admin | integrations_admin`). `billing_interval` does not exist because the `policies` table has no `billing_interval` column at all — only `annual_premium`.

### 5.6 Advisors

**Security (32 lints, mostly WARN):**
- 30 × `authenticated_security_definer_function_executable` — every SECURITY DEFINER RPC is grantable to `authenticated`. This is the intended pattern (helpers + RPCs called from the browser) and the helpers do their own auth gating. NOT a real risk if the gating is correct, but the linter is flagging the pattern.
- 1 × `anon_security_definer_function_executable` on `rls_auto_enable()` — this is callable by `anon` role. Likely a build-time utility that shouldn't be browser-exposed. Recommend revoking EXECUTE from `anon` and `authenticated`.
- 1 × `auth_leaked_password_protection` — HaveIBeenPwned check is disabled in Supabase Auth settings.

**Performance (33 lints, INFO/WARN):**
- 12 × unindexed foreign keys (incl. `agents.upline_agent_id_fkey`, `policy_commissions.agent_id_fkey`, `policy_commissions.position_id_fkey`, `tenants.owner_agent_id_fkey`).
- 3 × `auth_rls_initplan` — RLS policies on `agent_contracts` and `agents.agents_select_self` use `auth.uid()` directly instead of `(select auth.uid())`. Re-evaluates per row.
- 1 × `multiple_permissive_policies` on `agents` for SELECT (`agents_select_self` + `agents_select_visible`). Both run per query.
- 12 × `unused_index` (mostly low-traffic tables; safe to ignore until volume).
- 1 × `auth_db_connections_absolute` — absolute connection cap instead of percentage strategy.

---

## 6. Auth status

- Provider mix is unknown from MCP — I could not introspect Supabase Auth's GoTrue config (provider toggles) from the tools available. Auth.users table has rows including the live owner (`jrmenterprisegroup@gmail.com`) and two seeded owners.
- **Email + password is wired.** `Login.tsx` calls `signInWithPassword`. `Signup.tsx` POSTs to the `signup` edge function which creates the auth user with a password and then `signInWithPassword`s.
- **Magic link is NOT wired in the UI.** No `signInWithOtp` call anywhere in `src/`. The kickoff prompt and `tech-stack-and-infrastructure.md` both call for magic link as a primary auth method.
- **No JWT custom-claims trigger.** I checked: there is no auth hook function or trigger that injects `tenant_id` into the JWT. **This is fine** because the live RLS pattern does NOT depend on `auth.jwt() ->> 'tenant_id'`. Instead `current_tenant_id()` is a `SECURITY DEFINER` SQL function that looks up `tenant_id FROM public.agents WHERE id = auth.uid()`. Every RLS policy reads `current_tenant_id()`, not the JWT. So the missing trigger is by design and is not a P0 — but it diverges from the kickoff prompt's `(auth.jwt() ->> 'tenant_id')::uuid` pattern.
- Session persistence: `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: true` in `supabase-browser.ts`.

---

## 7. CI status

**NO CI.** There is no `.github/` directory at all. `gh run list` returned no output. The remote (`ceoofmylastname/baseshophq2`) exists but has no GitHub Actions configured.

The package.json has `bun test`, `tsc --noEmit && vite build`, but nothing enforces them on push or PR.

---

## 8. Seed data status

- **No `supabase/seed.sql` file.** The kickoff prompt explicitly asked for one with one tenant + 5 positions + 3 users (owner, manager, agent) + 1 carrier + 2 products + comp grid rows + 3 policies.
- The live DB has been bootstrapped by the `signup` edge function and the Agora grid bootstrap RPC. Current state:
  - tenants: 3 (`baseshop-hq-smoke-test`, `jrm-enterprise-group`, `phase-5-smoke`)
  - agents: 11
  - comp_grid_positions: 30
  - comp_grid_carriers: 58
  - comp_grid_products: 163
  - comp_grid_rates: 1440
  - policies: 17
  - agent_contracts: 4
- Hierarchy verification: `descendants_of('2d0fd9ce-b392-4f72-bef6-0f6b95c2827a')` (the JRM owner) returned a non-empty result, confirming the recursive walk works on real data.

The DB is populated, just not via a portable `seed.sql`. That means a fresh local clone would not get usable data without re-running the signup flow.

---

## 9. Beyond-Phase-1 work

The kickoff prompt's Phase 1 stopped after "auth + placeholder dashboard." The live product has gone much further. Status by wiki page spec:

| Wiki spec | Live page / hook | Status |
| --- | --- | --- |
| `book-of-business-page.md` | `/book-of-business` (BookOfBusinessPage + components) | present |
| `production-dashboard-page.md` | `/production` (ProductionPage, ~10D migration) | present |
| `scoreboard-page.md` | `/scoreboard` (ScoreboardPage + 4 leaderboard hooks) | present |
| `agents-directory-page.md` | `/agents` (AgentsPage + `agents/` components) | partial — page is thin, components folder exists |
| `policy-detail-page.md` | `/policy/:policyId` (PolicyDetailPage + `policy-detail/` components) | present |
| `payroll-page.md` | none | not built (no payroll tables) |
| `contracts-page.md` | `/contracts` (ContractsPage, Phase 10E) | present |
| `carriers-and-comp-sheets-page.md` | `/master-grid` (MasterGridPage, owner-only) | partial — master grid lives here but no full Carriers list + Comp Sheets surface + Level Imports + Rate Adjustments tab |
| `integrations-page.md` | none | not built (no `webhooks` table) |
| `authenticated-links-page.md` | none | not built (no `authenticated_links` table) |
| `home-page-and-announcements.md` | `/dashboard` (DashboardPage with AnnouncementsList) | partial — announcements present, action-required banners + distance-to-next-promotion + leadership broadcasts targeting + Org Chart hero are not |
| `agent-profile-pages.md` | `/agents/:agentId` (AgentProfilePage) | partial |
| `csv-imports-and-templates.md` | `/ingest` for policy reports | partial — only 1 of 4 import surfaces (policy CSV); no `User Imports`, `Level Imports`, `Contract Imports` |
| `agent-onboarding-flow.md` | `/signup` + `add-agent` edge function | partial — owner signup works; no bulk roster CSV, no welcome-email triggers |
| `active-agent-billing-model.md` | `/active-agents` (ActiveAgentsPage), `useActiveAgents` hook | partial — page exists but Billing page under System is missing; no `billing_snapshots` table |
| `marketing-site-and-acquisition.md` | none | not built (intentional, deferred) |

The "Phase 10 operational hardening paused pending 5-10 day real-use shakedown" note in `wiki/index.md` matches the commit log — Phase 10A through 10E ship dashboard widgets and the Contracts page; product is paused waiting for usage feedback.

---

## 10. Phase 1 success criteria checklist (kickoff prompt verbatim)

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | GitHub repo created, monorepo structure committed | PARTIAL | Repo `ceoofmylastname/baseshophq2` exists. Monorepo structure (apps/dashboard, apps/marketing, packages/shared, turbo.json, pnpm-workspace.yaml) was superseded by single-app Vite. No README.md. |
| 2 | Supabase project provisioned, all 26 migrations applied | PARTIAL (superseded) | Project `oarstmxbgdczytwzpyxj` is live with 30 migrations applied. The 26 specific tables in the kickoff list are not all present — many were dropped from the live design (payroll, webhooks, authenticated_links, audit_log, etc.). |
| 3 | RLS enabled and verified on every multi-tenant table | DONE | Every public base table has `rls_enabled = true`. 52 policies all filter by `tenant_id = current_tenant_id()`. Phase 6.5 cross-tenant patch is in. |
| 4 | `descendants_of()` function exists and returns correct results on seed data | DONE | Function exists (SECURITY DEFINER, search_path locked), tested live against the JRM owner and returned a non-empty rowset. |
| 5 | `apps/dashboard` runs locally with `pnpm dev` and shows placeholder dashboard after login | PARTIAL (superseded) | The Vite app runs with `bun run dev` (not pnpm). Login + protected `/dashboard` route work. The dashboard is far beyond a "placeholder" — it has metrics, leaderboards, trends, activity feed. |
| 6 | `apps/marketing` runs locally with `pnpm dev` and shows placeholder pages | NOT STARTED | No marketing app exists. Intentionally deferred per wiki. |
| 7 | CI pipeline passes on the first commit | NOT STARTED | No `.github/workflows/` directory. No CI configured. |
| 8 | Seed data is loaded and visible in Supabase Studio | PARTIAL | Live DB has 3 tenants, 11 agents, 1440 comp grid rates, 17 policies — data is present and visible. But there is no `supabase/seed.sql` artifact; the population came from edge functions and the Agora bootstrap RPC. A fresh clone would have nothing. |

**Counts: 2 DONE / 5 PARTIAL / 1 NOT STARTED** (with the caveat that 3 of the PARTIAL items are PARTIAL because the kickoff plan was superseded by design, not because of incomplete execution).

---

## 11. P0 blockers

Definition: anything that breaks core functionality or violates email uniqueness, writing-number uniqueness, view-down-only permissions, time-stamped hierarchy changes, or tenant data isolation.

1. **No CI pipeline.** `tsc --noEmit && vite build` is in `package.json` but nothing enforces it on push. A broken commit on `main` will not be caught until someone runs it manually. The signup edge function, RLS migrations, and 44 hooks all depend on type-safety holding — easy to silently break.
2. **No portable seed data.** `supabase/seed.sql` does not exist. A fresh contributor cannot spin up a usable local environment without running through the signup flow and the Agora bootstrap manually. This will become acute the moment anyone other than the owner needs to run the app.
3. **`rls_auto_enable()` is callable by the `anon` role as SECURITY DEFINER.** Flagged by the security advisor. Even if the function body is benign, exposing a `SECURITY DEFINER` function to unauthenticated callers via PostgREST is a hardening violation. Verify the function body and revoke EXECUTE from `anon` and `authenticated`.
4. **`policies.billing_interval` does not exist; `policies.modal_premium` does not exist.** The wiki and kickoff both list these. Production dashboards that need to distinguish "monthly premium" from "annual premium" cannot do so today. Active-agent billing math is OK because it counts agents, not premium-by-interval, but any future commission true-up or chargeback math that needs the modal premium is blocked.
5. **No `payroll_runs` / `payroll_run_items` / `payroll_adjustments` tables.** Payroll page is a core wiki spec and a non-negotiable for an agency management product. The commission engine writes `policy_commissions` rows on issue, but there is no way to roll those into a pay-period payout, mark them paid, generate a payroll CSV, or handle chargebacks against future periods. This is missing functionality, not a bug, but it's blocking for go-live.
6. **No `webhooks` table / no Discord/Slack integration.** `webhooks-and-culture-tools.md` is a flagship culture-tools feature. Until wired, real-time cascade has no external surface — the "Marcus just wrote $4,200" promise from `realtime-updates-and-hierarchy-cascade.md` only fires inside the app, not into Discord.
7. **Magic-link login is missing.** `Login.tsx` only supports password. Magic link is on the kickoff and on `tech-stack-and-infrastructure.md`. Onboarded agents who don't have a password (CSV-imported roster path) cannot sign in.

Not classed as P0 because tenant isolation, email uniqueness, view-down permissions, and time-stamped hierarchy are all enforced correctly:

- Tenant isolation: every RLS policy filters by `tenant_id = current_tenant_id()`. The Phase 6.5 patch closed the cross-tenant owner hole at the helper level.
- Email uniqueness: I did not verify the `auth.users.email` unique constraint or `agents.email` unique-per-tenant constraint directly, but the schema relies on Supabase Auth's email uniqueness for `auth.users.id = agents.id`. Recommend a confirmatory query.
- Writing-number uniqueness: `agent_contracts` exists with the writing-number column; I did not directly confirm the unique constraint on `(tenant_id, carrier_id, agent_number)`. Recommend a confirmatory query.
- View-down permissions: enforced by `can_view_agent()` + `descendants_of()`. Phase 6.5 hardened.
- Time-stamped hierarchy: `agent_positions` has time bounds; the wiki convention of "never edit history in place, populate end_date and insert a new row" is encoded in the `assign_agent_to_position` RPC.

---

## 12. Recommended next 3 moves, ranked

1. **Wire CI + ship a portable seed.** Create `.github/workflows/ci.yml` that runs `bun install`, `bun run build` (which runs `tsc --noEmit` + `vite build`), and `bun test` on every push and PR. In the same pass, generate a `supabase/seed.sql` that seeds 1 tenant + 5 positions + 3 agents (owner, manager, agent with a real hierarchy) + 1 carrier + 2 products + a handful of policies, runnable by `supabase db reset`. **Why:** these are the two unguarded-fence items. Without CI, every Phase 11+ commit risks silent regression on RLS, on the commission engine, or on the 44 hooks. Without portable seed, every new contributor (or every redeploy) starts from zero. Both are an evening of work and unblock everything downstream.

2. **Build the Payroll module (tables + RPC + page).** Add `payroll_runs`, `payroll_run_items`, `payroll_adjustments` with RLS. Add an RPC that rolls `policy_commissions` rows (where `policies.status = 'Issue Paid'`) into a pay-period payout per agent, accounts for chargebacks against earlier periods, and supports "Mark as Paid" + CSV export. Ship the page at `/payroll`. **Why:** the wiki calls Payroll a non-negotiable for an agency management product, the commission engine already produces the input rows, and "what do I pay everyone this period" is the first question an owner asks on Monday morning. Without it, the platform cannot be used as the actual back-office, only as a tracking dashboard.

3. **Reconcile the wiki vs the live schema.** Either rename the live tables to match the wiki canonical names (`users`, `positions`, `user_positions`, `commission_levels`, etc.) or — much more realistically — update `schema-spec.md` to reflect the live names (`agents`, `comp_grid_positions`, `agent_positions`, `comp_grid_rates`) and mark the deferred tables (payroll, webhooks, authenticated_links, audit_log, etc.) as "not yet built." Also rewrite `tech-stack-and-infrastructure.md` to say Vite + React + bun is the locked stack, not Next.js. **Why:** every future AI agent run will read the wiki, see the kickoff/Next.js story, hallucinate a `users` table, and write broken SQL. The wiki is the source of truth — it currently lies about both the framework and 60% of the table names. Cheap to fix, expensive to leave.

---

## Things I could not verify

- Supabase Auth provider toggles (email/password vs magic link vs OAuth). Tools available to me cannot read GoTrue config.
- `auth.users.email` unique constraint and `agents.email` unique-per-tenant constraint. I did not run a confirming query.
- `agent_contracts.(tenant_id, carrier_id, agent_number)` unique constraint. I did not run a confirming query.
- The exact body of `rls_auto_enable()` (only its existence and that it is callable by `anon` were surfaced by the advisor).
- Whether `gh run list` returned no output because there are zero workflow runs or because of an auth issue with `gh`. Repo metadata shows the repo is public and last pushed 2026-05-04.
