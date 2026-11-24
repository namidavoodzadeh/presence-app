-- System design item 7 (engine NEXT 4). Model traces (engine_calls) are kept for a limited time only. Talk traces are also written
-- without the person's words from the app side (placeholder of length and hash); this bounds every other purpose too.
-- purge_engine_calls(p_days) deletes rows older than p_days (default 30) and returns how many went. Service role only.
-- Scheduling it (pg_cron, daily) is a hosted step and waits for the owner's approval; nothing runs it until then.
-- Rollback: drop function public.purge_engine_calls(int).
create or replace function public.purge_engine_calls(p_days int default 30)
returns bigint language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  if p_days is null or p_days < 1 then raise exception 'p_days must be at least 1'; end if;
  delete from engine_calls where created_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.purge_engine_calls(int) from public, anon, authenticated;
