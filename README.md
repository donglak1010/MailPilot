# MailPilot

Lean email-marketing SaaS for digital-product sellers and affiliate marketers:
contacts, campaigns, automated sequences and an AI email writer, sending through Amazon SES.

Full requirements: [`docs/mailpilot_srs.md`](docs/mailpilot_srs.md).

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + Vite 8 + TypeScript 6, Tailwind CSS 4, shadcn/ui (Radix) |
| Routing / data | React Router 8, TanStack Query, Zod |
| Backend | Supabase: Auth, Postgres + RLS, Storage, Queues (pgmq), Edge Functions |
| Email | Amazon SES v2 |
| Hosting | Netlify |

## Prerequisites

- Node.js 22+
- Docker Desktop (WSL2 backend on Windows), running
- Supabase CLI 3+

## Local development

```bash
npm install
supabase start                 # local Postgres/Auth/Storage; applies migrations
cp .env.example .env.local     # set VITE_SUPABASE_PUBLISHABLE_KEY from `supabase status`
npm run dev                    # http://localhost:5173
```

Supabase Studio: http://127.0.0.1:54323 · local inbox (Mailpit): http://127.0.0.1:54324

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on port 5173 |
| `npm run typecheck` | TypeScript project build check |
| `npm run lint` | ESLint |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run test:db` | pgTAP database tests in `supabase/tests/` (needs `supabase start`) |
| `npm run db:types` | Regenerate `src/types/database.ts` from the local schema |
| `supabase db reset` | Recreate local DB from migrations + `supabase/seed.sql` (local dev login is documented there) |

## Project layout

```text
src/
  app/            router + providers
  components/     ui/ (shadcn), layout/, feedback/
  features/       one folder per module (contacts, campaigns, sequences, …)
  hooks/  lib/    shared hooks, env, supabase client, constants
supabase/
  migrations/     SQL schema (source of truth)
  tests/          pgTAP tests
  functions/      Edge Functions (SES, workers, AI) — from Phase 3
docs/             SRS and design notes
```

## Secrets

- Browser: only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Server-only secrets (AWS, AI, signing secrets) live in `supabase/functions/.env`
  locally and Supabase secrets in production. See `supabase/functions/.env.example`.

## Status

- [x] Phase 0 — scaffold, app shell, schema + smoke tests
- [x] Phase 1 — auth, workspace bootstrap, RLS tests, pg_cron jobs
- [ ] Phase 2 — contacts, lists, tags, CSV import
- [ ] Phase 3 — sender domains + SES
- [ ] Phase 4 — campaigns + send pipeline
- [ ] Phase 5 — sequences, templates, AI writer
- [ ] Phase 6 — hardening, launch checklist
