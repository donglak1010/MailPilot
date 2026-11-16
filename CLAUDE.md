# MailPilot — project guide for Claude Code

Lean email-marketing SaaS for digital-product sellers and affiliate marketers.
Requirements: `docs/mailpilot_srs.md`. The owner communicates in Vietnamese; reply in Vietnamese.

## Non-negotiables

- **Cost rule:** no Redis, BullMQ, VPS, Kubernetes, microservices or paid third-party email provider without explicit approval. Modular monolith.
- **Never silently change the stack or schema.** Explain trade-offs and ask before adding infrastructure.
- **Tenant isolation:** every tenant table has `workspace_id` + RLS. Never disable RLS to make the UI work.
- **Secrets:** browser gets only `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`. Service-role, AWS and AI keys stay in Edge Function secrets.
- **Email safety:** consent-based lists only; mandatory `{{unsubscribe_url}}` + `List-Unsubscribe` headers; suppression checked immediately before every send; hard bounce/complaint ⇒ suppression.
- **Sending reliability:** bounded batches; durable pgmq queue; retry only transient errors with backoff + jitter; a `sending` row whose lease expired becomes `ambiguous` and is **never auto-retried**.
- **AI copy is a draft:** never invent claims, testimonials, earnings, scarcity or guarantees; human review before sending.

## Commands

```bash
npm run dev          # http://localhost:5173 (strict port; Supabase auth redirects expect it)
npm run typecheck    # tsc -b
npm run lint         # eslint .
npm run build        # tsc -b && vite build
npm run test:db      # supabase test db (pgTAP; needs `supabase start`)
supabase db reset    # rebuild local DB from migrations
```

Before finishing any phase: `lint`, `typecheck`, `build` and `test:db` must pass.
After any migration: `supabase db reset` then `npm run db:types` and commit the regenerated types.
After editing `supabase/config.toml`: `supabase stop && supabase start` (auth settings only reload on restart).
Local dev login and test accounts are documented at the top of `supabase/seed.sql` (local only).

## SQL gotchas

- Supabase loads **pg-safeupdate** for API sessions: `DELETE`/`UPDATE` without `WHERE` fails
  ("DELETE requires a WHERE clause") — including inside RPC functions. pgTAP tests do NOT catch
  this (they run outside PostgREST, and `load 'safeupdate'` is not permitted). Use `TRUNCATE` for
  temp tables and always write a `WHERE`. Verify new RPCs through the real API (browser or supabase-js).

## Auth & tenancy (Phase 1)

- `AuthProvider` (onAuthStateChange) → `RequireAuth` / `PublicOnly` guards → `WorkspaceProvider` → `AppShell`.
- `useWorkspace()` gives `current` workspace + role; selection persisted per user in localStorage.
- Role checks in the UI (`canManageWorkspace`) are hints only; RLS is the authority. An RLS-filtered
  update returns 0 rows rather than an error — check `.select()` length after updates.
- Post-login redirects must go through `safeNextPath()` (open-redirect guard).
- Browser timezone lists use ICU names (`Asia/Saigon`); always include the stored value (`listTimezones(current)`).

## Environment notes (Windows dev machine)

- Supabase CLI is a standalone binary at `%LOCALAPPDATA%\supabase-cli` (on user PATH).
- Windows Smart App Control blocks some **unsigned native `.node` binaries** (e.g. oxlint). Prefer pure-JS tooling; if a package fails with `ERR_DLOPEN_FAILED ... Application Control policy`, choose a JS alternative — do not try to change OS security settings.
- TypeScript is pinned to 6.0.x because typescript-eslint does not yet support TS 7.

## Architecture

- `src/app` router (lazy routes) + providers (TanStack Query, Tooltip, Toaster).
- `src/features/<module>` owns its pages, hooks and API calls. Shared UI in `src/components`, shadcn primitives in `src/components/ui` (generated — edit sparingly).
- `src/lib/supabase/client.ts` — single browser client (`getSupabase()`).
- `supabase/migrations/0001_mailpilot_schema.sql` — schema, RLS, triggers, queue RPCs.

### Schema decisions (differ from the original SRS draft)

- `campaign_recipients` is replaced by **`email_sends`** — one outbox for campaign and sequence emails, one queue (`email_send`), one worker, one event pipeline.
- `sender_domains.domain` is **globally unique** (shared SES account ⇒ one identity per domain).
- Contacts can be `subscribed` only with `consent_at` + `consent_source`.
- Quota/safety columns on `workspaces` are not client-writable (column grants).
- Clients may only make safe campaign status transitions (trigger `guard_campaign_client_update`); `sending`/`sent` are server-only.
- Server-only RPCs (`enqueue_campaign`, `claim_send`, `complete_send`, `fail_send`, `record_email_event`, `unsubscribe_send`, queue wrappers, …) are executable by `service_role` only.

### Send pipeline (Phase 4)

1. `enqueue_campaign(id)` materialises `email_sends` (deduped, suppression-filtered) and pushes `{send_id}` to pgmq.
2. Worker: `queue_read` → `claim_send(send_id)` → outcome `send | drop | defer`.
3. `send` ⇒ call SES ⇒ `complete_send` or `fail_send(permanent?)`; `defer` ⇒ `queue_defer(msg, delay)`.
4. Cron: `enqueue_due_campaigns`, `enqueue_due_sequence_steps`, `mark_stale_sends_ambiguous`, `finalize_campaigns`.
5. SES events (SNS) ⇒ `webhook_inbox` ⇒ `record_email_event` (idempotent on provider event id).
