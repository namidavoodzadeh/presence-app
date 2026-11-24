// System design item 5: migration 0033 gives each person a 300¢ UTC-day allowance and drops the single global ledger lock.
// Proved on a real Postgres in process (PGlite, $0): 0001's ledger section, 0032, then 0033.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);
const read = (f: string) => Deno.readTextFile(new URL(f, MIGRATIONS));
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

async function db(): Promise<PGlite> {
  const all = await read("0001_app_v1.sql");
  const from = all.indexOf("-- ---------------------------------------------------------------- ledger, errors");
  const to = all.indexOf("-- ---------------------------------------------------------------- the receiver read function");
  assert(from > 0 && to > from, "0001's ledger section moved");
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated;
    create table public.profiles (id uuid primary key);
    insert into public.profiles values ('${A}'), ('${B}');
    create function public.new_ref() returns text language sql as $$ select md5(random()::text) $$;`);
  await pg.exec(all.slice(from, to));
  await pg.exec(await read("0032_eval_spend_cap.sql"));
  await pg.exec(await read("0033_person_daily_allowance.sql"));
  return pg;
}

type J = Record<string, unknown>;
async function reserve(pg: PGlite, kind: string, person: string | null, cents: number, preview = false): Promise<J> {
  const r = await pg.query<{ r: J }>("select public.ledger_reserve($1, $2, $3, $4) as r", [kind, person, cents * 10_000, preview]);
  return r.rows[0].r;
}

Deno.test("0033: one person stops at 300¢ a day with scope person; another person is untouched", async () => {
  const pg = await db();
  assertEquals((await reserve(pg, "talk_turn", A, 290)).ok, true);
  const over = await reserve(pg, "talk_turn", A, 20);
  assertEquals([over.ok, over.error, over.scope, over.day_cap_micros], [false, "daily_limit", "person", 300 * 10_000]);
  assert(String(over.opens_at).length > 0);
  assertEquals((await reserve(pg, "talk_turn", A, 10)).ok, true, "exactly at the allowance is admitted");
  assertEquals((await reserve(pg, "talk_turn", B, 250)).ok, true, "B has their own allowance");
  await pg.close();
});

Deno.test("0033: the owner's preview account keeps its +500¢; person-less and eval rows have no personal allowance", async () => {
  const pg = await db();
  assertEquals((await reserve(pg, "talk_turn", A, 790, true)).ok, true);
  assertEquals((await reserve(pg, "talk_turn", A, 20, true)).ok, false);
  assertEquals((await reserve(pg, "bridge_run", null, 900)).ok, true, "no person, no allowance");
  assertEquals((await reserve(pg, "eval:harness", null, 900)).ok, true);
  await pg.close();
});

Deno.test("0033: settled spend counts, so a cheap settle frees allowance; yesterday does not count", async () => {
  const pg = await db();
  await pg.query(`insert into usage_ledger (utc_day, kind, person, reserved_micros, spent_micros) values ('2020-01-01','talk_turn',$1,$2,$2)`, [A, 300 * 10_000]);
  const r = await reserve(pg, "talk_turn", A, 100);
  assertEquals(r.ok, true);
  await pg.query("select public.ledger_settle($1, $2, 'm', null)", [r.id, 10 * 10_000]);
  assertEquals((await reserve(pg, "talk_turn", A, 290)).ok, true);
  assertEquals((await reserve(pg, "talk_turn", A, 1)).ok, false);
  await pg.close();
});

Deno.test("0033: the 3,000¢ shared day cap still stops everyone as a safety net", async () => {
  const pg = await db();
  await pg.query(`insert into usage_ledger (utc_day, kind, reserved_micros, spent_micros) values ((now() at time zone 'utc')::date,'bridge_run',$1,$1)`, [2995 * 10_000]);
  const r = await reserve(pg, "talk_turn", B, 10);
  assertEquals([r.ok, r.error, r.scope], [false, "daily_limit", "shared"]);
  await pg.close();
});

Deno.test("0033: no global lock: reserve takes a per-person advisory lock, not 7742", async () => {
  const src = await read("0033_person_daily_allowance.sql");
  assert(!/pg_advisory_xact_lock\(7742\)/.test(src));
  assert(/pg_advisory_xact_lock\(hashtextextended\(coalesce\(p_person::text/.test(src));
});

Deno.test("0033: snapshot reports the allowance", async () => {
  const pg = await db();
  const s = (await pg.query<{ s: J }>("select public.ledger_snapshot() as s")).rows[0].s;
  assertEquals(s.person_daily_allowance_cents, 300);
  await pg.close();
});
