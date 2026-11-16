-- =====================================================================
-- MailPilot — Phase 2: contact quota + CSV import RPCs
--
-- Import flow (browser):
--   1. upload original CSV to storage bucket contact-imports/<workspace_id>/…
--   2. start_contact_import(...)            -> import id (status processing)
--   3. import_contacts_batch(id, rows) x N  -> per-batch counters (<= 1000 rows)
--   4. finish_contact_import(id)            -> status completed / failed
--
-- Rules
--   * dedupe by (workspace_id, email); first occurrence in a batch wins
--   * existing contacts: names / custom fields updated, STATUS NEVER CHANGED
--   * new contacts are "subscribed" only when the import records a consent
--     source; otherwise "pending" (not sendable)
--   * suppressed addresses are never created
--   * workspaces.max_contacts is enforced
-- =====================================================================

-- ---------------------------------------------------------------------
-- Contact quota (statement-level: bulk inserts are checked once)
-- ---------------------------------------------------------------------
create or replace function private.enforce_max_contacts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select w.id, w.max_contacts,
           (select count(*) from public.contacts c where c.workspace_id = w.id) as total
      from public.workspaces w
     where w.id in (select distinct n.workspace_id from new_rows n)
  loop
    if r.total > r.max_contacts then
      raise exception 'contact_limit_reached: this workspace allows % contacts', r.max_contacts
        using errcode = 'P0001', hint = 'contact_limit_reached';
    end if;
  end loop;
  return null;
end $$;

create trigger contacts_enforce_max
  after insert on public.contacts
  referencing new table as new_rows
  for each statement execute function private.enforce_max_contacts();

revoke all on function private.enforce_max_contacts() from public, anon, authenticated;

-- Fast lookups for list/tag filters and search ordering
create index if not exists contact_list_members_list_idx on public.contact_list_members (list_id, contact_id);
create index if not exists contact_tags_tag_idx          on public.contact_tags (tag_id, contact_id);
create index if not exists csv_imports_ws_idx             on public.csv_imports (workspace_id, created_at desc);

