-- Contacts, CSV import, quota and isolation (Phase 2).
-- Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'a@test.dev', '{"full_name":"A"}', 'authenticated', 'authenticated'),
  ('bbbbbbbb-2222-2222-2222-222222222222', 'b@test.dev', '{"full_name":"B"}', 'authenticated', 'authenticated');

create temporary table ws as
select
  (select id from public.workspaces where owner_id = 'aaaaaaaa-1111-1111-1111-111111111111') as a,
  (select id from public.workspaces where owner_id = 'bbbbbbbb-2222-2222-2222-222222222222') as b;
grant select on ws to authenticated;

-- existing state in A: an unsubscribed contact, a suppression, a list
insert into public.contacts (workspace_id, email, first_name, status)
select a, 'left@example.com', 'Old', 'unsubscribed' from ws;
insert into public.suppressions (workspace_id, email, reason)
select a, 'complained@example.com', 'complaint' from ws;
insert into public.contact_lists (workspace_id, name) select a, 'Buyers' from ws;

create temporary table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;

-- ---------------------------------------------------------------------
-- As A: import with recorded consent into list "Buyers"
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-1111-1111-1111-111111111111","role":"authenticated"}', true);

insert into ids
select 'imp1', public.start_contact_import(
  ws.a, ws.a::text || '/file1.csv', 7, '{"Email":"email"}'::jsonb,
  (select id from public.contact_lists where name = 'Buyers'), 'Checkout opt-in on mysite.com')
from ws;

select is(
  public.import_contacts_batch((select v from ids where k = 'imp1'), $$[
    {"email":" New1@Example.com ", "first_name":"New", "custom_fields":{"plan":"pro"}},
    {"email":"new1@example.com", "first_name":"Dup"},
    {"email":"not-an-email"},
    {"email":"left@example.com", "first_name":"Updated"},
    {"email":"complained@example.com"},
    {"email":"new2@example.com", "last_name":"Two"},
    {}
  ]$$::jsonb),
  '{"inserted":2,"updated":1,"skipped":4}'::jsonb,
  'batch counters: 2 inserted, 1 updated, 4 skipped');

select is((select status::text from public.contacts where email = 'new1@example.com'), 'subscribed',
  'consented import creates subscribed contacts');
select ok((select consent_at is not null and consent_source = 'Checkout opt-in on mysite.com'
             from public.contacts where email = 'new1@example.com'), 'consent timestamp + source recorded');
select is((select first_name from public.contacts where email = 'new1@example.com'), 'New',
  'first occurrence in file wins');
select is((select custom_fields ->> 'plan' from public.contacts where email = 'new1@example.com'), 'pro',
  'custom fields stored');
select is((select status::text from public.contacts where email = 'left@example.com'), 'unsubscribed',
  'import never re-subscribes an existing unsubscribed contact');
select is((select first_name from public.contacts where email = 'left@example.com'), 'Updated',
  'import updates names of existing contacts');
select is((select count(*)::int from public.contacts where email = 'complained@example.com'), 0,
  'suppressed address is not created');
select is((select count(*)::int from public.contact_list_members m join public.contact_lists l on l.id = m.list_id
            where l.name = 'Buyers'), 3, 'imported + updated contacts added to the target list');

-- second batch of the same import: cross-batch duplicate counts as update
select is(
  public.import_contacts_batch((select v from ids where k = 'imp1'), '[{"email":"new2@example.com","first_name":"Second"}]'::jsonb),
  '{"inserted":0,"updated":1,"skipped":0}'::jsonb,
  'cross-batch duplicate is an update, not a new contact');
select lives_ok($$select public.finish_contact_import((select v from ids where k = 'imp1'))$$, 'finish import');

select is((select row(status::text, inserted_rows, updated_rows, skipped_rows)::text from public.csv_imports
            where id = (select v from ids where k = 'imp1')),
  '(completed,2,2,4)', 'import record has final counters and status');
select is((select jsonb_array_length(errors) from public.csv_imports where id = (select v from ids where k = 'imp1')), 4,
  'skipped rows are listed with reasons');
select throws_ok($$select public.import_contacts_batch((select v from ids where k = 'imp1'), '[]'::jsonb)$$,
  'P0001', null, 'a finished import cannot receive more rows');

-- import without consent => pending
insert into ids select 'imp2', public.start_contact_import(ws.a, ws.a::text || '/file2.csv', 1) from ws;
select public.import_contacts_batch((select v from ids where k = 'imp2'), '[{"email":"noconsent@example.com"}]'::jsonb);
select is((select status::text from public.contacts where email = 'noconsent@example.com'), 'pending',
  'import without consent source creates pending (unsendable) contacts');

-- validation
select throws_ok($$select public.start_contact_import(ws.a, 'other-folder/x.csv', 1) from ws$$,
  '22023', null, 'storage path must be inside the workspace folder');
select throws_ok($$select public.start_contact_import(ws.a, ws.a::text || '/x.csv', 60000) from ws$$,
  '22023', null, 'row limit enforced');
select throws_ok($$select public.import_contacts_batch((select v from ids where k = 'imp2'), '{"email":"x@y.z"}'::jsonb)$$,
  '22023', null, 'batch must be an array');

-- isolation: A cannot start an import for B or touch B's import
select throws_ok($$select public.start_contact_import(ws.b, ws.b::text || '/x.csv', 1) from ws$$,
  '42501', null, 'A cannot start an import in B''s workspace');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}', true);
select throws_ok($$select public.import_contacts_batch((select v from ids where k = 'imp2'), '[{"email":"evil@example.com"}]'::jsonb)$$,
  '42501', null, 'B cannot write into A''s import');
select throws_ok($$select public.finish_contact_import((select v from ids where k = 'imp2'))$$,
  '42501', null, 'B cannot finish A''s import');
select is((select count(*)::int from public.csv_imports), 0, 'B cannot see A''s imports');
select is((select count(*)::int from public.contacts), 0, 'B sees none of A''s contacts');
reset role;

-- ---------------------------------------------------------------------
-- Contact quota
-- ---------------------------------------------------------------------
update public.workspaces set max_contacts = (select count(*) from public.contacts, ws where workspace_id = ws.a) + 1
 from ws where workspaces.id = ws.a;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-1111-1111-1111-111111111111","role":"authenticated"}', true);
insert into ids select 'imp3', public.start_contact_import(ws.a, ws.a::text || '/file3.csv', 3, '{}', null, 'opt-in') from ws;
select is(
  public.import_contacts_batch((select v from ids where k = 'imp3'),
    '[{"email":"q1@example.com"},{"email":"q2@example.com"},{"email":"q3@example.com"}]'::jsonb),
  '{"inserted":1,"updated":0,"skipped":2}'::jsonb,
  'import stops at the contact limit');
select throws_ok($$insert into public.contacts (workspace_id, email) select a, 'over@example.com' from ws$$,
  'P0001', null, 'manual insert over the contact limit is rejected');
reset role;

select is((select quantity from public.usage_records u, ws
            where u.workspace_id = ws.a and u.metric = 'contacts_imported'), 4,
  'contacts_imported usage recorded');

select * from finish();
rollback;
