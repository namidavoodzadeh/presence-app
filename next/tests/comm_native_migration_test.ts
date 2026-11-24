// V3 READ-1 (b): migration 0075 `comm_native` on PGlite: old rows false, rows with a recorded source backfilled true, rollback drops the column. $0.
import { assertEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const MIG = new URL("../../supabase/migrations/0075_comm_native.sql", import.meta.url);

async function db(): Promise<PGlite> {
  const pg = new PGlite();
  // The columns 0069 and 0072 add, as they are; the real table is 0001's.
  await pg.exec(`create schema if not exists public;
    create table public.beliefs (id text primary key, owner uuid not null default gen_random_uuid(), comm_kind text, comm_source text);
    insert into public.beliefs (id, comm_kind, comm_source) values
      ('old', null, null),                 -- an old kenning
      ('carried', 'other', null),          -- carried over, no recorded source
      ('typed', 'how_i_mean', 'typed'),    -- created as an item
      ('said', 'gets_heated', 'talk_said');`);
  await pg.exec(await Deno.readTextFile(MIG));
  return pg;
}
const marks = async (pg: PGlite) => Object.fromEntries((await pg.query<{ id: string; comm_native: boolean }>("select id, comm_native from public.beliefs order by id")).rows.map((r) => [r.id, r.comm_native]));

Deno.test("0075: old and carried-over rows are false, items with a recorded source are backfilled true, new rows default false", async () => {
  const pg = await db();
  assertEquals(await marks(pg), { carried: false, old: false, said: true, typed: true });
  await pg.exec("insert into public.beliefs (id) values ('fresh')");
  assertEquals((await marks(pg)).fresh, false);
  await pg.close();
});

Deno.test("0075: running it twice is safe: the column is not added again and the marks come out the same", async () => {
  const pg = await db();
  const once = await marks(pg);
  await pg.exec(await Deno.readTextFile(MIG));
  assertEquals(await marks(pg), once);
  await pg.close();
});

Deno.test("0075: the rollback line drops the column and nothing else", async () => {
  const pg = await db();
  const down = (await Deno.readTextFile(MIG)).split("-- Rollback:")[1].split("\n").map((l) => l.replace(/^--\s?/, "")).join("\n");
  await pg.exec(down);
  const cols = (await pg.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='beliefs' order by 1")).rows.map((r) => r.column_name);
  assertEquals(cols, ["comm_kind", "comm_source", "id", "owner"]);
  await pg.close();
});
