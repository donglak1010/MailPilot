# MailPilot Lean MVP — SRS & Build Blueprint

**Version:** 1.0  
**Date:** 14 November 2026  
**Product:** MailPilot  
**Scope:** Campaigns + automated email sequences + AI email writer  
**Provider:** Amazon Simple Email Service (SES)

---

## 1. Product summary

MailPilot is a lightweight email marketing SaaS for digital-product sellers and affiliate marketers. It helps users import and organize opted-in contacts, create campaigns, schedule multi-step email sequences, generate copy with AI, and review delivery/performance metrics.

### Product principles
1. Build for the founder's own daily use first.
2. Minimize fixed infrastructure costs.
3. Use one shared SES sending account initially, with tenant-level controls and clear sender-domain verification.
4. Keep the application modular, but do not split it into microservices.
5. Never trade away consent, unsubscribe, suppression, or sender reputation for growth.

### Initial customer groups
- Digital product sellers: ebooks, templates, printable PDFs, courses, downloads.
- Affiliate marketers: product launches, partner promotions, review/follow-up campaigns.
- Founder/operator: one internal workspace to validate the workflow before opening public signup.

### MVP success criteria
- A user can sign up and create a workspace.
- A user can import a CSV and manage contacts/lists/tags.
- A user can verify a sender domain and configure From/Reply-To.
- A user can create, preview, test-send, schedule, pause, and send a campaign.
- A user can create a sequence with ordered steps and delays.
- A user can enroll contacts and automatically send due sequence steps.
- A user can generate/edit email copy with an AI provider.
- Bounce, complaint, delivery, open, click, and unsubscribe events are recorded where available.
- Unsubscribed, bounced, complained, and suppressed contacts are never sent marketing email.
- Workspace data is isolated by RLS.

---

## 2. Functional requirements

### FR-01 Authentication and workspace
- Email/password and supported OAuth through Supabase Auth.
- Create one personal workspace on signup.
- Workspace members have `owner`, `admin`, or `member` roles.
- Every tenant-owned record includes `workspace_id`.
- Users can update workspace name, timezone, and default sender settings.

### FR-02 Contacts
- Add, edit, archive, and search contacts.
- Import CSV with column mapping and preview.
- Deduplicate by normalized email within a workspace.
- Store source, consent timestamp, consent source, and custom fields.
- Contact status: pending, subscribed, unsubscribed, bounced, complained.
- Do not provide a purchased-list import workflow or claim that importing a list establishes consent.
- Export contacts only for workspace members with appropriate permission.

### FR-03 Lists and tags
- Create lists and tags.
- Add/remove contacts from lists and tags.
- A campaign may target one or more lists.
- A contact should receive no more than one copy of a campaign even if present in multiple selected lists.

### FR-04 Sender domains
- User adds a domain/subdomain.
- Backend creates/verifies the SES identity in a configured AWS region.
- UI displays required DNS records and verification status.
- Require domain verification and DKIM before production sending.
- SPF and DMARC guidance must be displayed; do not tell users to create multiple conflicting SPF records.
- From address must belong to a verified sender identity.
- Show that DNS propagation can take time; provide a refresh status action.

### FR-05 Campaigns
- Create campaign with name, subject, preview text, sender, HTML, and text fallback.
- Select target lists and exclude suppressed contacts.
- Preview desktop/mobile and send a test email.
- Send now or schedule in workspace timezone.
- Pause/cancel campaigns.
- Show queued, sent, delivered, bounced, complained, opened, clicked, and failed counts.
- Snapshot recipient email at queue time for auditability.
- Campaign sending must be rate-limited to SES account quota and application safety limits.

### FR-06 Sequences
- Create sequence and ordered steps.
- Each step has subject, preview text, HTML/text body, and delay from previous step.
- MVP triggers: manual enrollment and list-join trigger. Tag/form triggers may be added after core scheduling works.
- Enroll a contact only once per sequence unless an explicit re-enrollment policy is implemented.
- Stop sequence when contact unsubscribes, bounces, complains, or is suppressed.
- Scheduler finds due enrollments and enqueues a send job; it must not send a large batch inside the scheduler invocation.

