-- =====================================================================
-- MailPilot Lean MVP — initial schema
-- Target: Supabase (PostgreSQL 15+), extensions: pgmq
-- Scope : tenants, contacts, lists/tags, sender domains, templates,
--         campaigns, sequences, unified send outbox, events,
--         suppressions, webhook inbox, usage, AI log, CSV imports,
--         queue + worker RPCs, RLS policies.
--
-- Conventions
--   * Every tenant-owned table has workspace_id + RLS.
--   * Child tables use composite FKs (id, workspace_id) so a row can
--     never point at another tenant's parent row.
--   * Emails / domains are stored lower-cased and trimmed (trigger).
--   * Functions use `set search_path = ''` and fully-qualified names.
--   * "Server-only" RPCs are executable by service_role only
--     (Edge Functions); never by anon/authenticated.
-- =====================================================================

create extension if not exists pgmq;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.workspace_role     as enum ('owner', 'admin', 'member');
create type public.workspace_status   as enum ('active', 'paused', 'suspended');
create type public.contact_status     as enum ('pending', 'subscribed', 'unsubscribed', 'bounced', 'complained');
create type public.domain_status      as enum ('pending', 'verified', 'failed', 'temporary_failure', 'not_started');
create type public.campaign_status    as enum ('draft', 'scheduled', 'sending', 'paused', 'sent', 'cancelled', 'failed');
create type public.sequence_status    as enum ('draft', 'active', 'paused', 'archived');
create type public.sequence_trigger   as enum ('manual', 'list_join');
create type public.enrollment_status  as enum ('active', 'completed', 'stopped');
create type public.send_kind          as enum ('campaign', 'sequence');
create type public.send_status        as enum (
  'pending',    -- materialised, not yet queued
  'queued',     -- message is in pgmq
  'sending',    -- worker holds a lease and is calling SES
  'sent',       -- SES accepted (has ses_message_id)
  'delivered',
  'bounced',
  'complained',
  'failed',     -- permanent error / rejected
  'skipped',    -- not eligible at send time (suppressed, unsubscribed…)
  'cancelled',
  'ambiguous'   -- lease expired with no SES result: NEVER auto-retry
);
create type public.suppression_reason as enum ('unsubscribe', 'hard_bounce', 'complaint', 'manual');
create type public.email_event_type   as enum ('send', 'delivery', 'bounce', 'complaint', 'reject', 'delivery_delay', 'open', 'click', 'unsubscribe', 'rendering_failure');
create type public.usage_metric       as enum ('emails_sent', 'ai_generations', 'contacts_imported');
create type public.import_status      as enum ('uploaded', 'processing', 'completed', 'failed');

-- ---------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function private.normalize_email()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Profiles & workspaces
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (char_length(full_name) <= 200),
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.workspaces (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(name) between 1 and 120),
  owner_id            uuid not null references auth.users (id) on delete restrict,
  timezone            text not null default 'UTC',
  default_from_name   text check (char_length(default_from_name) <= 120),
  default_from_email  text,
  default_reply_to    text,
  postal_address      text check (char_length(postal_address) <= 500),  -- shown in email footer
  -- Safety / quota controls: NOT user-editable (column grants below)
  sending_status      public.workspace_status not null default 'active',
  daily_send_limit    integer not null default 200   check (daily_send_limit >= 0),
  monthly_send_limit  integer not null default 3000  check (monthly_send_limit >= 0),
  monthly_ai_limit    integer not null default 50    check (monthly_ai_limit >= 0),
  max_contacts        integer not null default 2000  check (max_contacts >= 0),
  suspended_reason    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          public.workspace_role not null default 'member',
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);
-- exactly one owner row per workspace
create unique index workspace_members_one_owner on public.workspace_members (workspace_id) where role = 'owner';

