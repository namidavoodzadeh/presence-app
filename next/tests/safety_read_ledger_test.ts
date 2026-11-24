// QA-B336 (COO 03:20Z 16 Nov, Q-ENG-B336-FAILCLOSED-1 (3)): safety reads do not count against the person's allowance, are written
// under their own ledger kind, and one global daily ceiling bounds them (fails closed). Real Postgres in process (PGlite, $0):
// 0001's ledger section, 0032, 0033, 0068 (the credit cycle), then 0073 (re-based on 0068).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { PostgresLedger, resetSwitchCache } from "../api/lib/ledger.ts";
import { SAFETY_LEDGER_KIND, SAFETY_PURPOSE } from "../engine/model/ledger.ts";
import { SEMANTIC_PURPOSE } from "../engine/safety_semantic.ts";
import { AnthropicClient } from "../engine/model/client.ts";

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);
const read = (f: string) => Deno.readTextFile(new URL(f, MIGRATIONS));
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

async function db(through = "0073_safety_read_ledger.sql"): Promise<PGlite> {
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
  await pg.exec(await read("0068_ai_credit_cycle.sql"));
  if (through) await pg.exec(await read(through));
  return pg;
}

type J = Record<string, unknown>;
async function reserve(pg: PGlite, kind: string, person: string | null, cents: number, preview = false): Promise<J> {
  const r = await pg.query<{ r: J }>("select public.ledger_reserve($1, $2, $3, $4) as r", [kind, person, cents * 10_000, preview]);
  return r.rows[0].r;
}

Deno.test("0073: a person at their 300¢ allowance is still read; their next Talk call is refused", async () => {
  const pg = await db();
  assertEquals((await reserve(pg, "next-engine", A, 300)).ok, true);
  const talk = await reserve(pg, "next-engine", A, 1);
  assertEquals([talk.ok, talk.error, talk.scope], [false, "daily_limit", "person"]);
  const safety = await reserve(pg, SAFETY_LEDGER_KIND, A, 1);
  assertEquals(safety.ok, true, "the at-cap person is still read");
  assertEquals((await reserve(pg, SAFETY_LEDGER_KIND, A, 1)).ok, true);
  await pg.close();
});

Deno.test("0073: safety reads do not use up the person's allowance or the shared day cap", async () => {
  const pg = await db();
  for (let i = 0; i < 100; i++) assertEquals((await reserve(pg, SAFETY_LEDGER_KIND, A, 2)).ok, true);
  assertEquals((await reserve(pg, "next-engine", A, 300)).ok, true, "A's whole allowance is still there after 200¢ of reads");
  await pg.query(`insert into usage_ledger (utc_day, kind, reserved_micros, spent_micros) values ((now() at time zone 'utc')::date,'bridge_run',$1,$1)`, [2950 * 10_000]);
  const shared = await reserve(pg, "next-engine", B, 100);
  assertEquals([shared.ok, shared.scope], [false, "shared"]);
  assertEquals((await reserve(pg, SAFETY_LEDGER_KIND, B, 1)).ok, true, "a full shared day does not stop a safety read");
  await pg.close();
});

Deno.test("0073: the global safety ceiling (300¢ a UTC day) refuses with safety_ceiling; other work is untouched; the next day is open", async () => {
  const pg = await db();
  await pg.query(`insert into usage_ledger (utc_day, kind, person, reserved_micros, spent_micros) values ((now() at time zone 'utc')::date,'safety_read',$1,$2,$2)`, [A, 299 * 10_000]);
  assertEquals((await reserve(pg, SAFETY_LEDGER_KIND, B, 1)).ok, true, "exactly at the ceiling is admitted");
  const over = await reserve(pg, SAFETY_LEDGER_KIND, B, 1);
  assertEquals([over.ok, over.error, over.scope, over.day_cap_micros], [false, "safety_ceiling", "safety", 300 * 10_000]);
  assertEquals((await reserve(pg, "next-engine", B, 250)).ok, true, "the ceiling is not the person's allowance");
  await pg.query(`delete from usage_ledger where utc_day = (now() at time zone 'utc')::date and kind = 'safety_read'`);
  await pg.query(`insert into usage_ledger (utc_day, kind, person, reserved_micros, spent_micros) values ('2020-01-01','safety_read',$1,$2,$2)`, [A, 300 * 10_000]);
  assertEquals((await reserve(pg, SAFETY_LEDGER_KIND, B, 1)).ok, true, "yesterday's reads do not count");
  await pg.close();
});