### FR-07 AI Email Writer
- Inputs: product name/description, target audience, campaign goal, tone, language, offer, CTA, affiliate disclosure requirement.
- Outputs: subject line options, preview text, HTML-safe body draft, plain-text body, CTA suggestions, optional follow-up angle.
- User must review and approve generated content before sending.
- Never invent product claims, earnings, testimonials, discounts, scarcity, or guarantees.
- Add a visible affiliate disclosure suggestion when content promotes an affiliate offer.
- API key stays in server-side secrets. Add usage limits and log token/cost estimates if the AI provider exposes them.

### FR-08 Unsubscribe and compliance
- Every marketing email includes a clear unsubscribe link.
- Unsubscribe endpoint must work without login and be signed/tokenized.
- Process one-click unsubscribe headers where supported (`List-Unsubscribe` and `List-Unsubscribe-Post`).
- Suppress immediately at workspace level after unsubscribe, hard bounce, or complaint.
- Keep a minimal suppression record even if a contact is deleted, so deletion cannot accidentally re-enable sending.
- Capture consent source and timestamp.
- Include sender identity/address and accurate subject/from information.
- Users are responsible for lawful consent and content in each recipient jurisdiction. Provide product guidance, not legal advice.

### FR-09 Events and analytics
- Receive SES events through SNS/EventBridge or an authenticated webhook bridge.
- Store raw provider payload in a webhook inbox before processing.
- Deduplicate provider events.
- Update recipient state idempotently.
- Track delivery, bounce, complaint, reject, delay, open, click, and unsubscribe where configured.
- Opens/clicks are approximate indicators and may be affected by privacy features, scanners, and image proxying.

### FR-10 Usage and safety controls
- Track sent recipients per workspace and month.
- Enforce per-workspace daily/monthly limits and global sending rate.
- Pause workspace sending if bounce/complaint thresholds are exceeded.
- Admin can suspend abusive workspaces.
- New workspaces start with conservative limits and require verified sender domain.
- No purchased, scraped, or third-party lists without documented permission.

---

## 3. Non-functional requirements

| Area | Requirement |
|---|---|
| Security | Supabase Auth, RLS, least-privilege IAM, server-only secrets |
| Isolation | All tenant data scoped by workspace_id |
| Reliability | Durable queue, retries, idempotent event processing |
| Performance | Paginated contact lists; batch imports; background campaign processing |
| Availability | MVP best-effort; do not promise enterprise SLA |
| Observability | Structured logs, queue depth, failures, SES reputation metrics |
| Privacy | Data export/deletion workflow; minimize stored personal data |
| Accessibility | Keyboard-accessible controls, labels, contrast |
| Maintainability | TypeScript, shared validation/types, SQL migrations |

---

## 4. Recommended architecture

### Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + Vite + TypeScript | Fast, familiar, low-cost hosting |
| UI | Tailwind CSS + shadcn/ui | Reusable dashboard components |
| Hosting | Netlify | Fits existing deployment workflow |
| Auth / DB | Supabase Auth + PostgreSQL | One managed backend |
| Tenant security | PostgreSQL RLS | Enforce isolation at database layer |
| Queue | Supabase Queues (pgmq) | Avoid separate Redis at MVP stage |
| Scheduler | pg_cron + pg_net | Enqueue due work on a schedule |
| Server logic | Supabase Edge Functions | SES, AI, imports, webhooks |
| Email | Amazon SES v2 | Shared sending infrastructure |
| Events | SES Configuration Set + SNS/EventBridge destination | Delivery and reputation events |
| AI | Provider adapter, server-side key | Swap model vendor without changing UI |
| Monitoring | Supabase logs + AWS CloudWatch | Minimal initial observability |

