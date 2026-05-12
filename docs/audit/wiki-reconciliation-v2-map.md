# Wiki Reconciliation v2 — Phase 1 Resolution Map

**Generated:** 2026-05-11
**Phase:** 1 of 2 (mapping only; no edits applied)
**Wiki root:** `/Users/johnmelvin/Documents/Baseshop HQ/wiki/`
**Supabase project:** `oarstmxbgdczytwzpyxj`

---

## Precondition verification

All preconditions verified PASS via `information_schema` queries against project `oarstmxbgdczytwzpyxj`.

| Precondition | Result | Evidence |
|---|---|---|
| `comp_grid_positions` has `position_name` and `sort_order` (not `title` / `priority`) | PASS | columns: `id, tenant_id, position_code, position_name, sort_order, is_active, is_commissioned, created_at, updated_at` |
| `agents` has `is_owner boolean`, `archived_at timestamptz`, `upline_agent_id`, `upline_email` (not `permission_level`, `annual_goal`, `is_archived`) | PASS | columns include `is_owner boolean NOT NULL`, `archived_at timestamptz NULL`, `upline_agent_id uuid`, `upline_email text`. None of the legacy columns are present. |
| `agent_positions` columns: `agent_id, position_id, start_date, end_date, assigned_by, notes` (no `upline_user_id`) | PASS | columns: `id, tenant_id, agent_id, position_id, start_date, end_date, assigned_by, notes, created_at` |
| `tenants` has `annual_goal_amount` | PASS | column `annual_goal_amount numeric NOT NULL` present |
| `comp_grid_carriers` exists; `carriers` does not | PASS | `information_schema.tables` returns `comp_grid_carriers` and `comp_grid_rates`; no `carriers` row |
| `commission_rate_adjustments` does NOT exist | PASS | table absent from `information_schema.tables` query |

All preconditions PASS. Map build proceeds.

---

## Classification legend

- **RENAME** — mechanical column/table/string rename per the v2 decision table.
- **REWRITE-PERM** — replace `permission_level` enum description with the locked is_owner paragraph.
- **REWRITE-GOAL** — replace `agents.annual_goal` references with `tenants.annual_goal_amount` plus the locked inline note.
- **REWRITE-UPLINE** — drop `upline_user_id` from `agent_positions` schema blocks; add the locked sentence about `agents.upline_agent_id`.
- **MOVE-PAGE** — applies only to `wiki/rate-adjustments.md` itself (move under `wiki/deprecated/` and prepend the deprecation banner).
- **RELINK** — inbound `[[rate-adjustments]]` link in another page; rewrite to `[[comp-grid-engine]]` when that page exists (it does), else strip brackets to prose. (`comp-grid-engine.md` exists so every relink targets it.)
- **INDEX-UPDATE** — `index.md` edits per Step 2 instructions.
- **FALSE-POSITIVE** — keyword matched but context is prose, file paths, or page-link names. Leave alone.

---

## Per-file map

### `agent-onboarding-flow.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| 40 | `- \`permission_level\`` (CSV template column header in the "Template columns" list) | REWRITE-PERM | Drop the `permission_level` column from the CSV template column list. Add an inline note: "The CSV template no longer carries a `permission_level` column. Owner status is set per agent on `agents.is_owner` from the Agents Directory after import. Permission is a single boolean on `agents.is_owner`. Owner = `is_owner = true`. All other agents are non-owners. Manager-like authority over a downline is derived from being another agent's `upline_agent_id`, not stored as a role. The `status` enum (`active | inactive | archived`) is orthogonal to permission and only tracks lifecycle." Also remove **Permission Level** from the manual Add a User form field list (line 15) and rewrite the "Permission level vs position" section (lines 73-80) to reflect the boolean model. | REWRITE-PERM |
| 46 | `- \`annual_goal\`` (CSV template column header) | REWRITE-GOAL | Drop the `annual_goal` CSV template column. Add inline note: "Note: per-agent goals are not implemented in the live DB. The goal is tenant-wide via `tenants.annual_goal_amount`. Per-agent goal tracking is a parked product spec." Also drop **Annual goal** from the manual form field list (line 21). | REWRITE-GOAL |
| 47 | `position_title\` (looked up against \`comp_grid_positions.title\`)` | RENAME | `position_title\` (looked up against \`comp_grid_positions.position_name\`)` | RENAME (mechanical) |

