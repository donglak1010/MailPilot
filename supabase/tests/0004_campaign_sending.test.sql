-- Campaign sending pipeline (Phase 4).
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('a4444444-0000-0000-0000-000000000001', 'owner@test.dev',  '{"full_name":"Owner"}',  'authenticated', 'authenticated'),
  ('a4444444-0000-0000-0000-000000000002', 'member@test.dev', '{"full_name":"Member"}', 'authenticated', 'authenticated'),
  ('a4444444-0000-0000-0000-000000000003', 'other@test.dev',  '{"full_name":"Other"}',  'authenticated', 'authenticated');

create temporary table t (k text primary key, v uuid);
grant select, insert on t to authenticated;

insert into t select 'ws', id from public.workspaces where owner_id = 'a4444444-0000-0000-0000-000000000001';
insert into public.workspace_members (workspace_id, user_id, role)
select v, 'a4444444-0000-0000-0000-000000000002', 'member' from t where k = 'ws';

-- verified sender domain (normally written by the sender-domains function)
insert into public.sender_domains (workspace_id, domain, aws_region, verification_status, dkim_status)
select v, 'mail.brand.test', 'ap-northeast-1', 'verified', 'verified' from t where k = 'ws';
insert into t select 'dom', id from public.sender_domains where domain = 'mail.brand.test';

-- audience: list L1 {c1, c2, c3}, list L2 {c2, c4}; c3 unsubscribed, c4 suppressed
insert into public.contact_lists (workspace_id, name) select v, 'L1' from t where k = 'ws';
insert into public.contact_lists (workspace_id, name) select v, 'L2' from t where k = 'ws';
insert into public.contacts (workspace_id, email, first_name, status, consent_at, consent_source)
select t.v, e.email, e.name, e.status::public.contact_status, now(), 'test'
  from t, (values ('c1@example.com', 'One', 'subscribed'), ('c2@example.com', 'Two', 'subscribed'),
                  ('c3@example.com', 'Three', 'unsubscribed'), ('c4@example.com', 'Four', 'subscribed')) e(email, name, status)
 where t.k = 'ws';
insert into public.suppressions (workspace_id, email, reason) select v, 'c4@example.com', 'manual' from t where k = 'ws';
insert into public.contact_list_members (workspace_id, list_id, contact_id)
select l.workspace_id, l.id, c.id from public.contact_lists l join public.contacts c on c.workspace_id = l.workspace_id
 where (l.name = 'L1' and c.email in ('c1@example.com', 'c2@example.com', 'c3@example.com'))
    or (l.name = 'L2' and c.email in ('c2@example.com', 'c4@example.com'));

insert into public.campaigns (workspace_id, name, subject, html_body, text_body, from_name, from_email, sender_domain_id)
select ws.v, 'Launch', 'Hello {{first_name}}', '<p>Hi</p><a href="{{unsubscribe_url}}">Unsubscribe</a>', 'Hi',
       'Brand', 'hello@mail.brand.test', dom.v
  from t ws, t dom where ws.k = 'ws' and dom.k = 'dom';
insert into t select 'camp', id from public.campaigns where name = 'Launch';
insert into public.campaign_lists (campaign_id, list_id, workspace_id)
select c.id, l.id, c.workspace_id from public.campaigns c join public.contact_lists l on l.workspace_id = c.workspace_id
 where c.name = 'Launch';

-- ---------------------------------------------------------------------
-- Client checks
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4444444-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is(public.audience_count((select v from t where k = 'ws'), (select array_agg(id) from public.contact_lists)), 2,
  'audience = subscribed, unsuppressed, deduplicated across lists');
select throws_ok($$select public.start_campaign((select v from t where k = 'camp'))$$,
  '42501', null, 'a plain member cannot send a campaign');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4444444-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$select public.start_campaign((select v from t where k = 'camp'))$$,
  'P0002', null, 'another workspace cannot see the campaign');
select throws_ok($$select public.cancel_campaign((select v from t where k = 'camp'))$$,
  'P0002', null, 'another workspace cannot cancel the campaign');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4444444-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.start_campaign((select v from t where k = 'camp'))$$,
  'P0001', 'missing_postal_address', 'a postal address is required before sending');
update public.workspaces set postal_address = '1 Test Street, Hanoi' where id = (select v from t where k = 'ws');

select throws_ok($$select public.schedule_campaign((select v from t where k = 'camp'), now() + interval '30 seconds')$$,
  '22023', null, 'schedule time must be in the future');