-- ---------------------------------------------------------------------
-- RLS helpers (security definer => no recursive RLS on members table)
-- ---------------------------------------------------------------------
create or replace function private.is_member(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_role(p_workspace_id uuid, p_roles public.workspace_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

revoke all on function private.is_member(uuid) from public;
revoke all on function private.has_role(uuid, public.workspace_role[]) from public;
grant execute on function private.is_member(uuid) to authenticated, service_role;
grant execute on function private.has_role(uuid, public.workspace_role[]) to authenticated, service_role;

-- Owner membership is created automatically for every new workspace
create or replace function private.add_workspace_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end $$;

create trigger workspaces_add_owner
  after insert on public.workspaces
  for each row execute function private.add_workspace_owner();

-- New auth user => profile + one personal workspace
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1), 'My');
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''));

  insert into public.workspaces (name, owner_id)
  values (left(v_name || '''s workspace', 120), new.id);

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------
-- Contacts, lists, tags
-- ---------------------------------------------------------------------
create table public.contacts (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  email            text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 320),
  first_name       text check (char_length(first_name) <= 120),
  last_name        text check (char_length(last_name) <= 120),
  status           public.contact_status not null default 'pending',
  source           text check (char_length(source) <= 120),          -- e.g. csv_import, manual, form
  consent_at       timestamptz,
  consent_source   text check (char_length(consent_source) <= 500),  -- where/how consent was given
  custom_fields    jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  unsubscribed_at  timestamptz,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, email),
  unique (id, workspace_id),
  -- a contact can only be "subscribed" with a recorded consent basis
  constraint contacts_subscribed_needs_consent
    check (status <> 'subscribed' or (consent_at is not null and consent_source is not null))
);
create index contacts_ws_status_idx  on public.contacts (workspace_id, status) where archived_at is null;
create index contacts_ws_created_idx on public.contacts (workspace_id, created_at desc);

create table public.contact_lists (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 120),
  description   text check (char_length(description) <= 1000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, name),
  unique (id, workspace_id)
);

create table public.contact_list_members (
  list_id       uuid not null,
  contact_id    uuid not null,
  workspace_id  uuid not null,
  added_at      timestamptz not null default now(),
  primary key (list_id, contact_id),
  foreign key (list_id, workspace_id)    references public.contact_lists (id, workspace_id) on delete cascade,
  foreign key (contact_id, workspace_id) references public.contacts (id, workspace_id) on delete cascade
);
create index contact_list_members_contact_idx on public.contact_list_members (contact_id);

create table public.tags (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 60),
  color         text check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at    timestamptz not null default now(),
  unique (workspace_id, name),
  unique (id, workspace_id)
);

create table public.contact_tags (
  tag_id        uuid not null,
  contact_id    uuid not null,
  workspace_id  uuid not null,
  created_at    timestamptz not null default now(),
  primary key (tag_id, contact_id),
  foreign key (tag_id, workspace_id)     references public.tags (id, workspace_id) on delete cascade,
  foreign key (contact_id, workspace_id) references public.contacts (id, workspace_id) on delete cascade
);
create index contact_tags_contact_idx on public.contact_tags (contact_id);

-- ---------------------------------------------------------------------
-- Suppressions (survive contact deletion; checked before every send)
-- ---------------------------------------------------------------------
create table public.suppressions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  email         text not null check (char_length(email) <= 320),
  reason        public.suppression_reason not null,
  source        text check (char_length(source) <= 200),   -- e.g. send id, "manual", "ses"
  created_at    timestamptz not null default now(),
  unique (workspace_id, email)
);

-- ---------------------------------------------------------------------
-- Sender domains (SES identities live in ONE shared AWS account,
-- so a domain can be claimed by only one workspace globally)
-- ---------------------------------------------------------------------
create table public.sender_domains (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  domain               text not null unique
                         check (domain = lower(domain) and domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'),
  aws_region           text not null,
  ses_identity_arn     text,
  verification_status  public.domain_status not null default 'pending',
  dkim_status          public.domain_status not null default 'pending',
  dns_records          jsonb not null default '[]'::jsonb,   -- [{type,name,value,purpose}]
  mail_from_domain     text,
  last_checked_at      timestamptz,
  verified_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, workspace_id)
);

-- ---------------------------------------------------------------------
-- Templates (workspace_id null = system template, read-only for all)
-- ---------------------------------------------------------------------
create table public.email_templates (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references public.workspaces (id) on delete cascade,
  category      text not null default 'general'
                  check (category in ('general', 'product_launch', 'affiliate', 'welcome', 'follow_up')),
  name          text not null check (char_length(name) between 1 and 120),
  subject       text not null default '' check (char_length(subject) <= 250),
  preview_text  text not null default '' check (char_length(preview_text) <= 250),
  html_body     text not null default '' check (char_length(html_body) <= 500000),
  text_body     text not null default '' check (char_length(text_body) <= 200000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index email_templates_ws_idx on public.email_templates (workspace_id);

-- ---------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------
create table public.campaigns (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 200),
  subject           text not null default '' check (char_length(subject) <= 250),
  preview_text      text not null default '' check (char_length(preview_text) <= 250),
  from_name         text check (char_length(from_name) <= 120),
  from_email        text,
  reply_to          text,
  sender_domain_id  uuid,
  template_id       uuid references public.email_templates (id) on delete set null,
  html_body         text not null default '' check (char_length(html_body) <= 500000),
  text_body         text not null default '' check (char_length(text_body) <= 200000),
  status            public.campaign_status not null default 'draft',
  scheduled_at      timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  ai_assisted       boolean not null default false,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (sender_domain_id, workspace_id) references public.sender_domains (id, workspace_id),
  constraint campaigns_scheduled_needs_time check (status <> 'scheduled' or scheduled_at is not null)
);
create index campaigns_ws_idx  on public.campaigns (workspace_id, created_at desc);
create index campaigns_due_idx on public.campaigns (scheduled_at) where status = 'scheduled';

create table public.campaign_lists (
  campaign_id   uuid not null,
  list_id       uuid not null,
  workspace_id  uuid not null,
  primary key (campaign_id, list_id),
  foreign key (campaign_id, workspace_id) references public.campaigns (id, workspace_id) on delete cascade,
  foreign key (list_id, workspace_id)     references public.contact_lists (id, workspace_id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Sequences
-- ---------------------------------------------------------------------
create table public.sequences (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 200),
  description       text check (char_length(description) <= 1000),
  status            public.sequence_status not null default 'draft',
  trigger_type      public.sequence_trigger not null default 'manual',
  trigger_list_id   uuid,
  from_name         text check (char_length(from_name) <= 120),
  from_email        text,
  reply_to          text,
  sender_domain_id  uuid,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (trigger_list_id, workspace_id)  references public.contact_lists (id, workspace_id),
  foreign key (sender_domain_id, workspace_id) references public.sender_domains (id, workspace_id),
  constraint sequences_list_trigger_needs_list check (trigger_type <> 'list_join' or trigger_list_id is not null)
);
create index sequences_trigger_idx on public.sequences (trigger_list_id) where status = 'active' and trigger_type = 'list_join';

create table public.sequence_steps (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  sequence_id    uuid not null,
  position       integer not null check (position >= 1),
  delay_minutes  integer not null default 0 check (delay_minutes between 0 and 525600), -- max 1 year
  subject        text not null default '' check (char_length(subject) <= 250),
  preview_text   text not null default '' check (char_length(preview_text) <= 250),
  html_body      text not null default '' check (char_length(html_body) <= 500000),
  text_body      text not null default '' check (char_length(text_body) <= 200000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (sequence_id, position) deferrable initially immediate,
  unique (id, workspace_id),
  foreign key (sequence_id, workspace_id) references public.sequences (id, workspace_id) on delete cascade
);

create table public.sequence_enrollments (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  sequence_id         uuid not null,
  contact_id          uuid not null,
  status              public.enrollment_status not null default 'active',
  next_step_position  integer not null default 1,
  next_run_at         timestamptz,
  enrolled_at         timestamptz not null default now(),
  completed_at        timestamptz,
  stopped_at          timestamptz,
  stopped_reason      text,
  unique (sequence_id, contact_id),         -- enroll once per sequence
  unique (id, workspace_id),
  foreign key (sequence_id, workspace_id) references public.sequences (id, workspace_id) on delete cascade,
  foreign key (contact_id, workspace_id)  references public.contacts (id, workspace_id) on delete cascade
);
create index sequence_enrollments_due_idx     on public.sequence_enrollments (next_run_at) where status = 'active';
create index sequence_enrollments_contact_idx on public.sequence_enrollments (contact_id);

-- ---------------------------------------------------------------------
-- Unified send outbox: one row per email that MailPilot will send
-- (campaign recipient or sequence step). Replaces campaign_recipients
-- so a single queue/worker/event pipeline serves both features.
-- ---------------------------------------------------------------------
create table public.email_sends (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  kind              public.send_kind not null,
  campaign_id       uuid,
  enrollment_id     uuid,
  step_id           uuid,
  contact_id        uuid references public.contacts (id) on delete set null,
  to_email          text not null,             -- snapshot at queue time
  status            public.send_status not null default 'pending',
  attempts          integer not null default 0,
  lease_until       timestamptz,
  ses_message_id    text unique,
  last_error        text,
  queued_at         timestamptz,
  sent_at           timestamptz,
  delivered_at      timestamptz,
  opened_at         timestamptz,
  clicked_at        timestamptz,
  bounced_at        timestamptz,
  complained_at     timestamptz,
  unsubscribed_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (campaign_id, workspace_id)   references public.campaigns (id, workspace_id) on delete cascade,
  foreign key (enrollment_id, workspace_id) references public.sequence_enrollments (id, workspace_id) on delete cascade,
  foreign key (step_id, workspace_id)       references public.sequence_steps (id, workspace_id) on delete cascade,
  constraint email_sends_kind_refs check (
    (kind = 'campaign' and campaign_id is not null and enrollment_id is null and step_id is null) or
    (kind = 'sequence' and campaign_id is null and enrollment_id is not null and step_id is not null)
  )
);
-- one copy of a campaign per contact, one send per enrollment step
create unique index email_sends_campaign_contact_uq on public.email_sends (campaign_id, contact_id) where kind = 'campaign';
create unique index email_sends_enrollment_step_uq  on public.email_sends (enrollment_id, step_id) where kind = 'sequence';
create index email_sends_campaign_status_idx on public.email_sends (campaign_id, status) where kind = 'campaign';
create index email_sends_lease_idx           on public.email_sends (lease_until) where status = 'sending';
create index email_sends_ws_created_idx      on public.email_sends (workspace_id, created_at desc);

-- ---------------------------------------------------------------------
-- Provider events
-- ---------------------------------------------------------------------
create table public.webhook_inbox (
  id                   uuid primary key default gen_random_uuid(),
  provider             text not null default 'ses',
  provider_message_id  text not null,              -- SNS MessageId
  payload              jsonb not null,
  received_at          timestamptz not null default now(),
  processed_at         timestamptz,
  attempts             integer not null default 0,
  last_error           text,
  unique (provider, provider_message_id)
);
create index webhook_inbox_unprocessed_idx on public.webhook_inbox (received_at) where processed_at is null;

create table public.email_events (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  send_id            uuid references public.email_sends (id) on delete set null,
  contact_id         uuid references public.contacts (id) on delete set null,
  provider_event_id  text not null unique,     -- dedupe key
  event_type         public.email_event_type not null,
  ses_message_id     text,
  detail             jsonb not null default '{}'::jsonb,  -- minimal: bounce type, link url, ua…
  occurred_at        timestamptz not null,
  created_at         timestamptz not null default now()
);
create index email_events_send_idx on public.email_events (send_id);
create index email_events_ws_idx   on public.email_events (workspace_id, occurred_at desc);

-- ---------------------------------------------------------------------
-- Usage, AI log, CSV imports
-- ---------------------------------------------------------------------
create table public.usage_records (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  metric        public.usage_metric not null,
  usage_date    date not null default (now() at time zone 'utc')::date,
  quantity      integer not null default 0 check (quantity >= 0),
  primary key (workspace_id, metric, usage_date)
);

create table public.ai_generations (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  user_id        uuid references auth.users (id) on delete set null,
  provider       text not null,
  model          text not null,
  input          jsonb not null,
  output         jsonb,
  input_tokens   integer,
  output_tokens  integer,
  error          text,
  created_at     timestamptz not null default now()
);
create index ai_generations_ws_idx on public.ai_generations (workspace_id, created_at desc);

create table public.csv_imports (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  created_by      uuid references auth.users (id) on delete set null,
  storage_path    text not null,
  list_id         uuid,
  column_mapping  jsonb not null default '{}'::jsonb,
  consent_source  text,                      -- required to import as subscribed
  status          public.import_status not null default 'uploaded',
  total_rows      integer not null default 0,
  inserted_rows   integer not null default 0,
  updated_rows    integer not null default 0,
  skipped_rows    integer not null default 0,
  errors          jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  foreign key (list_id, workspace_id) references public.contact_lists (id, workspace_id) on delete set null (list_id)
);

-- ---------------------------------------------------------------------
-- updated_at + email normalisation triggers
-- ---------------------------------------------------------------------
create trigger profiles_updated_at        before update on public.profiles        for each row execute function private.set_updated_at();
create trigger workspaces_updated_at      before update on public.workspaces      for each row execute function private.set_updated_at();
create trigger contacts_updated_at        before update on public.contacts        for each row execute function private.set_updated_at();
create trigger contact_lists_updated_at   before update on public.contact_lists   for each row execute function private.set_updated_at();
create trigger sender_domains_updated_at  before update on public.sender_domains  for each row execute function private.set_updated_at();
create trigger email_templates_updated_at before update on public.email_templates for each row execute function private.set_updated_at();
create trigger campaigns_updated_at       before update on public.campaigns       for each row execute function private.set_updated_at();
create trigger sequences_updated_at       before update on public.sequences       for each row execute function private.set_updated_at();
create trigger sequence_steps_updated_at  before update on public.sequence_steps  for each row execute function private.set_updated_at();
create trigger email_sends_updated_at     before update on public.email_sends     for each row execute function private.set_updated_at();

create trigger contacts_normalize_email     before insert or update of email on public.contacts     for each row execute function private.normalize_email();
create trigger suppressions_normalize_email before insert or update of email on public.suppressions for each row execute function private.normalize_email();

-- ---------------------------------------------------------------------
-- Compliance triggers
-- ---------------------------------------------------------------------

-- A suppressed address cannot be (re)marked subscribed.
create or replace function private.guard_contact_subscribe()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'subscribed'
     and (tg_op = 'INSERT' or old.status is distinct from 'subscribed')
     and exists (select 1 from public.suppressions s
                 where s.workspace_id = new.workspace_id and s.email = new.email) then
    raise exception 'Email % is suppressed in this workspace and cannot be subscribed', new.email
      using errcode = 'P0001', hint = 'suppressed_email';
  end if;
  if new.status = 'unsubscribed' and new.unsubscribed_at is null then
    new.unsubscribed_at := now();
  end if;
  return new;
end $$;

create trigger contacts_guard_subscribe
  before insert or update of status on public.contacts
  for each row execute function private.guard_contact_subscribe();

-- Contact becomes unsubscribed/bounced/complained => suppression row.
create or replace function private.contact_status_to_suppression()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('unsubscribed', 'bounced', 'complained')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.suppressions (workspace_id, email, reason, source)
    values (new.workspace_id, new.email,
            case new.status
              when 'unsubscribed' then 'unsubscribe'::public.suppression_reason
              when 'bounced'      then 'hard_bounce'::public.suppression_reason
              else                     'complaint'::public.suppression_reason
            end,
            'contact_status')
    on conflict (workspace_id, email) do nothing;
  end if;
  return new;
end $$;

create trigger contacts_status_suppression
  after insert or update of status on public.contacts
  for each row execute function private.contact_status_to_suppression();

-- New suppression => update contact status, stop sequences, cancel unsent mail.
create or replace function private.apply_suppression()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.reason <> 'manual' then
    update public.contacts c
       set status = case new.reason
                      when 'unsubscribe' then 'unsubscribed'::public.contact_status
                      when 'hard_bounce' then 'bounced'::public.contact_status
                      else                    'complained'::public.contact_status
                    end
     where c.workspace_id = new.workspace_id
       and c.email = new.email
       and c.status not in ('unsubscribed', 'bounced', 'complained');
  end if;

  update public.sequence_enrollments e
     set status = 'stopped', stopped_at = now(), stopped_reason = 'suppressed:' || new.reason
    from public.contacts c
   where c.id = e.contact_id
     and c.workspace_id = new.workspace_id
     and c.email = new.email
     and e.status = 'active';

  update public.email_sends s
     set status = 'skipped', last_error = 'suppressed:' || new.reason
   where s.workspace_id = new.workspace_id
     and s.to_email = new.email
     and s.status in ('pending', 'queued');

  return new;
end $$;

create trigger suppressions_apply
  after insert on public.suppressions
  for each row execute function private.apply_suppression();

-- List join => enrol into active list-triggered sequences.
create or replace function private.enroll_on_list_join()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.sequence_enrollments (workspace_id, sequence_id, contact_id, next_step_position, next_run_at)
  select q.workspace_id, q.id, new.contact_id, first_step.position,
         now() + make_interval(mins => first_step.delay_minutes)
    from public.sequences q
    join public.contacts c on c.id = new.contact_id and c.status = 'subscribed' and c.archived_at is null
    cross join lateral (
      select st.position, st.delay_minutes from public.sequence_steps st
       where st.sequence_id = q.id order by st.position limit 1
    ) first_step
   where q.trigger_list_id = new.list_id
     and q.trigger_type = 'list_join'
     and q.status = 'active'
     and not exists (select 1 from public.suppressions s where s.workspace_id = c.workspace_id and s.email = c.email)
  on conflict (sequence_id, contact_id) do nothing;
  return new;
end $$;

create trigger contact_list_members_enroll
  after insert on public.contact_list_members
  for each row execute function private.enroll_on_list_join();

-- Clients (authenticated) may only make safe campaign state changes;
-- sending/sent transitions are done by server functions.
create or replace function private.guard_campaign_client_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;   -- service_role / security definer functions
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'scheduled') then
      raise exception 'New campaigns must be draft or scheduled' using errcode = 'P0001';
    end if;
    new.started_at := null; new.completed_at := null;
    return new;
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'draft'     and new.status in ('scheduled', 'cancelled')) or
       (old.status = 'scheduled' and new.status in ('draft', 'cancelled')) or
       (old.status = 'sending'   and new.status in ('paused', 'cancelled')) or
       (old.status = 'paused'    and new.status = 'cancelled')
     ) then
    raise exception 'Campaign status change % -> % is not allowed from the client', old.status, new.status
      using errcode = 'P0001';
  end if;

  if old.status not in ('draft', 'scheduled') and (
       new.subject, new.preview_text, new.from_name, new.from_email, new.reply_to,
       new.sender_domain_id, new.html_body, new.text_body
     ) is distinct from (
       old.subject, old.preview_text, old.from_name, old.from_email, old.reply_to,
       old.sender_domain_id, old.html_body, old.text_body
     ) then
    raise exception 'Campaign content cannot be edited once sending has started' using errcode = 'P0001';
  end if;

  new.started_at := old.started_at;
  new.completed_at := old.completed_at;
  return new;
end $$;

create trigger campaigns_guard_client
  before insert or update on public.campaigns
  for each row execute function private.guard_campaign_client_update();

-- ---------------------------------------------------------------------
-- Reporting view (RLS of underlying tables applies)
-- ---------------------------------------------------------------------
create view public.campaign_stats with (security_invoker = true) as
select
  s.campaign_id,
  s.workspace_id,
  count(*)                                                        as total,
  count(*) filter (where s.status in ('pending', 'queued', 'sending')) as in_progress,
  count(*) filter (where s.sent_at is not null)                   as sent,
  count(*) filter (where s.delivered_at is not null)              as delivered,
  count(*) filter (where s.opened_at is not null)                 as opened,
  count(*) filter (where s.clicked_at is not null)                as clicked,
  count(*) filter (where s.status = 'bounced')                    as bounced,
  count(*) filter (where s.status = 'complained')                 as complained,
  count(*) filter (where s.unsubscribed_at is not null)           as unsubscribed,
  count(*) filter (where s.status = 'failed')                     as failed,
  count(*) filter (where s.status = 'skipped')                    as skipped,
  count(*) filter (where s.status = 'ambiguous')                  as ambiguous
from public.email_sends s
where s.kind = 'campaign'
group by s.campaign_id, s.workspace_id;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.profiles             enable row level security;
alter table public.workspaces           enable row level security;
alter table public.workspace_members    enable row level security;
alter table public.contacts             enable row level security;
alter table public.contact_lists        enable row level security;
alter table public.contact_list_members enable row level security;
alter table public.tags                 enable row level security;
alter table public.contact_tags         enable row level security;
alter table public.suppressions         enable row level security;
alter table public.sender_domains       enable row level security;
alter table public.email_templates      enable row level security;
alter table public.campaigns            enable row level security;
alter table public.campaign_lists       enable row level security;
alter table public.sequences            enable row level security;
alter table public.sequence_steps       enable row level security;
alter table public.sequence_enrollments enable row level security;
alter table public.email_sends          enable row level security;
alter table public.webhook_inbox        enable row level security;  -- no policies: service only
alter table public.email_events         enable row level security;
alter table public.usage_records        enable row level security;
alter table public.ai_generations       enable row level security;
alter table public.csv_imports          enable row level security;

-- profiles: own row, plus co-members (for member lists)
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (select 1 from public.workspace_members me
               join public.workspace_members other on other.workspace_id = me.workspace_id
               where me.user_id = (select auth.uid()) and other.user_id = profiles.id)
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- workspaces
create policy workspaces_select on public.workspaces for select to authenticated
  using ((select private.is_member(id)));
create policy workspaces_insert on public.workspaces for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy workspaces_update on public.workspaces for update to authenticated
  using ((select private.has_role(id, array['owner','admin']::public.workspace_role[])))
  with check ((select private.has_role(id, array['owner','admin']::public.workspace_role[])));
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (owner_id = (select auth.uid()));

-- quota / safety columns are server-controlled
revoke insert, update on public.workspaces from anon, authenticated;
grant insert (name, owner_id, timezone, default_from_name, default_from_email, default_reply_to, postal_address)
  on public.workspaces to authenticated;
grant update (name, timezone, default_from_name, default_from_email, default_reply_to, postal_address)
  on public.workspaces to authenticated;

-- workspace_members: owner row is managed only by the system
create policy members_select on public.workspace_members for select to authenticated
  using ((select private.is_member(workspace_id)));
create policy members_insert on public.workspace_members for insert to authenticated
  with check (role <> 'owner' and (select private.has_role(workspace_id, array['owner','admin']::public.workspace_role[])));
create policy members_update on public.workspace_members for update to authenticated
  using (role <> 'owner' and (select private.has_role(workspace_id, array['owner','admin']::public.workspace_role[])))
  with check (role <> 'owner' and (select private.has_role(workspace_id, array['owner','admin']::public.workspace_role[])));
create policy members_delete on public.workspace_members for delete to authenticated
  using (role <> 'owner' and (
    user_id = (select auth.uid())
    or (select private.has_role(workspace_id, array['owner','admin']::public.workspace_role[]))
  ));

-- Standard member-CRUD tenant tables
do $$
declare t text;
begin
  foreach t in array array[
    'contacts', 'contact_lists', 'contact_list_members', 'tags', 'contact_tags',
    'campaigns', 'campaign_lists', 'sequences', 'sequence_steps'
  ] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using ((select private.is_member(workspace_id)))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check ((select private.is_member(workspace_id)))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using ((select private.is_member(workspace_id))) with check ((select private.is_member(workspace_id)))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using ((select private.is_member(workspace_id)))', t);
  end loop;
end $$;

-- sequence_enrollments: members may read, enrol manually and stop; scheduler advances them
create policy enrollments_select on public.sequence_enrollments for select to authenticated
  using ((select private.is_member(workspace_id)));
create policy enrollments_insert on public.sequence_enrollments for insert to authenticated
  with check ((select private.is_member(workspace_id)) and status = 'active');
create policy enrollments_update on public.sequence_enrollments for update to authenticated
  using ((select private.is_member(workspace_id)))
  with check ((select private.is_member(workspace_id)) and status = 'stopped');
create policy enrollments_delete on public.sequence_enrollments for delete to authenticated
  using ((select private.has_role(workspace_id, array['owner','admin']::public.workspace_role[])));

-- suppressions: members can read and add; only admins may remove MANUAL ones
create policy suppressions_select on public.suppressions for select to authenticated
  using ((select private.is_member(workspace_id)));
create policy suppressions_insert on public.suppressions for insert to authenticated
  with check ((select private.is_member(workspace_id)) and reason in ('manual', 'unsubscribe'));
create policy suppressions_delete on public.suppressions for delete to authenticated
  using (reason = 'manual' and (select private.has_role(workspace_id, array['owner','admin']::public.workspace_role[])));

-- sender_domains: created/verified by Edge Functions; members read; admins delete
create policy sender_domains_select on public.sender_domains for select to authenticated
  using ((select private.is_member(workspace_id)));
create policy sender_domains_delete on public.sender_domains for delete to authenticated
  using ((select private.has_role(workspace_id, array['owner','admin']::public.workspace_role[])));

-- templates: system templates readable by everyone signed in
create policy templates_select on public.email_templates for select to authenticated
  using (workspace_id is null or (select private.is_member(workspace_id)));
create policy templates_insert on public.email_templates for insert to authenticated
  with check (workspace_id is not null and (select private.is_member(workspace_id)));
create policy templates_update on public.email_templates for update to authenticated
  using (workspace_id is not null and (select private.is_member(workspace_id)))
  with check (workspace_id is not null and (select private.is_member(workspace_id)));
create policy templates_delete on public.email_templates for delete to authenticated
  using (workspace_id is not null and (select private.is_member(workspace_id)));

-- read-only for clients (written by server)
create policy email_sends_select    on public.email_sends    for select to authenticated using ((select private.is_member(workspace_id)));
create policy email_events_select   on public.email_events   for select to authenticated using ((select private.is_member(workspace_id)));
create policy usage_records_select  on public.usage_records  for select to authenticated using ((select private.is_member(workspace_id)));
create policy ai_generations_select on public.ai_generations for select to authenticated using ((select private.is_member(workspace_id)));
create policy csv_imports_select    on public.csv_imports    for select to authenticated using ((select private.is_member(workspace_id)));

-- =====================================================================
-- Storage: private bucket for CSV imports, path = <workspace_id>/<file>
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contact-imports', 'contact-imports', false, 10485760,
        array['text/csv', 'application/vnd.ms-excel', 'text/plain'])
on conflict (id) do nothing;

create policy contact_imports_select on storage.objects for select to authenticated
  using (bucket_id = 'contact-imports'
         and (select private.is_member(((storage.foldername(name))[1])::uuid)));
create policy contact_imports_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'contact-imports'
              and (select private.is_member(((storage.foldername(name))[1])::uuid)));
create policy contact_imports_delete on storage.objects for delete to authenticated
  using (bucket_id = 'contact-imports'
         and (select private.is_member(((storage.foldername(name))[1])::uuid)));

-- =====================================================================
-- Queue + server-only RPCs (called by Edge Functions with service_role)
-- =====================================================================
select pgmq.create('email_send');   -- durable (logged) queue; payload: {"send_id": uuid}

-- Is an address sendable for marketing right now?
create or replace function private.is_sendable(p_workspace_id uuid, p_contact_id uuid, p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.suppressions s
                     where s.workspace_id = p_workspace_id and s.email = lower(btrim(p_email)))
     and exists (select 1 from public.contacts c
                 where c.id = p_contact_id and c.workspace_id = p_workspace_id
                   and c.status = 'subscribed' and c.archived_at is null);
$$;

-- Is the from address on a verified domain of the workspace?
create or replace function private.sender_ok(p_workspace_id uuid, p_sender_domain_id uuid, p_from_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sender_domains d
     where d.id = p_sender_domain_id and d.workspace_id = p_workspace_id
       and d.verification_status = 'verified' and d.dkim_status = 'verified'
       and split_part(lower(p_from_email), '@', 2) = d.domain
  );
$$;

-- Queue wrappers -------------------------------------------------------
create or replace function public.queue_read(p_qty integer default 10, p_vt_seconds integer default 120)
returns table (msg_id bigint, read_ct integer, message jsonb)
language sql security definer set search_path = '' as $$
  select r.msg_id, r.read_ct, r.message from pgmq.read('email_send', p_vt_seconds, p_qty) r;
$$;

create or replace function public.queue_delete(p_msg_id bigint)
returns boolean language sql security definer set search_path = '' as $$
  select pgmq.delete('email_send', p_msg_id);
$$;

create or replace function public.queue_archive(p_msg_id bigint)
returns boolean language sql security definer set search_path = '' as $$
  select pgmq.archive('email_send', p_msg_id);
$$;

create or replace function public.queue_defer(p_msg_id bigint, p_delay_seconds integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pgmq.set_vt('email_send', p_msg_id, p_delay_seconds);
end $$;

-- Usage ---------------------------------------------------------------
create or replace function public.increment_usage(p_workspace_id uuid, p_metric public.usage_metric, p_qty integer default 1)
returns void language sql security definer set search_path = '' as $$
  insert into public.usage_records (workspace_id, metric, usage_date, quantity)
  values (p_workspace_id, p_metric, (now() at time zone 'utc')::date, p_qty)
  on conflict (workspace_id, metric, usage_date)
  do update set quantity = public.usage_records.quantity + excluded.quantity;
$$;

create or replace function private.usage_since(p_workspace_id uuid, p_metric public.usage_metric, p_since date)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(sum(quantity), 0)::integer from public.usage_records
   where workspace_id = p_workspace_id and metric = p_metric and usage_date >= p_since;
$$;

-- Campaign: materialise recipients and enqueue ------------------------
-- Works for first start (draft/scheduled) and for resume (paused).
create or replace function public.enqueue_campaign(p_campaign_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_c public.campaigns%rowtype;
  v_ws public.workspaces%rowtype;
  v_count integer;
  v_msgs jsonb[];
begin
  select * into v_c from public.campaigns where id = p_campaign_id for update;
  if not found then raise exception 'campaign_not_found' using errcode = 'P0002'; end if;
  if v_c.status not in ('draft', 'scheduled', 'paused') then
    raise exception 'campaign_not_startable: %', v_c.status using errcode = 'P0001';
  end if;

  select * into v_ws from public.workspaces where id = v_c.workspace_id;
  if v_ws.sending_status <> 'active' then
    raise exception 'workspace_sending_disabled' using errcode = 'P0001';
  end if;
  if not private.sender_ok(v_c.workspace_id, v_c.sender_domain_id, v_c.from_email) then
    raise exception 'sender_not_verified' using errcode = 'P0001';
  end if;
  if btrim(v_c.subject) = '' or btrim(v_c.html_body) = '' then
    raise exception 'campaign_content_incomplete' using errcode = 'P0001';
  end if;
  if position('{{unsubscribe_url}}' in v_c.html_body) = 0 then
    raise exception 'missing_unsubscribe_placeholder' using errcode = 'P0001';
  end if;

  if v_c.status in ('draft', 'scheduled') then
    insert into public.email_sends (workspace_id, kind, campaign_id, contact_id, to_email, status)
    select distinct on (c.id) v_c.workspace_id, 'campaign', v_c.id, c.id, c.email, 'pending'
      from public.campaign_lists cl
      join public.contact_list_members m on m.list_id = cl.list_id
      join public.contacts c on c.id = m.contact_id
     where cl.campaign_id = v_c.id
       and c.status = 'subscribed' and c.archived_at is null
       and not exists (select 1 from public.suppressions s
                       where s.workspace_id = v_c.workspace_id and s.email = c.email)
    on conflict do nothing;
  end if;

  with q as (
    update public.email_sends s
       set status = 'queued', queued_at = now()
     where s.campaign_id = v_c.id and s.kind = 'campaign' and s.status = 'pending'
    returning s.id
  )
  select array_agg(jsonb_build_object('send_id', q.id)), count(*)
    into v_msgs, v_count
    from q;

  if v_count > 0 then
    perform pgmq.send_batch('email_send', v_msgs);
  end if;

  update public.campaigns
     set status = 'sending', started_at = coalesce(started_at, now())
   where id = v_c.id;

  return v_count;
end $$;

-- Scheduled campaigns that are due (called by cron via Edge Function)
create or replace function public.enqueue_due_campaigns()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in select id from public.campaigns
            where status = 'scheduled' and scheduled_at <= now()
            order by scheduled_at limit 20 for update skip locked loop
    begin
      perform public.enqueue_campaign(r.id);
      n := n + 1;
    exception when others then
      update public.campaigns set status = 'failed' where id = r.id;
    end;
  end loop;
  return n;
end $$;

-- Sequences: create sends for due enrollments and enqueue ------------
create or replace function public.enqueue_due_sequence_steps(p_limit integer default 200)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  e record; v_step record; v_next record; v_send_id uuid; n integer := 0;
begin
  for e in
    select en.*, c.email as contact_email
      from public.sequence_enrollments en
      join public.sequences q on q.id = en.sequence_id and q.status = 'active'
      join public.contacts c on c.id = en.contact_id
     where en.status = 'active' and en.next_run_at <= now()
     order by en.next_run_at
     limit p_limit
     for update of en skip locked
  loop
    select st.* into v_step from public.sequence_steps st
     where st.sequence_id = e.sequence_id and st.position >= e.next_step_position
     order by st.position limit 1;

    if not found then
      update public.sequence_enrollments set status = 'completed', completed_at = now(), next_run_at = null
       where id = e.id;
      continue;
    end if;

    if not private.is_sendable(e.workspace_id, e.contact_id, e.contact_email) then
      update public.sequence_enrollments
         set status = 'stopped', stopped_at = now(), stopped_reason = 'not_sendable', next_run_at = null
       where id = e.id;
      continue;
    end if;

    insert into public.email_sends (workspace_id, kind, enrollment_id, step_id, contact_id, to_email, status, queued_at)
    values (e.workspace_id, 'sequence', e.id, v_step.id, e.contact_id, e.contact_email, 'queued', now())
    on conflict do nothing
    returning id into v_send_id;

    if v_send_id is not null then
      perform pgmq.send('email_send', jsonb_build_object('send_id', v_send_id));
      n := n + 1;
    end if;

    select st.position, st.delay_minutes into v_next from public.sequence_steps st
     where st.sequence_id = e.sequence_id and st.position > v_step.position
     order by st.position limit 1;

    update public.sequence_enrollments
       set next_step_position = coalesce(v_next.position, v_step.position + 1),
           next_run_at = now() + make_interval(mins => coalesce(v_next.delay_minutes, 0))
     where id = e.id;
  end loop;
  return n;
end $$;

-- Worker: claim one send. Returns jsonb with "outcome":
--   send   -> payload to send via SES (lease taken)
--   drop   -> nothing to do, delete the queue message
--   defer  -> keep message, retry later (quota / temporary)
create or replace function public.claim_send(p_send_id uuid, p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.email_sends%rowtype;
  v_ws public.workspaces%rowtype;
  v_c public.campaigns%rowtype;
  v_q public.sequences%rowtype;
  v_st public.sequence_steps%rowtype;
  v_from_name text; v_from_email text; v_reply_to text; v_domain uuid;
  v_subject text; v_preview text; v_html text; v_text text;
  v_contact public.contacts%rowtype;
begin
  select * into s from public.email_sends where id = p_send_id for update skip locked;
  if not found then return jsonb_build_object('outcome', 'defer', 'reason', 'locked_or_missing'); end if;
  if s.status <> 'queued' then return jsonb_build_object('outcome', 'drop', 'reason', 'status_' || s.status); end if;

  select * into v_ws from public.workspaces where id = s.workspace_id;
  if v_ws.sending_status <> 'active' then
    return jsonb_build_object('outcome', 'defer', 'reason', 'workspace_' || v_ws.sending_status, 'delay', 3600);
  end if;

  if s.kind = 'campaign' then
    select * into v_c from public.campaigns where id = s.campaign_id;
    if v_c.status = 'cancelled' then
      update public.email_sends set status = 'cancelled' where id = s.id;
      return jsonb_build_object('outcome', 'drop', 'reason', 'campaign_cancelled');
    elsif v_c.status = 'paused' then
      update public.email_sends set status = 'pending' where id = s.id;   -- re-queued on resume
      return jsonb_build_object('outcome', 'drop', 'reason', 'campaign_paused');
    elsif v_c.status <> 'sending' then
      return jsonb_build_object('outcome', 'drop', 'reason', 'campaign_' || v_c.status);
    end if;
    v_from_name := v_c.from_name; v_from_email := v_c.from_email; v_reply_to := v_c.reply_to; v_domain := v_c.sender_domain_id;
    v_subject := v_c.subject; v_preview := v_c.preview_text; v_html := v_c.html_body; v_text := v_c.text_body;
  else
    select q.* into v_q from public.sequences q
      join public.sequence_enrollments en on en.sequence_id = q.id
     where en.id = s.enrollment_id;
    if v_q.status = 'paused' then
      return jsonb_build_object('outcome', 'defer', 'reason', 'sequence_paused', 'delay', 900);
    elsif v_q.status <> 'active' then
      update public.email_sends set status = 'cancelled' where id = s.id;
      return jsonb_build_object('outcome', 'drop', 'reason', 'sequence_' || v_q.status);
    end if;
    if exists (select 1 from public.sequence_enrollments where id = s.enrollment_id and status = 'stopped') then
      update public.email_sends set status = 'cancelled' where id = s.id;
      return jsonb_build_object('outcome', 'drop', 'reason', 'enrollment_stopped');
    end if;
    select * into v_st from public.sequence_steps where id = s.step_id;
    v_from_name := v_q.from_name; v_from_email := v_q.from_email; v_reply_to := v_q.reply_to; v_domain := v_q.sender_domain_id;
    v_subject := v_st.subject; v_preview := v_st.preview_text; v_html := v_st.html_body; v_text := v_st.text_body;
  end if;

  if s.contact_id is null or not private.is_sendable(s.workspace_id, s.contact_id, s.to_email) then
    update public.email_sends set status = 'skipped', last_error = 'not_sendable' where id = s.id;
    return jsonb_build_object('outcome', 'drop', 'reason', 'not_sendable');
  end if;

  if not private.sender_ok(s.workspace_id, v_domain, v_from_email) then
    update public.email_sends set status = 'failed', last_error = 'sender_not_verified' where id = s.id;
    return jsonb_build_object('outcome', 'drop', 'reason', 'sender_not_verified');
  end if;

  if private.usage_since(s.workspace_id, 'emails_sent', (now() at time zone 'utc')::date) >= v_ws.daily_send_limit
     or private.usage_since(s.workspace_id, 'emails_sent', date_trunc('month', now() at time zone 'utc')::date) >= v_ws.monthly_send_limit then
    return jsonb_build_object('outcome', 'defer', 'reason', 'quota_exceeded', 'delay', 3600);
  end if;

  -- take the lease and reserve quota
  update public.email_sends
     set status = 'sending', attempts = attempts + 1, lease_until = now() + make_interval(secs => p_lease_seconds)
   where id = s.id;
  perform public.increment_usage(s.workspace_id, 'emails_sent', 1);

  select * into v_contact from public.contacts where id = s.contact_id;

  return jsonb_build_object(
    'outcome', 'send',
    'send_id', s.id,
    'workspace_id', s.workspace_id,
    'kind', s.kind,
    'to_email', s.to_email,
    'from_name', v_from_name,
    'from_email', v_from_email,
    'reply_to', v_reply_to,
    'subject', v_subject,
    'preview_text', v_preview,
    'html_body', v_html,
    'text_body', v_text,
    'postal_address', v_ws.postal_address,
    'contact', jsonb_build_object('first_name', v_contact.first_name, 'last_name', v_contact.last_name,
                                  'email', v_contact.email, 'custom_fields', v_contact.custom_fields)
  );
end $$;

-- Worker: SES accepted the message
create or replace function public.complete_send(p_send_id uuid, p_ses_message_id text)
returns void language sql security definer set search_path = '' as $$
  update public.email_sends
     set status = 'sent', ses_message_id = p_ses_message_id, sent_at = now(), lease_until = null, last_error = null
   where id = p_send_id and status in ('sending', 'ambiguous');
$$;

-- Worker: SES call failed. Transient => back to queued (worker defers the msg).
create or replace function public.fail_send(p_send_id uuid, p_error text, p_permanent boolean)
returns void language sql security definer set search_path = '' as $$
  update public.email_sends
     set status = case when p_permanent then 'failed'::public.send_status else 'queued'::public.send_status end,
         last_error = left(p_error, 1000),
         lease_until = null
   where id = p_send_id and status = 'sending';
$$;

-- Sweeper: leases that expired without a result => ambiguous (never auto-retried)
create or replace function public.mark_stale_sends_ambiguous()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.email_sends
     set status = 'ambiguous', last_error = 'lease_expired_without_result'
   where status = 'sending' and lease_until < now() and ses_message_id is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Mark campaigns finished when nothing is left in flight
create or replace function public.finalize_campaigns()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.campaigns c
     set status = 'sent', completed_at = now()
   where c.status = 'sending'
     and not exists (select 1 from public.email_sends s
                     where s.campaign_id = c.id and s.kind = 'campaign'
                       and s.status in ('pending', 'queued', 'sending'));
  get diagnostics n = row_count;
  return n;
end $$;

-- Events: apply one normalised SES event idempotently
create or replace function public.record_email_event(
  p_provider_event_id text,
  p_event_type public.email_event_type,
  p_ses_message_id text,
  p_occurred_at timestamptz,
  p_permanent_bounce boolean default false,
  p_detail jsonb default '{}'::jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare s public.email_sends%rowtype; v_event_id uuid;
begin
  select * into s from public.email_sends where ses_message_id = p_ses_message_id;
  if not found then return false; end if;   -- unknown message (e.g. test email)

  insert into public.email_events (workspace_id, send_id, contact_id, provider_event_id, event_type, ses_message_id, detail, occurred_at)
  values (s.workspace_id, s.id, s.contact_id, p_provider_event_id, p_event_type, p_ses_message_id, coalesce(p_detail, '{}'::jsonb), p_occurred_at)
  on conflict (provider_event_id) do nothing
  returning id into v_event_id;
  if v_event_id is null then return false; end if;   -- duplicate

  case p_event_type
    when 'delivery' then
      update public.email_sends
         set delivered_at = coalesce(delivered_at, p_occurred_at),
             status = case when status in ('sent', 'ambiguous') then 'delivered'::public.send_status else status end
       where id = s.id;
    when 'bounce' then
      update public.email_sends
         set bounced_at = coalesce(bounced_at, p_occurred_at),
             status = case when p_permanent_bounce and status <> 'complained' then 'bounced'::public.send_status else status end
       where id = s.id;
      if p_permanent_bounce then
        insert into public.suppressions (workspace_id, email, reason, source)
        values (s.workspace_id, s.to_email, 'hard_bounce', 'ses:' || s.id)
        on conflict (workspace_id, email) do nothing;
      end if;
    when 'complaint' then
      update public.email_sends
         set complained_at = coalesce(complained_at, p_occurred_at), status = 'complained'
       where id = s.id;
      insert into public.suppressions (workspace_id, email, reason, source)
      values (s.workspace_id, s.to_email, 'complaint', 'ses:' || s.id)
      on conflict (workspace_id, email) do update set reason = 'complaint';
      update public.contacts set status = 'complained'
       where workspace_id = s.workspace_id and email = s.to_email and status <> 'complained';
    when 'reject', 'rendering_failure' then
      update public.email_sends set status = 'failed', last_error = p_event_type::text where id = s.id;
    when 'open' then
      update public.email_sends set opened_at = coalesce(opened_at, p_occurred_at) where id = s.id;
    when 'click' then
      update public.email_sends
         set clicked_at = coalesce(clicked_at, p_occurred_at), opened_at = coalesce(opened_at, p_occurred_at)
       where id = s.id;
    else
      null;   -- send, delivery_delay, unsubscribe: stored only
  end case;
  return true;
end $$;

-- Unsubscribe by send id (the Edge Function verifies the HMAC token first)
create or replace function public.unsubscribe_send(p_send_id uuid, p_source text default 'link')
returns boolean language plpgsql security definer set search_path = '' as $$
declare s public.email_sends%rowtype;
begin
  select * into s from public.email_sends where id = p_send_id;
  if not found then return false; end if;

  insert into public.suppressions (workspace_id, email, reason, source)
  values (s.workspace_id, s.to_email, 'unsubscribe', p_source || ':' || s.id)
  on conflict (workspace_id, email) do nothing;

  update public.email_sends set unsubscribed_at = coalesce(unsubscribed_at, now()) where id = s.id;

  insert into public.email_events (workspace_id, send_id, contact_id, provider_event_id, event_type, ses_message_id, occurred_at)
  values (s.workspace_id, s.id, s.contact_id, 'unsub:' || s.id, 'unsubscribe', s.ses_message_id, now())
  on conflict (provider_event_id) do nothing;
  return true;
end $$;

-- Lock down server-only functions --------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.queue_read(integer, integer)',
    'public.queue_delete(bigint)',
    'public.queue_archive(bigint)',
    'public.queue_defer(bigint, integer)',
    'public.increment_usage(uuid, public.usage_metric, integer)',
    'public.enqueue_campaign(uuid)',
    'public.enqueue_due_campaigns()',
    'public.enqueue_due_sequence_steps(integer)',
    'public.claim_send(uuid, integer)',
    'public.complete_send(uuid, text)',
    'public.fail_send(uuid, text, boolean)',
    'public.mark_stale_sends_ambiguous()',
    'public.finalize_campaigns()',
    'public.record_email_event(text, public.email_event_type, text, timestamptz, boolean, jsonb)',
    'public.unsubscribe_send(uuid, text)',
    'private.is_sendable(uuid, uuid, text)',
    'private.sender_ok(uuid, uuid, text)',
    'private.usage_since(uuid, public.usage_metric, date)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Trigger functions are never called directly
revoke all on function private.add_workspace_owner()            from public, anon, authenticated;
revoke all on function private.handle_new_user()                from public, anon, authenticated;
revoke all on function private.guard_contact_subscribe()        from public, anon, authenticated;
revoke all on function private.contact_status_to_suppression()  from public, anon, authenticated;
revoke all on function private.apply_suppression()              from public, anon, authenticated;
revoke all on function private.enroll_on_list_join()            from public, anon, authenticated;

-- Queue tables are not reachable from the client API
revoke all on schema pgmq from anon, authenticated;

-- =====================================================================
-- System templates for digital-product sellers
-- Merge tags: {{first_name}}, {{unsubscribe_url}}, {{postal_address}}
-- =====================================================================
insert into public.email_templates (workspace_id, category, name, subject, preview_text, html_body, text_body) values
(null, 'welcome', 'Welcome — new subscriber',
 'Welcome, {{first_name}}! Here''s what to expect',
 'Thanks for joining — your first resource is inside.',
 '<p>Hi {{first_name}},</p><p>Thanks for subscribing. Here is what you will get from me: …</p><p>[Your lead magnet / download link]</p><p>Talk soon,<br>[Your name]</p><hr><p style="font-size:12px;color:#666">{{postal_address}}<br><a href="{{unsubscribe_url}}">Unsubscribe</a></p>',
 E'Hi {{first_name}},\n\nThanks for subscribing. Here is what you will get from me: …\n\n[Your lead magnet / download link]\n\nTalk soon,\n[Your name]\n\n{{postal_address}}\nUnsubscribe: {{unsubscribe_url}}'),
(null, 'product_launch', 'Product launch announcement',
 '[Product name] is live',
 'The thing I have been working on is finally ready.',
 '<p>Hi {{first_name}},</p><p>[Product name] is now available. It helps you [main benefit].</p><ul><li>[What is included #1]</li><li>[What is included #2]</li></ul><p><a href="[product url]">See [Product name]</a></p><hr><p style="font-size:12px;color:#666">{{postal_address}}<br><a href="{{unsubscribe_url}}">Unsubscribe</a></p>',
 E'Hi {{first_name}},\n\n[Product name] is now available. It helps you [main benefit].\n\n- [What is included #1]\n- [What is included #2]\n\nSee it: [product url]\n\n{{postal_address}}\nUnsubscribe: {{unsubscribe_url}}'),
(null, 'affiliate', 'Affiliate recommendation',
 'A tool I think you will find useful',
 'My honest take on [product].',
 '<p>Hi {{first_name}},</p><p>I have been looking at [product] and wanted to share it because [reason].</p><p><a href="[affiliate url]">Check out [product]</a></p><p><em>Disclosure: this is an affiliate link. If you buy through it I may earn a commission at no extra cost to you.</em></p><hr><p style="font-size:12px;color:#666">{{postal_address}}<br><a href="{{unsubscribe_url}}">Unsubscribe</a></p>',
 E'Hi {{first_name}},\n\nI have been looking at [product] and wanted to share it because [reason].\n\nCheck it out: [affiliate url]\n\nDisclosure: this is an affiliate link. If you buy through it I may earn a commission at no extra cost to you.\n\n{{postal_address}}\nUnsubscribe: {{unsubscribe_url}}'),
(null, 'follow_up', 'Sales follow-up',
 'Did you get a chance to look at [product]?',
 'A quick follow-up and an answer to a common question.',
 '<p>Hi {{first_name}},</p><p>A few days ago I shared [product]. A common question is: [question]? The answer: [answer].</p><p><a href="[product url]">Take another look</a></p><hr><p style="font-size:12px;color:#666">{{postal_address}}<br><a href="{{unsubscribe_url}}">Unsubscribe</a></p>',
 E'Hi {{first_name}},\n\nA few days ago I shared [product]. A common question is: [question]? The answer: [answer].\n\nTake another look: [product url]\n\n{{postal_address}}\nUnsubscribe: {{unsubscribe_url}}');