Supabase Queues is PostgreSQL-native and uses pgmq. It is pull-based; a worker reads messages and removes them after successful processing. Use a durable/basic queue, not an unlogged queue, for email jobs. Supabase documentation describes queue delivery within a visibility window; your application must still make the SES send operation idempotent because a worker can crash after SES accepts an email but before the database records success. See [Supabase Queues](https://supabase.com/docs/guides/queues) and [PGMQ](https://supabase.com/docs/guides/queues/pgmq).

### Architecture diagram

```text
Browser (React)
   |
   | Supabase Auth JWT
   v
Supabase API + PostgreSQL (RLS)
   |            |
   |            +-- contacts / lists / campaigns / sequences
   |            +-- campaign_recipients / enrollments / events
   |            +-- pgmq durable queue
   |
   +--> Edge Functions
           |-- create-campaign-jobs
           |-- send-worker
           |-- sequence-scheduler
           |-- ses-domain-management
           |-- ses-events-webhook
           |-- unsubscribe
           |-- ai-email-writer
           |
           +--> Amazon SES v2
                    |
                    +--> recipient mailbox
                    |
                    +--> Configuration Set events
                              |
                              v
                       SNS/EventBridge
                              |
                              v
                       event receiver
                              |
                              v
                       webhook_inbox -> email_events -> recipient metrics
```

### Important queue design
- Campaign creation materializes one `campaign_recipients` row per eligible contact.
- A database function/Edge Function enqueues recipient IDs in batches.
- Worker reads a small batch, rechecks contact status and suppression immediately before sending, then calls SES.
- Use a stable idempotency key in your own database (recipient ID + send attempt state). SES acceptance and DB commit cannot be one atomic transaction.
- Mark a recipient as `sending` with a lease/lock before calling SES.
- If the worker crashes after SES accepted the email but before saving the message ID, mark the result as ambiguous and do not blindly retry. Add an admin reconciliation path. This reduces duplicate sends.
- Retry throttling/transient errors with exponential backoff and jitter. Do not retry invalid addresses, complaints, or permanent rejects.
- Keep batches small (e.g. 10–25 initially) and tune based on SES quota.
- `EdgeRuntime.waitUntil()` is suitable for short background work, not an unlimited bulk-send engine. Use a queue consumer that processes bounded batches and exits.

Supabase recommends Queues for background job processing and Cron to enqueue scheduled work. See [Background job processing](https://supabase.com/kb/faqs/background-jobs/background-job-processing) and [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions).

### SES account setup
1. Choose one AWS region and keep SES identities/configuration sets in that region.
2. Verify a domain or sending subdomain.
3. Enable Easy DKIM and publish the DNS records.
4. Configure a custom MAIL FROM domain if appropriate.
5. Publish SPF and DMARC correctly.
6. Create an SES Configuration Set and publish send/delivery/bounce/complaint/reject/delay/open/click events to an event destination.
7. Request production access before sending to unverified external recipients.
8. Set account-level suppression and application-level suppression.
9. Create a dedicated IAM user/role with only required SES permissions; never put AWS keys in browser code.
10. Set CloudWatch alarms for reputation and sending metrics.

New SES accounts start in the sandbox in each region. AWS currently documents a sandbox limit of 200 messages per 24 hours and 1 message per second, with sending restricted to verified recipients until production access is granted. Actual production quotas vary by account and region. Verify current limits in the AWS console before launch: [SES quotas](https://docs.aws.amazon.com/ses/latest/dg/quotas.html), [request production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html), [event destinations](https://docs.aws.amazon.com/ses/latest/dg/event-destinations-manage.html).

### Cost-control rules
- Start with Supabase Free for development and founder-only testing if its current limits fit.
- Use SES pay-as-you-go; avoid dedicated IPs at MVP scale.
- Host frontend on existing Netlify account.
- Do not add Redis, a separate VPS, or a dedicated worker server until queue throughput or Edge Function limits justify it.
- Keep AI generation user-triggered, metered, and optional.
- Set hard limits on contact imports, campaign recipients, AI generations, and concurrent sends.
- Budget for a paid Supabase plan before public production use; free tiers are not an uptime or compliance guarantee.
- Review current vendor pricing before launch rather than hardcoding costs into the product.

---

## 5. Data model

The complete initial SQL migration is supplied separately as `mailpilot_schema.sql`.

Core entities:
- `profiles`, `workspaces`, `workspace_members`
- `contacts`, `contact_lists`, `contact_list_members`, `tags`, `contact_tags`
- `sender_domains`
- `email_templates`
- `campaigns`, `campaign_lists`, `campaign_recipients`
- `sequences`, `sequence_steps`, `sequence_enrollments`
- `email_events`, `suppressions`, `webhook_inbox`
- `usage_records`

### Data rules
- Unique contact email per workspace.
- Unique campaign/contact recipient pair.
- Unique sequence/contact enrollment pair.
- Every tenant table has `workspace_id`.
- Raw webhook payload is stored before event processing.
- Suppression is checked immediately before each send.
- Do not expose service-role keys or unrestricted queue functions to the browser.

### Before public launch
Add billing tables (`plans`, `subscriptions`, `billing_events`) and enforce quotas server-side. Billing is intentionally deferred until internal sending is stable.

---

## 6. API / Edge Function contract

| Function | Auth | Input | Responsibility |
|---|---|---|---|
| `create-campaign-jobs` | User JWT | campaign_id | Validate campaign, materialize eligible recipients, enqueue jobs |
| `send-worker` | Internal secret | batch_size | Pull queue, recheck suppression, send through SES |
| `schedule-campaigns` | Internal secret / Cron | none | Find scheduled campaigns due now and enqueue |
| `sequence-scheduler` | Internal secret / Cron | none | Find due enrollments and enqueue current step |
| `enroll-sequence` | User JWT | sequence_id, contact_ids | Validate and enroll contacts |
| `ses-domain-create` | User JWT | workspace_id, domain | Create SES identity and return DNS records |
| `ses-domain-refresh` | User JWT | sender_domain_id | Refresh verification/DKIM status |
| `ses-events-webhook` | Verified provider source | event payload | Persist webhook event; acknowledge quickly |
| `process-ses-events` | Internal secret | batch_size | Deduplicate and apply provider events |
| `unsubscribe` | Signed token | token | One-click unsubscribe and suppression |
| `ai-email-writer` | User JWT | prompt fields | Generate copy, enforce quotas, record usage |
| `csv-import` | User JWT | storage_path, mapping | Validate/import CSV in bounded batches |
| `send-test-email` | User JWT | campaign_id, test_email | Send only to verified/authorized test address |

For every user-facing function:
- Validate JWT and workspace membership.
- Validate input with Zod.
- Never trust workspace_id without checking membership.
- Rate-limit expensive operations.
- Return stable error codes.
- Log correlation ID, workspace ID, and operation; avoid logging full email bodies or secrets.

---

## 7. UI / page map

### Navigation
- Dashboard
- Contacts
- Campaigns
- Sequences
- Templates
- AI Writer
- Sender Domains
- Reports
- Settings

### MVP screens
1. Sign up / login / password reset.
2. Workspace onboarding.
3. Dashboard with sending totals, recent campaigns, warnings.
4. Contacts table + import wizard.
5. Lists and tags.
6. Sender domain setup with DNS checklist.
7. Campaign editor: details → audience → content → preview/test → schedule/send.
8. Sequence builder: sequence list + step editor + enrollment status.
9. AI Writer panel with editable output.
10. Campaign report.
11. Settings: workspace, timezone, sender defaults, usage.

Avoid building a full drag-and-drop email designer initially. Start with a clean rich-text/HTML template editor, a few responsive templates, and safe merge tags such as `{{first_name}}` plus a mandatory unsubscribe placeholder.

---

## 8. Source-code structure

```text
mailpilot/
├── public/
├── src/
│   ├── app/
│   │   ├── router.tsx
│   │   ├── providers.tsx
│   │   └── routes/
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/
│   │   ├── data-table/
│   │   └── email-preview/
│   ├── features/
│   │   ├── auth/
│   │   ├── dashboard/
│   │   ├── contacts/
│   │   ├── lists/
│   │   ├── campaigns/
│   │   ├── sequences/
│   │   ├── templates/
│   │   ├── ai-writer/
│   │   ├── sender-domains/
│   │   ├── analytics/
│   │   └── settings/
│   ├── lib/
│   │   ├── supabase/
│   │   ├── validation/
│   │   ├── formatters/
│   │   └── constants/
│   ├── hooks/
│   ├── types/
│   └── styles/
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   └── 0001_mailpilot_schema.sql
│   └── functions/
│       ├── _shared/
│       │   ├── auth.ts
│       │   ├── cors.ts
│       │   ├── env.ts
│       │   ├── errors.ts
│       │   ├── ses.ts
│       │   ├── queue.ts
│       │   ├── suppression.ts
│       │   └── validation.ts
│       ├── create-campaign-jobs/
│       ├── send-worker/
│       ├── schedule-campaigns/
│       ├── sequence-scheduler/
│       ├── enroll-sequence/
│       ├── ses-domain-create/
│       ├── ses-domain-refresh/
│       ├── ses-events-webhook/
│       ├── process-ses-events/
│       ├── unsubscribe/
│       ├── ai-email-writer/
│       ├── csv-import/
│       └── send-test-email/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── .env.example
├── .gitignore
├── CLAUDE.md
├── package.json
├── tsconfig.json
└── README.md
```

---

## 9. Environment variables

Frontend (public only):
```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Supabase Edge Function secrets:
```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
SES_CONFIGURATION_SET=
SES_FROM_FALLBACK=
AI_PROVIDER=
AI_API_KEY=
APP_BASE_URL=
INTERNAL_WORKER_SECRET=
```

Use Supabase secrets for deployed Edge Functions and `.env` only for local development. Do not commit secrets. Prefer AWS IAM roles/short-lived credentials if the deployment environment supports them; otherwise scope the IAM user tightly and rotate keys.

---

## 10. Four-week build roadmap

### Phase 0 — Setup (Day 1)
- Create GitHub repo and Vite React TypeScript app.
- Create Supabase project and link CLI.
- Add environment variables.
- Add `CLAUDE.md` and architecture notes.

**Exit criteria:** app runs locally, Supabase client connects, migrations apply.

### Phase 1 — Auth + tenant foundation (Days 2–5)
- Login/signup/reset.
- Profile and workspace bootstrap.
- Workspace switcher (single workspace first is acceptable).
- RLS tests for two different users.

**Exit criteria:** user A cannot read or modify user B's workspace data.

### Phase 2 — Contacts + lists (Days 6–9)
- Contacts CRUD, search, pagination.
- CSV upload, preview, mapping, dedupe.
- Lists/tags.
- Consent fields and suppression checks.

**Exit criteria:** import a test CSV, dedupe, segment and export contacts.

### Phase 3 — Sender domain + SES (Days 10–13)
- SES identity create/refresh.
- DNS record display.
- Configuration Set and event destination.
- Test email to verified addresses.
- Request SES production access.

**Exit criteria:** verified domain can send a test email and event is recorded.

### Phase 4 — Campaigns (Days 14–19)
- Campaign editor and preview.
- Audience selection and recipient materialization.
- Durable queue + worker.
- Schedule/pause/cancel.
- Unsubscribe and suppression.
- Bounce/complaint event handling.

**Exit criteria:** send a controlled campaign to a small, consented test audience; pause and resume safely.

### Phase 5 — Sequences + AI (Days 20–25)
- Sequence and step CRUD.
- Enrollment and due-step scheduler.
- AI Writer with usage cap.
- Template library.

**Exit criteria:** a test contact receives a two-step sequence at the configured delays; unsubscribe stops future steps.

### Phase 6 — Hardening (Days 26–28)
- Rate limits and workspace quotas.
- Error handling and retry tests.
- Admin safety controls.
- Data export/deletion.
- Backups, monitoring, privacy policy, terms, sender policy.

**Exit criteria:** internal pilot checklist passes. Public signup remains disabled until SES production access, abuse controls, compliance pages, and support process are ready.

---

## 11. Claude Code operating instructions

Use Claude Code from the project root. Commit after each phase. Do not ask Claude to generate the entire SaaS in one prompt.

### Prompt 0 — Project constitution

```text
You are the senior full-stack engineer building MailPilot, a lean email marketing SaaS.

Product scope:
- Customers: digital product sellers and affiliate marketers.
- MVP: contact management, lists/tags, campaigns, multi-step email sequences, AI email writer, basic analytics.
- Stack: React + Vite + TypeScript + Tailwind + shadcn/ui, Supabase Auth/Postgres/RLS/Storage/Queues, Supabase Edge Functions, Amazon SES v2, Netlify.
- Cost rule: do not add Redis, BullMQ, a VPS, Kubernetes, microservices, or a paid third-party email provider unless I explicitly approve.
- Architecture: modular monolith; business logic in feature modules and Edge Functions.
- Security: RLS on every tenant table; service role and AWS credentials server-side only; validate all input; least privilege.
- Email safety: consent-based lists only; one-click unsubscribe; workspace suppression; hard-bounce and complaint suppression; check suppression immediately before sending.
- Reliability: bounded batches, durable queue, idempotent event processing, retries only for transient errors, never blindly retry ambiguous SES sends.
- AI: generated copy is a draft; never invent claims/testimonials/earnings/guarantees; require human review.
- Code quality: strict TypeScript, reusable components, Zod validation, tests for critical logic, accessible UI.
- Never silently change the stack or schema. Explain trade-offs and ask before adding infrastructure.

First inspect the repository. Then create a concise implementation plan and identify missing decisions. Do not implement features until the plan is approved.
```

### Prompt 1 — Scaffold

```text
Implement Phase 0 only. Create a production-quality Vite React TypeScript project with Tailwind and shadcn/ui, routing, app shell, responsive sidebar, top bar, design tokens, error boundary, loading states, and placeholder routes for Dashboard, Contacts, Campaigns, Sequences, AI Writer, Templates, Sender Domains, Reports, Settings.

Add Supabase client setup using only VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Add .env.example, .gitignore, README, and CLAUDE.md. Do not expose service-role or AWS credentials. Run lint, typecheck, and build; fix errors. Report files created and commands to run.
```

### Prompt 2 — Database and RLS

```text
Implement Phase 1 database foundation. Read supabase/migrations/0001_mailpilot_schema.sql and inspect it before applying. Set up Supabase CLI, migration workflow, generated TypeScript database types, Auth screens, profile/workspace loading, and route guards.

Write integration tests proving:
1. User A can access their workspace.
2. User A cannot select, insert, update, or delete User B's tenant records.
3. Workspace member role checks behave correctly.
4. A new auth user receives exactly one personal workspace.

Do not disable RLS to make the UI work. If a policy or migration is unsafe, stop and explain it.
```

### Prompt 3 — Contacts

```text
Implement Contacts, Lists, and Tags end to end. Include paginated/searchable table, create/edit contact, list/tag management, CSV upload to private Storage, CSV preview and column mapping, duplicate detection by workspace/email, import result summary, and consent fields.

All database queries must be workspace-scoped and rely on RLS as a second security boundary. Validate CSV type/size/row limits. Do not mark imported contacts subscribed unless the user explicitly confirms a lawful consent basis and the source is recorded. Add tests for dedupe and cross-workspace isolation.
```

### Prompt 4 — SES domain onboarding

```text
Implement sender-domain onboarding using Supabase Edge Functions and AWS SDK SES v2.

Functions: ses-domain-create and ses-domain-refresh.
Requirements: verify user/workspace membership; create SES email identity; return DNS records; persist identity and region; refresh verification and DKIM status; enforce that a campaign sender address belongs to a verified domain. Credentials are Edge Function secrets only. Add structured errors and tests with mocked AWS SDK. Never put AWS credentials in frontend code.
```

### Prompt 5 — Campaign engine

```text
Implement campaigns end to end: campaign CRUD, HTML/text content, preview, audience selection, test send, schedule, pause, cancel, recipient materialization, and analytics summary.

Build the send pipeline with Supabase Queues (durable/basic queue) and a bounded Edge Function worker. Recheck contact status, workspace suppression, sender-domain verification, campaign state, and rate limits immediately before calling SES v2. Use small configurable batches. Persist SES MessageId and errors. Handle transient throttling with exponential backoff and jitter. Do not retry permanent errors. Treat a crash after SES acceptance but before DB commit as an ambiguous state; never blindly resend it.

Implement mandatory unsubscribe links and List-Unsubscribe headers. Add tests for deduplication, suppression, pause/cancel, retry classification, and duplicate event handling. First produce a sequence diagram and migration review, then implement.
```

### Prompt 6 — SES events and unsubscribe

```text
Implement SES event ingestion. Persist raw incoming events in webhook_inbox before processing. Verify the event source/signature according to the selected SNS/EventBridge integration. Deduplicate provider event IDs. Process delivery, bounce, complaint, reject, delay, open, and click events idempotently. Hard bounce and complaint must create suppression and stop future sequence sends. Implement a signed, no-login unsubscribe endpoint and one-click POST behavior. Add integration tests for duplicate and out-of-order events.
```

### Prompt 7 — Sequences

```text
Implement email sequences: sequence CRUD, ordered steps, delay minutes, activate/pause/archive, manual enrollment, list-join enrollment, enrollment status, and a scheduled worker that enqueues due steps.

The scheduler must only enqueue work; it must not send bulk email itself. The send worker must recheck unsubscribe/suppression immediately before sending. A contact can enroll only once per sequence by default. Stop enrollment on unsubscribe, bounce, complaint, or suppression. Add tests for delay calculations, duplicate enrollment, pause, completion, and suppression.
```

### Prompt 8 — AI Writer

```text
Implement AI Email Writer behind a provider adapter. UI inputs: product details, audience, goal, tone, language, offer, CTA, and affiliate disclosure. Output: subject options, preview text, HTML body, plain-text body, CTA, and follow-up angle.

Call the AI provider only from an Edge Function. Enforce authentication, workspace membership, per-user/workspace rate limits, request-size limits, and usage logging. Require human editing/approval; never auto-send generated content. Do not invent product facts, results, testimonials, earnings, scarcity, or guarantees. Add tests using a mocked provider.
```

### Prompt 9 — QA and release

```text
Perform a production-readiness review of MailPilot. Inspect RLS, service-role usage, AWS permissions, secret handling, CSV import, queue retry/idempotency, SES event verification, unsubscribe, suppression, sequence scheduler, rate limits, logging, and data deletion/export.

Run lint, typecheck, unit, integration, and build tests. Create a release checklist and list every blocker. Do not claim the app is production-ready if SES production access, domain authentication, consent workflow, complaint/bounce handling, unsubscribe, or tenant-isolation tests are incomplete.
```

---

## 12. Launch checklist

- [ ] Supabase project region selected and migrations applied.
- [ ] RLS tests pass for two separate users/workspaces.
- [ ] SES identity verified in the same region used by the app.
- [ ] DKIM enabled; SPF and DMARC records checked.
- [ ] SES Configuration Set and event destination configured.
- [ ] SES production access approved.
- [ ] Sending limits and worker rate limits configured.
- [ ] Unsubscribe link and one-click unsubscribe tested.
- [ ] Hard bounce and complaint suppression tested.
- [ ] Purchased/scraped-list policy and consent capture in product.
- [ ] Privacy policy, terms, acceptable-use and anti-spam policy published.
- [ ] Abuse reporting and account suspension process exists.
- [ ] Backup/restore and data export/deletion tested.
- [ ] Public signup enabled only after the above are complete.

## 13. Key risks and decisions

1. **SES shared reputation:** all tenants share the initial SES account reputation. Enforce strict onboarding, rate limits, consent rules, complaint/bounce monitoring, and the ability to pause a workspace.
2. **SES production access:** sandbox restrictions prevent sending to arbitrary external recipients. Apply for production access early and explain the real use case honestly.
3. **Queue exactly-once misconception:** queue visibility semantics do not make an external email send and a database commit atomic. Design for ambiguous outcomes and idempotent processing.
4. **Open/click metrics:** privacy protections and scanners can distort them. Treat delivery, bounce, complaint, and unsubscribe as stronger operational signals.
5. **Compliance:** requirements differ by recipient location. Build technical controls and clear user responsibilities; obtain qualified legal review before public launch.
6. **Scale trigger:** introduce a dedicated worker/Redis only when queue backlog, execution limits, throughput, or operational visibility show a real need.

---

## 14. Recommended first action

Start with Prompt 0, then Prompt 1. Do not configure bulk sending until authentication, RLS, contact consent, and sender-domain verification are in place.
