// Migration 0049 (contract v1.52): per-item sharing under real row level security in PGlite.
// Nothing shared by default; only the owner writes, only a live confirmed belief; the grantee reads the grant, never the belief;
// revoking and "Not me" take effect at once; deleting an account takes every grant made or received.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const dir = new URL("../../supabase/migrations/", import.meta.url);

async function db() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    create schema extensions; create function extensions.digest(b bytea, t text) returns bytea language sql as $$ select b $$;
    create schema cron; create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
    create function cron.unschedule(a text) returns boolean language sql as $$ select true $$;
    create schema net; create function net.http_post(url text, body jsonb default null, headers jsonb default null, params jsonb default null, timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
    create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`);
  const names = [...Deno.readDirSync(dir)].map((e) => e.name).filter((n) => n.endsWith(".sql")).sort();
  for (const n of names) await pg.exec((await Deno.readTextFile(new URL(n, dir))).replace(/create extension[^;]*;/gi, ""));
  await pg.exec("grant usage on schema public, auth to authenticated; grant all on all tables in schema public to authenticated; grant select on auth.users to authenticated;");
  return pg;
}
const as = async (pg: PGlite, uid: string | null) => {
  await pg.exec("reset role");
  if (uid) { await pg.exec("set role authenticated"); await pg.query("select set_config('app.uid', $1, false)", [uid]); }
};

Deno.test("share_items: owner-only writes, grantee reads the grant, revoke and Not me are immediate", async () => {
  const pg = await db();
  const a = crypto.randomUUID(), b = crypto.randomUUID(), c = crypto.randomUUID();
  for (const id of [a, b, c]) {
    await pg.query("insert into auth.users(id) values ($1)", [id]);
    await pg.query("insert into profiles(id, name) values ($1, 'Person')", [id]);
  }
  const mk = async (status: string, rating: string | null, text: string) =>
    (await pg.query<{ id: string }>(
      `insert into beliefs(owner,label,statement,type,kind,area,status,rating) values ($1,'L',$2,'something I believe is true','foundation','relationships',$3,$4) returning id`,
      [a, text, status, rating])).rows[0].id;
  const very = await mk("confirmed", "very", "I need time to think");
  const guess = await mk("guess", null, "inferred, unrated");

  // nothing shared by default
  await as(pg, b);
  assertEquals((await pg.query("select 1 from share_items")).rows.length, 0);

  // owner shares a live confirmed belief with b
  await as(pg, a);
  await pg.query("insert into share_items(owner,other,belief_id,wording) values ($1,$2,$3,'I need a little time')", [a, b, very]);
  // a guess cannot be offered (law 3)
  await assertRejects(() => pg.query("insert into share_items(owner,other,belief_id,wording) values ($1,$2,$3,'x')", [a, b, guess]), Error, "row-level security");
  // nobody shares as someone else
  await as(pg, b);
  await assertRejects(() => pg.query("insert into share_items(owner,other,belief_id,wording) values ($1,$2,$3,'forged')", [a, b, very]), Error, "row-level security");

  // the grantee reads the grant (wording), c reads nothing, and b cannot read the belief behind it
  await as(pg, b);
  const seen = await pg.query<{ wording: string }>("select wording from share_items");
  assertEquals(seen.rows.map((r) => r.wording), ["I need a little time"]);
  await as(pg, c);
  assertEquals((await pg.query("select 1 from share_items")).rows.length, 0);
  await as(pg, b);
  assertEquals((await pg.query("select 1 from beliefs where id = $1", [very])).rows.length, 0);
  // the grantee cannot edit or revoke the owner's grant
  await pg.query("update share_items set wording = 'mine now'");
  await pg.query("delete from share_items");
  await as(pg, a);
  assertEquals((await pg.query<{ wording: string }>("select wording from share_items")).rows[0].wording, "I need a little time");

  // Not me / set aside: the grantee stops seeing it at once, with no cleanup step
  await pg.query("update beliefs set status = 'set_aside' where id = $1", [very]);
  await as(pg, b);
  assertEquals((await pg.query("select 1 from share_items")).rows.length, 0);
  await as(pg, a);
  await pg.query("update beliefs set status = 'confirmed', rating = 'not' where id = $1", [very]);
  await as(pg, b);
  assertEquals((await pg.query("select 1 from share_items")).rows.length, 0);
  await as(pg, a);
  await pg.query("update beliefs set rating = 'partly' where id = $1", [very]);
  await as(pg, b);
  assertEquals((await pg.query("select 1 from share_items")).rows.length, 1);

  // revoke is a delete, seen at once
  await as(pg, a);
  await pg.query("delete from share_items where belief_id = $1 and other = $2", [very, b]);
  await as(pg, b);
  assertEquals((await pg.query("select 1 from share_items")).rows.length, 0);
  await pg.close();
});

Deno.test("share_items: deleting an account removes grants made and received", async () => {
  const pg = await db();
  const a = crypto.randomUUID(), b = crypto.randomUUID();
  for (const id of [a, b]) {
    await pg.query("insert into auth.users(id) values ($1)", [id]);
    await pg.query("insert into profiles(id, name) values ($1, 'Person')", [id]);
  }
  const mk = async (owner: string) =>
    (await pg.query<{ id: string }>(
      `insert into beliefs(owner,label,statement,type,kind,area,status,rating) values ($1,'L','s','something I believe is true','foundation','work','confirmed','very') returning id`, [owner])).rows[0].id;
  await pg.query("insert into share_items(owner,other,belief_id,wording) values ($1,$2,$3,'w1'), ($2,$1,$4,'w2')", [a, b, await mk(a), await mk(b)]);
  assertEquals((await pg.query("select 1 from share_items")).rows.length, 2);
  await pg.query("select public.delete_account($1)", [a]);
  const left = await pg.query<{ owner: string }>("select owner from share_items");
  assert(left.rows.length === 0, `grants made or received by the deleted account survive: ${JSON.stringify(left.rows)}`);
  await pg.close();
});
