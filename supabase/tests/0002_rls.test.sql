-- Tenant isolation and role checks (Phase 1 exit criteria).
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------
-- Fixtures (as postgres): owner A, owner B, member M and admin D in A's workspace
-- ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.dev', '{"full_name":"Owner A"}', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.dev', '{"full_name":"Owner B"}', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'm@test.dev', '{"full_name":"Member M"}', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-4444-444444444444', 'd@test.dev', '{"full_name":"Admin D"}', 'authenticated', 'authenticated');

create temporary table ws as
select
  (select id from public.workspaces where owner_id = '11111111-1111-1111-1111-111111111111') as a,
  (select id from public.workspaces where owner_id = '22222222-2222-2222-2222-222222222222') as b;
grant select on ws to authenticated, anon;

insert into public.workspace_members (workspace_id, user_id, role)
select a, '33333333-3333-3333-3333-333333333333'::uuid, 'member'::public.workspace_role from ws union all
select a, '44444444-4444-4444-4444-444444444444'::uuid, 'admin'::public.workspace_role  from ws;

insert into public.contacts (workspace_id, email, first_name)
select a, 'alice-contact@example.com', 'AC' from ws union all
select b, 'bob-contact@example.com',   'BC' from ws;
insert into public.contact_lists (workspace_id, name) select a, 'A list' from ws union all select b, 'B list' from ws;
insert into public.tags (workspace_id, name) select a, 'a-tag' from ws union all select b, 'b-tag' from ws;
insert into public.campaigns (workspace_id, name) select a, 'A campaign' from ws union all select b, 'B campaign' from ws;
insert into public.sequences (workspace_id, name) select a, 'A seq' from ws union all select b, 'B seq' from ws;
insert into public.suppressions (workspace_id, email, reason) select b, 'complainer@example.com', 'complaint' from ws;

-- ---------------------------------------------------------------------
-- Signup bootstrap
-- ---------------------------------------------------------------------
select is((select count(*)::int from public.workspaces where owner_id = '11111111-1111-1111-1111-111111111111'), 1,
  'new user gets exactly one personal workspace');
select is((select role::text from public.workspace_members m, ws
            where m.workspace_id = ws.a and m.user_id = '11111111-1111-1111-1111-111111111111'), 'owner',
  'new user is owner of that workspace');
select is((select full_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'), 'Owner A',
  'profile created with full_name from signup metadata');
select is((select name from public.workspaces, ws where id = ws.a), 'Owner A''s workspace',
  'workspace named after the user');

-- ---------------------------------------------------------------------
-- As owner A
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select is((select count(*)::int from public.workspaces), 1, 'A sees only own workspace');
select is((select count(*)::int from public.contacts), 1, 'A sees only own contacts');
select is((select count(*)::int from public.contact_lists), 1, 'A sees only own lists');
select is((select count(*)::int from public.tags), 1, 'A sees only own tags');
select is((select count(*)::int from public.campaigns), 1, 'A sees only own campaigns');
select is((select count(*)::int from public.sequences), 1, 'A sees only own sequences');
select is((select count(*)::int from public.suppressions), 0, 'A cannot see B suppressions');
select is((select count(*)::int from public.workspace_members), 3, 'A sees members of own workspace only');
select is((select count(*)::int from public.profiles), 3, 'A sees own + co-member profiles only');

select throws_ok($$insert into public.contacts (workspace_id, email) select b, 'x@example.com' from ws$$,
  '42501', null, 'A cannot insert a contact into B''s workspace');
select throws_ok($$insert into public.campaigns (workspace_id, name) select b, 'evil' from ws$$,
  '42501', null, 'A cannot insert a campaign into B''s workspace');
select throws_ok($$insert into public.workspace_members (workspace_id, user_id, role)
                   select b, '11111111-1111-1111-1111-111111111111', 'admin' from ws$$,
  '42501', null, 'A cannot add themself to B''s workspace');
select throws_ok($$update public.contacts set workspace_id = ws.b from ws where contacts.workspace_id = ws.a$$,
  '42501', null, 'A cannot move a contact into B''s workspace');

-- updates/deletes on B's rows are silently filtered by RLS
update public.contacts set first_name = 'hacked' where email = 'bob-contact@example.com';
delete from public.campaigns where name = 'B campaign';
delete from public.workspaces using ws where workspaces.id = ws.b;

-- server-controlled data
select throws_ok($$update public.workspaces set daily_send_limit = 1000000 from ws where workspaces.id = ws.a$$,
  '42501', null, 'owner cannot raise own sending limit');
select throws_ok($$update public.workspaces set sending_status = 'active' from ws where workspaces.id = ws.a$$,
  '42501', null, 'owner cannot change sending status');
select throws_ok($$insert into public.sender_domains (workspace_id, domain, aws_region, verification_status, dkim_status)
                   select a, 'fake.example.com', 'us-east-1', 'verified', 'verified' from ws$$,
  '42501', null, 'client cannot insert (self-verify) a sender domain');
select throws_ok($$insert into public.email_sends (workspace_id, kind, campaign_id, to_email)
                   select ws.a, 'campaign', c.id, 'x@example.com' from ws, public.campaigns c$$,
  '42501', null, 'client cannot write to the send outbox');
select throws_ok($$select public.claim_send(gen_random_uuid())$$,
  '42501', null, 'client cannot call worker RPCs');
select throws_ok($$select * from pgmq.read('email_send', 30, 10)$$,
  '42501', null, 'client cannot read the queue directly');

update public.workspaces set name = 'Renamed by A' from ws where workspaces.id = ws.a;
select is((select name from public.workspaces, ws where id = ws.a), 'Renamed by A', 'owner can rename workspace');
reset role;

-- B's data is untouched
select is((select first_name from public.contacts where email = 'bob-contact@example.com'), 'BC',
  'A''s update did not change B''s contact');
select is((select count(*)::int from public.campaigns, ws where workspace_id = ws.b), 1,
  'A''s delete did not remove B''s campaign');
select is((select count(*)::int from public.workspaces, ws where id = ws.b), 1,
  'A''s delete did not remove B''s workspace');

-- ---------------------------------------------------------------------
-- As member M (role: member) in A's workspace
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);

