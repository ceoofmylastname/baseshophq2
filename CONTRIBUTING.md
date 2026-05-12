# Contributing

## Prerequisites

- **bun** 1.3+ — package manager and test runner
- **Supabase CLI** 2.98+ — `brew install supabase/tap/supabase`
- A **container runtime** for `supabase start`. Any of:
  - [OrbStack](https://orbstack.dev/) (recommended on macOS — lighter than Docker Desktop)
  - Docker Desktop
  - Colima
  - Podman

`supabase start` brings up the local Postgres + Auth + PostgREST stack inside Docker. Without one of the above, the local dev loop and the `migration-check` CI job will not work.

## First-time setup

```bash
git clone git@github.com:ceoofmylastname/baseshophq2.git
cd baseshophq2
bun install
supabase start          # 30-60s on first run (image pulls)
supabase db reset       # applies all migrations + supabase/seed.sql
cp .env.example .env.local
# edit .env.local to point at the local stack (URLs printed by `supabase start`)
bun run dev
```

## Demo login

The seed creates a single demo tenant with a realistic 17-agent hierarchy, 3 carriers, ~125 policies, and 5 orphan policies that exercise the manual-review queue.

- URL: `http://localhost:5173`
- Email: `demo@baseshophq.test`
- Password: `BaseShop!2026`

The owner sees the full tenant. To exercise view-down permissions, query the 4 director accounts or 12 third-level agents directly via SQL — they exist in `auth.users` but use placeholder passwords (not loggable through the UI by design).

## Daily commands

```bash
bun run dev          # vite dev server on :5173
bun run lint         # eslint correctness rules
bun run typecheck    # tsc --noEmit
bun run test         # bun test
bun run format       # prettier --write (local-only; not run in CI)

supabase db reset    # wipe local + re-apply migrations + seed
supabase stop        # tear down local stack
```

## What CI runs on every PR

- `lint` — eslint, max-warnings 0
- `typecheck` — `tsc --noEmit`
- `test` — `bun test`
- `migration-check` — `supabase db reset --local` end-to-end, applying every migration + seed against a fresh stack

All four must pass before merge. See [.github/workflows/ci.yml](.github/workflows/ci.yml) and [.github/SECRETS.md](.github/SECRETS.md).