### `hierarchy-permissions-model.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| 63 | `- \`upline_user_id\`` (bullet under "Every position assignment carries:") | REWRITE-UPLINE | Drop the `upline_user_id` bullet from this list (the live `agent_positions` table does not have this column). Add the locked sentence to this section: "Upline is stored on the agent record as `agents.upline_agent_id` (with `agents.upline_email` as a denormalized helper). `agent_positions` tracks position-history only." | REWRITE-UPLINE |
| 75 | `The hierarchy is a recursive parent-child relationship on the agents table (\`upline_user_id\`) plus a separate \`agent_positions\` table that holds the time-stamped history.` | RENAME | `The hierarchy is a recursive parent-child relationship on the agents table (\`upline_agent_id\`) plus a separate \`agent_positions\` table that holds the time-stamped history.` | RENAME (column reference in prose schema-context — `agents.upline_user_id` → `agents.upline_agent_id`) |

### `positions-and-blueprint.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| 27 | `- \`title\` (e.g. "Position #8")` (in `comp_grid_positions` schema block) | RENAME | `- \`position_name\` (e.g. "Position #8")` | RENAME |
| 28 | `- \`priority\` (integer, lower or higher means more senior depending on agency convention; AgentView uses lower number means higher priority counted from the top)` | RENAME | `- \`sort_order\` (integer, lower or higher means more senior depending on agency convention; AgentView uses lower number means higher priority counted from the top)` | RENAME |
| 41 | `- \`upline_user_id\`` (in `agent_positions` schema block) | REWRITE-UPLINE | Drop the bullet. Append the locked sentence to this section: "Upline is stored on the agent record as `agents.upline_agent_id` (with `agents.upline_email` as a denormalized helper). `agent_positions` tracks position-history only." | REWRITE-UPLINE |
| 46 | `When a user changes positions, the existing row gets \`end_date\` populated and a new row is inserted with the new \`position_id\`, \`upline_user_id\`, and \`start_date\`. Never edit history in place.` | REWRITE-UPLINE | `When a user changes positions, the existing row gets \`end_date\` populated and a new row is inserted with the new \`position_id\` and \`start_date\`. Never edit history in place. Upline changes are made on \`agents.upline_agent_id\` directly, not via \`agent_positions\`.` | REWRITE-UPLINE (the same upline_user_id drop applies in prose alongside schema fields) |
| 52 | `**Positions page** (System dropdown): a flat list of every defined position with columns \`Title\` and \`Priority\`. Pencil edit icon per row. Plus button to add a new position.` | RENAME | `**Positions page** (System dropdown): a flat list of every defined position with columns \`Position Name\` and \`Sort Order\`. Pencil edit icon per row. Plus button to add a new position.` | RENAME (UI columns map to the underlying schema columns) |
| 55 | `The Create User Position form requires User, Position (dropdown from the comp_grid_positions table), Upline (dropdown of agents), and Start date.` | FALSE-POSITIVE | (prose; no schema column ref) | FALSE-POSITIVE |
| 65 | `1. New \`comp_grid_positions\` table with columns above.` | FALSE-POSITIVE | (prose) | FALSE-POSITIVE |
| 67 | `**Positions page** showing title and priority columns. Create form with title and priority. Edit and delete per row. Owner-only access.` | RENAME | `**Positions page** showing position_name and sort_order columns. Create form with position_name and sort_order. Edit and delete per row. Owner-only access.` | RENAME (build-spec prose listing column names) |
| 78 | `Priority is not just a sort order. It is what drives commission spread math. ... The priority value lets the comp grid engine compute that spread without hard-coding rank labels.` | FALSE-POSITIVE | This paragraph uses "priority" conceptually rather than as a column name. The column is now `sort_order`. Recommend a light prose tweak on Phase 2 to say "The sort_order value (formerly called priority)…" — flagging as a CLARIFY edit; safe to leave as prose if scope is strict mechanical. **Treat as RENAME in Phase 2:** change the column-name mentions in this paragraph (`priority value`, `priority 30`, `priority 110`) to `sort_order`. | RENAME |

