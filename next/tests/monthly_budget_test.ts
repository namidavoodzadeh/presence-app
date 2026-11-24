// Migration 0067: a monthly AI budget in place of the lifetime cap (docs/ops/AI-BUDGET-PROPOSAL.md). $0, PGlite: 0001's ledger section, 0032, 0033, 0067.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);
const read = (f: string) => Deno.readTextFile(new URL(f, MIGRATIONS));
type J = Record<string, unknown>;

async function db(with0067 = true): Promise<PGlite> {
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
  if (with0067) await pg.exec(await read("0067_monthly_ai_budget.sql"));
  return pg;
}
const reserve = async (pg: PGlite, kind: string, cents: number): Promise<J> =>
  (await pg.query<{ r: J }>("select public.ledger_reserve($1, null, $2, false) as r", [kind, cents * 10_000])).rows[0].r;
// Rows at the first day of this UTC month: inside the month, and not today's day cap unless today is the 1st (the amounts here are small).
const seed = (pg: PGlite, kind: string, cents: number, day = "date_trunc('month', now() at time zone 'utc')::date") =>
  pg.query(`insert into usage_ledger (utc_day, kind, reserved_micros, spent_micros) values (${day}, $1, $2, $2)`, [kind, cents * 10_000]);
const snap = async (pg: PGlite): Promise<J> => (await pg.query<{ s: J }>("select public.ledger_snapshot() as s")).rows[0].s;
const setCap = (pg: PGlite, cents: number) => pg.query("update ai_budget set monthly_cap_cents = $1", [cents]);

Deno.test("0067: the month cap refuses with month_limit and opens on the 1st of next month; the amount is a setting", async () => {
  const pg = await db();
  await setCap(pg, 100);
  await seed(pg, "talk_turn", 90);
  assertEquals((await reserve(pg, "talk_turn", 10)).ok, true, "exactly at the cap is admitted");
  const over = await reserve(pg, "talk_turn", 1);
  assertEquals([over.ok, over.error], [false, "month_limit"]);
  assertEquals(over.month_cap_micros, 100 * 10_000);
  const first = (await pg.query<{ d: string }>("select to_char((date_trunc('month', now() at time zone 'utc') + interval '1 month'), 'YYYY-MM-DD') as d")).rows[0].d;
  assertEquals(new Date(String(over.opens_at)).toISOString().slice(0, 10), first);
  assertEquals(new Date(String(over.opens_at)).toISOString().slice(11, 19), "00:00:00");
  await setCap(pg, 500);                                                   // Nami's figure: one update, no deploy
  assertEquals((await reserve(pg, "talk_turn", 50)).ok, true);
  await pg.close();
});

Deno.test("0067: earlier months do not count (the lifetime total no longer stops anything) and eval spend is not part of the live month", async () => {
  const pg = await db();
  await seed(pg, "seed:sqlite", 19_900, "'2020-01-01'");
  assertEquals((await reserve(pg, "talk_turn", 20)).ok, true, "15,088¢ of history is not this month");
  await setCap(pg, 100);
  await seed(pg, "eval:harness", 600);
  assertEquals((await reserve(pg, "talk_turn", 10)).ok, true, "this month's evals are not live use");
  assertEquals((await reserve(pg, "eval:bridge_run", 5)).ok, true, "an eval is never stopped by the month cap, only by its own day cap");
  await pg.close();
});

