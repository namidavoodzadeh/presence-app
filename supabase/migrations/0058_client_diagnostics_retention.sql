-- 0037 follow-up (CPO ruling d, d-cpo-reports-redbutton-12nov): crash and hang reports (errors rows with source 'client' and code
-- client_crash / client_hang) are kept 90 days, then deleted. Nothing goes to a model. Account deletion already removes them
-- (delete_account, 0039: delete from errors where person = p_id), so they go with the account, not kept as anonymous data.
-- purge_client_diagnostics(p_days) returns how many rows went. Service role only. Scheduling it (pg_cron, daily) is a hosted step
-- and waits for Nami's yes with 0037.
-- Rollback: drop function public.purge_client_diagnostics(int);
create or replace function public.purge_client_diagnostics(p_days int default 90)
returns bigint language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  if p_days is null or p_days < 1 then raise exception 'p_days must be at least 1'; end if;
  delete from errors where source = 'client' and code in ('client_crash', 'client_hang')
    and created_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.purge_client_diagnostics(int) from public, anon, authenticated;
grant execute on function public.purge_client_diagnostics(int) to service_role;