### `carriers-and-comp-sheets-page.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| 69 | `Gap analysis item #14. See [[rate-adjustments]] for full detail.` | RELINK | `Gap analysis item #14. See [[comp-grid-engine]] for full detail (the prior \`commission_rate_adjustments\` table was dropped during Phase 6b — rate overrides now flow through \`comp_grid_rates\` with \`rate_source = 'override'\`).` | RELINK |
| 130 | `### \`carriers\`` (H3 heading of a schema block) | RENAME | `### \`comp_grid_carriers\`` and update body columns to match live schema (`carrier_name`, `product_type`, `is_active`, etc.) — drop fields that no longer exist on the live table (`supported_name`, `chargeback_window_months`). Phase 2 edit owns the full body rewrite. | RENAME (table rename) |
| 154 | `### \`commission_rate_adjustments\`` (H3 schema heading + See-link) | RENAME / RELINK | Delete the heading and the "See [[rate-adjustments]] and [[schema-spec]]." line. Replace with a one-line deprecation note: "The `commission_rate_adjustments` table was dropped during Phase 6b. Rate overrides now flow through `comp_grid_rates` with `rate_source = 'override'`. See [[comp-grid-engine]]." | RENAME (delete deprecated schema block) |
| 156 | `See [[rate-adjustments]] and [[schema-spec]].` | RELINK | `See [[comp-grid-engine]] and [[schema-spec]].` | RELINK |
| 161 | `- [[rate-adjustments]]` (Related pages list) | RELINK | `- [[comp-grid-engine]]` (already present in list — Phase 2 should de-duplicate; if duplicate, just remove the `[[rate-adjustments]]` bullet) | RELINK |
| 3, 11, 13, 30, 35, 67, 73 | "Carriers list view", "/system/carriers", "Create Carrier", "Per-carrier configuration page", "Rate Adjustments tab", "Level Imports page" | FALSE-POSITIVE | UI surface names and URL paths. Not schema-context. | FALSE-POSITIVE |

### `rate-adjustments.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| (whole file) | Entire `wiki/rate-adjustments.md` describes the dropped `commission_rate_adjustments` table | MOVE-PAGE | Move file to `wiki/deprecated/rate-adjustments.md` (create the `deprecated/` directory). Prepend the locked deprecation banner above the existing `# Rate Adjustments` title:<br>`> **DEPRECATED 2026-05-11** — The \`commission_rate_adjustments\` table was dropped during the Phase 6b agent_overrides redesign. Rate overrides now flow through \`comp_grid_rates\` directly with \`rate_source = 'override'\`. This page is preserved for historical context only — do not write new code against it.`<br>`>`<br>`> See [[comp-grid-engine]] for the current rate-resolution model.` | MOVE-PAGE |
| 19 | `### \`commission_rate_adjustments\`` | (inside MOVE-PAGE scope) | No further edit beyond the page move + banner; content stays as historical. | MOVE-PAGE |
| 25, 46 | `commission_rate_adjustments` body / resolution-order references | (inside MOVE-PAGE scope) | No further edit. | MOVE-PAGE |
| 87 | `- [[carriers-and-comp-sheets-page]]` | (inside MOVE-PAGE scope) | No further edit. | MOVE-PAGE |

### `payroll-page.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| 126 | `- [[rate-adjustments]]` (Related pages list) | RELINK | `- [[comp-grid-engine]]` (note: `[[comp-grid-engine]]` already appears on line 125 — Phase 2 should drop the duplicate cleanly, ending with a single bullet) | RELINK |

