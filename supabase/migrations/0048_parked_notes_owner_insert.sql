-- Fix (not deployed): POST /checkin/:person/notes inserts into parked_notes with the caller's own session, but 0020 gave
-- the table read, update and delete policies only, so parking a note failed with
-- 'new row violates row-level security policy for table parked_notes' (hosted v61 probe as namitest, ref B9XJ).
-- The writer may insert their own rows; nobody can park a note as another writer.
create policy parked_notes_writer_insert on public.parked_notes for insert with check (auth.uid() = writer);

-- rollback: drop policy parked_notes_writer_insert on public.parked_notes;
