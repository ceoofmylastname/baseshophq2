# Audit Receipts

This folder is the permanent record of security and data-integrity audits performed against Base Shop HQ. These files are not generated automatically. They are committed by hand after a human-reviewed audit run, and they exist so that anyone (a new contributor, a carrier partner, a compliance reviewer) can answer "why is the security posture what it is?" without needing to re-run the audit.

## What lives here

`audit-report.md`
The full initial security audit of Base Shop HQ. Covers RLS posture, SECURITY DEFINER function inventory, EXECUTE grant footprint, and the discovered drift between live DB state and migration files. This is the snapshot that triggered the hygiene pass.

`security-hygiene-report.md`
The 52-function ledger produced after the REVOKE. For each SECURITY DEFINER function in `public`, this file records: caller-tenant enforcement, downline-visibility enforcement, EXECUTE grant footprint, and classification (acceptable, belt-and-suspenders, tenant-wide-by-design, outlier). Current state: 52 functions, 0 outliers. Two intentional patterns are documented and not flagged:

1. `position_template_blast_radius` uses both `can_view_agent()` and an explicit caller-tenant check. The redundant check is intentional and addresses the cross-tenant owner edge case in `can_view_agent`.
2. The `scoreboard_*` functions intentionally do not filter by `visible_agent_ids()` because they are tenant-wide leaderboards. Tenant scope is still enforced via `current_tenant_id()`.

`wiki-reconciliation-v2-map.md`
Maps the wiki drift that existed between `Wiki/index.md`, the actual wiki page filenames, and the live schema. Used to close the gap before the security pass. Kept here because the wiki state at the time of the audit is part of the audit's context.

## How to use this folder

Read order for a new contributor: `audit-report.md` first, then `security-hygiene-report.md`, then `wiki-reconciliation-v2-map.md`. The first explains why we audited. The second proves the audit found nothing wrong after the fix. The third explains the documentation state at the time.

When a new audit runs, add a new file with a date prefix (e.g. `2026-08-01-security-hygiene-report.md`) rather than overwriting. Older receipts stay. The folder is append-only by convention.

## What is NOT here

Operational runbooks, deploy checklists, and one-off Lovable/Bolt prompt packs do not belong in this folder. Those belong in `branded/` or `ops/` if those folders exist. This folder is strictly for audit evidence.

## Related

The actual fix this folder documents lives at:
`supabase/migrations/20260511120000_revoke_rls_auto_enable_grants.sql`

The wiki entries describing the pass live at:
`Wiki/log.md` (entries dated 2026-05-11 and 2026-05-12)