### `schema-spec.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| 129 | `- \`permission_level\` (enum: \`agent\`, \`manager\`, \`owner\`, \`payroll_admin\`, \`integrations_admin\`)` | REWRITE-PERM | Replace this bullet with: `- \`is_owner\` (boolean, NOT NULL)` followed by the locked paragraph: "Permission is a single boolean on `agents.is_owner`. Owner = `is_owner = true`. All other agents are non-owners. Manager-like authority over a downline is derived from being another agent's `upline_agent_id`, not stored as a role. The `status` enum (`active | inactive | archived`) is orthogonal to permission and only tracks lifecycle." Also add `- \`upline_agent_id\` (uuid, nullable)` and `- \`upline_email\` (text, nullable, denormalized helper)` to the column list to match live schema. | REWRITE-PERM |
| 130 | `- \`annual_goal\` (numeric, USD)` | REWRITE-GOAL | Remove the bullet. Add the locked note in this section: "Note: per-agent goals are not implemented in the live DB. The goal is tenant-wide via `tenants.annual_goal_amount`. Per-agent goal tracking is a parked product spec." Phase 2 should also append `- \`annual_goal_amount\` (numeric, NOT NULL)` to the `tenants` schema block (or add a `tenants` schema block if one is missing). | REWRITE-GOAL |
| 131 | `- \`is_archived\` (boolean)` | RENAME | Replace with: `- \`archived_at\` (timestamptz, nullable; non-null indicates the agent is archived)`. Type changes boolean → timestamp; update inline type description. | RENAME |
| 143 | `- \`title\` (e.g. "Position #8")` (under `comp_grid_positions`) | RENAME | `- \`position_name\` (e.g. "Position #8")` | RENAME |
| 144 | `- \`priority\` (integer; sort order; lower means more senior in AgentView convention)` | RENAME | `- \`sort_order\` (integer; lower means more senior in AgentView convention)` | RENAME |
| 155 | `- \`upline_user_id\` (nullable for the top of the tree)` (under `agent_positions`) | REWRITE-UPLINE | Drop this bullet. Append the locked sentence to the `agent_positions` section: "Upline is stored on the agent record as `agents.upline_agent_id` (with `agents.upline_email` as a denormalized helper). `agent_positions` tracks position-history only." | REWRITE-UPLINE |
| 160 | `### \`carriers\`` (H3 schema heading) | RENAME | `### \`comp_grid_carriers\`` and rewrite body to live columns: `id`, `tenant_id`, `carrier_name`, `product_type` (enum: `life`, `annuity`), `is_active`, `created_at`, `updated_at`. Drop `supported_name` and `chargeback_window_months` (not in live table). Phase 2 owns the body rewrite. | RENAME (table rename) |
| 212 | `### \`commission_rate_adjustments\`` (H3 schema block) | RENAME | Delete the entire schema block (lines 212-226). Replace with a one-line deprecation note: "The `commission_rate_adjustments` table was dropped during Phase 6b. Rate overrides now flow through `comp_grid_rates` with `rate_source = 'override'`. See [[comp-grid-engine]]." | RENAME (delete deprecated schema block) |
| 475 | `- \`action\` (string; e.g. \`policy.update\`, \`user.archive\`, \`commission_level.update\`)` | RENAME | `- \`action\` (string; e.g. \`policy.update\`, \`user.archive\`, \`comp_grid_rate.update\`)` | RENAME (string-literal swap) |
| 633 | `- [[rate-adjustments]]` (Related pages list) | RELINK | Remove this bullet. `[[comp-grid-engine]]` already appears (line 623). | RELINK |

### `index.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| 40 | `- [[rate-adjustments]] — temporary commission overrides that sit on top of the base comp grid.` (under "Core concepts") | INDEX-UPDATE | Remove this bullet from the active section. Add a "## Deprecated" section near the bottom of the file with one line: `- [[deprecated/rate-adjustments]] — moved 2026-05-11; \`commission_rate_adjustments\` table dropped during Phase 6b. Rate overrides now flow through \`comp_grid_rates\` with \`rate_source = 'override'\`. See [[comp-grid-engine]].` | INDEX-UPDATE |
| 32 | `[[agora-master-grid-rates]] ... 11 Life carriers, 8 Annuity carriers, 50 product entries, 486 rates across 9 commissioned positions.` | FALSE-POSITIVE | Prose plural ("carriers"). | FALSE-POSITIVE |
| 55 | `- [[carriers-and-comp-sheets-page]] — Carriers list, Comp Sheets, Level Imports, Rate Adjustments tab.` | FALSE-POSITIVE | Page-link name and UI surface description. | FALSE-POSITIVE |

### `csv-imports-and-templates.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| 19 | `- **Columns**: \`permission_level\`, \`first_name\`, \`last_name\`, \`email\`, \`phone\`, \`npn\`, \`annual_goal\`, \`position_title\`, \`upline_email\`, \`start_date\`, \`send_invite\`.` | REWRITE-PERM + REWRITE-GOAL | Drop `permission_level` and `annual_goal` from the column list. Add inline note for each (the two locked paragraphs). Result: `**Columns**: \`first_name\`, \`last_name\`, \`email\`, \`phone\`, \`npn\`, \`position_title\`, \`upline_email\`, \`start_date\`, \`send_invite\`.` Then append the locked permission paragraph + the locked annual_goal note in a "Removed columns" subsection just below the column list. | REWRITE-PERM + REWRITE-GOAL |
| 24, 38, 94 | `[[carriers-and-comp-sheets-page]]` page-link references | FALSE-POSITIVE | Page-link names. | FALSE-POSITIVE |

