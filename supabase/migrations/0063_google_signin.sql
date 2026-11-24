-- Google sign-in (d-ceo-cdo-coo-google-signin-14nov, CPO-S-1). Additive. STAGING ONLY until Nami's yes.
-- (1) auth_provider accepts 'google'. (2) google_refresh_token_enc: our Google grant, application-layer encrypted
-- (next/api/lib/apple_auth.ts encryptAppleToken, keyed per project) so DELETE /account can revoke it at Google; the
-- route clears it before delete_account runs. (3) scrub_google_profile: we keep only the email. The Google iOS SDK
-- always asks for basic profile, and Supabase Auth copies the ID token's name and photo claims into
-- auth.users.raw_user_meta_data and auth.identities.identity_data on every sign-in; POST /auth/google calls this right
-- after each sign-in and fails closed if it errors. Service role only. plpgsql so the body is checked when called, not
-- when created (local test databases have a bare auth.users).
-- Rollback: drop function if exists public.scrub_google_profile(uuid);
--   alter table public.profiles drop column if exists google_refresh_token_enc;
--   alter table public.profiles drop constraint if exists profiles_auth_provider_check;
--   alter table public.profiles add constraint profiles_auth_provider_check check (auth_provider in ('apple', 'preview', 'legacy'));
--   (the last line fails while a 'google' profile exists: delete those test accounts first).

alter table public.profiles drop constraint if exists profiles_auth_provider_check;
alter table public.profiles add constraint profiles_auth_provider_check
  check (auth_provider in ('apple', 'google', 'preview', 'legacy'));

alter table public.profiles add column if not exists google_refresh_token_enc text;

create or replace function public.scrub_google_profile(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update auth.users
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
       - array['name', 'full_name', 'given_name', 'family_name', 'nickname', 'preferred_username', 'picture', 'avatar_url', 'locale']
   where id = p_user;
  update auth.identities
     set identity_data = coalesce(identity_data, '{}'::jsonb)
       - array['name', 'full_name', 'given_name', 'family_name', 'nickname', 'preferred_username', 'picture', 'avatar_url', 'locale']
   where user_id = p_user and provider = 'google';
end;
$$;

revoke all on function public.scrub_google_profile(uuid) from public, anon, authenticated;
grant execute on function public.scrub_google_profile(uuid) to service_role;
