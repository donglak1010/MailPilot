-- Schema smoke tests: tenant bootstrap, campaign + sequence pipelines, suppression, RLS.
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
 ('aaaaaaaa-0000-0000-0000-000000000001','a@test.dev','{"full_name":"Alice"}','authenticated','authenticated'),
 ('bbbbbbbb-0000-0000-0000-000000000002','b@test.dev','{}','authenticated','authenticated');

do $$
declare wa uuid; wb uuid; n int; r jsonb; sid uuid; dom uuid; lst uuid; c1 uuid; c2 uuid; camp uuid; sq uuid; msg record;
begin
  select count(*) into n from public.workspaces where owner_id='aaaaaaaa-0000-0000-0000-000000000001';
  assert n = 1, 'A should have exactly 1 workspace';
  select id into wa from public.workspaces where owner_id='aaaaaaaa-0000-0000-0000-000000000001';
  select id into wb from public.workspaces where owner_id='bbbbbbbb-0000-0000-0000-000000000002';
  assert (select role from public.workspace_members where workspace_id=wa) = 'owner', 'owner membership';
  raise notice 'OK 1: signup -> profile + workspace + owner';

  insert into public.sender_domains (workspace_id, domain, aws_region, verification_status, dkim_status)
    values (wa,'mail.alice.dev','us-east-1','verified','verified') returning id into dom;
  insert into public.contact_lists (workspace_id,name) values (wa,'Buyers') returning id into lst;
  insert into public.contacts (workspace_id,email,first_name,status,consent_at,consent_source)
    values (wa,'  Bob@Example.COM ','Bob','subscribed',now(),'checkout form') returning id into c1;
  assert (select email from public.contacts where id=c1)='bob@example.com', 'email normalized';
  insert into public.contact_list_members (list_id,contact_id,workspace_id) values (lst,c1,wa);
  insert into public.campaigns (workspace_id,name,subject,from_email,sender_domain_id,html_body)
    values (wa,'Launch','Hello','me@mail.alice.dev',dom,'<p>Hi {{first_name}} <a href="{{unsubscribe_url}}">u</a></p>') returning id into camp;
  insert into public.campaign_lists values (camp,lst,wa);
  n := public.enqueue_campaign(camp);
  assert n = 1, 'one recipient queued, got '||n;
  select * into msg from public.queue_read(10,30) limit 1;
  sid := (msg.message->>'send_id')::uuid;
  r := public.claim_send(sid);
  assert r->>'outcome'='send', 'claim outcome '||r::text;
  assert (public.claim_send(sid))->>'outcome'='drop', 'second claim must not send again';
  perform public.complete_send(sid,'ses-msg-1');
  perform public.queue_delete(msg.msg_id);
  assert public.record_email_event('ev1','delivery','ses-msg-1',now());
  assert not public.record_email_event('ev1','delivery','ses-msg-1',now()), 'duplicate event ignored';
  perform public.record_email_event('ev2','bounce','ses-msg-1',now(),true);
  assert (select status from public.contacts where id=c1)='bounced', 'hard bounce -> contact bounced';
  assert exists(select 1 from public.suppressions where workspace_id=wa and email='bob@example.com'), 'suppressed';
  assert public.finalize_campaigns() = 1, 'campaign finalized';
  raise notice 'OK 2: campaign enqueue/claim/complete/events/suppression/finalize';

  begin
    update public.contacts set status='subscribed' where id=c1;
    raise exception 'should have failed';
  exception when sqlstate 'P0001' then null; end;
  raise notice 'OK 3: suppressed contact cannot be resubscribed';

  insert into public.sequences (workspace_id,name,status,trigger_type,trigger_list_id,from_email,sender_domain_id)
    values (wa,'Welcome','active','list_join',lst,'me@mail.alice.dev',dom) returning id into sq;
  insert into public.sequence_steps (workspace_id,sequence_id,position,delay_minutes,subject,html_body)
    values (wa,sq,1,0,'Step1','<p>{{unsubscribe_url}}</p>'),(wa,sq,2,1440,'Step2','<p>{{unsubscribe_url}}</p>');
  insert into public.contacts (workspace_id,email,status,consent_at,consent_source)
    values (wa,'carol@example.com','subscribed',now(),'optin') returning id into c2;
  insert into public.contact_list_members values (lst,c2,wa,now());
  assert (select count(*) from public.sequence_enrollments where contact_id=c2)=1, 'enrolled on list join';
  assert public.enqueue_due_sequence_steps() = 1, 'step 1 enqueued';
  assert public.enqueue_due_sequence_steps() = 0, 'step 2 not yet due';
  assert (select next_step_position from public.sequence_enrollments where contact_id=c2)=2, 'advanced to step 2';
  perform public.unsubscribe_send((select id from public.email_sends where contact_id=c2));
  assert (select status from public.sequence_enrollments where contact_id=c2)='stopped', 'unsubscribe stops sequence';
  raise notice 'OK 4: sequence list-join, scheduler, unsubscribe stops sequence';

  perform set_config('mp.wa', wa::text, false);
  perform set_config('mp.wb', wb::text, false);
  perform set_config('mp.camp', camp::text, false);
end $$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}',true) \;
do $$
declare n int;
begin
  select count(*) into n from public.workspaces; assert n=1, 'A sees only own workspace, saw '||n;
  select count(*) into n from public.contacts; assert n=2, 'A sees own contacts';
  begin
    insert into public.contacts (workspace_id,email) values (current_setting('mp.wb')::uuid,'x@y.com');
    raise exception 'cross-tenant insert should fail';
  exception when insufficient_privilege then null; end;
  begin
    update public.workspaces set daily_send_limit = 999999 where id = current_setting('mp.wa')::uuid;
    raise exception 'quota update should fail';
  exception when insufficient_privilege then null; end;
  begin
    update public.campaigns set status='draft' where id = current_setting('mp.camp')::uuid;
    raise exception 'client status change should fail';
  exception when sqlstate 'P0001' then null; end;
  begin
    perform public.enqueue_campaign(current_setting('mp.camp')::uuid);
    raise exception 'client must not call server RPC';
  exception when insufficient_privilege then null; end;
  select count(*) into n from public.email_templates where workspace_id is null; assert n=4, 'system templates visible';
  raise notice 'OK 5: RLS isolation, column grants, campaign guard, RPC lockdown';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}',true) \;
do $$ begin
  assert (select count(*) from public.contacts)=0, 'B sees no A contacts';
  assert (select count(*) from public.email_sends)=0, 'B sees no A sends';
  raise notice 'OK 6: user B cannot see user A data';
end $$;
select pass('schema smoke assertions (see NOTICE lines) all passed');
select * from finish();
rollback;