select is((select count(*)::int from public.contacts), 1, 'member sees workspace contacts');
select lives_ok($$insert into public.contacts (workspace_id, email) select a, 'new@example.com' from ws$$,
  'member can add contacts');
update public.workspaces set name = 'Renamed by member' from ws where workspaces.id = ws.a;
select is((select name from public.workspaces, ws where id = ws.a), 'Renamed by A', 'member cannot rename workspace');
select throws_ok($$insert into public.workspace_members (workspace_id, user_id, role)
                   select a, '22222222-2222-2222-2222-222222222222', 'member' from ws$$,
  '42501', null, 'member cannot add members');
delete from public.suppressions;  -- none visible / none deletable
reset role;

-- ---------------------------------------------------------------------
-- As admin D in A's workspace
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);

update public.workspaces set timezone = 'Asia/Ho_Chi_Minh' from ws where workspaces.id = ws.a;
select is((select timezone from public.workspaces, ws where id = ws.a), 'Asia/Ho_Chi_Minh', 'admin can edit workspace settings');
select lives_ok($$insert into public.workspace_members (workspace_id, user_id, role)
                  select a, '22222222-2222-2222-2222-222222222222', 'member' from ws$$,
  'admin can add a member');
select throws_ok($$update public.workspace_members set role = 'owner'
                   from ws where workspace_id = ws.a and user_id = '22222222-2222-2222-2222-222222222222'$$,
  '42501', null, 'admin cannot promote someone to owner');
delete from public.workspace_members using ws
 where workspace_id = ws.a and user_id = '11111111-1111-1111-1111-111111111111';
reset role;
select is((select count(*)::int from public.workspace_members m, ws
            where m.workspace_id = ws.a and m.role = 'owner'), 1, 'admin cannot remove the owner');

-- non-manual suppressions cannot be deleted even by the owner
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
delete from public.suppressions where email = 'complainer@example.com';
reset role;
select is((select count(*)::int from public.suppressions where email = 'complainer@example.com'), 1,
  'complaint suppression cannot be deleted by the client');

-- ---------------------------------------------------------------------
-- Anonymous
-- ---------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from public.contacts), 0, 'anon sees no contacts');
select is((select count(*)::int from public.workspaces), 0, 'anon sees no workspaces');
select is((select count(*)::int from public.email_templates), 0, 'anon sees no templates');
reset role;

-- ---------------------------------------------------------------------
-- Scheduled jobs registered
-- ---------------------------------------------------------------------
select is((select count(*)::int from cron.job where jobname like 'mp-%'), 7, 'seven pg_cron jobs are scheduled');

select * from finish();
rollback;
