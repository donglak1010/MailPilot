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

### Sender domains (Phase 3)

- Edge Function `sender-domains` (actions: account, create, refresh, delete, send_test) is the only writer of
  `sender_domains` (service role). It checks membership/role itself — RLS is bypassed there.
- SES v2 via `aws4fetch` (`supabase/functions/_shared/ses.ts`); pure logic in `_shared/sender-domain.ts`
  (unit-tested by vitest). `SES_MOCK=true` in `supabase/functions/.env` fakes SES locally (refused on hosted).
- Local functions: `supabase functions serve --env-file supabase/functions/.env`. AWS setup: `docs/aws-ses-setup.md`.
- All DNS records go on the sending subdomain; never tell users to change their root SPF.
- Test emails go only to the caller's own auth email and count toward `emails_sent` / daily limit.

### Send pipeline (Phase 4)

1. `enqueue_campaign(id)` materialises `email_sends` (deduped, suppression-filtered) and pushes `{send_id}` to pgmq.
2. Worker: `queue_read` → `claim_send(send_id)` → outcome `send | drop | defer`.
3. `send` ⇒ call SES ⇒ `complete_send` or `fail_send(permanent?)`; `defer` ⇒ `queue_defer(msg, delay)`.
4. Cron: `enqueue_due_campaigns`, `enqueue_due_sequence_steps`, `mark_stale_sends_ambiguous`, `finalize_campaigns`.
5. SES events (SNS) ⇒ `webhook_inbox` ⇒ `record_email_event` (idempotent on provider event id).

Implementation (0004_campaign_sending.sql + functions):
- Client actions go through RPCs that check roles themselves: `start_campaign`, `schedule_campaign`, `resume_campaign`
  (owner/admin), `pause_campaign`, `cancel_campaign` (any member). All share `private.campaign_preflight` (verified sender,
  subject/content, `{{unsubscribe_url}}`, postal address, non-empty audience, monthly quota). Errors carry the code in `hint`
  (mapped in `src/lib/supabase/errors.ts`).
- Worker trigger: `private.kick_worker()` → `pg_net` POST to `send-worker` with `x-worker-secret`; run by cron
  `mp-send-worker` every minute and right after start/resume. Needs Vault secrets `mp_functions_url`, `mp_worker_secret`
  (local values in `seed.sql`; hosted: see `docs/aws-ses-setup.md`). Missing secrets ⇒ silent no-op.
- `send-worker`: single instance via `acquire_worker_lease`; time budget 45 s; rate `SES_MAX_SEND_RATE`/s; transient SES
  errors ⇒ `fail_send(false)` + backoff with jitter (max 6 reads); network errors after the request ⇒ left `sending`
  (→ ambiguous). Note: `claim_send` counts usage before SES, so retries over-count `emails_sent` slightly (conservative).
- `unsubscribe` (public): POST with HMAC token (`_shared/unsubscribe-token.ts`); GET only redirects to the app page
  `/unsubscribe` (link scanners must not unsubscribe people). Emails carry `List-Unsubscribe` + `-Post` one-click headers.
- `ses-events` (public): SNS signature verified with WebCrypto (`_shared/sns.ts`), topic must equal `SES_EVENTS_TOPIC_ARN`.
- Merge-tag rendering lives in `supabase/functions/_shared/render.ts` and is imported by the app as `@shared/render`
  (preview = exactly what the worker sends). Keep that file free of Deno/npm imports.
- Functions with `verify_jwt = false` are listed in `supabase/config.toml`; they must authenticate requests themselves.

<!-- BEGIN AWS Agent Toolkit rules -->
# AWS Guidance

- Where these AWS rules conflict with the project's own instructions, the
  project's instructions take precedence.
- Prefer the AWS MCP Server for AWS interactions — it provides sandboxed
  execution, observability, and audit logging. If unavailable, use the
  AWS CLI directly.
- For any AWS task or question — building, configuring, migrating, debugging,
  or operating a service, writing SDK code, authoring CDK/CloudFormation, or
  answering how a service works — first call `aws___search_documentation` with
  topic `agent_skills` and load the matching skill with `aws___retrieve_skill`.
  Do this even when you believe you know the answer: skills carry current
  service behavior that your training may not. Prefer the skill's guidance over
  general knowledge. Skip it only for work that does not involve AWS.
- When uncertain about specific AWS details (API parameters, permissions,
  limits, error codes), verify against documentation rather than guessing.
  State uncertainty explicitly if you cannot confirm.
- Before reporting a count, a total, or that something does not exist, read
  every page of the results and search every Region and scope where it could
  be. If you could not, say the result is partial and name what you checked.
- To say what a system currently does, read what the runtime uses: the
  completed deployment, the alias or version that is invoked, the template the
  stack is running. A newer stored version, a draft, or a description field is
  not evidence of live behavior.
- Present a cause as confirmed only if data, configuration, or logs you read
  show it. Label anything else as unverified, and say what you would check
  next.
- Before you interpret the records that show a failure, such as error log
  lines, failed executions, or table items, read one of them whole, with
  every field. Don't truncate messages or select fields in your own code
  until you have.
- When an error says a value was undefined, null, empty, or missing, find
  the input, query result, or item that supplied that value. If the account
  shows why it was empty, such as no item matching the key, read that
  before you call the cause unverified.
- When a field in a record you read explains the result, such as an error
  counter, an empty array, a null, or a state value, name the field and its
  exact value in the answer, and say which record it came from.
- When the user asks a specific question or names a suspected cause, confirm
  or rule out each cause they raised, and do not offer alternatives your evidence
  does not support.
- When creating infrastructure, prefer infrastructure-as-code (AWS CDK or
  CloudFormation) over direct CLI commands.
- When working with infrastructure, follow AWS Well-Architected Framework
  principles.
- Do not use em dashes in AWS resource names or descriptions. Use
  hyphens instead.

## Before you conclude

- Before deciding the AWS account can't hold what the request asks for,
  look. List the places it could live, such as S3 buckets, databases, and
  log groups, and read what is there.
- Don't conclude that records are missing from metadata, such as a
  creation date or a stored-bytes count, or from one query that failed or
  came back empty. Read the records another way, across the full time
  range, before reporting them absent.
- A tool's own error is evidence. If a call the answer depends on fails
  with expired or missing credentials or AccessDenied, report that error
  and what it blocks, and don't overrule it with another check. Searching
  other Regions is for finding resources, not for retrying an auth error.
  Retry throttling with backoff before you report it.

## Secret Safety

- MUST load the `aws-secrets-manager` skill first for any secret,
  credential, API key, token, or password task. MUST NOT call
  `secretsmanager get-secret-value` or `batch-get-secret-value`, and MUST
  NOT hit the Secrets Manager Agent daemon directly. MUST use
  `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with
  `asm-exec` so the secret resolves at runtime without entering context.
<!-- END AWS Agent Toolkit rules -->
