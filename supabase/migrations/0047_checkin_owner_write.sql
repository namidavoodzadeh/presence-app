-- Fix (not deployed): PUT /checkin/:person/schedule writes check_ins and check_in_dates with the caller's own session,
-- but 0035 and 0042 gave those tables read and delete policies only, so every first write failed with
-- 'new row violates row-level security policy for table check_ins' (hosted v59, 5 times 23:39-00:05Z 9-10 Nov).
-- The owner may insert and update their own rows. Nobody can write a row for another owner.
create policy check_ins_owner_insert on public.check_ins for insert with check (auth.uid() = owner);
create policy check_ins_owner_update on public.check_ins for update using (auth.uid() = owner) with check (auth.uid() = owner);
create policy check_in_dates_owner_insert on public.check_in_dates for insert with check (auth.uid() = owner);
create policy check_in_dates_owner_update on public.check_in_dates for update using (auth.uid() = owner) with check (auth.uid() = owner);

-- rollback: drop policy check_ins_owner_insert on public.check_ins; drop policy check_ins_owner_update on public.check_ins;
--   drop policy check_in_dates_owner_insert on public.check_in_dates; drop policy check_in_dates_owner_update on public.check_in_dates;
