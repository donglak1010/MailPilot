-- =====================================================================
-- LOCAL DEVELOPMENT SEED ONLY — applied by `supabase db reset` locally.
-- Never run against the hosted project.
--
-- Dev login (local stack only):
--   email:    dev@mailpilot.test
--   password: mailpilot-dev-123
--
-- Throwaway account used when testing the signup UI locally (not seeded):
--   email:    signup-test@mailpilot.test
--   password: signup-test-456   (changed to signup-test-789 by the reset-password test)
-- =====================================================================

do $$
declare
  v_user_id uuid := '00000000-0000-4000-8000-00000000d001';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
    'dev@mailpilot.test', extensions.crypt('mailpilot-dev-123', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"full_name":"Dev User"}', now(), now(),
    '', '', '', '', '', '', '', ''
  ) on conflict (id) do nothing;

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_user_id, v_user_id::text, 'email',
          jsonb_build_object('sub', v_user_id::text, 'email', 'dev@mailpilot.test', 'email_verified', true),
          now(), now(), now())
  on conflict do nothing;

  -- give the dev workspace a postal address and a few consented contacts
  update public.workspaces
     set postal_address = '123 Example Street, District 1, Ho Chi Minh City, Vietnam',
         timezone = 'Asia/Ho_Chi_Minh'
   where owner_id = v_user_id;

  insert into public.contacts (workspace_id, email, first_name, status, source, consent_at, consent_source)
  select w.id, c.email, c.first_name, 'subscribed', 'seed', now(), 'local dev seed'
    from public.workspaces w
   cross join (values ('alice@example.com', 'Alice'), ('bao@example.com', 'Bao'), ('chi@example.com', 'Chi')) as c(email, first_name)
   where w.owner_id = v_user_id
  on conflict (workspace_id, email) do nothing;
end $$;

-- Send worker wiring for the local stack (see 0004_campaign_sending.sql).
-- The secret is a fixed local-only value; supabase/functions/.env must use the same
-- INTERNAL_WORKER_SECRET. The hosted project uses its own random secret.
select vault.create_secret('http://supabase_kong_MailPilot:8000/functions/v1', 'mp_functions_url');
select vault.create_secret('local-dev-only-worker-secret-not-for-production-use', 'mp_worker_secret');