Deno.test("0067: the snapshot keeps every old key and adds month_cents, month_cap_cents, month_pct, level and month_opens_at", async () => {
  const pg = await db();
  await setCap(pg, 200);
  await seed(pg, "talk_turn", 99);
  let s = await snap(pg);
  assertEquals([s.month_cents, s.month_cap_cents, s.level], [99, 200, "ok"]);
  assertEquals([s.total_cents, s.daily_cap_cents, s.person_daily_allowance_cents, s.eval_daily_cap_cents], [99, 3000, 300, 1000]);
  assertEquals(s.total_cap_cents, null);
  await seed(pg, "talk_turn", 1);
  s = await snap(pg);
  assertEquals([s.month_cents, s.month_pct, s.level], [100, 50, "warn"]);
  await seed(pg, "talk_turn", 59);
  assertEquals((await snap(pg)).level, "warn");                            // 159¢ of 200: 80% is 160¢
  await seed(pg, "talk_turn", 1);
  s = await snap(pg);
  assertEquals([s.month_cents, s.level], [160, "high"]);                   // exactly 80% is high
  await seed(pg, "eval:harness", 900);
  assertEquals((await snap(pg)).month_cents, 160, "evals stay out of the month figure");
  assertEquals((await snap(pg)).total_cents, 1060, "total_cents stays as information");
  assert(String(s.month_opens_at).length > 0);
  await pg.close();
});

Deno.test("0067: ai_budget is one row, closed to the app roles, and its warning levels are checked", async () => {
  const pg = await db();
  const row = (await pg.query<J>("select monthly_cap_cents, warn_pct_1, warn_pct_2 from ai_budget")).rows;
  assertEquals(row, [{ monthly_cap_cents: 20000, warn_pct_1: 50, warn_pct_2: 80 }]);
  await pg.query("insert into ai_budget (id) values (true) on conflict (id) do nothing");
  assertEquals((await pg.query("select 1 from ai_budget")).rows.length, 1);
  let refused = false;
  try { await pg.query("insert into ai_budget (id, monthly_cap_cents) values (false, 5)"); } catch { refused = true; }
  assert(refused, "a second row is refused");
  for (const q of ["update ai_budget set monthly_cap_cents = 0", "update ai_budget set warn_pct_1 = 90"]) {
    let bad = false; try { await pg.query(q); } catch { bad = true; }
    assert(bad, q);
  }
  for (const role of ["anon", "authenticated"]) {
    const r = await pg.query<{ p: boolean; f: boolean }>(
      `select has_table_privilege('${role}', 'public.ai_budget', 'select') as p,
              has_function_privilege('${role}', 'public.ledger_reserve(text, uuid, bigint, boolean)', 'execute') as f`);
    assertEquals([r.rows[0].p, r.rows[0].f], [false, false], role);
  }
  await pg.close();
});

Deno.test("0067 rollback: re-running 0033 brings the lifetime 20,000¢ cap back at once", async () => {
  const pg = await db();
  await seed(pg, "seed:sqlite", 19_990, "'2020-01-01'");
  assertEquals((await reserve(pg, "talk_turn", 5)).ok, true);
  await pg.exec(await read("0033_person_daily_allowance.sql"));
  const r = await reserve(pg, "talk_turn", 20);
  assertEquals([r.ok, r.error], [false, "total_limit"]);
  await pg.close();
});

Deno.test("0067: without the migration the lifetime cap is unchanged (control)", async () => {
  const pg = await db(false);
  await seed(pg, "seed:sqlite", 19_990, "'2020-01-01'");
  assertEquals((await reserve(pg, "talk_turn", 20)).error, "total_limit");
  await pg.close();
});

import { PostgresLedger } from "../api/lib/ledger.ts";
Deno.test("0067: a month_limit refusal reaches the app as daily_limit with the true opening day and opens_at; no '12:00 AM'", async () => {
  const db = { rpc: (fn: string) => Promise.resolve({ data: fn === "ledger_reserve" ? { ok: false, error: "month_limit", opens_at: "2026-12-01T00:00:00+00:00" } : null, error: null }),
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) };
  // deno-lint-ignore no-explicit-any
  const l = new PostgresLedger(db as any, { person: "p", ownerPreview: false });
  assertEquals((await l.reserve("n", "talk_turn", 5)).ok, false);
  const e = l.refusalError("talk");
  assertEquals([e.code, e.message, e.extra.opens_at, e.extra.limit], ["daily_limit", "Talk opens again on 1 December.", "2026-12-01T00:00:00.000Z", "month_limit"]);
  assert(!/12:00/.test(e.message));
});
