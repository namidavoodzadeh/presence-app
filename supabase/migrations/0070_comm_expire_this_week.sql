-- V3 communication model, spec 4.1: "This week" items are deleted at the end of their time, with no message (COMM-MODEL-DESIGN.md 1.7).
-- One statement, no text read or written, returns only the count. Run hourly by pg_cron or the supervisor; reads already treat an expired
-- item as gone (engine/comm.ts isExpired), so a late run leaks nothing. Receipts, links and grants go with the row through their on-delete-cascade keys.
-- Additive (one function), STAGING FIRST, service role only. Needs 0069.
create or replace function public.comm_expire_this_week(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.beliefs where comm_kind = 'this_week' and comm_expires_at is not null and comm_expires_at <= p_now;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.comm_expire_this_week(timestamptz) from public, anon, authenticated;
-- Rollback: drop function if exists public.comm_expire_this_week(timestamptz);