### `agents-directory-page.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| 81 | `1. Add \`is_archived\` boolean to \`agents\` table.` (in the "Archived Agents" build-spec section) | RENAME | `1. Add \`archived_at\` (timestamptz, nullable) to \`agents\` table. Non-null indicates the agent is archived. Type changed from boolean to timestamp during Phase 6b.` | RENAME |
| 24 | `- Permission level` (filter bar item) | REWRITE-PERM | Replace with: `- Owner status (boolean)`. Also rewrite the **Role** table column (line 33: `Role` (Permission level: Organization Leader, Manager, Agent)) to: `Role` (Owner / Non-Owner; manager-like authority is derived from `upline_agent_id` not stored as a role). Add the locked permission paragraph in a sidebar or footnote. | REWRITE-PERM |
| 33 | `- **Role** (Permission level: Organization Leader, Manager, Agent)` (table column) | REWRITE-PERM | (covered with line 24 above) | REWRITE-PERM |
| 98 | `**Overview**: name, email, phone, NPN, position, upline, start date, annual goal.` (profile drawer Overview tab field list) | REWRITE-GOAL | Replace `annual goal` with a tenant-level goal reference; add the locked note. New text: `**Overview**: name, email, phone, NPN, position, upline, start date. (Per-agent annual goal removed — goal is tenant-wide via \`tenants.annual_goal_amount\`. Per-agent goal tracking is a parked product spec.)` | REWRITE-GOAL |
| 109 | "A manager-level user only sees themselves and their downline." (Permission scoping section) | REWRITE-PERM | Rewrite this paragraph to reflect the boolean model: "A non-owner agent only sees themselves and their downline (computed via `upline_agent_id` recursion). The owner (`is_owner = true`) sees everyone in the tenant. There is no separate 'manager' role." Include the locked permission paragraph above this paragraph if not already present elsewhere in this file. | REWRITE-PERM |

### `active-agent-billing-model.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| 46 | `AND u.is_archived = false` (inside the SQL block computing the active-agent count) | RENAME | `AND u.archived_at IS NULL` | RENAME (column rename inside a SQL code fence — schema-context) |

### `baseshop-hq-feature-gap-analysis.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| 202 | `- \`is_archived\` boolean on \`agents\` table.` (Item 12 build spec) | RENAME | `- \`archived_at\` (timestamptz, nullable) on \`agents\` table. Non-null indicates the agent is archived. (Type changed from boolean to timestamp during Phase 6b.)` | RENAME |
| 231 | `- \`commission_rate_adjustments\` table: id, tenant_id, carrier_id, product_id, position_id, agent_id, adjustment_rate, adjustment_type, start_date, end_date, reason.` (Item 14 build spec) | RENAME | Replace the bullet with a deprecation note: "Item 14 superseded — the `commission_rate_adjustments` table was dropped during Phase 6b. Rate overrides now flow through `comp_grid_rates` with `rate_source = 'override'`. See [[comp-grid-engine]]." | RENAME (delete deprecated schema bullet) |
| 235 | `Detailed in [[rate-adjustments]] and [[comp-grid-engine]].` | RELINK | `Detailed in [[comp-grid-engine]]. (Prior [[rate-adjustments]] page is deprecated — see deprecated/rate-adjustments.md.)` | RELINK |

### `pricing-and-checkout.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| 91 | `Agency name (becomes the tenant \`name\`), default subdomain (e.g. \`lifeco.baseshophq.com\`), owner full name, owner email (becomes the first user, \`permission_level = owner\`), phone, time zone.` | REWRITE-PERM | Replace `\`permission_level = owner\`` with `\`is_owner = true\``. Net effect: `... owner email (becomes the first user, \`is_owner = true\`), phone, time zone.` (Locked permission paragraph not required in this prose context per Step 2 — the change is a single literal swap.) | REWRITE-PERM (literal column ref inline; minor inline swap, no full paragraph) |
| 58 | `Everything in Starter plus unlimited carriers, multi-carrier comp grids, …` | FALSE-POSITIVE | Prose plural ("carriers"). | FALSE-POSITIVE |

### `comp-grid-engine.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| 227 | `- [[rate-adjustments]]` (Related pages list) | RELINK | Remove this bullet. (Self-link to `comp-grid-engine` is not required.) | RELINK |
| 38, 52, 108, 128, 132, 201, 228 (and other "carriers" plural prose mentions throughout) | "X Life rates across Y carriers", "carriers per product type", "11 Life carriers, 8 Annuity carriers", "[[carriers-and-comp-sheets-page]]" | FALSE-POSITIVE | Prose plurals and a page-link name. None are schema-context column refs. | FALSE-POSITIVE |

