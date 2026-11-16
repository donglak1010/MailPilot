-- =====================================================================
-- MailPilot — Phase 4: campaign sending
--  * client RPCs: audience_count, start/schedule/pause/resume/cancel_campaign
--  * campaign preflight checks shared by "send now", "schedule" and the scheduler
--  * worker lease (one send-worker at a time) + pg_net "kick" of the worker
--  * cron job that runs the send worker every minute
-- Worker URL and secret live in Supabase Vault:
--   select vault.create_secret('<https://<ref>.supabase.co/functions/v1>', 'mp_functions_url');
--   select vault.create_secret('<INTERNAL_WORKER_SECRET>', 'mp_worker_secret');
-- Without them the kick is a no-op (nothing is sent).
-- =====================================================================

create extension if not exists pg_net;

-- Why the scheduler marked a campaign failed (server-written only)
alter table public.campaigns add column failure_reason text check (char_length(failure_reason) <= 500);

-- ---------------------------------------------------------------------
-- Client guard: also protect failure_reason
-- ---------------------------------------------------------------------
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
    new.started_at := null; new.completed_at := null; new.failure_reason := null;
    return new;
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'draft'     and new.status in ('scheduled', 'cancelled')) or
       (old.status = 'scheduled' and new.status in ('draft', 'cancelled')) or
       (old.status = 'sending'   and new.status in ('paused', 'cancelled')) or
       (old.status = 'paused'    and new.status = 'cancelled') or
       (old.status = 'failed'    and new.status = 'draft')
     ) then
    raise exception 'Campaign status change % -> % is not allowed from the client', old.status, new.status
      using errcode = 'P0001';
  end if;

  if old.status not in ('draft', 'scheduled', 'failed') and (
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
  new.failure_reason := case when new.status = 'draft' then null else old.failure_reason end;
  return new;
end $$;

-- Audience lists cannot change once a campaign has started
create or replace function private.guard_campaign_lists()
returns trigger language plpgsql set search_path = '' as $$
declare v_status public.campaign_status;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  select status into v_status from public.campaigns
   where id = coalesce(new.campaign_id, old.campaign_id);
  if v_status is not null and v_status not in ('draft', 'scheduled', 'failed') then
    raise exception 'Audience cannot be changed once sending has started' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

create trigger campaign_lists_guard
  before insert or update or delete on public.campaign_lists
  for each row execute function private.guard_campaign_lists();
revoke all on function private.guard_campaign_lists() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Audience size (security invoker: RLS applies)
-- ---------------------------------------------------------------------
create or replace function public.audience_count(p_workspace_id uuid, p_list_ids uuid[])
returns integer language sql stable security invoker set search_path = '' as $$
  select count(distinct c.id)::integer
    from public.contact_list_members m
    join public.contacts c on c.id = m.contact_id
   where m.workspace_id = p_workspace_id
     and m.list_id = any (p_list_ids)
     and c.status = 'subscribed' and c.archived_at is null
     and not exists (select 1 from public.suppressions s
                     where s.workspace_id = c.workspace_id and s.email = c.email);
$$;
grant execute on function public.audience_count(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- Preflight: returns an error code, or null when the campaign may send
-- ---------------------------------------------------------------------
create or replace function private.campaign_preflight(p_campaign_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_c public.campaigns%rowtype;
  v_ws public.workspaces%rowtype;
  v_lists uuid[];
  v_audience integer;
  v_month_used integer;
begin
  select * into v_c from public.campaigns where id = p_campaign_id;
  if not found then return 'campaign_not_found'; end if;
  select * into v_ws from public.workspaces where id = v_c.workspace_id;

  if v_ws.sending_status <> 'active' then return 'workspace_sending_disabled'; end if;
  if not private.sender_ok(v_c.workspace_id, v_c.sender_domain_id, v_c.from_email) then return 'sender_not_verified'; end if;
  if btrim(v_c.subject) = '' then return 'missing_subject'; end if;
  if btrim(v_c.html_body) = '' then return 'missing_content'; end if;
  if position('{{unsubscribe_url}}' in v_c.html_body) = 0 then return 'missing_unsubscribe_placeholder'; end if;
  if coalesce(btrim(v_ws.postal_address), '') = '' then return 'missing_postal_address'; end if;

  select array_agg(list_id) into v_lists from public.campaign_lists where campaign_id = v_c.id;
  if v_lists is null then return 'no_audience'; end if;

  select count(distinct c.id) into v_audience
    from public.contact_list_members m
    join public.contacts c on c.id = m.contact_id
   where m.list_id = any (v_lists)
     and c.status = 'subscribed' and c.archived_at is null
     and not exists (select 1 from public.suppressions s
                     where s.workspace_id = c.workspace_id and s.email = c.email);
  if v_audience = 0 then return 'empty_audience'; end if;

  v_month_used := private.usage_since(v_c.workspace_id, 'emails_sent', date_trunc('month', now() at time zone 'utc')::date);
  if v_audience > v_ws.monthly_send_limit - v_month_used then return 'monthly_quota_insufficient'; end if;

  return null;
end $$;

-- ---------------------------------------------------------------------
-- Worker kick (async HTTP via pg_net; never blocks or fails the caller)
-- ---------------------------------------------------------------------
create or replace function private.kick_worker()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'mp_functions_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mp_worker_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/send-worker',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret),
    timeout_milliseconds := 60000
  );
exception when others then
  raise warning 'kick_worker failed: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- Single-worker lease (the worker calls these with service_role)
-- ---------------------------------------------------------------------
create table private.worker_leases (
  name        text primary key,
  holder      uuid,
  lease_until timestamptz not null default '-infinity'
);
insert into private.worker_leases (name) values ('send-worker');
revoke all on private.worker_leases from public, anon, authenticated;

create or replace function public.acquire_worker_lease(p_name text, p_holder uuid, p_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update private.worker_leases
     set holder = p_holder, lease_until = now() + make_interval(secs => p_seconds)
   where name = p_name and (lease_until < now() or holder = p_holder);
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function public.release_worker_lease(p_name text, p_holder uuid)
returns void language sql security definer set search_path = '' as $$
  update private.worker_leases set holder = null, lease_until = '-infinity'
   where name = p_name and holder = p_holder;
$$;

-- ---------------------------------------------------------------------
-- Client RPCs (authenticated). Each checks the caller's role itself.
-- ---------------------------------------------------------------------
create or replace function private.lock_campaign_for(p_campaign_id uuid, p_roles public.workspace_role[])
returns public.campaigns language plpgsql security definer set search_path = '' as $$
declare v_c public.campaigns%rowtype;
begin
  select * into v_c from public.campaigns where id = p_campaign_id for update;
  if not found or not private.is_member(v_c.workspace_id) then
    raise exception 'campaign_not_found' using errcode = 'P0002', hint = 'campaign_not_found';
  end if;
  if not private.has_role(v_c.workspace_id, p_roles) then
    raise exception 'not_allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return v_c;
end $$;

create or replace function public.start_campaign(p_campaign_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_c public.campaigns%rowtype; v_err text; n integer;
begin
  v_c := private.lock_campaign_for(p_campaign_id, array['owner','admin']::public.workspace_role[]);
  if v_c.status not in ('draft', 'scheduled') then
    raise exception 'campaign_not_startable' using errcode = 'P0001', hint = 'campaign_not_startable';
  end if;
  v_err := private.campaign_preflight(v_c.id);
  if v_err is not null then raise exception '%', v_err using errcode = 'P0001', hint = v_err; end if;

  update public.campaigns set failure_reason = null, scheduled_at = coalesce(scheduled_at, now()) where id = v_c.id;
  n := public.enqueue_campaign(v_c.id);
  perform private.kick_worker();
  return n;
end $$;

create or replace function public.schedule_campaign(p_campaign_id uuid, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c public.campaigns%rowtype; v_err text;
begin
  v_c := private.lock_campaign_for(p_campaign_id, array['owner','admin']::public.workspace_role[]);
  if v_c.status not in ('draft', 'scheduled') then
    raise exception 'campaign_not_schedulable' using errcode = 'P0001', hint = 'campaign_not_schedulable';
  end if;
  if p_at is null or p_at < now() + interval '2 minutes' or p_at > now() + interval '365 days' then
    raise exception 'invalid_schedule_time' using errcode = '22023', hint = 'invalid_schedule_time';
  end if;
  v_err := private.campaign_preflight(v_c.id);
  if v_err is not null then raise exception '%', v_err using errcode = 'P0001', hint = v_err; end if;
  update public.campaigns set status = 'scheduled', scheduled_at = p_at, failure_reason = null where id = v_c.id;
end $$;

create or replace function public.pause_campaign(p_campaign_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c public.campaigns%rowtype;
begin
  v_c := private.lock_campaign_for(p_campaign_id, array['owner','admin','member']::public.workspace_role[]);
  if v_c.status <> 'sending' then
    raise exception 'campaign_not_sending' using errcode = 'P0001', hint = 'campaign_not_sending';
  end if;
  update public.campaigns set status = 'paused' where id = v_c.id;
  -- Queued messages are turned back into 'pending' when the worker sees them (claim_send),
  -- so do it here too: nothing new is handed to SES after this commit.
  update public.email_sends set status = 'pending'
   where campaign_id = v_c.id and kind = 'campaign' and status = 'queued';
end $$;

create or replace function public.resume_campaign(p_campaign_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_c public.campaigns%rowtype; v_err text; n integer;
begin
  v_c := private.lock_campaign_for(p_campaign_id, array['owner','admin']::public.workspace_role[]);
  if v_c.status <> 'paused' then
    raise exception 'campaign_not_paused' using errcode = 'P0001', hint = 'campaign_not_paused';
  end if;
  v_err := private.campaign_preflight(v_c.id);
  -- the audience may legitimately be fully sent already; only sender/content problems block a resume
  if v_err is not null and v_err not in ('empty_audience', 'monthly_quota_insufficient') then
    raise exception '%', v_err using errcode = 'P0001', hint = v_err;
  end if;
  n := public.enqueue_campaign(v_c.id);
  perform private.kick_worker();
  return n;
end $$;

create or replace function public.cancel_campaign(p_campaign_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c public.campaigns%rowtype;
begin
  v_c := private.lock_campaign_for(p_campaign_id, array['owner','admin','member']::public.workspace_role[]);
  if v_c.status not in ('draft', 'scheduled', 'sending', 'paused') then
    raise exception 'campaign_not_cancellable' using errcode = 'P0001', hint = 'campaign_not_cancellable';
  end if;
  update public.campaigns set status = 'cancelled', completed_at = now() where id = v_c.id;
  update public.email_sends set status = 'cancelled'
   where campaign_id = v_c.id and kind = 'campaign' and status in ('pending', 'queued');
end $$;

-- ---------------------------------------------------------------------
-- Scheduler: record why a due campaign could not start
-- ---------------------------------------------------------------------
create or replace function public.enqueue_due_campaigns()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0; v_err text;
begin
  for r in select id from public.campaigns
            where status = 'scheduled' and scheduled_at <= now()
            order by scheduled_at limit 20 for update skip locked loop
    v_err := private.campaign_preflight(r.id);
    if v_err is not null then
      update public.campaigns set status = 'failed', failure_reason = v_err where id = r.id;
      continue;
    end if;
    begin
      perform public.enqueue_campaign(r.id);
      n := n + 1;
    exception when others then
      update public.campaigns set status = 'failed', failure_reason = left(sqlerrm, 500) where id = r.id;
    end;
  end loop;
  if n > 0 then perform private.kick_worker(); end if;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.start_campaign(uuid)',
    'public.schedule_campaign(uuid, timestamptz)',
    'public.pause_campaign(uuid)',
    'public.resume_campaign(uuid)',
    'public.cancel_campaign(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;

  foreach f in array array[
    'public.acquire_worker_lease(text, uuid, integer)',
    'public.release_worker_lease(text, uuid)',
    'public.enqueue_due_campaigns()',
    'private.campaign_preflight(uuid)',
    'private.kick_worker()',
    'private.lock_campaign_for(uuid, public.workspace_role[])'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- lock_campaign_for / campaign_preflight / kick_worker are only called from the
-- security definer RPCs above (which run as their owner), never directly by clients.

-- ---------------------------------------------------------------------
-- Cron: run the send worker every minute (no-op until Vault secrets exist)
-- ---------------------------------------------------------------------
select cron.schedule('mp-send-worker', '* * * * *', $$select private.kick_worker()$$);
