// TL-1 seam (COO 18:20Z 15 Nov, app's Q-APP-TL1-1): the staging-only list that makes ledger_reserve refuse one fictional account with
// total_limit. $0, PGlite: 0001's ledger section, 0032, then the exact SQL `staging_ai.py cap` sends to staging (`print-sql`).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);
const read = (f: string) => Deno.readTextFile(new URL(f, MIGRATIONS));
type J = Record<string, unknown>;
const A = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const B = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";

async function stagingSql(day = 300, safety = false): Promise<string> {
  const out = await new Deno.Command("python3", { args: ["-I", new URL("../scripts/staging_ai.py", import.meta.url).pathname, "print-sql", String(day), ...(safety ? ["--safety"] : [])], stdout: "piped", stderr: "piped" }).output();
  assertEquals(out.code, 0, new TextDecoder().decode(out.stderr));
  return new TextDecoder().decode(out.stdout);
}
async function db(day = 300, safety = false): Promise<PGlite> {
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
  if (safety) await pg.exec(await read("0068_ai_credit_cycle.sql"));   // 0073 is the functions only: the budget table and cycle function come from 0068, as on staging
  await pg.exec(await stagingSql(day, safety));
  await pg.query("insert into public.profiles (id) values ($1), ($2)", [A, B]);
  return pg;
}
const reserve = async (pg: PGlite, kind: string, person: string | null): Promise<J> =>
  (await pg.query<{ r: J }>("select public.ledger_reserve($1, $2, 1000, false) as r", [kind, person])).rows[0].r;

Deno.test("seam: a listed account gets total_limit, everyone else is untouched, off clears it", async () => {
  const pg = await db();
  assertEquals((await reserve(pg, "talk_turn", A)).ok, true, "empty list: nothing refused");
  await pg.query("insert into public.staging_total_limit_accounts (person) values ($1)", [A]);
  const r = await reserve(pg, "talk_turn", A);
  assertEquals([r.ok, r.error], [false, "total_limit"]);
  assertEquals((await reserve(pg, "talk_turn", B)).ok, true, "another account is admitted");
  assertEquals((await reserve(pg, "talk_turn", null)).ok, true, "a person-less row is admitted");
  assertEquals((await reserve(pg, "eval:talk", A)).ok, true, "an eval is never refused by the seam");
  await pg.query("delete from public.staging_total_limit_accounts");
  assertEquals((await reserve(pg, "talk_turn", A)).ok, true, "off: admitted again");
  await pg.close();
});

Deno.test("person extra: one test account gets more than 300 cents a day, everyone else keeps 300, clearing the row restores it", async () => {
  const pg = await db(700);                     // the shared day cap lifted to 700, as for a harness run: only the person's own cap is under test
  await pg.query("insert into public.usage_ledger (kind, person, reserved_micros) values ('talk_turn', $1, $2)", [A, 290 * 10000]);   // A has used 290 of 300 today
  assertEquals((await reserve(pg, "talk_turn", A)).ok, true, "290 + 0.1 is within 300");
  await pg.query("delete from public.usage_ledger where person = $1", [A]);       // the admitted call above wrote its own row
  await pg.query("insert into public.usage_ledger (kind, person, reserved_micros) values ('talk_turn', $1, $2)", [A, 350 * 10000]);   // 350: over 300
  const refused = await reserve(pg, "talk_turn", A);
  assertEquals([refused.ok, refused.scope], [false, "person"]);
  await pg.query("insert into public.staging_person_extra (person, extra_cents) values ($1, 150)", [A]);
  assertEquals((await reserve(pg, "talk_turn", A)).ok, true, "350 of 450: admitted with the extra");
  assertEquals((await reserve(pg, "talk_turn", B)).ok, true, "B has no extra row and is untouched");
  await pg.query("delete from public.staging_person_extra");
  assertEquals((await reserve(pg, "talk_turn", A)).ok, false, "row cleared: 300 again");
  await pg.close();
});

Deno.test("seam: the refusal reaches the phone as 429 daily_limit with limit total_limit (ledger.ts refusalError)", async () => {
  const src = await Deno.readTextFile(new URL("../api/lib/ledger.ts", import.meta.url));
  assert(src.includes('r.error === "daily_limit" || r.error === "total_limit"') && src.includes("limit: r.error"));
});

Deno.test("seam: no migration carries the table (hosted never has it)", async () => {
  for await (const f of Deno.readDir(MIGRATIONS)) {
    const t = await read(f.name);
    assert(!t.includes("staging_total_limit_accounts") && !t.includes("staging_person_extra"), f.name);
  }
});

Deno.test("print-sql --safety (0073 build): a safety read is admitted for an account at its allowance, the person extra and the seam still work, the lift still lifts", async () => {
  const pg = await db(700, true);
  await pg.query("insert into public.usage_ledger (kind, person, reserved_micros) values ('talk_turn', $1, $2)", [A, 350 * 10000]);   // over 300
  assertEquals((await reserve(pg, "talk_turn", A)).scope, "person");
  assertEquals((await reserve(pg, "safety_read", A)).ok, true, "a safety read is not counted against the allowance");
  await pg.query("insert into public.staging_person_extra (person, extra_cents) values ($1, 150)", [A]);
  assertEquals((await reserve(pg, "talk_turn", A)).ok, true, "the extra still applies to the account's own calls");
  await pg.query("insert into public.staging_total_limit_accounts (person) values ($1)", [B]);
  assertEquals((await reserve(pg, "talk_turn", B)).error, "total_limit", "the seam still refuses a listed account");
  const snap = (await pg.query<{ s: J }>("select public.ledger_snapshot() as s")).rows[0].s;
  assertEquals([snap.daily_cap_cents, snap.safety_daily_ceiling_cents, snap.person_daily_allowance_cents], [700, 300, 300]);
  await pg.close();
});
