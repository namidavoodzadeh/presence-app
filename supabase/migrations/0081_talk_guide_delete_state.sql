-- Law 10: tombstoning an account must not leave its private guide topics on its profile.
-- Conversations (and guide_brief, guide_comfort and guide_steered_turns with them) are deleted by delete_account.
create or replace function public.clear_talk_guide_state_on_account_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    new.talk_guide_avoids := '[]'::jsonb;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_clear_talk_guide_state_on_account_delete on public.profiles;
create trigger profiles_clear_talk_guide_state_on_account_delete
  before update of deleted_at on public.profiles
  for each row execute function public.clear_talk_guide_state_on_account_delete();

-- Rollback: drop trigger if exists profiles_clear_talk_guide_state_on_account_delete on public.profiles;
-- drop function if exists public.clear_talk_guide_state_on_account_delete();