### `comp-grid-build-spec.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| 83 | `Remove the \`commission_rate_adjustments\` fetch (table is dropped).` | FALSE-POSITIVE | Prose already correctly documenting the drop. Leave as-is. | FALSE-POSITIVE |
| 47, 63, 247, 255, 264 | various "carriers" prose plurals ("11 Life carriers", "all carriers", etc.) | FALSE-POSITIVE | Prose plurals. | FALSE-POSITIVE |

### `antigravity-build-sequence.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| 156 | `- Wiki/carriers-and-comp-sheets-page.md` (a Lovable-prompt reference list of wiki files) | FALSE-POSITIVE | File path / page-link name. | FALSE-POSITIVE |
| 389 | `default positions, blank carriers, agency brand inherited.` | FALSE-POSITIVE | Prose plural. | FALSE-POSITIVE |
| 560 | `- \`agent_position_history.upline_email\` to \`upline_user_id\` migration.` (queued-work list) | UNRESOLVED — likely RENAME or REWRITE | This refers to a queued migration item from a historical pass. The live schema has neither `agent_position_history` (replaced by `agent_positions`) nor an `agent_positions.upline_user_id` column (upline now lives on `agents.upline_agent_id`). Recommended Phase 2 rewrite: "Migration of historical upline data to `agents.upline_agent_id` (with `agents.upline_email` as the denormalized helper). The `upline_user_id` column on the deprecated `agent_position_history` table was never carried forward to `agent_positions`." | UNRESOLVED — flagged for human review of the exact replacement text; default action: REWRITE-UPLINE-equivalent prose rewrite. |

### `log.md` (append-only changelog — special handling)

The historical log entries below describe past states correctly as they existed at the time. Per Phase-1 rules ("Mechanical-rename hits target schema-context only: table definitions, column refs in tables, SQL code fences, ER diagrams, FK descriptions, type lines. Prose plurals, file paths, and wiki-page links are false positives"), and because `log.md` is an append-only changelog of historical decisions, none of the matches below should be back-edited. They are not schema-context.

| Line | Current text | Action | Classification |
|---|---|---|---|
| 23 | `- \`rate-adjustments.md\`` (in a list of pages updated in a past pass) | FALSE-POSITIVE | Historical file-list entry. | FALSE-POSITIVE |
| 31 | `- \`carriers-and-comp-sheets-page.md\`` | FALSE-POSITIVE | Historical file-list entry. | FALSE-POSITIVE |
| 72 | `\`carriers-and-comp-sheets-page.md\` — added the three paths …` | FALSE-POSITIVE | Historical file-list entry. | FALSE-POSITIVE |
| 99 | `\`policy-import-playbook.md\` — … positions, agents, NPN, writing numbers, comp grid, carriers, webhooks …` | FALSE-POSITIVE | Prose plural in a historical changelog. | FALSE-POSITIVE |
| 119 | `\`comp-grid-engine.md\` — added "Verified Behavior (2026-05-01)" section documenting … (upline_email → upline_user_id migration queued; reassign-upline UI shipped separately).` | FALSE-POSITIVE | Historical entry describing what the log entry was at the time. | FALSE-POSITIVE |
| 125 | `Migrate \`agent_position_history.upline_email\` (TEXT) to \`upline_user_id\` (FK). Brittle …` | FALSE-POSITIVE | Historical queued-work note; the table no longer exists. | FALSE-POSITIVE |
| 316 | `3. Apply \`commission_rate_adjustments\` (temporary bonuses) on top.` | FALSE-POSITIVE | Historical resolution-order documentation. | FALSE-POSITIVE |
| 419 | `Carrier roster inheritance shipped. Every agent in a tenant now sees the owner's full carrier list in every dropdown. Owner-added carriers propagate to active agent sessions in real time via Supabase Realtime.` | FALSE-POSITIVE | Prose plurals. | FALSE-POSITIVE |
| 437 | `… destructive DROP TABLE statements were executed directly in the Lovable Cloud SQL editor on the production Supabase backing the tenant, dropping carriers, carrier_products, positions, agent_position_history, commission_levels, commission_rate_adjustments, promotion_targets, …` | FALSE-POSITIVE | Historical incident log naming the dropped tables. | FALSE-POSITIVE |
| 445 | `\`agora-master-grid-rates.md\` — … 11 Life carriers …, 8 Annuity carriers …` | FALSE-POSITIVE | Prose plural in changelog. | FALSE-POSITIVE |
| 480 | `commission_rate_adjustments table. Override system on agent_carrier_rates replaces the temporary-bonus mechanism.` | FALSE-POSITIVE | Historical "deprecated and dropped" note. | FALSE-POSITIVE |
| 483 | `carriers and carrier_products tables. Replaced by comp_grid_carriers and comp_grid_products …` | FALSE-POSITIVE | Historical deprecation entry. | FALSE-POSITIVE |
| 568 | `… for carriers, products, and percentages.` | FALSE-POSITIVE | Prose plural in changelog. | FALSE-POSITIVE |
| 618 | `… edge cases that smoke tests don't, especially around CSV variability across carriers …` | FALSE-POSITIVE | Prose plural in changelog. | FALSE-POSITIVE |
| 631 | `Files touched: schema-spec.md, hierarchy-permissions-model.md, agent-onboarding-flow.md, contracts-page.md, positions-and-blueprint.md, agents-directory-page.md, agent-profile-pages.md, realtime-updates-and-hierarchy-cascade.md, csv-imports-and-templates.md, carriers-and-comp-sheets-page.md, rate-adjustments.md, …` | FALSE-POSITIVE | Historical file-list. | FALSE-POSITIVE |