Deno.test("0073: the credit cycle's 19,000¢ cap (0068) still applies to a safety read (credits only: it fails closed)", async () => {
  const pg = await db();
  // An eval row today counts in the cycle (one pool) and not in the shared day sum, so only the cycle cap is in play.
  await pg.query(`insert into usage_ledger (utc_day, kind, reserved_micros, spent_micros) values ((now() at time zone 'utc')::date,'eval:old',$1,$1)`, [18_999 * 10_000]);
  assertEquals((await reserve(pg, SAFETY_LEDGER_KIND, A, 1)).ok, true);
  const r = await reserve(pg, SAFETY_LEDGER_KIND, A, 1);
  assertEquals([r.ok, r.error], [false, "month_limit"]);
  await pg.close();
});

Deno.test("0073: everything that is not a safety read behaves as in 0068 (person, shared, eval, preview)", async () => {
  const pg = await db();
  assertEquals((await reserve(pg, "talk_turn", A, 290)).ok, true);
  assertEquals((await reserve(pg, "talk_turn", A, 20)).ok, false);
  assertEquals((await reserve(pg, "talk_turn", B, 790, true)).ok, true);
  assertEquals((await reserve(pg, "talk_turn", B, 20, true)).ok, false);
  assertEquals((await reserve(pg, "eval:harness", null, 900)).ok, true);
  assertEquals((await reserve(pg, "eval:harness", null, 200)).ok, false);
  await pg.close();
});

Deno.test("0073: snapshot keeps safety reads out of today_cents and reports them and the ceiling", async () => {
  const pg = await db();
  await reserve(pg, "next-engine", A, 10);
  await reserve(pg, SAFETY_LEDGER_KIND, A, 7);
  const s = (await pg.query<{ s: J }>("select public.ledger_snapshot() as s")).rows[0].s;
  assertEquals([s.today_cents, s.safety_today_cents, s.safety_daily_ceiling_cents, s.person_daily_allowance_cents], [10, 7, 300, 300]);
  await pg.close();
});

Deno.test("0073 rollback: 0068's two functions put the old behaviour back (a safety_read row is then an ordinary row)", async () => {
  const pg = await db();
  await pg.exec(await read("0068_ai_credit_cycle.sql"));
  assertEquals((await reserve(pg, SAFETY_LEDGER_KIND, A, 300)).ok, true);
  assertEquals((await reserve(pg, "next-engine", A, 1)).ok, false);
  await pg.close();
});

// ---- the TypeScript side: which kind a call is written under, and no feature kill switch on a safety read.
Deno.test("the model client writes a safety reading under safety_read and everything else under next-engine", async () => {
  assertEquals(SEMANTIC_PURPOSE, SAFETY_PURPOSE);
  const kinds: string[] = [];
  const ledger = { reserve: (_n: string, kind: string) => { kinds.push(kind); return Promise.resolve({ ok: false, error: "x" }); }, settle: () => Promise.resolve() };
  const client = new AnthropicClient({ config: { key: "k", workspace: "w" }, ledger, fetchImpl: () => Promise.reject(new Error("no network")) });
  const base = { system: "s", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 10 };
  await client.complete({ ...base, purpose: SAFETY_PURPOSE });
  await client.complete({ ...base, purpose: "turn" });
  assertEquals(kinds, ["safety_read", "next-engine"]);
});

Deno.test("a safety read is neither refused by a switched-off feature nor renamed by a kind override", async () => {
  resetSwitchCache();
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const fake = {
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [{ feature: "talk" }, { feature: "bridge" }, { feature: "import" }], error: null }) }) }),
    rpc: (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return Promise.resolve({ data: { ok: true, id: "L1" }, error: null }); },
  };
  // deno-lint-ignore no-explicit-any
  const ledger = new PostgresLedger(fake as any, { person: "p", ownerPreview: false, feature: "talk" }, "import_ai");
  assertEquals((await ledger.reserve("n1", "next-engine", 5)).ok, false, "an ordinary talk call is refused by the switch");
  assertEquals((await ledger.reserve("n2", SAFETY_LEDGER_KIND, 1)).ok, true, "a safety read is not");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].args.p_kind, SAFETY_LEDGER_KIND, "the import override does not rename it");
});