-- ---------------------------------------------------------------------
-- start_contact_import
-- ---------------------------------------------------------------------
create or replace function public.start_contact_import(
  p_workspace_id   uuid,
  p_storage_path   text,
  p_total_rows     integer,
  p_column_mapping jsonb default '{}'::jsonb,
  p_list_id        uuid default null,
  p_consent_source text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_consent text := nullif(btrim(coalesce(p_consent_source, '')), '');
begin
  if not private.is_member(p_workspace_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if p_storage_path is null or split_part(p_storage_path, '/', 1) <> p_workspace_id::text then
    raise exception 'invalid_storage_path' using errcode = '22023';
  end if;
  if p_total_rows is null or p_total_rows < 1 or p_total_rows > 50000 then
    raise exception 'invalid_row_count: 1..50000 rows per import' using errcode = '22023';
  end if;
  if char_length(v_consent) > 500 then
    raise exception 'consent_source_too_long' using errcode = '22023';
  end if;
  if p_list_id is not null and not exists (
       select 1 from public.contact_lists l where l.id = p_list_id and l.workspace_id = p_workspace_id) then
    raise exception 'list_not_found' using errcode = '22023';
  end if;

  insert into public.csv_imports (workspace_id, created_by, storage_path, list_id, column_mapping,
                                  consent_source, status, total_rows)
  values (p_workspace_id, auth.uid(), p_storage_path, p_list_id, coalesce(p_column_mapping, '{}'::jsonb),
          v_consent, 'processing', p_total_rows)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- import_contacts_batch
-- p_rows: [{ "email": "...", "first_name": "...", "last_name": "...",
--            "custom_fields": { ... } }, ...]   (max 1000 per call)
-- returns { inserted, updated, skipped }
-- ---------------------------------------------------------------------
create or replace function public.import_contacts_batch(p_import_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  imp         public.csv_imports%rowtype;
  v_max       integer;
  v_capacity  integer;
  v_inserted  integer := 0;
  v_updated   integer := 0;
  v_skipped   integer := 0;
  v_errors    jsonb;
  v_status    public.contact_status;
begin
  select * into imp from public.csv_imports where id = p_import_id for update;
  if not found or not private.is_member(imp.workspace_id) then
    raise exception 'import_not_found' using errcode = '42501';
  end if;
  if imp.status <> 'processing' then
    raise exception 'import_not_open' using errcode = 'P0001';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'invalid_batch: expected an array of at most 1000 rows' using errcode = '22023';
  end if;

  v_status := case when imp.consent_source is not null then 'subscribed' else 'pending' end;

  create temp table if not exists mp_import_rows (
    ord bigint, email text, first_name text, last_name text, custom_fields jsonb,
    outcome text, existing_id uuid, contact_id uuid
  ) on commit drop;
  -- TRUNCATE, not DELETE: Supabase's pg-safeupdate rejects DELETE without WHERE for API roles
  truncate pg_temp.mp_import_rows;

  insert into pg_temp.mp_import_rows (ord, email, first_name, last_name, custom_fields)
  select r.ord,
         lower(btrim(r.v ->> 'email')),
         nullif(left(btrim(r.v ->> 'first_name'), 120), ''),
         nullif(left(btrim(r.v ->> 'last_name'), 120), ''),
         case when jsonb_typeof(r.v -> 'custom_fields') = 'object' then r.v -> 'custom_fields' else '{}'::jsonb end
    from jsonb_array_elements(p_rows) with ordinality as r(v, ord);

  -- 1. invalid email
  update pg_temp.mp_import_rows set outcome = 'invalid_email'
   where email is null or char_length(email) > 320 or email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';

  -- 2. duplicate inside this batch (first wins)
  update pg_temp.mp_import_rows t set outcome = 'duplicate_in_file'
   where t.outcome is null
     and exists (select 1 from pg_temp.mp_import_rows o
                  where o.outcome is null and o.email = t.email and o.ord < t.ord);

  -- 3. existing contacts
  update pg_temp.mp_import_rows t set existing_id = c.id
    from public.contacts c
   where t.outcome is null and c.workspace_id = imp.workspace_id and c.email = t.email;

  -- 4. never create contacts for suppressed addresses
  update pg_temp.mp_import_rows t set outcome = 'suppressed'
   where t.outcome is null and t.existing_id is null
     and exists (select 1 from public.suppressions s
                  where s.workspace_id = imp.workspace_id and s.email = t.email);

  -- 5. contact quota
  select w.max_contacts into v_max from public.workspaces w where w.id = imp.workspace_id;
  select greatest(0, v_max - count(*))::integer into v_capacity
    from public.contacts c where c.workspace_id = imp.workspace_id;

  update pg_temp.mp_import_rows t set outcome = 'contact_limit'
   where t.ord in (
     select n.ord from pg_temp.mp_import_rows n
      where n.outcome is null and n.existing_id is null
      order by n.ord offset v_capacity
   );

  -- 6. update existing (names + custom fields; status untouched)
  with u as (
    update public.contacts c
       set first_name    = coalesce(t.first_name, c.first_name),
           last_name     = coalesce(t.last_name, c.last_name),
           custom_fields = c.custom_fields || t.custom_fields
      from pg_temp.mp_import_rows t
     where t.outcome is null and t.existing_id = c.id
    returning c.id
  )
  select count(*) into v_updated from u;
  update pg_temp.mp_import_rows set outcome = 'updated', contact_id = existing_id
   where outcome is null and existing_id is not null;

  -- 7. insert new
  with ins as (
    insert into public.contacts (workspace_id, email, first_name, last_name, custom_fields,
                                 status, source, consent_at, consent_source)
    select imp.workspace_id, t.email, t.first_name, t.last_name, t.custom_fields,
           v_status, 'csv_import',
           case when v_status = 'subscribed' then now() end,
           imp.consent_source
      from pg_temp.mp_import_rows t
     where t.outcome is null and t.existing_id is null
     order by t.ord
    on conflict (workspace_id, email) do nothing
    returning id, email
  )
  update pg_temp.mp_import_rows t set outcome = 'inserted', contact_id = ins.id
    from ins where t.email = ins.email and t.outcome is null;
  get diagnostics v_inserted = row_count;

  -- rows that lost a race with a concurrent insert
  update pg_temp.mp_import_rows set outcome = 'conflict' where outcome is null;

  -- 8. list membership
  if imp.list_id is not null then
    insert into public.contact_list_members (list_id, contact_id, workspace_id)
    select imp.list_id, t.contact_id, imp.workspace_id
      from pg_temp.mp_import_rows t
     where t.contact_id is not null
    on conflict do nothing;
  end if;

  select count(*) into v_skipped from pg_temp.mp_import_rows
   where outcome not in ('inserted', 'updated');

  select coalesce(jsonb_agg(jsonb_build_object('row', ord, 'email', left(email, 320), 'reason', outcome) order by ord), '[]'::jsonb)
    into v_errors
    from (select ord, email, outcome from pg_temp.mp_import_rows
           where outcome not in ('inserted', 'updated') order by ord limit 200) e;

  update public.csv_imports
     set inserted_rows = inserted_rows + v_inserted,
         updated_rows  = updated_rows + v_updated,
         skipped_rows  = skipped_rows + v_skipped,
         errors = case when jsonb_array_length(errors) >= 200 then errors
                       else (errors || v_errors) end
   where id = imp.id;

  if v_inserted > 0 then
    perform public.increment_usage(imp.workspace_id, 'contacts_imported', v_inserted);
  end if;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped);
end $$;

-- ---------------------------------------------------------------------
-- finish_contact_import
-- ---------------------------------------------------------------------
create or replace function public.finish_contact_import(p_import_id uuid, p_error text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from public.csv_imports where id = p_import_id;
  if v_ws is null or not private.is_member(v_ws) then
    raise exception 'import_not_found' using errcode = '42501';
  end if;
  update public.csv_imports
     set status = case when p_error is null then 'completed'::public.import_status else 'failed'::public.import_status end,
         completed_at = now(),
         errors = case when p_error is null then errors
                       else errors || jsonb_build_array(jsonb_build_object('reason', left(p_error, 500))) end
   where id = p_import_id and status = 'processing';
end $$;

revoke all on function public.start_contact_import(uuid, text, integer, jsonb, uuid, text) from public, anon;
revoke all on function public.import_contacts_batch(uuid, jsonb) from public, anon;
revoke all on function public.finish_contact_import(uuid, text) from public, anon;
grant execute on function public.start_contact_import(uuid, text, integer, jsonb, uuid, text) to authenticated;
grant execute on function public.import_contacts_batch(uuid, jsonb) to authenticated;
grant execute on function public.finish_contact_import(uuid, text) to authenticated;