### `contracts-page.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| 83 | `- \`carrier_id\` (foreign key to \`carriers\`)` (FK description inside the `agent_contracts` schema block) | RENAME | `- \`carrier_id\` (foreign key to \`comp_grid_carriers\`)` | RENAME (table rename in FK description — schema-context) |
| 109 | `- [[carriers-and-comp-sheets-page]]` (Related pages list) | FALSE-POSITIVE | Page-link name. | FALSE-POSITIVE |

### `integrations-page.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| 48 | `… each carrier has its own credentials and security requirements. After v1 ships, the goal is self-serve setup for the most common carriers.` | FALSE-POSITIVE | Prose plurals. | FALSE-POSITIVE |
| 111 | `- [[carriers-and-comp-sheets-page]]` | FALSE-POSITIVE | Page-link name. | FALSE-POSITIVE |

### `carrier-ingest-pipeline.md`

All "carriers" matches (lines 3, 19, 23, 121, 128) are prose plurals or page-link names. No schema-context hits.

| Line | Current text | Action | Classification |
|---|---|---|---|
| 3, 19, 23, 121, 128 | "Carriers that don't deliver feeds", "per carrier", "[[carriers-and-comp-sheets-page]]" | FALSE-POSITIVE |

### `ui-design-system.md`

| Line | Current text | Action | Classification |
|---|---|---|---|
| 233 | `- [[carriers-and-comp-sheets-page]]` | FALSE-POSITIVE |

### `marketing-site-and-acquisition.md`

| Line | Current text | Action | Classification |
|---|---|---|---|
| 34 | `"How it works" three-step: connect carriers, upload your roster, watch your book come alive.` | FALSE-POSITIVE |

### `agora-master-grid-rates.md`

All "carriers" matches (lines 13, 34, 99, 1006) are prose plurals describing rate-seed metadata. No schema-context.

| Line | Current text | Action | Classification |
|---|---|---|---|
| 13, 34, 99, 1006 | prose plural "carriers" | FALSE-POSITIVE |

### `tech-stack-and-infrastructure.md`

| Line | Current text | Action | Classification |
|---|---|---|---|
| 146 | `A seed script that populates a sample tenant with positions, carriers, agents, and policies for fast iteration.` | FALSE-POSITIVE |

### `book-of-business-page.md`

| Line | Current text | Action | Classification |
|---|---|---|---|
| 69 | `The carrier ingest pipeline parsers (where carriers provide them)` | FALSE-POSITIVE |

### `book-valuation-and-ma-readiness.md`

| Line | Current text | Action | New text | Classification |
|---|---|---|---|---|
| 119 | `… a read-only computation over \`policies\`, \`agents\`, \`policy_status_history\`, \`policy_commissions\`, and \`carriers\`.` | RENAME | `… a read-only computation over \`policies\`, \`agents\`, \`policy_status_history\`, \`policy_commissions\`, and \`comp_grid_carriers\`.` | RENAME (table-ref list inside a schema-context paragraph) |

### `policy-import-playbook.md`

