// QA-B403 + QA-B404 on the real migrations (PGlite): 0074 hides existing removals from the removed person, and delete_account withdraws
// bridges others scheduled to the deleted account. Mutation check: drop step 1b or the update in 0074 and the matching test fails.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const dir = new URL("../../supabase/migrations/", import.meta.url);
const PRE = `create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users(id uuid primary key default gen_random_uuid());
  create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
  create schema extensions; create function extensions.digest(b bytea, t text) returns bytea language sql as $$ select b $$;
  create schema cron; create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
  create function cron.unschedule(a text) returns boolean language sql as $$ select true $$;
  create schema net; create function net.http_post(url text, body jsonb default null, headers jsonb default null, params jsonb default null, timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
  create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`;
const NEW = "0074_removal_hidden_and_incoming_withdrawn.sql";

async function migrated(upTo: "before" | "all") {
  const pg = new PGlite();
  await pg.exec(PRE);
  const names = [...Deno.readDirSync(dir)].map((e) => e.name).filter((n) => n.endsWith(".sql")).sort()
    .filter((n) => upTo === "all" || n < NEW);
  for (const n of names) await pg.exec((await Deno.readTextFile(new URL(n, dir))).replace(/create extension[^;]*;/gi, ""));
  return pg;
}
async function person(pg: PGlite, name: string) {
  const id = crypto.randomUUID();
  await pg.query("insert into auth.users(id) values ($1)", [id]);
  await pg.query("insert into profiles(id, name) values ($1, $2)", [id, name]);
  return id;
}
const bridge = (pg: PGlite, sender: string, receiver: string, deliverIn: string, extra = "status = 'scheduled'") =>
  pg.query<{ id: string }>(
    `insert into bridges(sender, receiver, original, final, used, deliver_at) values ($1,$2,'o','f','mine', now() + $3::interval) returning id`,
    [sender, receiver, deliverIn],
  ).then(async (r) => { await pg.query(`update bridges set ${extra} where id = $1`, [r.rows[0].id]); return r.rows[0].id; });
const statusOf = async (pg: PGlite, id: string) => (await pg.query<{ status: string }>("select status from bridges where id = $1", [id])).rows[0].status;

Deno.test("0074 flips person-made removals to invisible and leaves an account delete's removal visible", async () => {
  const pg = await migrated("before");
  const a = await person(pg, "Ava"), b = await person(pg, "Ben"), c = await person(pg, "Cy"), gone = await person(pg, "Gone");
  await pg.query("insert into thread_events(person_a, person_b, type) values ($1,$2,'removed'), ($3,$4,'removed'), ($1,$2,'talked')", [a, b, gone, c]);
  await pg.query("update profiles set deleted_at = now(), name = 'Deleted account' where id = $1", [gone]);
  await pg.exec((await Deno.readTextFile(new URL(NEW, dir))));
  const vis = async (x: string, type: string) => (await pg.query<{ v: boolean }>("select visible_to_b v from thread_events where person_a = $1 and type = $2", [x, type])).rows[0].v;
  assertEquals(await vis(a, "removed"), false, "Ava's removal of Ben is hidden from Ben");
  assertEquals(await vis(gone, "removed"), true, "the deleted account's own removal stays readable");
  assertEquals(await vis(a, "talked"), true, "other events untouched");
  await pg.close();
});

Deno.test("delete_account withdraws bridges others scheduled to the account that are not yet due; delivered, opened and withdrawn rows stay", async () => {
  const pg = await migrated("all");
  const a = await person(pg, "Ava"), gone = await person(pg, "Gone"), c = await person(pg, "Cy");
  const future = await bridge(pg, a, gone, "2 days");
  const futureFromC = await bridge(pg, c, gone, "1 hour");
  const due = await bridge(pg, a, gone, "-1 hour");
  const opened = await bridge(pg, a, gone, "2 days", "opened_at = now()");
  const elsewhere = await bridge(pg, a, c, "2 days");
  const own = await bridge(pg, gone, a, "2 days");
  const r = await pg.query<{ w: { withdrawn: string[] } }>("select public.delete_account($1) as w", [gone]);
  assertEquals(r.rows[0].w.withdrawn, [own], "the reply's withdrawn list is still only the deleted person's own bridges");
  assertEquals(
    await Promise.all([future, futureFromC, due, opened, elsewhere, own].map((id) => statusOf(pg, id))),
    ["withdrawn", "withdrawn", "scheduled", "scheduled", "scheduled", "withdrawn"],
  );
  assert((await pg.query("select 1 from bridges where id = $1 and withdrawn_at is not null", [future])).rows.length === 1);
  await pg.close();
});
