// Q16 (a), CEO 13:15 PT 07 Nov: migration 0032 gives eval spend its own kind and a 1,000¢ daily cap, apart from the shared
// 3,000¢. Proved on a real Postgres in process (PGlite, $0, no network after the first fetch): 0001's ledger section, then 0032.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { EVAL_KIND } from "../api/lib/ledger.ts";

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);
const read = (f: string) => Deno.readTextFile(new URL(f, MIGRATIONS));

/** 0001's ledger section as written: usage_ledger, errors, ledger_reserve / settle / snapshot and their revokes. */
async function ledgerSection(): Promise<string> {
  const all = await read("0001_app_v1.sql");
  const from = all.indexOf("-- ---------------------------------------------------------------- ledger, errors");
  const to = all.indexOf("-- ---------------------------------------------------------------- the receiver read function");
  assert(from > 0 && to > from, "0001's ledger section moved");
  return all.slice(from, to);
}

async function db(with0032 = true): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated;
    create table public.profiles (id uuid primary key);
    create function public.new_ref() returns text language sql as $$ select md5(random()::text) $$;`);
  await pg.exec(await ledgerSection());
  if (with0032) await pg.exec(await read("0032_eval_spend_cap.sql"));
  return pg;
}

type J = Record<string, unknown>;
async function reserve(pg: PGlite, kind: string, cents: number, ownerPreview = false): Promise<J> {
  const r = await pg.query<{ r: J }>("select public.ledger_reserve($1, null, $2, $3) as r", [kind, cents * 10_000, ownerPreview]);
  return r.rows[0].r;
}
async function seed(pg: PGlite, kind: string, cents: number, day = "today"): Promise<void> {
  const at = day === "today" ? "(now() at time zone 'utc')::date" : `'${day}'::date`;
  await pg.query(`insert into usage_ledger (utc_day, kind, reserved_micros, spent_micros) values (${at}, $1, $2, $2)`, [kind, cents * 10_000]);
}

Deno.test("0032: eval spend never uses the shared cap: with 2,995¢ of live use today, the eval still has its own 1,000¢", async () => {
  const pg = await db();
  await seed(pg, "bridge_run", 2995);
  const r = await reserve(pg, EVAL_KIND.bridgeRun, 40);
  assertEquals(r.ok, true, JSON.stringify(r));
  assertEquals(r.day_cap_micros, 1000 * 10_000);
  // And live use is refused by its own cap, as before, not by the eval's.
  const live = await reserve(pg, "bridge_run", 10);
  assertEquals([live.ok, live.error, live.scope], [false, "daily_limit", "shared"]);
  await pg.close();
});

Deno.test("0032: eval spend stops at 1,000¢ a UTC day and never takes from the 2,000¢+ kept for live use", async () => {
  const pg = await db();
  await seed(pg, EVAL_KIND.harness, 600);
  await seed(pg, EVAL_KIND.bridgeRun, 380);
  await seed(pg, EVAL_KIND.bridgeRun, 900, "2020-01-01"); // another day does not count
  const over = await reserve(pg, EVAL_KIND.bridgeRun, 40);
  assertEquals([over.ok, over.error, over.scope, over.day_used_micros], [false, "daily_limit", "eval", 980 * 10_000]);
  assert(String(over.opens_at).length > 0);
  assertEquals((await reserve(pg, EVAL_KIND.bridgeRun, 20)).ok, true, "exactly at the cap is admitted");
  // 1,000¢ of eval spend leaves the whole shared 3,000¢ (and the owner's +500¢) for live use.
  assertEquals((await reserve(pg, "talk_turn", 2990)).ok, true);
  assertEquals((await reserve(pg, "talk_turn", 20)).ok, false);
  assertEquals((await reserve(pg, "talk_turn", 20, true)).ok, true, "the owner's preview +500¢ still applies to live use");
  await pg.close();
});

Deno.test("0032: the 20,000¢ total cap still counts every row, eval included", async () => {
  const pg = await db();
  await seed(pg, "seed:sqlite", 19_000, "2020-01-01");
  await seed(pg, EVAL_KIND.harness, 990, "2020-01-02");
  const r = await reserve(pg, "bridge_run", 20);
  assertEquals([r.ok, r.error], [false, "total_limit"]);
  await pg.close();
});

Deno.test("0032: the snapshot keeps today_cents for the shared cap and adds the eval's own day and cap", async () => {
  const pg = await db();
  await seed(pg, "bridge_run", 120);
  await seed(pg, EVAL_KIND.bridgeRun, 45);
  const s = (await pg.query<{ s: J }>("select public.ledger_snapshot() as s")).rows[0].s;
  assertEquals([s.today_cents, s.eval_today_cents, s.daily_cap_cents, s.eval_daily_cap_cents, s.total_cents], [120, 45, 3000, 1000, 165]);
  await pg.close();
});

Deno.test("before 0032 (and after its rollback) an eval: kind is only a label: it counts against the shared cap, as today", async () => {
  const pg = await db(false);
  await seed(pg, "bridge_run", 2995);
  const r = await reserve(pg, EVAL_KIND.bridgeRun, 40);
  assertEquals([r.ok, r.error], [false, "daily_limit"]);
  await pg.close();
});