| Line | Current text | Action | Classification |
|---|---|---|---|
| 80 | `Add every carrier you write with. This makes the carrier name normalize correctly across the system. See [[carriers-and-comp-sheets-page]].` | FALSE-POSITIVE |
| 293 | `\| Add carriers \| Yes \| No \| No \|` (role permission matrix row label) | FALSE-POSITIVE |
| 354 | `- [[carriers-and-comp-sheets-page]]` | FALSE-POSITIVE |

### `white-label-and-sub-account-architecture.md`

| Line | Current text | Action | Classification |
|---|---|---|---|
| 17 | `agent directory, positions blueprint, comp grids, carriers, policies, payroll, and webhooks.` | FALSE-POSITIVE |
| 272 | `Spin up a new isolated environment with default positions, blank carriers list, and the agency's brand inherited.` | FALSE-POSITIVE |

### `source-summaries/agentview-onboarding-call.md`

| Line | Current text | Action | Classification |
|---|---|---|---|
| 31 | `Direct carrier feeds via API or FTP for carriers that allow it. … New carriers get integrated in roughly 12 hours.` | FALSE-POSITIVE |
| 58 | `See [[agents-directory-page]], …, [[carriers-and-comp-sheets-page]], …` | FALSE-POSITIVE |

---

## Files to be edited in Phase 2

The following files have at least one non-FALSE-POSITIVE action queued:

1. `agent-onboarding-flow.md` — REWRITE-PERM, REWRITE-GOAL, RENAME
2. `hierarchy-permissions-model.md` — REWRITE-UPLINE, RENAME
3. `positions-and-blueprint.md` — RENAME (multiple), REWRITE-UPLINE
4. `carriers-and-comp-sheets-page.md` — RENAME (table rename + delete deprecated block), RELINK (multiple)
5. `rate-adjustments.md` — MOVE-PAGE (page move + deprecation banner)
6. `payroll-page.md` — RELINK
7. `schema-spec.md` — RENAME (multiple), REWRITE-PERM, REWRITE-GOAL, REWRITE-UPLINE, RELINK
8. `index.md` — INDEX-UPDATE
9. `csv-imports-and-templates.md` — REWRITE-PERM, REWRITE-GOAL
10. `agents-directory-page.md` — RENAME, REWRITE-PERM, REWRITE-GOAL
11. `active-agent-billing-model.md` — RENAME (SQL fence)
12. `baseshop-hq-feature-gap-analysis.md` — RENAME, RELINK
13. `pricing-and-checkout.md` — REWRITE-PERM (literal swap)
14. `comp-grid-engine.md` — RELINK
15. `antigravity-build-sequence.md` — UNRESOLVED rewrite (flagged below)
16. `contracts-page.md` — RENAME (FK description)
17. `book-valuation-and-ma-readiness.md` — RENAME (table-ref list)
18. `wiki/deprecated/` — NEW directory to be created during Phase 2.

`log.md` is intentionally excluded from Phase 2 edits per the false-positive rationale (append-only historical changelog).

---

## Unresolved hits

1. **`antigravity-build-sequence.md` line 560** — `\`agent_position_history.upline_email\` to \`upline_user_id\` migration.`
   Question for human review: this is a queued-work item from a prior pass. The live schema has no `agent_position_history` table and no `upline_user_id` column. Two reasonable Phase 2 rewrites:
   (a) Strike the bullet entirely (the migration is moot — the column never made it into `agent_positions` in the live schema; upline lives on `agents.upline_agent_id`).
   (b) Rewrite as: "Historical upline data now lives on `agents.upline_agent_id` (with `agents.upline_email` as denormalized helper). Migration of any remaining `upline_email`-only rows is tracked separately."
   Recommended: option (a). Awaiting human confirmation before Phase 2 applies anything.

2. **`positions-and-blueprint.md` line 78** — The "Why priority matters" paragraph uses `priority` as a conceptual term as well as a column name reference. Confirming Phase 2 scope: the locked decision says rename `priority` → `sort_order` mechanically, so the in-paragraph mentions of `priority` (column-name-style) should also become `sort_order`. Flagging because the surrounding prose ("Priority is not just a sort order. It is what drives commission spread math.") becomes self-referential ("sort_order is not just a sort order"). Suggest a light prose tweak to: "The sort_order value (previously called priority in earlier docs) drives commission spread math…" — flagging for human approval of the exact phrasing.

---

## Confirmation

- No wiki files were edited during Phase 1.
- No page was moved during Phase 1.
- `log.md` was not appended to.
- The map above is the complete set of edits queued for Phase 2.
