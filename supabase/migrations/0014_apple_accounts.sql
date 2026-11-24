-- Sign in with Apple real-account metadata. The Apple subject and credential stay in auth.users/auth.identities; Presence stores
-- only the provider class and the consent recorded by O02. Existing preview and test users keep their current behavior.

alter table public.profiles
  add column if not exists auth_provider text not null default 'legacy'
    check (auth_provider in ('apple', 'preview', 'legacy')),
  add column if not exists adult_confirmed_at timestamptz,
  add column if not exists terms_version text;

update public.profiles set auth_provider = 'preview' where is_preview and auth_provider = 'legacy';

-- A real account deletion keeps one anonymised profile tombstone so an already-opened bridge can still say "Deleted account",
-- but removes the Auth user and provider identity. Ordinary admin cleanup (throwaway tests, failed provisioning) still removes the
-- profile and lets its existing foreign keys cascade every product row.
alter table public.profiles drop constraint if exists profiles_id_fkey;

create or replace function public.cleanup_profile_after_auth_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.profiles where id = old.id and deleted_at is null;
  return old;
end $$;

drop trigger if exists presence_cleanup_profile_after_auth_delete on auth.users;
create trigger presence_cleanup_profile_after_auth_delete
after delete on auth.users for each row execute function public.cleanup_profile_after_auth_delete();
