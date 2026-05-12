# CI Secrets

None required at this checkpoint.

The `migration-check` job runs against the local Supabase stack the CLI brings up via Docker inside the runner. The remote Supabase project (`oarstmxbgdczytwzpyxj`) is never contacted by CI.

If future jobs need to talk to the remote project (e.g. a deploy step, a schema diff against production), document the required secrets here. Likely candidates:

- `SUPABASE_ACCESS_TOKEN` — for `supabase login` and remote operations
- `SUPABASE_DB_PASSWORD` — for direct Postgres access
- `SUPABASE_SERVICE_ROLE_KEY` — never in browser code; only for server-side jobs