select lives_ok($$select public.schedule_campaign((select v from t where k = 'camp'), now() + interval '1 hour')$$,
  'owner can schedule');
select is((select status::text from public.campaigns where id = (select v from t where k = 'camp')), 'scheduled', 'campaign scheduled');

select is(public.start_campaign((select v from t where k = 'camp')), 2, 'send now enqueues 2 recipients');
select is((select status::text from public.campaigns where id = (select v from t where k = 'camp')), 'sending', 'campaign is sending');
select throws_ok($$delete from public.campaign_lists where campaign_id = (select v from t where k = 'camp')$$,
  'P0001', null, 'audience is locked once sending started');
select throws_ok($$update public.campaigns set subject = 'changed' where id = (select v from t where k = 'camp')$$,
  'P0001', null, 'content is locked once sending started');
select throws_ok($$select public.start_campaign((select v from t where k = 'camp'))$$,
  'P0001', 'campaign_not_startable', 'cannot start twice');
reset role;

select is((select count(*)::int from public.email_sends where campaign_id = (select v from t where k = 'camp') and status = 'queued'), 2,
  'two queued sends');
select is((select count(*)::int from pgmq.q_email_send), 2, 'two queue messages');

-- ---------------------------------------------------------------------
-- Pause / resume
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4444444-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$select public.pause_campaign((select v from t where k = 'camp'))$$, 'a member can pause (safety action)');
reset role;
select is((select count(*)::int from public.email_sends where campaign_id = (select v from t where k = 'camp') and status = 'pending'), 2,
  'pause turns queued sends back into pending');
select is((public.claim_send((select id from public.email_sends where to_email = 'c1@example.com'))) ->> 'outcome', 'drop',
  'worker drops messages of a paused campaign');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4444444-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.resume_campaign((select v from t where k = 'camp')), 2, 'resume re-queues the pending sends');
reset role;

-- ---------------------------------------------------------------------
-- Worker flow
-- ---------------------------------------------------------------------
create temporary table claim as select public.claim_send((select id from public.email_sends where to_email = 'c1@example.com')) as r;
select is((select r ->> 'outcome' from claim), 'send', 'claim returns a send payload');
select is((select r -> 'contact' ->> 'first_name' from claim), 'One', 'payload carries merge data');
select is((select r ->> 'postal_address' from claim), '1 Test Street, Hanoi', 'payload carries the postal address');
select is((select status::text from public.email_sends where to_email = 'c1@example.com'), 'sending', 'send is leased');
select is((public.claim_send((select id from public.email_sends where to_email = 'c1@example.com'))) ->> 'outcome', 'drop',
  'a leased send cannot be claimed twice');

select public.fail_send((select id from public.email_sends where to_email = 'c1@example.com'), 'Throttling', false);
select is((select status::text from public.email_sends where to_email = 'c1@example.com'), 'queued', 'transient failure re-queues');
select is((public.claim_send((select id from public.email_sends where to_email = 'c1@example.com'))) ->> 'outcome', 'send', 'retry claims again');
select public.complete_send((select id from public.email_sends where to_email = 'c1@example.com'), 'ses-msg-1');
select is((select status::text from public.email_sends where to_email = 'c1@example.com'), 'sent', 'SES acceptance marks sent');

-- second send: lease expires without result => ambiguous, never re-claimed
select is((public.claim_send((select id from public.email_sends where to_email = 'c2@example.com'))) ->> 'outcome', 'send', 'claim second');
update public.email_sends set lease_until = now() - interval '1 second' where to_email = 'c2@example.com';
select is(public.mark_stale_sends_ambiguous(), 1, 'expired lease is swept');
select is((select status::text from public.email_sends where to_email = 'c2@example.com'), 'ambiguous', 'send is ambiguous');
select is((public.claim_send((select id from public.email_sends where to_email = 'c2@example.com'))) ->> 'outcome', 'drop',
  'ambiguous sends are never retried automatically');

select is(public.finalize_campaigns(), 1, 'campaign finalised when nothing is in flight');
select is((select status::text from public.campaigns where id = (select v from t where k = 'camp')), 'sent', 'campaign sent');

-- ---------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------
select ok(public.record_email_event('sns-1', 'delivery', 'ses-msg-1', now()), 'delivery recorded');
select ok(not public.record_email_event('sns-1', 'delivery', 'ses-msg-1', now()), 'duplicate event ignored');
select ok(not public.record_email_event('sns-x', 'delivery', 'unknown-msg', now()), 'unknown message ignored');
select is((select status::text from public.email_sends where to_email = 'c1@example.com'), 'delivered', 'send delivered');
select ok(public.record_email_event('sns-2', 'click', 'ses-msg-1', now(), false, '{"link":"https://x.test"}'), 'click recorded');
select ok((select opened_at is not null and clicked_at is not null from public.email_sends where to_email = 'c1@example.com'),
  'click implies open');
