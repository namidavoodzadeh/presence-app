// E24 (C) remainder (COO 2026-11-07 00:20 Tehran): `practice` is a distinct field from `is_example` on Person,
// backed by its own `profiles.is_practice` column (migration 0031), so the app can read it directly instead of
// inferring "this is a practice person" on the phone.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { personObject } from "../api/lib/objects.ts";

Deno.test("Person carries `practice` distinct from `is_example`: both can differ independently", () => {
  assertEquals(personObject({ id: "1", name: "Lea", is_example: true, is_practice: true }).practice, true);
  assertEquals(personObject({ id: "1", name: "Lea", is_example: true, is_practice: true }).is_example, true);
  // Jo: is_example, never practice (the QA pair's other half, never linked to the owner).
  assertEquals(personObject({ id: "2", name: "Jo", is_example: true, is_practice: false }).practice, false);
  assertEquals(personObject({ id: "2", name: "Jo", is_example: true, is_practice: false }).is_example, true);
  // A profile row from before migration 0031 (no is_practice column read): defaults to false, never throws.
  assertEquals(personObject({ id: "3", name: "Kai", is_example: false }).practice, false);
});

Deno.test("migration 0031 adds is_practice distinct from is_example, and backfills the owner's cast but not Jo", async () => {
  const migration = await Deno.readTextFile(
    new URL("../../supabase/migrations/0031_practice_label.sql", import.meta.url),
  );
  assert(migration.includes("add column if not exists is_practice boolean not null default false"));
  assert(migration.includes("is_example = true"));
  assert(migration.includes("persona != 'jo'"));
});
