// Migration 0068: the AI credit cycle (CEO 15 Nov: keep it to the $200 credit). $0, PGlite: 0001's ledger section, 0032, 0033, 0067, 0068.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);
const read = (f: string) => Deno.readTextFile(new URL(f, MIGRATIONS));
type J = Record<string, unknown>;

async function db(opts: { with0067?: boolean } = {}): Promise<PGlite> {
  const all = await read("0001_app_v1.sql");
  const from = all.indexOf("-- ---------------------------------------------------------------- ledger, errors");
  const to = all.indexOf("-- ---------------------------------------------------------------- the receiver read function");
  assert(from > 0 && to > from, "0001's ledger section moved");
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated;
    create table public.profiles (id uuid primary key);
    create function public.new_ref() returns text language sql as $$ select md5(random()::text) $$;`);
  await pg.exec(all.slice(from, to));
  await pg.exec(await read("0032_eval_spend_cap.sql"));
  await pg.exec(await read("0033_person_daily_allowance.sql"));
  if (opts.with0067) await pg.exec(await read("0067_monthly_ai_budget.sql"));
  await pg.exec(await read("0068_ai_credit_cycle.sql"));
  return pg;
}
const reserve = async (pg: PGlite, kind: string, micros: number): Promise<J> =>
  (await pg.query<{ r: J }>("select public.ledger_reserve($1, null, $2, false) as r", [kind, micros])).rows[0].r;
const seed = (pg: PGlite, kind: string, micros: number, day = "public.ai_cycle_start()") =>
  pg.query(`insert into usage_ledger (utc_day, kind, reserved_micros, spent_micros) values (${day}, $1, $2, $2)`, [kind, micros]);
const snap = async (pg: PGlite): Promise<J> => (await pg.query<{ s: J }>("select public.ledger_snapshot() as s")).rows[0].s;
const start = async (pg: PGlite, today: string): Promise<string> =>
  (await pg.query<{ d: string }>("select to_char(public.ai_cycle_start($1::date), 'YYYY-MM-DD') as d", [today])).rows[0].d;
const C = 10_000; // micros per cent

Deno.test("0068: the cycle starts on the 25th: the 24th belongs to last month's cycle, the 25th opens a new one, year ends roll back", async () => {
  const pg = await db();
  assertEquals(await start(pg, "2026-11-24"), "2026-10-25");
  assertEquals(await start(pg, "2026-11-25"), "2026-11-25");
  assertEquals(await start(pg, "2026-11-30"), "2026-11-25");
  assertEquals(await start(pg, "2026-12-01"), "2026-11-25");
  assertEquals(await start(pg, "2027-01-10"), "2026-12-25");
  assertEquals(await start(pg, "2027-01-25"), "2027-01-25");
  assertEquals(await start(pg, "2027-03-01"), "2027-02-25");           // February has no 29th to trip on: reset_day is capped at 28
  await pg.query("update ai_budget set reset_day = 1");
  assertEquals(await start(pg, "2026-11-15"), "2026-11-01");           // the day is a setting: day 1 is the old calendar month
  await pg.close();
});

Deno.test("0068: default cap is 19,000 cents real, it also works on top of 0067, and exactly at the cap is admitted", async () => {
  for (const with0067 of [false, true]) {
    const pg = await db({ with0067 });
    const row = (await pg.query<J>("select monthly_cap_cents, reset_day, warn_pct_1, warn_pct_2, warn_pct_3 from ai_budget")).rows[0];
    assertEquals([row.monthly_cap_cents, row.reset_day, row.warn_pct_1, row.warn_pct_2, row.warn_pct_3], [19000, 25, 50, 80, 95]);
    await pg.query("update ai_budget set monthly_cap_cents = 100");
    await seed(pg, "talk_turn", 90 * C);
    assertEquals((await reserve(pg, "talk_turn", 10 * C)).ok, true);
    const over = await reserve(pg, "talk_turn", 1);
    assertEquals([over.ok, over.error], [false, "month_limit"]);
    await pg.close();
  }
});

Deno.test("0068: refusal opens on the next 25th at 00:00 UTC; the whole cycle counts, earlier cycles do not", async () => {
  const pg = await db();
  await pg.query("update ai_budget set monthly_cap_cents = 100");
  await seed(pg, "talk_turn", 500 * C, "public.ai_cycle_start() - 1");  // the day before the cycle: last cycle's spend
  assertEquals((await reserve(pg, "talk_turn", 5 * C)).ok, true, "last cycle's spend is not this cycle's");
  await seed(pg, "talk_turn", 95 * C);
  const over = await reserve(pg, "talk_turn", 1);
  assertEquals(over.error, "month_limit");
  const next = (await pg.query<{ d: string }>("select to_char((public.ai_cycle_start() + interval '1 month')::date, 'YYYY-MM-DD') as d")).rows[0].d;
  assertEquals(new Date(String(over.opens_at)).toISOString().slice(0, 10), next);
  assertEquals(new Date(String(over.opens_at)).toISOString().slice(11, 19), "00:00:00");
  assert(next.endsWith("-25"), `opens on a 25th: ${next}`);
  await pg.close();
});

Deno.test("0068: evals draw on the same credit: they count in the cycle and are refused when it is spent", async () => {
  const pg = await db();
  await pg.query("update ai_budget set monthly_cap_cents = 100");
  await seed(pg, "eval:harness", 90 * C);
  assertEquals((await reserve(pg, "talk_turn", 11 * C)).error, "month_limit", "live use sees the evals' spend");
  assertEquals((await reserve(pg, "eval:bridge_run", 11 * C)).error, "month_limit", "an eval is refused at the cap too");
  assertEquals((await reserve(pg, "eval:bridge_run", 10 * C)).ok, true);
  await pg.close();
});

Deno.test("0068: a fraction of a cent is counted as a fraction (exact settling): 0.04-cent safety readings do not round up to 1", async () => {
  const pg = await db();
  await pg.query("update ai_budget set monthly_cap_cents = 100");
  const { rows } = await pg.query<{ id: string }>("insert into usage_ledger (utc_day, kind, reserved_micros) values (public.ai_cycle_start(), 'talk_safety', $1) returning id", [C]);
  await pg.query("select public.ledger_settle($1, $2, 'claude-haiku-5-5', null)", [rows[0].id, 400]);   // 0.04 cent
  const spent = (await pg.query<{ s: string }>("select spent_micros::text as s from usage_ledger where id = $1", [rows[0].id])).rows[0].s;
  assertEquals(spent, "400");
  for (let i = 0; i < 99; i++) await seed(pg, "talk_safety", 400);
  const s = await snap(pg);
  assertEquals(s.month_cents, 4, "100 readings of 0.04 cent are 4 cents, not 100");
  await pg.close();
});

Deno.test("0068: the snapshot levels are ok < 50 <= warn < 80 <= high < 95 <= critical, by exact micros, and it names the cycle", async () => {
  const pg = await db();
  await pg.query("update ai_budget set monthly_cap_cents = 200");
  const level = async () => (await snap(pg)).level;
  await seed(pg, "talk_turn", 99 * C);
  assertEquals(await level(), "ok");
  await seed(pg, "talk_turn", 1 * C);
  assertEquals(await level(), "warn");                                    // 100 of 200 = 50 per cent
  await seed(pg, "talk_turn", 59 * C);
  assertEquals(await level(), "warn");                                    // 159
  await seed(pg, "talk_turn", 1 * C);
  assertEquals(await level(), "high");                                    // 160 = 80 per cent
  await seed(pg, "talk_turn", 29 * C);
  assertEquals(await level(), "high");                                    // 189
  await seed(pg, "eval:harness", 1 * C);
  const s = await snap(pg);
  assertEquals([s.month_cents, s.month_eval_cents, s.level], [190, 1, "critical"]); // 190 = 95 per cent, evals included
  assertEquals([s.month_cap_cents, s.month_pct], [200, 95]);
  assertEquals([s.daily_cap_cents, s.person_daily_allowance_cents, s.eval_daily_cap_cents, s.total_cap_cents], [3000, 300, 1000, null]);
  const startDay = (await pg.query<{ d: string }>("select to_char(public.ai_cycle_start(), 'YYYY-MM-DD') as d")).rows[0].d;
  assertEquals(String(s.cycle_starts_at).slice(0, 10), startDay);
  assert(String(s.month_opens_at).slice(0, 10) > startDay);
  await pg.close();
});

Deno.test("0068: rollback to 0033's two functions restores the lifetime cap at once", async () => {
  const pg = await db();
  const all = await read("0033_person_daily_allowance.sql");
  await pg.exec(all);
  await pg.query("update ai_budget set monthly_cap_cents = 1");
  await seed(pg, "talk_turn", 50 * C);
  assertEquals((await reserve(pg, "talk_turn", 5 * C)).ok, true, "the monthly setting no longer stops anything");
  assertEquals((await snap(pg)).total_cap_cents, 20000);
  await pg.close();
});