select ok(public.record_email_event('sns-3', 'bounce', 'ses-msg-1', now(), true), 'hard bounce recorded');
select is((select reason::text from public.suppressions where email = 'c1@example.com'), 'hard_bounce', 'hard bounce suppresses');
select is((select status::text from public.contacts where email = 'c1@example.com'), 'bounced', 'contact marked bounced');

select ok(public.unsubscribe_send((select id from public.email_sends where to_email = 'c2@example.com'), 'one-click'), 'unsubscribe');
select is((select status::text from public.contacts where email = 'c2@example.com'), 'unsubscribed', 'unsubscribe updates the contact');
select is((select reason::text from public.suppressions where email = 'c2@example.com'), 'unsubscribe', 'unsubscribe suppresses');

-- ---------------------------------------------------------------------
-- Scheduler + cancel
-- ---------------------------------------------------------------------
insert into public.campaigns (workspace_id, name, subject, html_body, from_email, sender_domain_id, status, scheduled_at)
select ws.v, 'Due', 'S', '<a href="{{unsubscribe_url}}">u</a>', 'hello@other.test', dom.v, 'scheduled', now() - interval '1 minute'
  from t ws, t dom where ws.k = 'ws' and dom.k = 'dom';
insert into public.campaign_lists (campaign_id, list_id, workspace_id)
select c.id, l.id, c.workspace_id from public.campaigns c join public.contact_lists l on l.workspace_id = c.workspace_id
 where c.name = 'Due' and l.name = 'L1';
select is(public.enqueue_due_campaigns(), 0, 'scheduler skips an invalid due campaign');
select is((select status::text || ':' || failure_reason from public.campaigns where name = 'Due'), 'failed:sender_not_verified',
  'invalid due campaign fails with a reason');

insert into public.contacts (workspace_id, email, status, consent_at, consent_source)
select v, 'c5@example.com', 'subscribed', now(), 'test' from t where k = 'ws';
insert into public.contact_list_members (workspace_id, list_id, contact_id)
select l.workspace_id, l.id, c.id from public.contact_lists l, public.contacts c where l.name = 'L1' and c.email = 'c5@example.com';
update public.campaigns set from_email = 'news@mail.brand.test', status = 'scheduled', failure_reason = null where name = 'Due';
select is(public.enqueue_due_campaigns(), 1, 'scheduler starts a valid due campaign');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4444444-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$select public.cancel_campaign((select id from public.campaigns where name = 'Due'))$$, 'member can cancel');
reset role;
select is((select count(*)::int from public.email_sends s join public.campaigns c on c.id = s.campaign_id
            where c.name = 'Due' and s.status not in ('cancelled')), 0, 'cancel cancels every queued send');
select is((public.claim_send((select s.id from public.email_sends s join public.campaigns c on c.id = s.campaign_id where c.name = 'Due' limit 1))) ->> 'outcome',
  'drop', 'worker drops sends of a cancelled campaign');

-- ---------------------------------------------------------------------
-- Worker lease + privileges
-- ---------------------------------------------------------------------
select ok(public.acquire_worker_lease('send-worker', 'b0000000-0000-0000-0000-000000000001', 60), 'first worker gets the lease');
select ok(not public.acquire_worker_lease('send-worker', 'b0000000-0000-0000-0000-000000000002', 60), 'second worker is refused');
select public.release_worker_lease('send-worker', 'b0000000-0000-0000-0000-000000000001');
select ok(public.acquire_worker_lease('send-worker', 'b0000000-0000-0000-0000-000000000002', 60), 'lease free after release');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4444444-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.acquire_worker_lease('send-worker', gen_random_uuid(), 60)$$, '42501', null,
  'clients cannot take the worker lease');
select throws_ok($$select public.enqueue_due_campaigns()$$, '42501', null, 'clients cannot run the scheduler');
update public.campaigns set failure_reason = 'forged' where name = 'Launch';
reset role;
select is((select failure_reason from public.campaigns where name = 'Launch'), null, 'clients cannot write failure_reason');

select is((select count(*)::int from cron.job where jobname = 'mp-send-worker'), 1, 'send worker cron job scheduled');

select * from finish();
rollback;
